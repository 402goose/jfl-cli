/**
 * Terminal Visualization Commands
 * @purpose CLI access to dashboard data — experiments, leaderboard, flows, events rendered in terminal via kuva
 */

import chalk from "chalk"
import type { Command } from "commander"
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
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
import type { BarEntry, TimeSeriesPoint } from "../lib/kuva.js"
import { TrainingBuffer } from "../lib/training-buffer.js"

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

  // Self-driving loop summary
  try {
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString()
    const evtData7d = await hubFetch<{ events: HubEvent[] }>(`/api/events?limit=500&since=${encodeURIComponent(since7d)}`)
    const allEvents = evtData7d.events
    const evalEvents = allEvents.filter(e => e.type === "eval:scored")
    const mergedCount = evalEvents.filter(e => {
      const d = e.data as Record<string, unknown> | undefined
      return d?.improved === "true" || d?.improved === true
    }).length
    const rejectedCount = evalEvents.length - mergedCount
    const detectCount = allEvents.filter(e => e.type === "telemetry:insight").length

    if (evalEvents.length > 0 || detectCount > 0) {
      console.log(chalk.bold("\n  Loop (7d)\n"))
      const loopParts: string[] = []
      if (mergedCount > 0) loopParts.push(chalk.green(`${mergedCount} merged`))
      if (rejectedCount > 0) loopParts.push(chalk.red(`${rejectedCount} rejected`))
      if (detectCount > 0) loopParts.push(`${detectCount} detected`)
      console.log(`  ${loopParts.join("  |  ")}`)
    }
  } catch {}

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

// ── Loop: self-driving pipeline view ──────────────────────────────────

interface LoopCycle {
  detect_event?: HubEvent
  propose_event?: HubEvent
  eval_event?: HubEvent
  merge_event?: HubFlowExecution
  pr_number?: number
  branch?: string
  delta?: number
  improved?: boolean
  ts: string
}

function buildCycles(events: HubEvent[], executions: HubFlowExecution[]): LoopCycle[] {
  const evals = events.filter(e => e.type === "eval:scored")
  const cycles: LoopCycle[] = []

  for (const ev of evals) {
    const d = ev.data as Record<string, unknown> | undefined
    const prNum = d?.pr_number as number | undefined
    const branch = d?.branch as string | undefined
    const delta = d?.delta as number | undefined
    const improved = d?.improved === "true" || d?.improved === true

    const detect = events.find(e =>
      e.type === "telemetry:insight" && e.ts < ev.ts
      && (!branch || (e.data as Record<string, unknown>)?.branch === branch)
    )

    const propose = events.find(e =>
      (e.type === "peter:pr-created" || e.type === "peter:pr-proposed")
      && e.ts <= ev.ts
      && ((e.data as Record<string, unknown>)?.pr_number === prNum
        || (e.data as Record<string, unknown>)?.branch === branch)
    )

    const merge = executions.find(ex =>
      (ex.flow === "auto-merge-on-improvement" || ex.flow === "flag-regression")
      && ex.trigger_event_type === "eval:scored"
      && ex.started_at >= ev.ts
    )

    cycles.push({
      detect_event: detect,
      propose_event: propose,
      eval_event: ev,
      merge_event: merge,
      pr_number: prNum,
      branch,
      delta,
      improved,
      ts: ev.ts,
    })
  }

  return cycles.sort((a, b) => b.ts.localeCompare(a.ts))
}

async function loopCommand(options: { days?: string; json?: boolean }): Promise<void> {
  ensureHub()

  const days = parseInt(options.days ?? "7", 10)
  const since = new Date(Date.now() - days * 86400000).toISOString()

  let events: HubEvent[] = []
  let executions: HubFlowExecution[] = []
  let agents: EvalAgent[] = []

  try {
    const evtData = await hubFetch<{ events: HubEvent[] }>(`/api/events?limit=500&since=${encodeURIComponent(since)}`)
    events = evtData.events
    const execData = await hubFetch<{ executions: HubFlowExecution[] }>("/api/flows/executions")
    executions = execData.executions
    agents = await hubFetch<EvalAgent[]>("/api/eval/leaderboard")
  } catch (err: any) {
    console.log(chalk.red(`\n  ${err.message}\n`))
    return
  }

  const cycles = buildCycles(events, executions)

  const detectCount = events.filter(e => e.type === "telemetry:insight").length
  const proposeCount = events.filter(e => e.type.startsWith("peter:")).length
  const evalCount = events.filter(e => e.type === "eval:scored").length
  const mergeCount = cycles.filter(c => c.improved).length
  const rejectCount = cycles.filter(c => c.improved === false).length

  // Score trajectory
  const bestAgent = agents.sort((a, b) => (b.latest_composite ?? 0) - (a.latest_composite ?? 0))[0]
  const firstScore = bestAgent?.trend?.[0]
  const lastScore = bestAgent?.latest_composite

  // Training buffer stats
  const tb = new TrainingBuffer()
  const tbStats = tb.stats()

  // Policy weights
  let policyTrained = 0
  try {
    const weightsPath = join(process.cwd(), ".jfl", "policy-weights.json")
    if (existsSync(weightsPath)) {
      const w = JSON.parse(readFileSync(weightsPath, "utf-8"))
      policyTrained = w.trained_on ?? 0
    }
  } catch {}

  const retrainDelta = tbStats.total - policyTrained
  const retrainNeeded = retrainDelta >= 20

  if (options.json) {
    console.log(JSON.stringify({
      days,
      detect: detectCount, propose: proposeCount, eval: evalCount,
      merge: mergeCount, reject: rejectCount,
      score_start: firstScore, score_end: lastScore,
      tuples: tbStats.total, retrain_delta: retrainDelta,
      cycles: cycles.slice(0, 20),
    }, null, 2))
    return
  }

  console.log(chalk.bold("\n\u2501".repeat(52)))
  console.log(chalk.bold(`  Self-Driving Loop \u2014 Last ${days} days`))
  console.log(chalk.bold("\u2501".repeat(52)))

  // Score line
  if (firstScore !== undefined && lastScore !== undefined) {
    const scoreDelta = lastScore - firstScore
    const arrow = scoreDelta >= 0 ? chalk.green(`\u25b2+${scoreDelta.toFixed(2)}`) : chalk.red(`\u25bc${scoreDelta.toFixed(2)}`)
    const pct = Math.round(lastScore * 100)
    const filled = Math.round(pct / 10)
    const bar = chalk.green("\u2588".repeat(filled)) + chalk.gray("\u2591".repeat(10 - filled))
    console.log(`\n  Score: ${firstScore.toFixed(2)} \u2192 ${lastScore.toFixed(2)}  ${arrow}  ${bar} ${pct}%`)
  } else {
    console.log(chalk.gray("\n  Score: no eval data yet"))
  }

  // Pipeline
  console.log()
  console.log(`  ${chalk.cyan("DETECT")}  \u2192  ${chalk.yellow("PROPOSE")}  \u2192  ${chalk.blue("EVAL")}  \u2192  ${chalk.green("MERGE")}  \u2192  ${chalk.magenta("LEARN")}`)

  const skipCount = proposeCount > 0 ? Math.max(0, proposeCount - evalCount) : 0

  console.log(
    `    ${detectCount}` +
    `        ${proposeCount}` +
    `          ${evalCount}` +
    `        ${mergeCount}` +
    `         ${retrainNeeded ? chalk.yellow(`${retrainDelta} new`) : `${tbStats.total} tuples`}`
  )

  if (skipCount > 0 || rejectCount > 0) {
    const parts: string[] = []
    if (skipCount > 0) parts.push(`${skipCount} skip`)
    if (rejectCount > 0) parts.push(`${rejectCount} reject`)
    console.log(chalk.gray(`              ${parts.join("     ")}`))
  }

  // Pipeline health
  const stuckStages: string[] = []
  if (detectCount > 0 && proposeCount === 0) stuckStages.push("propose")
  if (proposeCount > 0 && evalCount === 0) stuckStages.push("eval")
  if (evalCount > 0 && mergeCount === 0 && rejectCount === 0) stuckStages.push("merge")
  if (stuckStages.length === 0 && evalCount > 0) {
    console.log(chalk.green(`\n  Pipeline health: ${"█".repeat(10)} 100%  (no stuck stages)`))
  } else if (stuckStages.length > 0) {
    console.log(chalk.yellow(`\n  Pipeline health: stuck at ${stuckStages.join(", ")}`))
  }

  // Last cycle
  if (cycles.length > 0) {
    const last = cycles[0]
    const ago = timeAgo(last.ts)
    const source = last.detect_event ? "telemetry:insight" : "cron"
    const outcome = last.improved ? chalk.green("merged") : chalk.red("rejected")
    const deltaStr = last.delta !== undefined ? (last.delta >= 0 ? `+${last.delta.toFixed(3)}` : last.delta.toFixed(3)) : "?"
    console.log(chalk.gray(`\n  Last cycle: ${ago} \u2014 ${source} \u2192 ${last.branch ?? "?"} \u2192 ${deltaStr} \u2192 ${outcome}`))
  }

  // Recent cycles table
  if (cycles.length > 1) {
    console.log(chalk.bold("\n  Recent Cycles\n"))
    const headers = ["Time", "Branch", "Delta", "Result"]
    const rows = cycles.slice(0, 8).map(c => {
      const deltaStr = c.delta !== undefined
        ? (c.delta >= 0 ? chalk.green(`+${c.delta.toFixed(4)}`) : chalk.red(c.delta.toFixed(4)))
        : chalk.gray("?")
      const result = c.improved ? chalk.green("merged") : chalk.red("rejected")
      return [
        c.ts.replace("T", " ").slice(0, 16),
        c.branch ?? "\u2014",
        deltaStr,
        result,
      ]
    })
    console.log(formatTable(headers, rows))
  }

  console.log(chalk.bold("\n\u2501".repeat(52) + "\n"))
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

// ── Learning: policy head progress ───────────────────────────────────

async function learningCommand(options: { json?: boolean }): Promise<void> {
  const tb = new TrainingBuffer()
  const tbStats = tb.stats()
  const entries = tb.read()

  // Load policy weights
  let weights: {
    trained_on: number
    direction_accuracy: number
    rank_correlation: number
    trained_at: string
    target_mean: number
    target_std: number
  } | null = null

  const weightsPath = join(process.cwd(), ".jfl", "policy-weights.json")
  if (existsSync(weightsPath)) {
    try {
      weights = JSON.parse(readFileSync(weightsPath, "utf-8"))
    } catch {}
  }

  // Compute action type reward stats
  const actionRewards: Record<string, { count: number; totalReward: number }> = {}
  for (const e of entries) {
    const t = e.action.type
    if (!actionRewards[t]) actionRewards[t] = { count: 0, totalReward: 0 }
    actionRewards[t].count++
    actionRewards[t].totalReward += e.reward.composite_delta
  }

  const topActions = Object.entries(actionRewards)
    .map(([type, stats]) => ({ type, avgReward: stats.totalReward / stats.count, count: stats.count }))
    .sort((a, b) => b.avgReward - a.avgReward)

  // Reward timeline for sparkline
  const rewardTimeline = entries
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .map(e => e.reward.composite_delta)

  if (options.json) {
    console.log(JSON.stringify({
      tuples: tbStats,
      weights: weights ? {
        trained_on: weights.trained_on,
        direction_accuracy: weights.direction_accuracy,
        rank_correlation: weights.rank_correlation,
        trained_at: weights.trained_at,
      } : null,
      top_actions: topActions.slice(0, 5),
      reward_timeline: rewardTimeline,
    }, null, 2))
    return
  }

  console.log(chalk.bold("\n\u2501".repeat(52)))
  console.log(chalk.bold("  Policy Head \u2014 Learning Curve"))
  console.log(chalk.bold("\u2501".repeat(52)))

  // Tuple stats
  console.log(`\n  Tuples: ${chalk.bold(String(tbStats.total))}`)
  console.log(`  Avg reward: ${tbStats.avgReward >= 0 ? chalk.green(`+${tbStats.avgReward.toFixed(4)}`) : chalk.red(tbStats.avgReward.toFixed(4))}`)
  console.log(`  Improvement rate: ${(tbStats.improvedRate * 100).toFixed(1)}%`)

  if (rewardTimeline.length > 2) {
    console.log(`  Reward trend: ${sparkline(rewardTimeline)}`)
  }

  // Policy head stats
  if (weights) {
    const retrainDelta = tbStats.total - weights.trained_on
    const retrainNeeded = retrainDelta >= 20

    console.log()
    console.log(chalk.bold("  Policy Head"))
    console.log(`  Trained on: ${weights.trained_on} tuples`)
    console.log(`  Rank correlation: ${weights.rank_correlation.toFixed(3)}`)
    console.log(`  Direction accuracy: ${weights.direction_accuracy.toFixed(3)}`)
    console.log(`  Last trained: ${weights.trained_at.replace("T", " ").slice(0, 19)}`)

    if (retrainNeeded) {
      console.log(chalk.yellow(`\n  ${retrainDelta} new tuples since last train (threshold: 20)`))
      console.log(chalk.gray("  Retrain: python3 scripts/train-policy-head.py --epochs 200"))
    } else {
      console.log(chalk.gray(`\n  Next retrain: ${20 - retrainDelta} tuples away (threshold: 20)`))
    }
  } else {
    console.log(chalk.gray("\n  No policy weights found — using heuristic selection"))
    if (tbStats.total >= 20) {
      console.log(chalk.yellow(`  ${tbStats.total} tuples available — ready to train!`))
      console.log(chalk.gray("  Train: python3 scripts/train-policy-head.py --epochs 200"))
    } else {
      console.log(chalk.gray(`  Need ${20 - tbStats.total} more tuples before first train`))
    }
  }

  // Top action types
  if (topActions.length > 0) {
    console.log(chalk.bold("\n  Top Action Types (by avg reward)\n"))
    const headers = ["#", "Type", "Avg Reward", "Count"]
    const rows = topActions.slice(0, 6).map((a, i) => [
      String(i + 1),
      a.type,
      a.avgReward >= 0 ? chalk.green(`+${a.avgReward.toFixed(4)}`) : chalk.red(a.avgReward.toFixed(4)),
      String(a.count),
    ])
    console.log(formatTable(headers, rows))

    // Bar chart
    const barEntries: BarEntry[] = topActions.slice(0, 6).map(a => ({
      label: a.type,
      value: Math.max(0, a.avgReward * 1000),
    }))
    if (barEntries.some(b => b.value > 0)) {
      console.log()
      console.log(renderBars(barEntries, "Avg Reward (×1000)"))
    }
  }

  // Source breakdown
  if (Object.keys(tbStats.bySource).length > 0) {
    console.log(chalk.bold("\n  Tuple Sources\n"))
    const sourceEntries: BarEntry[] = Object.entries(tbStats.bySource)
      .sort(([, a], [, b]) => b - a)
      .map(([source, count]) => ({ label: source, value: count }))
    console.log(renderBars(sourceEntries, "By Source"))
  }

  console.log(chalk.bold("\n\u2501".repeat(52) + "\n"))
}

// ── Fleet: parallel VM agent status ──────────────────────────────────

async function fleetCommand(options: { wave?: string; json?: boolean }): Promise<void> {
  // Check if prlctl is available
  let hasPrlctl = false
  try {
    execSync("which prlctl", { stdio: "ignore" })
    hasPrlctl = true
  } catch {}

  if (!hasPrlctl) {
    console.log(chalk.gray("\n  prlctl not found — Parallels Desktop Pro required for VM fleet."))
    console.log(chalk.gray("  See: scripts/spawn-fleet.sh\n"))
    return
  }

  // List VMs
  let vmListOutput: string
  try {
    vmListOutput = execSync("prlctl list -a --json 2>/dev/null", { encoding: "utf-8" })
  } catch {
    console.log(chalk.gray("\n  No VMs found.\n"))
    return
  }

  let vms: Array<{ name: string; status: string; uuid: string }>
  try {
    vms = JSON.parse(vmListOutput)
  } catch {
    console.log(chalk.gray("\n  Could not parse VM list.\n"))
    return
  }

  // Filter to agent VMs
  const agentVms = vms.filter(v => v.name.startsWith("agent-"))

  if (agentVms.length === 0) {
    console.log(chalk.gray("\n  No agent VMs found."))
    console.log(chalk.gray("  Spawn a fleet: ./scripts/spawn-fleet.sh [size] [repo]\n"))
    return
  }

  // Group by wave
  const waves: Record<string, typeof agentVms> = {}
  for (const vm of agentVms) {
    const match = vm.name.match(/^agent-(\d+)-/)
    const waveId = match ? match[1] : "unknown"
    if (options.wave && waveId !== options.wave) continue
    if (!waves[waveId]) waves[waveId] = []
    waves[waveId].push(vm)
  }

  if (Object.keys(waves).length === 0) {
    console.log(chalk.gray(`\n  No agent VMs found for wave ${options.wave}.\n`))
    return
  }

  if (options.json) {
    console.log(JSON.stringify(waves, null, 2))
    return
  }

  for (const [waveId, waveVms] of Object.entries(waves)) {
    const running = waveVms.filter(v => v.status === "running").length
    const stopped = waveVms.filter(v => v.status === "stopped").length
    const other = waveVms.length - running - stopped

    console.log(chalk.bold(`\n\u2501`.repeat(52)))
    console.log(chalk.bold(`  Fleet \u2014 Wave ${waveId} (${waveVms.length} agents)`))
    console.log(chalk.bold("\u2501".repeat(52)))

    for (const vm of waveVms.sort((a, b) => a.name.localeCompare(b.name))) {
      const statusIcon = vm.status === "running" ? chalk.green("\u25cf") : vm.status === "stopped" ? chalk.gray("\u25cb") : chalk.red("\u25cf")
      const statusText = vm.status === "running" ? chalk.green("running") : vm.status === "stopped" ? chalk.gray("done   ") : chalk.red(vm.status.padEnd(7))

      // Try to get tuple count from VM if running
      let tupleInfo = ""
      if (vm.status === "running") {
        try {
          const countStr = execSync(
            `prlctl exec "${vm.name}" -- bash -c "wc -l < /tmp/workspace/.jfl/training-buffer.jsonl 2>/dev/null || echo 0" 2>/dev/null`,
            { encoding: "utf-8", timeout: 5000 }
          ).trim()
          tupleInfo = `${countStr} tuples`
        } catch {
          tupleInfo = ""
        }
      }

      console.log(`  ${statusIcon} ${vm.name.padEnd(28)} ${statusText}  ${chalk.gray(tupleInfo)}`)
    }

    console.log(`\n  ${chalk.green(String(running))} running  ${chalk.gray(String(stopped))} done  ${other > 0 ? chalk.red(`${other} error`) : ""}`)
    console.log(chalk.gray(`\n  collect:  ./scripts/collect-tuples.sh ${waveId}`))
    console.log(chalk.gray(`  destroy:  ./scripts/destroy-fleet.sh ${waveId}`))
    console.log(chalk.bold("\u2501".repeat(52) + "\n"))
  }
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

  vizCmd
    .command("loop")
    .description("Self-driving loop pipeline — detect, propose, eval, merge, learn")
    .option("--days <n>", "Lookback period in days", "7")
    .option("--json", "Output as JSON")
    .action(loopCommand)

  vizCmd
    .command("learning")
    .description("Policy head learning curve — tuples, accuracy, action rewards")
    .option("--json", "Output as JSON")
    .action(learningCommand)

  vizCmd
    .command("fleet")
    .description("VM fleet status — parallel agent waves and tuple collection")
    .option("--wave <id>", "Filter to a specific wave ID")
    .option("--json", "Output as JSON")
    .action(fleetCommand)

  vizCmd.action(async () => {
    await dashCommand({})
  })
}
