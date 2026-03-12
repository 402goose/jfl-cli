/**
 * IDE Pane Registry
 *
 * Built-in pane types, agent-to-command resolution, and dependency checking
 * for the jfl ide workspace system.
 *
 * @purpose Resolve pane names to commands, discover available panes, check dependencies
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import { listAgentConfigs, loadAgentConfig } from "./agent-config.js"
import type { IdeLayout, IdePane, IdePaneType, IdeConfig } from "../types/ide.js"

interface BuiltinPaneDef {
  type: IdePaneType
  title: string
  command: string
  description: string
}

const BUILTIN_PANES: Record<string, BuiltinPaneDef> = {
  events: {
    type: "events",
    title: "Events",
    command: 'jfl context-hub events --follow 2>/dev/null || echo "Context Hub not running. Run: jfl context-hub start"',
    description: "Event stream from Context Hub",
  },
  eval: {
    type: "eval",
    title: "Eval",
    command: 'watch -n 5 "cat .jfl/eval/eval.jsonl 2>/dev/null | tail -20 || echo No eval data yet"',
    description: "Metrics dashboard (auto-refresh)",
  },
  training: {
    type: "training",
    title: "Training",
    command: 'watch -n 10 "ls -la .jfl/replay/ 2>/dev/null | tail -10 || echo No replay buffer yet"',
    description: "Replay buffer stats",
  },
  topology: {
    type: "topology",
    title: "Topology",
    command: 'jfl services deps 2>/dev/null || echo "No services registered"',
    description: "Service dependency graph",
  },
  alerts: {
    type: "alerts",
    title: "Alerts",
    command: 'jfl context-hub events --follow --filter "alert,error,warning" 2>/dev/null || echo "No alerts"',
    description: "Filtered alert events",
  },
}

export function hasPi(): boolean {
  try {
    execSync("which pi", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export function hasTmuxIde(): boolean {
  try {
    execSync("which tmux-ide", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export function hasTmux(): boolean {
  try {
    execSync("which tmux", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export function getProjectRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim()
  } catch {
    return process.cwd()
  }
}

export function getIdeConfigPath(root: string): string {
  return join(root, ".jfl", "ide.yml")
}

export function getRootIdeYmlPath(root: string): string {
  return join(root, "ide.yml")
}

function yamlValue(val: string): string {
  if (val.includes('"') || val.includes("'")) {
    const escaped = val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    return `"${escaped}"`
  }
  return val
}

function readYaml(content: string): IdeLayout {
  const lines = content.split("\n")
  const result: Record<string, unknown> = {}
  const currentRows: Array<{ size: string; panes: IdePane[] }> = []
  let currentRow: { size: string; panes: IdePane[] } | null = null
  let currentPane: Record<string, unknown> | null = null
  let inRows = false
  let inPanes = false
  let inTheme = false

  for (const line of lines) {
    const stripped = line.trim()
    if (!stripped || stripped.startsWith("#")) continue

    const indent = line.length - line.trimStart().length

    if (indent === 0 && stripped.startsWith("name:")) {
      result.name = stripped.replace("name:", "").trim().replace(/^["']|["']$/g, "")
    } else if (indent === 0 && stripped.startsWith("before:")) {
      result.before = stripped.replace("before:", "").trim()
    } else if (indent === 0 && stripped === "rows:") {
      inRows = true
      inTheme = false
    } else if (indent === 0 && stripped === "theme:") {
      inTheme = true
      inRows = false
      result.theme = {}
    } else if (inTheme && indent >= 2) {
      const colonIdx = stripped.indexOf(":")
      if (colonIdx > 0) {
        const key = stripped.slice(0, colonIdx).trim()
        const val = stripped.slice(colonIdx + 1).trim()
        ;(result.theme as Record<string, string>)[key] = val
      }
    } else if (inRows) {
      if (indent === 2 && stripped.startsWith("- size:")) {
        if (currentRow) {
          if (currentPane) currentRow.panes.push(currentPane as unknown as IdePane)
          currentPane = null
          currentRows.push(currentRow)
        }
        currentRow = { size: stripped.replace("- size:", "").trim().replace(/^["']|["']$/g, ""), panes: [] }
        inPanes = false
      } else if (indent === 4 && stripped === "panes:") {
        inPanes = true
      } else if (inPanes && indent === 6 && stripped.startsWith("- title:")) {
        if (currentPane && currentRow) currentRow.panes.push(currentPane as unknown as IdePane)
        currentPane = { title: stripped.replace("- title:", "").trim().replace(/^["']|["']$/g, "") }
      } else if (currentPane && indent >= 8) {
        const colonIdx = stripped.indexOf(":")
        if (colonIdx > 0) {
          const k = stripped.slice(0, colonIdx).trim()
          let raw = stripped.slice(colonIdx + 1).trim()
          if (raw.startsWith('"') && raw.endsWith('"')) {
            raw = raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
          } else if (raw.startsWith("'") && raw.endsWith("'")) {
            raw = raw.slice(1, -1)
          }
          let v: string | boolean = raw
          if (v === "true") v = true
          if (v === "false") v = false
          currentPane[k] = v
        }
      }
    }
  }

  if (currentRow) {
    if (currentPane) currentRow.panes.push(currentPane as unknown as IdePane)
    currentRows.push(currentRow)
  }

  return {
    name: result.name as string || "workspace",
    before: result.before as string | undefined,
    rows: currentRows,
    theme: result.theme as IdeLayout["theme"],
  }
}

function toYaml(layout: IdeLayout): string {
  const lines: string[] = []
  if (layout.name) lines.push(`name: ${layout.name}`)
  if (layout.before) lines.push(`before: ${yamlValue(layout.before)}`)
  lines.push("")
  lines.push("rows:")
  for (const row of layout.rows) {
    lines.push(`  - size: ${row.size || "50%"}`)
    lines.push("    panes:")
    for (const pane of row.panes) {
      lines.push(`      - title: "${pane.title}"`)
      if (pane.command) lines.push(`        command: ${yamlValue(pane.command)}`)
      if (pane.size) lines.push(`        size: ${pane.size}`)
      if (pane.focus) lines.push(`        focus: true`)
      if (pane.type) lines.push(`        type: ${pane.type}`)
      if (pane.agent) lines.push(`        agent: ${pane.agent}`)
    }
  }
  if (layout.theme) {
    lines.push("")
    lines.push("theme:")
    for (const [k, v] of Object.entries(layout.theme)) {
      lines.push(`  ${k}: ${v}`)
    }
  }
  lines.push("")
  return lines.join("\n")
}

export function loadIdeLayout(root: string): IdeLayout | null {
  const configPath = getIdeConfigPath(root)
  if (!existsSync(configPath)) return null
  try {
    const content = readFileSync(configPath, "utf-8")
    return readYaml(content)
  } catch {
    return null
  }
}

export function saveIdeLayout(root: string, layout: IdeLayout): void {
  const configPath = getIdeConfigPath(root)
  const dir = join(root, ".jfl")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(configPath, toYaml(layout))
}

export function syncToRoot(root: string): void {
  const src = getIdeConfigPath(root)
  const dest = getRootIdeYmlPath(root)
  if (existsSync(src)) {
    const content = readFileSync(src, "utf-8")
    writeFileSync(dest, content)
  }
}

export function getIdeConfig(root: string): IdeConfig {
  const configPath = join(root, ".jfl", "config.json")
  if (!existsSync(configPath)) return {}
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    return {
      primary: config.ide?.primary,
      piAsked: config.ide?.piAsked,
    }
  } catch {
    return {}
  }
}

export function setIdeConfig(root: string, ideConfig: Partial<IdeConfig>): void {
  const configPath = join(root, ".jfl", "config.json")
  let config: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"))
    } catch {
      config = {}
    }
  }
  config.ide = { ...(config.ide as Record<string, unknown> || {}), ...ideConfig }
  const dir = join(root, ".jfl")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
}

export function resolveAgentCommand(_root: string, agentName: string): string {
  return `jfl peter agent run ${agentName} 2>/dev/null || echo "Agent ${agentName} failed to start"`
}

export function resolveServiceCommand(serviceName: string): string {
  return `watch -n 30 "jfl services status ${serviceName} 2>/dev/null || echo 'Service ${serviceName} not found'"`
}

export function resolvePrimaryPaneCommand(ideConfig: IdeConfig): { title: string; command?: string; type: IdePaneType } {
  if (ideConfig.primary === "pi") {
    return { title: "Pi Assistant", type: "pi", command: "jfl pi 2>/dev/null || claude" }
  }
  return { title: "Claude", type: "claude", command: "claude" }
}

export function createDefaultLayout(root: string, ideConfig: IdeConfig): IdeLayout {
  const projectName = root.split("/").pop() || "workspace"
  const primary = resolvePrimaryPaneCommand(ideConfig)

  return {
    name: projectName,
    before: "jfl context-hub ensure 2>/dev/null",
    rows: [
      {
        size: "100%",
        panes: [
          {
            title: primary.title,
            type: primary.type,
            command: primary.command,
            size: "50%",
            focus: true,
          },
          {
            title: "Shell",
            type: "shell",
            size: "50%",
          },
        ],
      },
    ],
    theme: {
      accent: "colour75",
      border: "colour238",
      bg: "colour235",
      fg: "colour248",
    },
  }
}

export function createWelcomeLayout(root: string, ideConfig: IdeConfig): IdeLayout {
  const layout = createDefaultLayout(root, ideConfig)
  const agents = listAgentConfigs(root)
  const services = getRegisteredServiceNames(root)

  let welcomeText = "echo '\\n  Welcome to JFL IDE\\n'"
  welcomeText += ` && echo '  Available pane types:'`
  welcomeText += ` && echo '    events     - Event stream from Context Hub'`
  welcomeText += ` && echo '    eval       - Metrics dashboard'`
  welcomeText += ` && echo '    alerts     - Alert events'`
  welcomeText += ` && echo '    topology   - Service dependency graph'`
  welcomeText += ` && echo '    training   - Replay buffer stats'`

  if (agents.length > 0) {
    welcomeText += ` && echo '' && echo '  Agents:'`
    for (const a of agents) {
      try {
        const agentConfig = loadAgentConfig(root, a)
        welcomeText += ` && echo '    ${a.padEnd(16)} ${agentConfig.metric}'`
      } catch {
        welcomeText += ` && echo '    ${a}'`
      }
    }
  }

  if (services.length > 0) {
    welcomeText += ` && echo '' && echo '  Services:'`
    for (const s of services) {
      welcomeText += ` && echo '    ${s}'`
    }
  }

  welcomeText += ` && echo '' && echo '  Add panes: jfl ide add <name> [--row N]'`
  welcomeText += ` && echo '  See all:   jfl ide available'`
  welcomeText += ` && echo '' && exec $SHELL`

  layout.rows[0].panes[1] = {
    title: "Welcome",
    type: "welcome",
    command: welcomeText,
    size: "50%",
  }

  return layout
}

function getRegisteredServiceNames(root: string): string[] {
  const configPath = join(root, ".jfl", "config.json")
  if (!existsSync(configPath)) return []
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    return (config.registered_services || []).map((s: { name: string }) => s.name)
  } catch {
    return []
  }
}

interface AvailableItem {
  name: string
  category: "agent" | "builtin" | "service"
  description: string
  inWorkspace: boolean
}

export function getAvailableItems(root: string, layout: IdeLayout | null): AvailableItem[] {
  const items: AvailableItem[] = []

  const inWorkspace = (name: string): boolean => {
    if (!layout) return false
    for (const row of layout.rows) {
      for (const pane of row.panes) {
        if (pane.agent === name || pane.type === name) return true
        if (pane.title.toLowerCase() === name.toLowerCase()) return true
      }
    }
    return false
  }

  const agents = listAgentConfigs(root)
  for (const a of agents) {
    try {
      const agentConfig = loadAgentConfig(root, a)
      items.push({
        name: a,
        category: "agent",
        description: agentConfig.metric,
        inWorkspace: inWorkspace(a),
      })
    } catch {
      items.push({
        name: a,
        category: "agent",
        description: "(config error)",
        inWorkspace: inWorkspace(a),
      })
    }
  }

  for (const [name, def] of Object.entries(BUILTIN_PANES)) {
    items.push({
      name,
      category: "builtin",
      description: def.description,
      inWorkspace: inWorkspace(name),
    })
  }

  const services = getRegisteredServiceNames(root)
  for (const s of services) {
    items.push({
      name: s,
      category: "service",
      description: "Service health pane",
      inWorkspace: inWorkspace(s),
    })
  }

  return items
}

export function resolvePane(root: string, name: string, options?: { title?: string; cmd?: string }): IdePane | null {
  if (options?.title && options?.cmd) {
    return {
      title: options.title,
      command: options.cmd,
      type: "custom",
    }
  }

  if (BUILTIN_PANES[name]) {
    const def = BUILTIN_PANES[name]
    return {
      title: def.title,
      command: def.command,
      type: def.type,
    }
  }

  const agents = listAgentConfigs(root)
  if (agents.includes(name)) {
    return {
      title: name,
      command: resolveAgentCommand(root, name),
      type: "agent",
      agent: name,
    }
  }

  const services = getRegisteredServiceNames(root)
  if (services.includes(name)) {
    return {
      title: name,
      command: resolveServiceCommand(name),
      type: "service",
    }
  }

  return null
}

export function checkDependencies(root: string, name: string): { ok: boolean; checks: Array<{ label: string; ok: boolean; hint?: string }> } {
  const checks: Array<{ label: string; ok: boolean; hint?: string }> = []

  const agents = listAgentConfigs(root)
  if (agents.includes(name)) {
    checks.push({ label: "Agent TOML configured", ok: true })

    try {
      const agentConfig = loadAgentConfig(root, name)
      const evalPath = join(root, agentConfig.eval.script)
      checks.push({
        label: `Eval script exists (${agentConfig.eval.script})`,
        ok: existsSync(evalPath),
        hint: existsSync(evalPath) ? undefined : `Create: ${agentConfig.eval.script}`,
      })
    } catch {
      checks.push({ label: "Agent config valid", ok: false, hint: `Fix: .jfl/agents/${name}.toml` })
    }
  }

  if (BUILTIN_PANES[name]) {
    if (name === "events" || name === "alerts") {
      let hubRunning = false
      try {
        execSync("jfl context-hub status 2>/dev/null", { stdio: "ignore" })
        hubRunning = true
      } catch { /* not running */ }
      checks.push({
        label: "Context Hub running",
        ok: hubRunning,
        hint: hubRunning ? undefined : "Will start automatically",
      })
    }
  }

  return { ok: checks.every((c) => c.ok || c.hint?.includes("automatically")), checks }
}

export function detectNewSinceLastLaunch(root: string, layout: IdeLayout | null): string[] {
  const messages: string[] = []
  const items = getAvailableItems(root, layout)

  for (const item of items) {
    if (!item.inWorkspace && item.category === "agent") {
      messages.push(`${item.name} agent configured \u2192 jfl ide add ${item.name}`)
    }
  }

  return messages
}

export { BUILTIN_PANES }
