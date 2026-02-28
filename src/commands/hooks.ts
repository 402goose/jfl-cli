/**
 * jfl hooks - Manage Claude Code HTTP hooks for Context Hub
 *
 * Configures Claude Code to POST hook events to Context Hub's /api/hooks
 * endpoint, bridging tool use, session lifecycle, and subagent events
 * into the MAP event bus.
 *
 * @purpose CLI command to init/status/remove Claude Code HTTP hooks
 */

import chalk from "chalk"
import * as fs from "fs"
import * as path from "path"
import { getProjectPort } from "../utils/context-hub-port.js"
import { stringify as stringifyYaml } from "yaml"

const HOOK_EVENTS = ["PostToolUse", "Stop", "PreCompact", "SubagentStart", "SubagentStop"] as const

const DEFAULT_FLOWS_YAML = {
  flows: [
    {
      name: "session-activity-log",
      description: "Log tool use activity for session analysis",
      enabled: true,
      trigger: { pattern: "hook:tool-use" },
      actions: [{ type: "log", message: "Tool used: {{data.tool_name}} on {{data.file_paths}}" }],
    },
    {
      name: "session-end-summary",
      description: "Emit summary event when session stops",
      enabled: true,
      trigger: { pattern: "hook:stop" },
      actions: [{
        type: "emit",
        event_type: "session:ended",
        data: { source: "flow:session-end-summary", auto_captured: true },
      }],
    },
  ],
}

interface HookCommand {
  type: "command" | "http"
  command?: string
  url?: string
  args?: string[]
  async?: boolean
}

interface HookEntry {
  matcher: string
  hooks: HookCommand[]
}

interface SettingsJson {
  hooks?: Record<string, HookEntry[]>
  [key: string]: unknown
}

function findProjectRoot(): string | null {
  let dir = process.cwd()
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".jfl", "config.json"))) {
      return dir
    }
    dir = path.dirname(dir)
  }
  return null
}

function resolvePort(): number {
  const projectRoot = findProjectRoot()

  if (projectRoot) {
    const configPath = path.join(projectRoot, ".jfl", "config.json")
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
      if (config.type === "service" && config.gtm_parent) {
        const parentPort = getProjectPort(config.gtm_parent)
        return parentPort
      }
    } catch {}
  }

  return getProjectPort(projectRoot || process.cwd())
}

function readSettings(): SettingsJson {
  const settingsPath = path.join(process.cwd(), ".claude", "settings.json")
  if (!fs.existsSync(settingsPath)) {
    return {}
  }
  return JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
}

function writeSettings(settings: SettingsJson): void {
  const settingsDir = path.join(process.cwd(), ".claude")
  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true })
  }
  fs.writeFileSync(
    path.join(settingsDir, "settings.json"),
    JSON.stringify(settings, null, 2) + "\n"
  )
}

function isHttpHook(cmd: HookCommand): boolean {
  return cmd.type === "http"
}

async function initHooks(): Promise<void> {
  const port = resolvePort()
  const hookUrl = `http://localhost:${port}/api/hooks`

  const settings = readSettings()
  if (!settings.hooks) {
    settings.hooks = {}
  }

  let added = 0

  for (const eventName of HOOK_EVENTS) {
    if (!settings.hooks[eventName]) {
      settings.hooks[eventName] = []
    }

    const entries = settings.hooks[eventName]
    const alreadyHasHttp = entries.some(
      (entry) => entry.hooks?.some((h) => isHttpHook(h) && h.url?.includes("/api/hooks"))
    )

    if (alreadyHasHttp) {
      continue
    }

    entries.push({
      matcher: "",
      hooks: [{ type: "http", url: hookUrl }],
    })
    added++
  }

  writeSettings(settings)

  if (added > 0) {
    console.log(chalk.green(`\n  HTTP hooks configured for ${added} events → ${hookUrl}\n`))
  } else {
    console.log(chalk.yellow(`\n  HTTP hooks already configured → ${hookUrl}\n`))
  }

  console.log(chalk.gray("  Events:"))
  for (const eventName of HOOK_EVENTS) {
    console.log(chalk.gray(`    ${eventName}`))
  }
  console.log()

  const flowsPath = path.join(process.cwd(), ".jfl", "flows.yaml")
  if (!fs.existsSync(flowsPath)) {
    const jflDir = path.join(process.cwd(), ".jfl")
    if (!fs.existsSync(jflDir)) {
      fs.mkdirSync(jflDir, { recursive: true })
    }
    fs.writeFileSync(flowsPath, stringifyYaml(DEFAULT_FLOWS_YAML, { lineWidth: 120 }))
    console.log(chalk.green("  Default flows created → .jfl/flows.yaml"))
    console.log(chalk.gray("  Run: jfl flows list"))
    console.log()
  }
}

async function statusHooks(): Promise<void> {
  const port = resolvePort()
  const hookUrl = `http://localhost:${port}/api/hooks`
  const settings = readSettings()

  console.log(chalk.bold("\n  Claude Code HTTP Hooks\n"))
  console.log(chalk.gray("  Target: ") + chalk.cyan(hookUrl))

  if (!settings.hooks) {
    console.log(chalk.yellow("\n  No hooks configured.\n"))
    return
  }

  let httpCount = 0
  for (const [eventName, entries] of Object.entries(settings.hooks)) {
    for (const entry of entries as HookEntry[]) {
      for (const cmd of entry.hooks || []) {
        if (isHttpHook(cmd)) {
          console.log(chalk.green("  ✓ ") + chalk.bold(eventName) + chalk.gray(` → ${cmd.url}`))
          httpCount++
        }
      }
    }
  }

  if (httpCount === 0) {
    console.log(chalk.yellow("  No HTTP hooks found."))
    console.log(chalk.gray("  Run: jfl hooks init"))
  }

  console.log()

  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    if (response.ok) {
      console.log(chalk.green("  Context Hub: running") + chalk.gray(` (port ${port})`))
    } else {
      console.log(chalk.red("  Context Hub: not responding"))
    }
  } catch {
    console.log(chalk.red("  Context Hub: not running"))
    console.log(chalk.gray("  Run: jfl context-hub start"))
  }
  console.log()
}

async function removeHooks(): Promise<void> {
  const settings = readSettings()

  if (!settings.hooks) {
    console.log(chalk.yellow("\n  No hooks configured.\n"))
    return
  }

  let removed = 0

  for (const [eventName, entries] of Object.entries(settings.hooks)) {
    const filtered = (entries as HookEntry[]).map((entry) => {
      const originalLen = entry.hooks?.length || 0
      const kept = (entry.hooks || []).filter((cmd) => !isHttpHook(cmd))
      removed += originalLen - kept.length
      return { ...entry, hooks: kept }
    }).filter((entry) => entry.hooks.length > 0)

    if (filtered.length > 0) {
      settings.hooks[eventName] = filtered
    } else {
      delete settings.hooks[eventName]
    }
  }

  writeSettings(settings)

  if (removed > 0) {
    console.log(chalk.green(`\n  Removed ${removed} HTTP hook(s). Shell hooks preserved.\n`))
  } else {
    console.log(chalk.yellow("\n  No HTTP hooks found to remove.\n"))
  }
}

async function deployHooks(all: boolean): Promise<void> {
  const projectRoot = findProjectRoot()
  if (!projectRoot) {
    console.log(chalk.red("\n  Not in a JFL project. Run from a directory with .jfl/config.json\n"))
    return
  }

  const configPath = path.join(projectRoot, ".jfl", "config.json")
  let config: any
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
  } catch {
    console.log(chalk.red("\n  Failed to read .jfl/config.json\n"))
    return
  }

  const services: Array<{ name: string; path: string }> = config.registered_services || []

  if (services.length === 0) {
    console.log(chalk.yellow("\n  No registered services found in .jfl/config.json"))
    console.log(chalk.gray("  Register services with: jfl services register <path>\n"))
    return
  }

  console.log(chalk.bold(`\n  Deploying hooks to ${services.length} service(s)\n`))

  let success = 0
  let skipped = 0
  let failed = 0

  for (const service of services) {
    const servicePath = path.isAbsolute(service.path)
      ? service.path
      : path.resolve(projectRoot, service.path)
    const serviceName = service.name || path.basename(servicePath)

    if (!fs.existsSync(servicePath)) {
      console.log(chalk.red(`  ✗ ${serviceName} — directory not found: ${servicePath}`))
      failed++
      continue
    }

    const settingsDir = path.join(servicePath, ".claude")
    const settingsPath = path.join(settingsDir, "settings.json")

    let settings: any = {}
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
      } catch {
        settings = {}
      }
    }

    if (!settings.hooks) {
      settings.hooks = {}
    }

    const port = getProjectPort(projectRoot)
    const hookUrl = `http://localhost:${port}/api/hooks`

    let added = 0
    for (const eventName of HOOK_EVENTS) {
      if (!settings.hooks[eventName]) {
        settings.hooks[eventName] = []
      }
      const entries = settings.hooks[eventName]
      const alreadyHasHttp = entries.some(
        (entry: any) => entry.hooks?.some((h: any) => h.type === "http" && h.url?.includes("/api/hooks"))
      )
      if (alreadyHasHttp) continue

      entries.push({
        matcher: "",
        hooks: [{ type: "http", url: hookUrl }],
      })
      added++
    }

    if (added === 0) {
      console.log(chalk.gray(`  - ${serviceName} — hooks already configured`))
      skipped++
      continue
    }

    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true })
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n")
    console.log(chalk.green(`  ✓ ${serviceName} — ${added} hook events → ${hookUrl}`))
    success++
  }

  console.log(chalk.bold(`\n  Done: ${success} configured, ${skipped} already set, ${failed} failed\n`))
}

export async function hooksCommand(action?: string): Promise<void> {
  switch (action) {
    case "init":
      await initHooks()
      break
    case "status":
      await statusHooks()
      break
    case "remove":
      await removeHooks()
      break
    case "deploy":
      await deployHooks(true)
      break
    default:
      console.log(chalk.bold("\n  jfl hooks - Claude Code HTTP hooks for Context Hub\n"))
      console.log(chalk.gray("  Commands:"))
      console.log("    jfl hooks init     Configure HTTP hooks in .claude/settings.json")
      console.log("    jfl hooks status   Show configured hooks and hub connectivity")
      console.log("    jfl hooks remove   Remove HTTP hooks (preserve shell hooks)")
      console.log("    jfl hooks deploy   Deploy hooks to all registered services")
      console.log()
  }
}
