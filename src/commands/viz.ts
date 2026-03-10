/**
 * Terminal Visualization Commands
 * @purpose CLI access to dashboard data — experiments, leaderboard, flows, events rendered in terminal via kuva
 */

import chalk from "chalk"
import type { Command } from "commander"
import { hubFetch, getHubConfig } from "../lib/hub-client.js"
import type {
  EvalAgent,
  TrajectoryResponse,
  HubFlowDef,
  HubFlowExecution,
  HubEvent,
  WorkspaceStatus,
} from "../lib/hub-client.js"
import { linePlot, sparkline, renderBars, asciiBars } from "../lib/kuva.js"
import type { BarEntry } from "../lib/kuva.js"

function formatTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] || "").length))
  )
  const lines: string[] = []
  lines.push("  " + headers.map((h, i) => h.padEnd(colWidths[i])).join("  "))
  lines.push("  " + colWidths.map(w => "\u2500".repeat(w)).join("  "))
  for (const row of rows) {
    lines.push("  " + row.map((c, i) => (c || "").padEnd(colWidths[i])).join("  "))
  }
  return lines.join("\n")
}

function ensureHub(): void {
  const config = getHubConfig()
  if (!config) {
    console.log(chalk.red("\n  Hub not running."))
    console.log(chalk.gray("  Start it with: jfl hub start\n"))
    process.exit(1)
  }
}

interface ExperimentRun {
  run_id: string
  ts: string
  composite: number
  delta: number
  improved: boolean
  model_version?: string
}

function buildRuns(points: TrajectoryResponse["points"]): ExperimentRun[] {
  const runs: ExperimentRun[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const prev = i > 0 ? points[i - 1].value : p.value
    const delta = p.value - prev
    runs.push({
      run_id: p.run_id ?? `run-${i + 1}`,
      ts: p.ts,
      composite: p.value,
      delta,
      improved: delta >= 0,
      model_version: p.model_version,
    })
  }
  return runs
}

async function experimentsCommand(options: { agent?: string; json?: boolean }): Promise<void> {
  ensureHub()

  let agents: EvalAgent[]
  try {
    agents = await hubFetch<EvalAgent[]>("/api/eval/leaderboard")
  } catch (err: any) {
    console.log(chalk.red(`\n  ${err.message}\n`))
    return
  }

  if (options.agent) {
    agents = agents.filter(a => a.agent === options.agent)
  }

  if (agents.length === 0) {
    console.log(chalk.gray("\n  No agents found.\n"))
    return
  }

  for (const agent of agents) {
    let trajectory: TrajectoryResponse
    try {
      trajectory = await hubFetch<TrajectoryResponse>(
        `/api/eval/trajectory?agent=${encodeURIComponent(agent.agent)}&metric=composite`
      )
    } catch {
      continue
    }

    const runs = buildRuns(trajectory.points)

    if (options.json) {
      console.log(JSON.stringify({ agent: agent.agent, runs }, null, 2))
      continue
    }

    console.log(chalk.bold(`\n  Experiments: ${agent.agent}`))
    console.log()

    // Dot plot
    if (runs.length > 0) {
      const dots = runs.map(r =>
        r.improved ? chalk.green("\u25cf") : chalk.gray("\u25cb")
      ).join(" ")
      console.log(`  ${dots}`)
      console.log()
    }

    // Sparkline
    if (runs.length > 1) {
      const spark = sparkline(runs.map(r => r.composite))
      console.log(`  ${chalk.gray("trend:")} ${spark}`)
      console.log()
    }

    // Score table
    const headers = ["#", "Time", "Version", "Composite", "Delta"]
    const rows = runs.map((r, i) => {
      const deltaStr = i === 0
        ? chalk.gray("--")
        : r.delta >= 0
          ? chalk.green(`+${r.delta.toFixed(4)}`)
          : chalk.red(r.delta.toFixed(4))
      return [
        String(i + 1),
        r.ts.replace("T", " ").slice(0, 19),
        r.model_version ?? "\u2014",
        r.composite.toFixed(4),
        deltaStr,
      ]
    })
    console.log(formatTable(headers, rows))
    console.log()
  }
}

async function leaderboardCommand(options: { json?: boolean }): Promise<void> {
  ensureHub()

  let agents: EvalAgent[]
  try {
    agents = await hubFetch<EvalAgent[]>("/api/eval/leaderboard")
  } catch (err: any) {
    console.log(chalk.red(`\n  ${err.message}\n`))
    return
  }

  if (agents.length === 0) {
    console.log(chalk.gray("\n  No leaderboard data.\n"))
    return
  }

  if (options.json) {
    console.log(JSON.stringify(agents, null, 2))
    return
  }

  agents.sort((a, b) => (b.latest_composite ?? 0) - (a.latest_composite ?? 0))

  console.log(chalk.bold("\n  Leaderboard\n"))

  const headers = ["Rank", "Agent", "Composite", "Evals", "Improvement", "Trend"]
  const rows = agents.map((a, i) => {
    const trend = a.trend && a.trend.length > 1 ? sparkline(a.trend) : "\u2014"
    const impRate = a.improvement_rate !== undefined
      ? `${(a.improvement_rate * 100).toFixed(1)}%`
      : "\u2014"
    return [
      String(i + 1),
      a.agent,
      a.latest_composite !== undefined ? a.latest_composite.toFixed(4) : "\u2014",
      String(a.eval_count ?? 0),
      impRate,
      trend,
    ]
  })
  console.log(formatTable(headers, rows))

  // Bar chart of scores
  const barEntries: BarEntry[] = agents
    .filter(a => a.latest_composite !== undefined)
    .map(a => ({ label: a.agent, value: a.latest_composite }))

  if (barEntries.length > 0) {
    console.log()
    console.log(renderBars(barEntries, "Composite Scores"))
  }

  console.log()
}

async function flowsVizCommand(options: { pending?: boolean; json?: boolean }): Promise<void> {
  ensureHub()

  let flows: HubFlowDef[]
  let executions: HubFlowExecution[]
  try {
    flows = await hubFetch<HubFlowDef[]>("/api/flows")
    const execData = await hubFetch<{ executions: HubFlowExecution[] }>("/api/flows/executions")
    executions = execData.executions
  } catch (err: any) {
    console.log(chalk.red(`\n  ${err.message}\n`))
    return
  }

  if (options.pending) {
    executions = executions.filter(e => !!e.gated)
  }

  if (options.json) {
    console.log(JSON.stringify({ flows, executions }, null, 2))
    return
  }

  console.log(chalk.bold(`\n  Flows (${flows.length})\n`))

  if (flows.length === 0) {
    console.log(chalk.gray("  No flows configured.\n"))
  } else {
    for (const flow of flows) {
      const status = flow.enabled ? chalk.green("enabled ") : chalk.gray("disabled")
      console.log(`  ${status}  ${chalk.bold(flow.name)}`)
      console.log(chalk.gray(`           trigger: ${chalk.cyan(flow.trigger.pattern)}`))
      if (flow.description) {
        console.log(chalk.gray(`           ${flow.description}`))
      }
      console.log()
    }
  }

  const pending = executions.filter(e => !!e.gated)
  if (pending.length > 0) {
    console.log(chalk.yellow.bold(`  Pending Approvals (${pending.length})\n`))
    for (const exec of pending) {
      console.log(`  ${chalk.bold(exec.flow)}`)
      console.log(chalk.gray(`    trigger: ${exec.trigger_event_type}  gated: ${chalk.yellow(exec.gated ?? "unknown")}`))
      console.log(chalk.gray(`    started: ${exec.started_at}`))
      console.log()
    }
  } else if (options.pending) {
    console.log(chalk.gray("  No pending approvals.\n"))
  }
}

async function eventsCommand(options: { pattern?: string; limit?: string; json?: boolean }): Promise<void> {
  ensureHub()

  const limit = parseInt(options.limit ?? "20", 10)
  let queryPath = `/api/events?limit=${limit}`
  if (options.pattern) {
    queryPath += `&pattern=${encodeURIComponent(options.pattern)}`
  }

  let events: HubEvent[]
  try {
    const data = await hubFetch<{ events: HubEvent[] }>(queryPath)
    events = data.events
  } catch (err: any) {
    console.log(chalk.red(`\n  ${err.message}\n`))
    return
  }

  if (options.json) {
    console.log(JSON.stringify(events, null, 2))
    return
  }

  if (events.length === 0) {
    console.log(chalk.gray("\n  No events found.\n"))
    return
  }

  console.log(chalk.bold(`\n  Events (${events.length})\n`))

  const typeColors: Record<string, (s: string) => string> = {
    "session": chalk.blue,
    "eval": chalk.green,
    "flow": chalk.magenta,
    "error": chalk.red,
    "deploy": chalk.yellow,
    "hook": chalk.cyan,
  }

  for (const event of events) {
    const time = event.ts.replace("T", " ").slice(0, 19)
    const prefix = Object.keys(typeColors).find(k => event.type.startsWith(k))
    const colorFn = prefix ? typeColors[prefix] : chalk.white
    const typeStr = colorFn(event.type.padEnd(28))
    const source = chalk.gray(event.source ?? "")
    console.log(`  ${chalk.gray(time)}  ${typeStr}  ${source}`)
  }
  console.log()
}

async function statusCommand(options: { json?: boolean }): Promise<void> {
  ensureHub()

  let status: WorkspaceStatus
  try {
    status = await hubFetch<WorkspaceStatus>("/api/context/status")
  } catch (err: any) {
    console.log(chalk.red(`\n  ${err.message}\n`))
    return
  }

  if (options.json) {
    console.log(JSON.stringify(status, null, 2))
    return
  }

  console.log(chalk.bold("\n  Hub Status\n"))

  const pairs: Array<[string, string]> = [
    ["Name", status.name ?? "\u2014"],
    ["Port", String(status.port ?? "\u2014")],
  ]

  if (status.uptime_ms !== undefined) {
    const secs = Math.floor(status.uptime_ms / 1000)
    const mins = Math.floor(secs / 60)
    const hrs = Math.floor(mins / 60)
    const uptimeStr = hrs > 0
      ? `${hrs}h ${mins % 60}m`
      : mins > 0
        ? `${mins}m ${secs % 60}s`
        : `${secs}s`
    pairs.push(["Uptime", uptimeStr])
  }

  if (status.item_count !== undefined) pairs.push(["Items", String(status.item_count)])
  if (status.memory_count !== undefined) pairs.push(["Memories", String(status.memory_count)])
  if (status.flow_count !== undefined) pairs.push(["Flows", String(status.flow_count)])
  if (status.event_count !== undefined) pairs.push(["Events", String(status.event_count)])

  const labelWidth = Math.max(...pairs.map(([k]) => k.length))
  for (const [label, value] of pairs) {
    console.log(`  ${chalk.gray(label.padEnd(labelWidth) + ":")}  ${value}`)
  }

  if (status.children && status.children.length > 0) {
    console.log()
    console.log(chalk.gray("  Children:"))
    for (const child of status.children) {
      console.log(`    ${child}`)
    }
  }

  if (status.sources && status.sources.length > 0) {
    console.log()
    console.log(chalk.gray("  Sources:"))
    for (const src of status.sources) {
      console.log(`    ${src}`)
    }
  }

  console.log()
}

async function dashCommand(options: { json?: boolean }): Promise<void> {
  ensureHub()

  if (options.json) {
    const result: Record<string, unknown> = {}

    try { result.leaderboard = await hubFetch<EvalAgent[]>("/api/eval/leaderboard") } catch { result.leaderboard = [] }
    try {
      const execData = await hubFetch<{ executions: HubFlowExecution[] }>("/api/flows/executions")
      result.pending_flows = execData.executions.filter(e => !!e.gated)
    } catch { result.pending_flows = [] }
    try {
      const evtData = await hubFetch<{ events: HubEvent[] }>("/api/events?limit=10")
      result.recent_events = evtData.events
    } catch { result.recent_events = [] }
    try { result.status = await hubFetch<WorkspaceStatus>("/api/context/status") } catch { result.status = null }

    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(chalk.bold("\n  Dashboard\n"))
  console.log(chalk.gray("  " + "\u2500".repeat(50)))

  // Leaderboard summary
  try {
    let agents = await hubFetch<EvalAgent[]>("/api/eval/leaderboard")
    agents.sort((a, b) => (b.latest_composite ?? 0) - (a.latest_composite ?? 0))

    if (agents.length > 0) {
      console.log(chalk.bold("\n  Leaderboard\n"))
      const headers = ["Rank", "Agent", "Composite", "Trend"]
      const rows = agents.slice(0, 5).map((a, i) => {
        const trend = a.trend && a.trend.length > 1 ? sparkline(a.trend) : "\u2014"
        return [
          String(i + 1),
          a.agent,
          a.latest_composite !== undefined ? a.latest_composite.toFixed(4) : "\u2014",
          trend,
        ]
      })
      console.log(formatTable(headers, rows))
      if (agents.length > 5) {
        console.log(chalk.gray(`\n  ... and ${agents.length - 5} more agents`))
      }
    }
  } catch {
    console.log(chalk.gray("\n  Leaderboard: unavailable"))
  }

  // Pending flows
  try {
    const execData = await hubFetch<{ executions: HubFlowExecution[] }>("/api/flows/executions")
    const pending = execData.executions.filter(e => !!e.gated)

    if (pending.length > 0) {
      console.log(chalk.yellow.bold(`\n  Pending Approvals (${pending.length})\n`))
      for (const exec of pending.slice(0, 3)) {
        console.log(`  ${chalk.yellow("\u25cf")} ${chalk.bold(exec.flow)} ${chalk.gray(`(${exec.gated})`)}`)
      }
      if (pending.length > 3) {
        console.log(chalk.gray(`  ... and ${pending.length - 3} more`))
      }
    }
  } catch {
    // silent
  }

  // Recent events
  try {
    const evtData = await hubFetch<{ events: HubEvent[] }>("/api/events?limit=5")
    const events = evtData.events

    if (events.length > 0) {
      console.log(chalk.bold("\n  Recent Events\n"))
      for (const event of events) {
        const time = event.ts.replace("T", " ").slice(11, 19)
        console.log(`  ${chalk.gray(time)}  ${event.type}  ${chalk.gray(event.source ?? "")}`)
      }
    }
  } catch {
    console.log(chalk.gray("\n  Events: unavailable"))
  }

  // Hub status
  try {
    const hubStatus = await hubFetch<WorkspaceStatus>("/api/context/status")
    console.log(chalk.bold("\n  Hub\n"))
    const items: string[] = []
    if (hubStatus.item_count !== undefined) items.push(`${hubStatus.item_count} items`)
    if (hubStatus.memory_count !== undefined) items.push(`${hubStatus.memory_count} memories`)
    if (hubStatus.flow_count !== undefined) items.push(`${hubStatus.flow_count} flows`)
    if (hubStatus.event_count !== undefined) items.push(`${hubStatus.event_count} events`)
    if (items.length > 0) {
      console.log(`  ${items.join("  |  ")}`)
    }
  } catch {
    console.log(chalk.gray("\n  Hub: unavailable"))
  }

  console.log(chalk.gray("\n  " + "\u2500".repeat(50)))
  console.log(chalk.gray("  Use jfl viz <subcommand> for details\n"))
}

export function registerVizCommand(program: Command): void {
  const vizCmd = program
    .command("viz")
    .description("Terminal visualizations — headless dashboard data via Context Hub")

  vizCmd
    .command("experiments")
    .description("Show experiment runs with dot plot, sparklines, and score table")
    .option("--agent <name>", "Filter to a specific agent")
    .option("--json", "Output as JSON")
    .action(experimentsCommand)

  vizCmd
    .command("leaderboard")
    .description("Ranked agent leaderboard with sparklines and bar chart")
    .option("--json", "Output as JSON")
    .action(leaderboardCommand)

  vizCmd
    .command("flows")
    .description("Flow definitions and pending executions")
    .option("--pending", "Show only pending approval executions")
    .option("--json", "Output as JSON")
    .action(flowsVizCommand)

  vizCmd
    .command("events")
    .description("Recent event stream with type coloring")
    .option("--pattern <pattern>", "Filter events by type pattern")
    .option("--limit <n>", "Max events to show", "20")
    .option("--json", "Output as JSON")
    .action(eventsCommand)

  vizCmd
    .command("status")
    .description("Hub health, children, sources, item count")
    .option("--json", "Output as JSON")
    .action(statusCommand)

  vizCmd
    .command("dash")
    .description("Composite dashboard — leaderboard, pending flows, events, status")
    .option("--json", "Output as JSON")
    .action(dashCommand)

  vizCmd.action(async () => {
    await dashCommand({})
  })
}
