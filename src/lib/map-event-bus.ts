/**
 * MAP Event Bus
 *
 * In-process event bus for the Context Hub daemon. Ring buffer store,
 * subscriber management with glob pattern matching, fan-out to SSE/WS/poll.
 *
 * @purpose Core event bus for MAP protocol — lives inside Context Hub process
 */

import * as fs from "fs"
import * as path from "path"
import * as crypto from "crypto"
import type { MAPEvent, MAPEventType, MAPSubscription } from "../types/map.js"

function generateId(): string {
  return crypto.randomUUID()
}

function matchPattern(pattern: string, type: string): boolean {
  if (pattern === "*") return true
  if (pattern === type) return true

  if (pattern.includes("*")) {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$")
    return regex.test(type)
  }

  return false
}

export type EventCallback = (event: MAPEvent) => void

interface InternalSubscription extends MAPSubscription {
  callback?: EventCallback
}

export class MAPEventBus {
  private buffer: MAPEvent[] = []
  private maxSize: number
  private subscribers: Map<string, InternalSubscription> = new Map()
  private persistPath: string | null
  private watchAbort: AbortController | null = null
  private serviceEventsWatcher: fs.FSWatcher | null = null
  private serviceEventsOffset: number = 0
  private journalWatcher: fs.FSWatcher | null = null
  private journalOffsets: Map<string, number> = new Map()
  private dirWatcher: fs.FSWatcher | null = null

  constructor(options: {
    maxSize?: number
    persistPath?: string | null
    serviceEventsPath?: string | null
    journalDir?: string | null
  } = {}) {
    this.maxSize = options.maxSize ?? 1000
    this.persistPath = options.persistPath ?? null

    if (this.persistPath) {
      this.loadPersistedEvents()
    }

    if (options.serviceEventsPath) {
      this.bridgeServiceEvents(options.serviceEventsPath)
    }

    if (options.journalDir) {
      this.bridgeJournalEntries(options.journalDir)
    }
  }

  emit(partial: Omit<MAPEvent, "id" | "ts">): MAPEvent {
    const event: MAPEvent = {
      ...partial,
      id: generateId(),
      ts: new Date().toISOString(),
    }

    this.buffer.push(event)

    if (this.buffer.length > this.maxSize) {
      this.buffer = this.buffer.slice(this.buffer.length - this.maxSize)
    }

    if (this.persistPath) {
      try {
        fs.appendFileSync(this.persistPath, JSON.stringify(event) + "\n")
      } catch {
        // Non-fatal — persistence is best-effort
      }
    }

    this.fanOut(event)

    return event
  }

  subscribe(sub: {
    clientId: string
    patterns: string[]
    transport: "sse" | "websocket" | "poll"
    callback?: EventCallback
  }): MAPSubscription {
    const subscription: InternalSubscription = {
      id: generateId(),
      clientId: sub.clientId,
      patterns: sub.patterns,
      transport: sub.transport,
      createdAt: new Date().toISOString(),
      callback: sub.callback,
    }

    this.subscribers.set(subscription.id, subscription)

    return {
      id: subscription.id,
      clientId: subscription.clientId,
      patterns: subscription.patterns,
      transport: subscription.transport,
      createdAt: subscription.createdAt,
    }
  }

  unsubscribe(id: string): boolean {
    return this.subscribers.delete(id)
  }

  getEvents(options: {
    since?: string
    pattern?: string
    limit?: number
  } = {}): MAPEvent[] {
    let events = [...this.buffer]

    if (options.since) {
      const sinceTime = new Date(options.since).getTime()
      events = events.filter(e => new Date(e.ts).getTime() > sinceTime)
    }

    if (options.pattern) {
      const pattern = options.pattern
      events = events.filter(e => matchPattern(pattern, e.type))
    }

    if (options.limit && events.length > options.limit) {
      events = events.slice(events.length - options.limit)
    }

    return events
  }

  getSubscriberCount(): number {
    return this.subscribers.size
  }

  destroy(): void {
    if (this.serviceEventsWatcher) {
      this.serviceEventsWatcher.close()
      this.serviceEventsWatcher = null
    }
    if (this.journalWatcher) {
      this.journalWatcher.close()
      this.journalWatcher = null
    }
    if (this.dirWatcher) {
      this.dirWatcher.close()
      this.dirWatcher = null
    }
    this.subscribers.clear()
  }

  private fanOut(event: MAPEvent): void {
    for (const [, sub] of this.subscribers) {
      const matches = sub.patterns.some(p => matchPattern(p, event.type))
      if (matches && sub.callback) {
        try {
          sub.callback(event)
        } catch {
          // Don't let subscriber errors crash the bus
        }
      }
      if (matches) {
        sub.lastEventId = event.id
      }
    }
  }

  private loadPersistedEvents(): void {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return

    try {
      const content = fs.readFileSync(this.persistPath, "utf-8")
      const lines = content.trim().split("\n").filter(l => l.trim())

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as MAPEvent
          if (event.ttl) {
            const age = (Date.now() - new Date(event.ts).getTime()) / 1000
            if (age > event.ttl) continue
          }
          this.buffer.push(event)
        } catch {
          // Skip malformed lines
        }
      }

      if (this.buffer.length > this.maxSize) {
        this.buffer = this.buffer.slice(this.buffer.length - this.maxSize)
      }
    } catch {
      // Non-fatal
    }

    // Truncate persisted file on startup to just what we loaded
    if (this.persistPath) {
      try {
        const content = this.buffer.map(e => JSON.stringify(e)).join("\n") + "\n"
        fs.writeFileSync(this.persistPath, content)
      } catch {
        // Non-fatal
      }
    }
  }

  private bridgeServiceEvents(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      // File doesn't exist yet — watch the parent directory for its creation
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }) } catch { /* non-fatal */ }
      }
      // Create empty file so fs.watch works
      try { fs.writeFileSync(filePath, "") } catch { /* non-fatal */ }
    }

    // Read existing events
    try {
      const content = fs.readFileSync(filePath, "utf-8")
      this.serviceEventsOffset = content.length

      const lines = content.trim().split("\n").filter(l => l.trim())
      for (const line of lines.slice(-50)) {
        try {
          const entry = JSON.parse(line)
          this.emit({
            type: (entry.type || "custom") as MAPEventType,
            source: `service:${entry.service || "unknown"}`,
            session: entry.session,
            data: entry,
          })
        } catch {
          // Skip malformed
        }
      }
    } catch {
      // Non-fatal
    }

    // Watch for new entries
    try {
      this.serviceEventsWatcher = fs.watch(filePath, () => {
        try {
          const content = fs.readFileSync(filePath, "utf-8")
          if (content.length <= this.serviceEventsOffset) return

          const newContent = content.slice(this.serviceEventsOffset)
          this.serviceEventsOffset = content.length

          const lines = newContent.trim().split("\n").filter(l => l.trim())
          for (const line of lines) {
            try {
              const entry = JSON.parse(line)
              this.emit({
                type: (entry.type || "custom") as MAPEventType,
                source: `service:${entry.service || "unknown"}`,
                session: entry.session,
                data: entry,
              })
            } catch {
              // Skip malformed
            }
          }
        } catch {
          // Non-fatal
        }
      })
    } catch {
      // Non-fatal — file watching not critical
    }
  }

  private bridgeJournalEntries(journalDir: string): void {
    if (!fs.existsSync(journalDir)) {
      try { fs.mkdirSync(journalDir, { recursive: true }) } catch { return }
    }

    // Initialize offsets for existing files
    try {
      const files = fs.readdirSync(journalDir).filter(f => f.endsWith(".jsonl"))
      for (const file of files) {
        const filePath = path.join(journalDir, file)
        try {
          const content = fs.readFileSync(filePath, "utf-8")
          this.journalOffsets.set(filePath, content.length)
        } catch {
          // skip
        }
      }
    } catch {
      // non-fatal
    }

    // Watch journal directory for changes
    try {
      this.journalWatcher = fs.watch(journalDir, (_eventType, filename) => {
        if (!filename || !filename.endsWith(".jsonl")) return

        const filePath = path.join(journalDir, filename)
        if (!fs.existsSync(filePath)) return

        try {
          const content = fs.readFileSync(filePath, "utf-8")
          const previousOffset = this.journalOffsets.get(filePath) ?? 0

          if (content.length <= previousOffset) return

          const newContent = content.slice(previousOffset)
          this.journalOffsets.set(filePath, content.length)

          const lines = newContent.trim().split("\n").filter(l => l.trim())
          for (const line of lines) {
            try {
              const entry = JSON.parse(line)
              this.emit({
                type: "journal:entry" as MAPEventType,
                source: `journal:${entry.session || filename.replace(".jsonl", "")}`,
                session: entry.session,
                data: {
                  title: entry.title,
                  type: entry.type,
                  summary: entry.summary,
                  status: entry.status,
                  files: entry.files,
                  ts: entry.ts,
                },
              })
            } catch {
              // Skip malformed
            }
          }
        } catch {
          // Non-fatal
        }
      })
    } catch {
      // Non-fatal
    }
  }
}
