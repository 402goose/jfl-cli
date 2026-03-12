/**
 * IDE Command
 *
 * Terminal workspace powered by tmux-ide. Compositional layout that grows
 * with your project — start with Claude + Shell, add agents and observability
 * as needed. Layout persists in .jfl/ide.yml and syncs to project root.
 *
 * @purpose Launch, configure, and manage the jfl ide terminal workspace
 */

import chalk from "chalk"
import { execSync, spawn } from "child_process"
import { existsSync, unlinkSync } from "fs"
import { join } from "path"
import {
  hasTmuxIde,
  hasTmux,
  hasPi,
  getProjectRoot,
  loadIdeLayout,
  saveIdeLayout,
  syncToRoot,
  getIdeConfig,
  setIdeConfig,
  createDefaultLayout,
  createWelcomeLayout,
  resolvePane,
  checkDependencies,
  getAvailableItems,
  detectNewSinceLastLaunch,
} from "../lib/ide-panes.js"
import type { IdeLayout, IdePane, IdeRow } from "../types/ide.js"

export async function ideLaunchCommand(_options: { json?: boolean } = {}): Promise<void> {
  const root = getProjectRoot()

  if (!hasTmux()) {
    console.error(chalk.red("\n  tmux is required for jfl ide"))
    console.log(chalk.gray("  Install: brew install tmux\n"))
    process.exit(1)
  }

  if (!hasTmuxIde()) {
    console.log(chalk.yellow("  tmux-ide not found. Installing..."))
    try {
      execSync("npm install -g tmux-ide", { stdio: "inherit" })
    } catch {
      console.error(chalk.red("  Failed to install tmux-ide"))
      console.log(chalk.gray("  Install manually: npm install -g tmux-ide\n"))
      process.exit(1)
    }
  }

  let layout = loadIdeLayout(root)
  const ideConfig = getIdeConfig(root)
  let isFirstLaunch = false

  if (!ideConfig.piAsked && hasPi()) {
    console.log()
    console.log(chalk.cyan("  Pi runtime detected.") + " Use it as your primary workspace? (y/n)")
    const answer = await readSingleChar()
    if (answer === "y" || answer === "Y") {
      setIdeConfig(root, { primary: "pi", piAsked: true })
    } else {
      setIdeConfig(root, { primary: "claude", piAsked: true })
    }
  }

  if (!layout) {
    isFirstLaunch = true
    const freshConfig = getIdeConfig(root)
    layout = createWelcomeLayout(root, freshConfig)
    saveIdeLayout(root, layout)
  }

  if (!isFirstLaunch) {
    const newItems = detectNewSinceLastLaunch(root, layout)
    if (newItems.length > 0) {
      console.log()
      for (const msg of newItems) {
        console.log(chalk.gray(`  New: ${msg}`))
      }
    }
  }

  syncToRoot(root)

  console.log(chalk.gray(`  Launching workspace...`))
  console.log()

  try {
    const child = spawn("tmux-ide", [], {
      cwd: root,
      stdio: "inherit",
    })
    child.on("error", (err) => {
      console.error(chalk.red(`  Failed to launch: ${err.message}`))
    })
    await new Promise<void>((resolve) => {
      child.on("close", () => resolve())
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(chalk.red(`  Failed to launch workspace: ${message}`))
    process.exit(1)
  }
}

export async function ideAddCommand(
  name: string | undefined,
  options: { row?: string; position?: string; title?: string; cmd?: string }
): Promise<void> {
  const root = getProjectRoot()

  if (!name && !options.title) {
    console.error(chalk.red("  Specify a pane name or use --title and --cmd for custom panes"))
    console.log(chalk.gray("  See available: jfl ide available"))
    process.exit(1)
  }

  let layout = loadIdeLayout(root)
  if (!layout) {
    const ideConfig = getIdeConfig(root)
    layout = createDefaultLayout(root, ideConfig)
  }

  let pane: IdePane | null = null

  if (options.title && options.cmd) {
    pane = { title: options.title, command: options.cmd, type: "custom" }
  } else if (name) {
    pane = resolvePane(root, name, options)
  }

  if (!pane) {
    console.error(chalk.red(`  Unknown pane: ${name}`))
    console.log(chalk.gray("  See available: jfl ide available"))

    if (name) {
      console.log(chalk.gray(`  Or add custom: jfl ide add --title "${name}" --cmd "your command"`))
    }
    process.exit(1)
  }

  if (name) {
    const deps = checkDependencies(root, name)
    if (deps.checks.length > 0) {
      console.log()
      console.log(chalk.gray(`  ${name} requires:`))
      for (const check of deps.checks) {
        const icon = check.ok ? chalk.green("\u2713") : chalk.yellow("\u26A0")
        const hint = check.hint ? chalk.gray(` (${check.hint})`) : ""
        console.log(`    ${icon} ${check.label}${hint}`)
      }
      if (!deps.ok) {
        console.log()
        console.error(chalk.red(`  Hard dependency missing. Fix before adding.`))
        process.exit(1)
      }
    }
  }

  const rowIdx = options.row !== undefined ? parseInt(options.row, 10) : layout.rows.length - 1
  const posIdx = options.position !== undefined ? parseInt(options.position, 10) : -1

  while (layout.rows.length <= rowIdx) {
    layout.rows.push({ size: "30%", panes: [] })
  }

  if (posIdx >= 0 && posIdx < layout.rows[rowIdx].panes.length) {
    layout.rows[rowIdx].panes.splice(posIdx, 0, pane)
  } else {
    layout.rows[rowIdx].panes.push(pane)
  }

  rebalanceRowSizes(layout)
  saveIdeLayout(root, layout)
  syncToRoot(root)

  const rowDisplay = rowIdx
  const posDisplay = posIdx >= 0 ? posIdx : layout.rows[rowIdx].panes.length - 1
  console.log()
  console.log(chalk.green(`  Added "${pane.title}" to row ${rowDisplay}, position ${posDisplay}`))
  console.log(chalk.gray("  Restart workspace to apply: jfl ide restart"))
}

export async function ideRemoveCommand(name: string): Promise<void> {
  const root = getProjectRoot()
  const layout = loadIdeLayout(root)

  if (!layout) {
    console.error(chalk.red("  No workspace layout found"))
    process.exit(1)
  }

  let found = false
  for (const row of layout.rows) {
    const idx = row.panes.findIndex(
      (p: IdePane) => p.agent === name || p.type === name || p.title.toLowerCase() === name.toLowerCase()
    )
    if (idx >= 0) {
      row.panes.splice(idx, 1)
      found = true
      break
    }
  }

  if (!found) {
    console.error(chalk.red(`  Pane "${name}" not found in workspace`))
    process.exit(1)
  }

  layout.rows = layout.rows.filter((r: IdeRow) => r.panes.length > 0)
  if (layout.rows.length === 0) {
    const ideConfig = getIdeConfig(root)
    const fresh = createDefaultLayout(root, ideConfig)
    layout.rows = fresh.rows
  }

  rebalanceRowSizes(layout)
  saveIdeLayout(root, layout)
  syncToRoot(root)

  console.log(chalk.green(`  Removed "${name}" from workspace`))
  console.log(chalk.gray("  Restart workspace to apply: jfl ide restart"))
}

export async function ideAvailableCommand(): Promise<void> {
  const root = getProjectRoot()
  const layout = loadIdeLayout(root)
  const items = getAvailableItems(root, layout)

  const agents = items.filter((i: AvailableItem) => i.category === "agent")
  const builtins = items.filter((i: AvailableItem) => i.category === "builtin")
  const services = items.filter((i: AvailableItem) => i.category === "service")

  console.log()

  if (agents.length > 0) {
    console.log(chalk.cyan("  Agents:"))
    for (const a of agents) {
      const status = a.inWorkspace ? chalk.green("[in workspace \u2713]") : chalk.gray("[not in workspace]")
      console.log(`    ${a.name.padEnd(18)} ${a.description.padEnd(18)} ${status}`)
    }
    console.log()
  }

  console.log(chalk.cyan("  Built-in:"))
  for (const b of builtins) {
    const status = b.inWorkspace ? chalk.green("[in workspace \u2713]") : chalk.gray("[not in workspace]")
    console.log(`    ${b.name.padEnd(18)} ${b.description.padEnd(22)} ${status}`)
  }
  console.log()

  if (services.length > 0) {
    console.log(chalk.cyan("  Services:"))
    for (const s of services) {
      const status = s.inWorkspace ? chalk.green("[in workspace \u2713]") : chalk.gray("[not in workspace]")
      console.log(`    ${s.name.padEnd(18)} ${s.description.padEnd(22)} ${status}`)
    }
    console.log()
  }

  console.log(chalk.cyan("  Custom:"))
  console.log(chalk.gray('    --title "..." --cmd "..."           add anything'))
  console.log()
}

interface AvailableItem {
  name: string
  category: string
  description: string
  inWorkspace: boolean
}

export async function ideStatusCommand(options: { json?: boolean } = {}): Promise<void> {
  const root = getProjectRoot()
  const layout = loadIdeLayout(root)

  if (!layout) {
    if (options.json) {
      console.log(JSON.stringify({ configured: false }))
    } else {
      console.log(chalk.gray("  No workspace configured. Run: jfl ide"))
    }
    return
  }

  if (options.json) {
    console.log(JSON.stringify(layout, null, 2))
    return
  }

  console.log()
  console.log(chalk.bold(`  Workspace: ${layout.name}`))
  console.log()

  let totalPanes = 0
  for (let rowIdx = 0; rowIdx < layout.rows.length; rowIdx++) {
    const row = layout.rows[rowIdx]
    console.log(chalk.cyan(`  Row ${rowIdx}`) + chalk.gray(` (${row.size || "auto"})`))
    for (const pane of row.panes) {
      totalPanes++
      const type = pane.type ? chalk.gray(`[${pane.type}]`) : ""
      const focus = pane.focus ? chalk.yellow(" *") : ""
      console.log(`    ${pane.title} ${type}${focus}`)
    }
  }

  console.log()
  console.log(chalk.gray(`  ${totalPanes} panes across ${layout.rows.length} rows`))

  let tmuxRunning = false
  try {
    execSync(`tmux has-session -t "${layout.name}" 2>/dev/null`, { stdio: "ignore" })
    tmuxRunning = true
  } catch { /* not running */ }

  if (tmuxRunning) {
    console.log(chalk.green("  Session is running"))
  } else {
    console.log(chalk.gray("  Session not running"))
  }
  console.log()
}

export async function ideStopCommand(): Promise<void> {
  const root = getProjectRoot()
  const layout = loadIdeLayout(root)
  const name = layout?.name || root.split("/").pop() || "workspace"

  try {
    execSync(`tmux-ide stop "${name}" 2>/dev/null`, { cwd: root, stdio: "inherit" })
    console.log(chalk.green(`  Stopped workspace "${name}"`))
  } catch {
    console.log(chalk.gray(`  No running session "${name}"`))
  }
}

export async function ideRestartCommand(): Promise<void> {
  const root = getProjectRoot()
  syncToRoot(root)

  try {
    execSync("tmux-ide restart", { cwd: root, stdio: "inherit" })
  } catch {
    console.log(chalk.gray("  No running session to restart. Launching..."))
    await ideLaunchCommand()
  }
}

export async function ideResetCommand(): Promise<void> {
  const root = getProjectRoot()
  const configPath = join(root, ".jfl", "ide.yml")
  const rootYml = join(root, "ide.yml")

  if (existsSync(configPath)) unlinkSync(configPath)
  if (existsSync(rootYml)) unlinkSync(rootYml)

  setIdeConfig(root, { piAsked: false, primary: undefined })

  console.log(chalk.green("  Workspace reset. Run jfl ide to start fresh."))
}

export async function ideConfigCommand(key?: string, value?: string): Promise<void> {
  const root = getProjectRoot()

  if (key === "primary" && value) {
    if (!["pi", "claude", "auto"].includes(value)) {
      console.error(chalk.red(`  Invalid value: ${value}. Use: pi, claude, or auto`))
      process.exit(1)
    }
    setIdeConfig(root, { primary: value as "pi" | "claude" | "auto", piAsked: true })
    console.log(chalk.green(`  Primary pane set to: ${value}`))
    return
  }

  if (key && !value) {
    const config = getIdeConfig(root)
    const val = (config as Record<string, unknown>)[key]
    if (val !== undefined) {
      console.log(`  ${key}: ${val}`)
    } else {
      console.log(chalk.gray(`  ${key}: not set`))
    }
    return
  }

  const config = getIdeConfig(root)
  console.log()
  console.log(chalk.bold("  IDE Config"))
  console.log(`  primary: ${config.primary || "claude"}`)
  console.log(`  piAsked: ${config.piAsked || false}`)
  console.log()
}

function rebalanceRowSizes(layout: IdeLayout): void {
  const count = layout.rows.length
  if (count === 1) {
    layout.rows[0].size = "100%"
  } else if (count === 2) {
    layout.rows[0].size = "70%"
    layout.rows[1].size = "30%"
  } else {
    const each = Math.floor(100 / count)
    for (let i = 0; i < count; i++) {
      layout.rows[i].size = `${each}%`
    }
  }
}

function readSingleChar(): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve("n")
      return
    }
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding("utf-8")
    process.stdin.once("data", (data: string) => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      const char = data.toString().trim()
      console.log(char)
      resolve(char)
    })
  })
}
