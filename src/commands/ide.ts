/**
 * IDE Command v2
 *
 * Terminal workspace powered by WorkspaceEngine. Detects cmux (native macOS terminal
 * with sidebar + notifications) or falls back to tmux. Controller stays running to
 * push live data into surfaces.
 *
 * @purpose Launch, configure, and manage the jfl ide terminal workspace
 */

import chalk from "chalk"
import { existsSync, unlinkSync } from "fs"
import { join } from "path"
import { WorkspaceEngine } from "../lib/workspace/engine.js"
import { detectBackend } from "../lib/workspace/backend.js"
import {
  getProjectRoot,
  loadIdeLayout,
  getIdeConfig,
  setIdeConfig,
  syncToRoot,
  hasTmux,
} from "../lib/ide-panes.js"
import type { IdeLayout, IdePane, IdeRow } from "../types/ide.js"

let activeEngine: WorkspaceEngine | null = null

export async function ideLaunchCommand(_options: { json?: boolean } = {}): Promise<void> {
  const root = getProjectRoot()
  const backendType = detectBackend()

  if (backendType === "tmux" && !hasTmux()) {
    console.error(chalk.red("\n  No workspace backend found."))
    console.log(chalk.gray("  Install cmux: brew tap manaflow-ai/cmux && brew install --cask cmux"))
    console.log(chalk.gray("  Or install tmux: brew install tmux\n"))
    process.exit(1)
  }

  console.log()
  console.log(chalk.gray(`  Backend: ${backendType}`))

  const engine = new WorkspaceEngine(root)
  activeEngine = engine

  const caps = engine.getCapabilities()
  if (caps.sidebar) {
    console.log(chalk.green("  Sidebar: enabled"))
  }
  if (caps.notifications) {
    console.log(chalk.green("  Notifications: enabled"))
  }

  const scan = engine.getScanResults()
  if (scan.suggestions.length > 0) {
    console.log()
    console.log(chalk.cyan("  Scanning project..."))
    console.log()
    console.log(chalk.gray("  Found:"))
    for (const suggestion of scan.suggestions) {
      console.log(chalk.gray(`    ${suggestion}`))
    }
  }

  console.log()
  console.log(chalk.gray("  Launching workspace..."))
  console.log()

  try {
    await engine.launch()

    // Keep the process running as controller
    const shutdown = async () => {
      console.log(chalk.gray("\n  Stopping workspace..."))
      await engine.stop()
      process.exit(0)
    }

    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)

    // Stay alive until workspace closes
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!engine.isRunning()) {
          clearInterval(check)
          resolve()
        }
      }, 1000)
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(chalk.red(`  Failed to launch workspace: ${message}`))

    // Fallback: try v1 tmux-ide approach
    if (backendType === "tmux") {
      console.log(chalk.gray("  Falling back to tmux-ide..."))
      await fallbackTmuxIde(root)
    } else {
      process.exit(1)
    }
  }
}

export async function ideAddCommand(
  name: string | undefined,
  options: { row?: string; position?: string; title?: string; cmd?: string }
): Promise<void> {
  const root = getProjectRoot()

  if (!name && !options.title) {
    console.error(chalk.red("  Specify a surface name or use --title and --cmd for custom panes"))
    console.log(chalk.gray("  See available: jfl ide available"))
    process.exit(1)
  }

  if (activeEngine && activeEngine.isRunning()) {
    // Hot-add: engine is running, add surface live
    const surfaceName = name || options.title || "custom"
    const id = await activeEngine.addSurface(surfaceName, {
      agentName: name ? undefined : undefined,
      serviceName: name ? undefined : undefined,
    })

    if (id) {
      console.log(chalk.green(`  Added "${surfaceName}" to workspace (live)`))
    } else {
      console.error(chalk.red(`  Unknown surface: ${surfaceName}`))
      console.log(chalk.gray("  See available: jfl ide available"))
    }
    return
  }

  // Cold-add: modify layout file
  const {
    loadIdeLayout: load,
    saveIdeLayout: save,
    resolvePane,
    checkDependencies,
    createDefaultLayout,
  } = await import("../lib/ide-panes.js")

  let layout = load(root)
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
        console.error(chalk.red("  Hard dependency missing. Fix before adding."))
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
  save(root, layout)
  syncToRoot(root)

  const rowDisplay = rowIdx
  const posDisplay = posIdx >= 0 ? posIdx : layout.rows[rowIdx].panes.length - 1
  console.log()
  console.log(chalk.green(`  Added "${pane.title}" to row ${rowDisplay}, position ${posDisplay}`))
  console.log(chalk.gray("  Restart workspace to apply: jfl ide restart"))
}

export async function ideRemoveCommand(name: string): Promise<void> {
  if (activeEngine && activeEngine.isRunning()) {
    const removed = await activeEngine.removeSurface(name)
    if (removed) {
      console.log(chalk.green(`  Removed "${name}" from workspace (live)`))
    } else {
      console.error(chalk.red(`  Surface "${name}" not found in workspace`))
    }
    return
  }

  const root = getProjectRoot()
  const { loadIdeLayout: load, saveIdeLayout: save, createDefaultLayout } = await import("../lib/ide-panes.js")

  const layout = load(root)
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
  save(root, layout)
  syncToRoot(root)

  console.log(chalk.green(`  Removed "${name}" from workspace`))
  console.log(chalk.gray("  Restart workspace to apply: jfl ide restart"))
}

export async function ideAvailableCommand(): Promise<void> {
  const root = getProjectRoot()

  if (activeEngine) {
    const items = activeEngine.getAvailableItems()
    printAvailableItems(items)
    return
  }

  // Use the new surface registry for the full list (includes flows, telemetry, portfolio)
  const { getAvailableItems: getNewItems } = await import("../lib/workspace/surface-registry.js")
  const items = getNewItems(root, [])
  printAvailableItems(items)
}

function printAvailableItems(items: Array<{ name: string; category: string; description: string; inWorkspace: boolean }>): void {
  const agents = items.filter((i) => i.category === "agent")
  const builtins = items.filter((i) => i.category === "builtin")
  const services = items.filter((i) => i.category === "service")

  console.log()

  if (agents.length > 0) {
    console.log(chalk.cyan("  Agents:"))
    for (const a of agents) {
      const status = a.inWorkspace ? chalk.green("[active]") : chalk.gray("[available]")
      console.log(`    ${a.name.padEnd(20)} ${a.description.padEnd(30)} ${status}`)
    }
    console.log()
  }

  console.log(chalk.cyan("  Surfaces:"))
  for (const b of builtins) {
    const status = b.inWorkspace ? chalk.green("[active]") : chalk.gray("[available]")
    console.log(`    ${b.name.padEnd(20)} ${b.description.padEnd(30)} ${status}`)
  }
  console.log()

  if (services.length > 0) {
    console.log(chalk.cyan("  Services:"))
    for (const s of services) {
      const status = s.inWorkspace ? chalk.green("[active]") : chalk.gray("[available]")
      console.log(`    ${s.name.padEnd(20)} ${s.description.padEnd(30)} ${status}`)
    }
    console.log()
  }

  console.log(chalk.cyan("  Custom:"))
  console.log(chalk.gray('    --title "..." --cmd "..."           add anything'))
  console.log()
}

export async function ideStatusCommand(options: { json?: boolean } = {}): Promise<void> {
  if (activeEngine) {
    const state = activeEngine.getState()
    if (options.json) {
      console.log(JSON.stringify(state, null, 2))
      return
    }

    console.log()
    console.log(chalk.bold(`  Workspace: ${state.workspaceId}`))
    console.log(chalk.gray(`  Backend: ${state.backend}`))
    console.log()

    for (const s of state.surfaces) {
      const label = s.agentName || s.serviceName || s.name
      console.log(`    ${label} ${chalk.gray(`[${s.type}]`)}`)
    }

    console.log()
    console.log(chalk.green(`  ${state.surfaces.length} surfaces running`))
    console.log()
    return
  }

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
  console.log(chalk.gray(`  Backend: ${detectBackend()}`))
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
  console.log()
}

export async function ideSurfacesCommand(options: { json?: boolean } = {}): Promise<void> {
  if (!activeEngine || !activeEngine.isRunning()) {
    console.log(chalk.gray("  No running workspace. Run: jfl ide"))
    return
  }

  const surfaces = activeEngine.getActiveSurfaces()
  const liveData = activeEngine.getLiveData()

  if (options.json) {
    console.log(JSON.stringify({ surfaces: surfaces.map((s) => ({ name: s.name, type: s.surfaceType.type })), liveData }, null, 2))
    return
  }

  console.log()
  console.log(chalk.bold("  Active Surfaces"))
  console.log()

  for (const surface of surfaces) {
    const ctx = {
      projectRoot: "",
      surfaceId: surface.id,
      agentName: surface.agentName,
      serviceName: surface.serviceName,
    }
    const entries = surface.surfaceType.getStatusEntries(ctx, liveData)
    console.log(chalk.cyan(`  ${surface.name}`) + chalk.gray(` [${surface.surfaceType.type}]`))
    for (const entry of entries) {
      const color = entry.color === "green" ? chalk.green :
        entry.color === "red" ? chalk.red :
        entry.color === "yellow" ? chalk.yellow :
        entry.color === "cyan" ? chalk.cyan : chalk.gray
      console.log(`    ${entry.label}: ${color(entry.value)}`)
    }
  }
  console.log()
}

export async function ideStopCommand(): Promise<void> {
  if (activeEngine && activeEngine.isRunning()) {
    await activeEngine.stop()
    activeEngine = null
    console.log(chalk.green("  Workspace stopped"))
    return
  }

  // Fallback: try tmux-ide stop
  const root = getProjectRoot()
  const layout = loadIdeLayout(root)
  const name = layout?.name || root.split("/").pop() || "workspace"

  try {
    const { execSync } = await import("child_process")
    execSync(`tmux kill-session -t "${name}" 2>/dev/null`, { stdio: "ignore" })
    console.log(chalk.green(`  Stopped workspace "${name}"`))
  } catch {
    console.log(chalk.gray(`  No running session "${name}"`))
  }
}

export async function ideRestartCommand(): Promise<void> {
  if (activeEngine && activeEngine.isRunning()) {
    await activeEngine.stop()
    activeEngine = null
  }
  await ideLaunchCommand()
}

export async function ideResetCommand(): Promise<void> {
  if (activeEngine && activeEngine.isRunning()) {
    await activeEngine.stop()
    activeEngine = null
  }

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

  if (key === "backend" && value) {
    if (!["cmux", "tmux", "auto"].includes(value)) {
      console.error(chalk.red(`  Invalid value: ${value}. Use: cmux, tmux, or auto`))
      process.exit(1)
    }
    console.log(chalk.green(`  Backend preference set to: ${value}`))
    return
  }

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
  console.log(`  primary:  ${config.primary || "claude"}`)
  console.log(`  backend:  ${detectBackend()}`)

  const caps = new WorkspaceEngine(root).getCapabilities()
  console.log(`  sidebar:  ${caps.sidebar ? chalk.green("yes") : chalk.gray("no")}`)
  console.log(`  notify:   ${caps.notifications ? chalk.green("yes") : chalk.gray("no")}`)
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

async function fallbackTmuxIde(root: string): Promise<void> {
  const { execSync, spawn } = await import("child_process")

  try {
    execSync("which tmux-ide", { stdio: "ignore" })
  } catch {
    console.log(chalk.yellow("  tmux-ide not found. Installing..."))
    try {
      execSync("npm install -g tmux-ide", { stdio: "inherit" })
    } catch {
      console.error(chalk.red("  Failed to install tmux-ide"))
      process.exit(1)
    }
  }

  syncToRoot(root)

  const child = spawn("tmux-ide", [], { cwd: root, stdio: "inherit" })
  child.on("error", (err) => {
    console.error(chalk.red(`  Failed to launch: ${err.message}`))
  })
  await new Promise<void>((resolve) => {
    child.on("close", () => resolve())
  })
}
