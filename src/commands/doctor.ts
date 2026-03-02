/**
 * @purpose Unified health checker — single entry point for project diagnostics and auto-repair
 */

import chalk from "chalk"
import * as fs from "fs"
import * as path from "path"
import { initHooks } from "./hooks.js"
import { getProjectPort } from "../utils/context-hub-port.js"

interface CheckResult {
  name: string
  ok: boolean
  detail?: string
  fixable?: boolean
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

function checkJflDir(): CheckResult {
  const jflDir = path.join(process.cwd(), ".jfl")
  return {
    name: ".jfl directory",
    ok: fs.existsSync(jflDir),
    detail: fs.existsSync(jflDir) ? undefined : "Run jfl init",
    fixable: false,
  }
}

function checkConfig(): CheckResult {
  const configPath = path.join(process.cwd(), ".jfl", "config.json")
  if (!fs.existsSync(configPath)) {
    return { name: "config.json", ok: false, detail: "Missing .jfl/config.json", fixable: true }
  }
  try {
    JSON.parse(fs.readFileSync(configPath, "utf-8"))
    return { name: "config.json", ok: true }
  } catch {
    return { name: "config.json", ok: false, detail: "Invalid JSON", fixable: true }
  }
}

async function checkContextHub(): Promise<CheckResult> {
  const projectRoot = findProjectRoot() || process.cwd()
  const port = getProjectPort(projectRoot)
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    })
    if (res.ok) {
      return { name: `Context Hub (port ${port})`, ok: true }
    }
    return { name: `Context Hub (port ${port})`, ok: false, detail: "Not responding", fixable: false }
  } catch {
    return { name: `Context Hub (port ${port})`, ok: false, detail: "Not running — jfl context-hub start", fixable: false }
  }
}

function checkHooks(): CheckResult {
  const settingsPath = path.join(process.cwd(), ".claude", "settings.json")
  if (!fs.existsSync(settingsPath)) {
    return { name: "Hooks", ok: false, detail: "No .claude/settings.json", fixable: true }
  }
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
    if (!settings.hooks) {
      return { name: "Hooks", ok: false, detail: "No hooks configured", fixable: true }
    }
    const httpCount = Object.values(settings.hooks).reduce((count: number, entries: any) => {
      for (const entry of entries) {
        for (const cmd of entry.hooks || []) {
          if (cmd.type === "http") count++
        }
      }
      return count
    }, 0)
    if (httpCount === 0) {
      return { name: "Hooks", ok: false, detail: "No HTTP hooks found", fixable: true }
    }
    return { name: "Hooks", ok: true, detail: `${httpCount} HTTP hook(s)` }
  } catch {
    return { name: "Hooks", ok: false, detail: "Invalid settings.json", fixable: true }
  }
}

function checkMemory(): CheckResult {
  const dbPath = path.join(process.cwd(), ".jfl", "memory.db")
  if (!fs.existsSync(dbPath)) {
    return { name: "Memory database", ok: false, detail: "Not initialized — jfl memory init", fixable: false }
  }
  try {
    const stats = fs.statSync(dbPath)
    const sizeKb = Math.round(stats.size / 1024)
    return { name: "Memory database", ok: true, detail: `${sizeKb} KB` }
  } catch {
    return { name: "Memory database", ok: true }
  }
}

function checkJournal(): CheckResult {
  const journalDir = path.join(process.cwd(), ".jfl", "journal")
  if (!fs.existsSync(journalDir)) {
    return { name: "Journal", ok: false, detail: "Missing .jfl/journal/", fixable: true }
  }
  try {
    const files = fs.readdirSync(journalDir).filter(f => f.endsWith(".jsonl"))
    return { name: "Journal", ok: true, detail: `${files.length} session(s)` }
  } catch {
    return { name: "Journal", ok: true }
  }
}

function checkAgents(): CheckResult {
  const agentsDir = path.join(process.cwd(), ".jfl", "agents")
  if (!fs.existsSync(agentsDir)) {
    return { name: "Agents", ok: true, detail: "none registered" }
  }
  try {
    const dirs = fs.readdirSync(agentsDir).filter(f =>
      fs.statSync(path.join(agentsDir, f)).isDirectory()
    )
    return { name: "Agents", ok: true, detail: `${dirs.length} registered` }
  } catch {
    return { name: "Agents", ok: true }
  }
}

function checkFlowsSync(): CheckResult {
  const yamlPath = path.join(process.cwd(), ".jfl", "flows.yaml")
  const jsonPath = path.join(process.cwd(), ".jfl", "flows.json")

  if (!fs.existsSync(yamlPath) && !fs.existsSync(jsonPath)) {
    return { name: "Flows", ok: true, detail: "no flows file" }
  }

  const filePath = fs.existsSync(yamlPath) ? yamlPath : jsonPath
  try {
    fs.readFileSync(filePath, "utf-8")
    return { name: "Flows", ok: true }
  } catch (err: any) {
    return { name: "Flows", ok: false, detail: `Read error: ${err.message}` }
  }
}

function checkGitBranch(): CheckResult {
  try {
    const { execSync } = require("child_process")
    const branch = execSync("git branch --show-current", { encoding: "utf-8" }).trim()
    const isSession = branch.startsWith("session-")
    return {
      name: "Git branch",
      ok: true,
      detail: isSession ? branch : `${branch} (not a session branch)`,
    }
  } catch {
    return { name: "Git branch", ok: true, detail: "not a git repo" }
  }
}

async function fixConfig(): Promise<void> {
  const configPath = path.join(process.cwd(), ".jfl", "config.json")
  const jflDir = path.join(process.cwd(), ".jfl")
  if (!fs.existsSync(jflDir)) return

  const defaultConfig = {
    name: path.basename(process.cwd()),
    type: "gtm",
    version: "0.2.0",
  }
  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + "\n")
}

async function fixJournal(): Promise<void> {
  const journalDir = path.join(process.cwd(), ".jfl", "journal")
  if (!fs.existsSync(journalDir)) {
    fs.mkdirSync(journalDir, { recursive: true })
  }
}

export async function doctorCommand(options: { fix?: boolean } = {}): Promise<void> {
  console.log(chalk.bold("\n  JFL Doctor\n"))

  const results: CheckResult[] = []

  results.push(checkJflDir())
  results.push(checkConfig())
  results.push(await checkContextHub())
  results.push(checkHooks())
  results.push(checkMemory())
  results.push(checkJournal())
  results.push(checkAgents())
  results.push(checkFlowsSync())
  results.push(checkGitBranch())

  let issues = 0
  let fixed = 0

  for (const r of results) {
    if (r.ok) {
      const detail = r.detail ? chalk.gray(` (${r.detail})`) : ""
      console.log(chalk.green("  [ok] ") + r.name + detail)
    } else {
      issues++
      if (options.fix && r.fixable) {
        // attempt fix
        if (r.name === "Hooks") {
          await initHooks()
          fixed++
          console.log(chalk.cyan("  [fix] ") + r.name + chalk.gray(" → initialized"))
        } else if (r.name === "config.json") {
          await fixConfig()
          fixed++
          console.log(chalk.cyan("  [fix] ") + r.name + chalk.gray(" → created default"))
        } else if (r.name === "Journal") {
          await fixJournal()
          fixed++
          console.log(chalk.cyan("  [fix] ") + r.name + chalk.gray(" → directory created"))
        }
      } else {
        const detail = r.detail ? chalk.gray(` — ${r.detail}`) : ""
        const fixHint = r.fixable ? chalk.gray(" (fixable)") : ""
        console.log(chalk.red("  [!!] ") + r.name + detail + fixHint)
      }
    }
  }

  console.log()

  if (options.fix && fixed > 0) {
    const remaining = issues - fixed
    if (remaining > 0) {
      console.log(chalk.cyan(`  ${fixed} issue(s) fixed. ${remaining} remaining.\n`))
    } else {
      console.log(chalk.green("  All issues resolved.\n"))
    }
  } else if (issues > 0) {
    console.log(chalk.yellow(`  ${issues} issue(s) found.`) + chalk.gray(" Run jfl doctor --fix to repair.\n"))
  } else {
    console.log(chalk.green("  All checks passed.\n"))
  }
}
