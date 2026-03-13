/**
 * @purpose Lightweight telemetry client with batched HTTP flush, spillover queue, and opt-out consent
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, truncateSync } from 'fs'
import { join, dirname } from 'path'
import { platform } from 'os'
import { fileURLToPath } from 'url'
import type { TelemetryEvent, TelemetryConfig } from '../types/telemetry.js'
import { JFL_PATHS, JFL_FILES } from '../utils/jfl-paths.js'

const BATCH_SIZE = 25
const FLUSH_INTERVAL_MS = 10_000
const FLUSH_TIMEOUT_MS = 2_000
const INGEST_URL_DEFAULT = 'https://jfl-platform.fly.dev/api/v1/telemetry/ingest'

let jflVersion: string | undefined

function getJflVersion(): string {
  if (jflVersion) return jflVersion
  try {
    // Try multiple strategies to find package.json
    let pkgPath: string | undefined

    // Strategy 1: CommonJS __dirname (Jest test environment)
    if (typeof __dirname !== 'undefined') {
      pkgPath = join(__dirname, '../../package.json')
    }

    // Strategy 2: process.cwd() fallback
    if (!pkgPath || !existsSync(pkgPath)) {
      pkgPath = join(process.cwd(), 'package.json')
    }

    // Strategy 3: ESM import.meta.url (production) - wrapped to avoid parse errors
    if (!existsSync(pkgPath)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const metaUrl = new Function('return import.meta.url')()
        pkgPath = fileURLToPath(new URL('../../package.json', metaUrl))
      } catch {
        // import.meta not available
      }
    }

    if (pkgPath && existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      jflVersion = pkg.version || 'unknown'
    } else {
      jflVersion = 'unknown'
    }
  } catch {
    jflVersion = 'unknown'
  }
  return jflVersion!
}

class TelemetryClient {
  private queue: TelemetryEvent[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private initialized = false
  private disabled = false
  private sessionId: string = ''
  private installId: string = ''
  private flushing = false
  private exitHandlerRegistered = false

  track(partial: Partial<TelemetryEvent> & Pick<TelemetryEvent, 'category' | 'event'>): void {
    if (this.disabled) return

    if (!this.initialized) {
      this.init()
      if (this.disabled) return
    }

    const event: TelemetryEvent = {
      event_id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      session_id: this.sessionId,
      install_id: this.installId,
      jfl_version: getJflVersion(),
      node_version: process.versions.node,
      os: platform(),
      ...partial,
    } as TelemetryEvent

    this.queue.push(event)

    if (this.queue.length >= BATCH_SIZE) {
      this.flush()
    }
  }

  private init(): void {
    this.initialized = true

    // Env var override — highest priority
    const envVar = process.env.JFL_TELEMETRY
    if (envVar === '0' || envVar === 'false' || envVar === 'off') {
      this.disabled = true
      return
    }
    const envForceEnable = envVar === '1' || envVar === 'true' || envVar === 'on'

    const config = this.getConfig()

    if (!envForceEnable) {
      // First-time consent notice
      if (config.consent_shown !== true) {
        if (process.stdout.isTTY) {
          this.showConsentNotice()
          config.consent_shown = true
          if (config.enabled === undefined) {
            config.enabled = true
          }
          this.saveConfig(config)
        } else {
          // Non-TTY: default disabled until explicitly enabled
          this.disabled = true
          return
        }
      }

      if (config.enabled === false) {
        this.disabled = true
        return
      }
    }

    // Install ID
    if (!config.install_id) {
      config.install_id = crypto.randomUUID()
      this.saveConfig(config)
    }
    this.installId = config.install_id

    // Session ID (random per process)
    this.sessionId = crypto.randomUUID()

    // Start flush timer
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
    this.timer.unref()

    // Register exit handler
    if (!this.exitHandlerRegistered) {
      this.exitHandlerRegistered = true
      const onExit = () => this.flushSync()
      process.on('beforeExit', onExit)
      process.on('SIGINT', () => { this.flushSync(); process.exit(0) })
      process.on('SIGTERM', () => { this.flushSync(); process.exit(0) })
    }

    // Load spillover from previous run
    this.loadSpillover()
  }

  private showConsentNotice(): void {
    const notice = `
  JFL Telemetry Notice

  JFL collects anonymous usage data to improve the tool.
  No file paths, arguments, usernames, or content are collected.

  Disable anytime:  jfl preferences --no-telemetry
  Or set:           JFL_TELEMETRY=0
`
    process.stderr.write(notice)
  }

  private getConfig(): TelemetryConfig {
    try {
      const configPath = JFL_FILES.config
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'))
        return config.telemetry || {}
      }
    } catch {
      // ignore
    }
    return {}
  }

  private saveConfig(telemetryConfig: TelemetryConfig): void {
    try {
      const configPath = JFL_FILES.config
      const configDir = dirname(configPath)
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true })
      }
      let config: Record<string, any> = {}
      if (existsSync(configPath)) {
        try {
          config = JSON.parse(readFileSync(configPath, 'utf-8'))
        } catch {
          config = {}
        }
      }
      config.telemetry = telemetryConfig
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
    } catch {
      // ignore — config write is best-effort
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return
    this.flushing = true

    const batch = this.queue.splice(0, BATCH_SIZE)

    this.archiveLocally(batch)

    const url = process.env.JFL_PLATFORM_URL
      ? `${process.env.JFL_PLATFORM_URL}/api/v1/telemetry/ingest`
      : INGEST_URL_DEFAULT

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-JFL-Install-Id': this.installId,
        },
        body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(5_000),
      })

      if (response.status === 401) {
        this.disabled = true
        return
      }

      if (response.status === 429) {
        this.queue.unshift(...batch)
        return
      }

      if (!response.ok) {
        this.spillToDisk(batch)
      }
    } catch {
      this.spillToDisk(batch)
    } finally {
      this.flushing = false
    }
  }

  private flushSync(): void {
    if (this.queue.length === 0) return
    const batch = this.queue.splice(0)
    this.archiveLocally(batch)
    this.spillToDisk(batch)
  }

  private get spilloverPath(): string {
    return JFL_FILES.telemetryQueue
  }

  private archiveLocally(events: TelemetryEvent[]): void {
    try {
      const archivePath = JFL_FILES.telemetryArchive
      const dir = dirname(archivePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n'
      appendFileSync(archivePath, lines)
    } catch {}
  }

  private spillToDisk(events: TelemetryEvent[]): void {
    try {
      const dir = dirname(this.spilloverPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n'
      appendFileSync(this.spilloverPath, lines)
    } catch {
      // Last resort — drop events silently
    }
  }

  private loadSpillover(): void {
    try {
      if (!existsSync(this.spilloverPath)) return
      const content = readFileSync(this.spilloverPath, 'utf-8').trim()
      if (!content) return

      const events: TelemetryEvent[] = []
      for (const line of content.split('\n')) {
        try {
          events.push(JSON.parse(line))
        } catch {
          // skip bad lines
        }
      }

      if (events.length > 0) {
        this.queue.unshift(...events)
        // Truncate file after loading
        truncateSync(this.spilloverPath, 0)
      }
    } catch {
      // ignore
    }
  }

  isEnabled(): boolean {
    if (!this.initialized) this.init()
    return !this.disabled
  }

  getInstallId(): string {
    if (!this.initialized) this.init()
    return this.installId
  }

  getSessionId(): string {
    if (!this.initialized) this.init()
    return this.sessionId
  }

  getQueueSize(): number {
    return this.queue.length
  }

  getSpilloverEvents(): TelemetryEvent[] {
    try {
      if (!existsSync(this.spilloverPath)) return []
      const content = readFileSync(this.spilloverPath, 'utf-8').trim()
      if (!content) return []
      return content.split('\n').map(line => {
        try { return JSON.parse(line) } catch { return null }
      }).filter(Boolean) as TelemetryEvent[]
    } catch {
      return []
    }
  }

  disable(): void {
    this.disabled = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    const config = this.getConfig()
    config.enabled = false
    this.saveConfig(config)
  }

  enable(): void {
    const config = this.getConfig()
    config.enabled = true
    config.consent_shown = true
    if (!config.install_id) {
      config.install_id = crypto.randomUUID()
    }
    this.saveConfig(config)
    this.disabled = false
    this.initialized = false // Re-init on next track()
  }

  resetInstallId(): void {
    const config = this.getConfig()
    config.install_id = crypto.randomUUID()
    this.saveConfig(config)
    this.installId = config.install_id!
  }
}

// Singleton
export const telemetry = new TelemetryClient()
