/**
 * @purpose CLI commands for eval framework — list, trajectory, log, compare, tuples
 */

import chalk from "chalk"
import type { Command } from "commander"
import { readEvals, getTrajectory, getLatestEval, listAgents, appendEval, getScopedJournalDirs } from "../lib/eval-store.js"
import { extractTuples, formatTuplesReport } from "../lib/training-tuples.js"
import { linePlot, asciiBars, sparkline } from "../lib/kuva.js"
import type { EvalEntry } from "../types/eval.js"

function formatTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] || "").length))
  )

  const lines: string[] = []
  lines.push("  " + headers.map((h, i) => h.padEnd(colWidths[i])).join("  "))
  lines.push("  " + colWidths.map(w => "─".repeat(w)).join("  "))
  for (const row of rows) {
    lines.push("  " + row.map((c, i) => (c || "").padEnd(colWidths[i])).join("  "))
  }
  return lines.join("\n")
}

async function listCommand(options: { agent?: string; limit?: string }): Promise<void> {
  const evals = readEvals()
  const filtered = options.agent
    ? evals.filter(e => e.agent === options.agent)
    : evals

  if (filtered.length === 0) {
    console.log(chalk.gray("\n  No eval entries found.\n"))
    console.log(chalk.gray("  Log one with: jfl eval log --agent <name> --metrics '{\"composite\":0.5}'"))
    return
  }

  const limit = parseInt(options.limit ?? "20", 10)
  const recent = filtered.slice(-limit)

  console.log(chalk.bold(`\n  Eval Entries${options.agent ? ` (${options.agent})` : ""}`))
  console.log()

  const headers = ["Time", "Agent", "Version", "Composite", "Metrics"]
  const rows = recent.map(e => {
    const time = e.ts.replace("T", " ").slice(0, 19)
    const comp = e.composite !== undefined ? e.composite.toFixed(4) : "—"
    const metricKeys = Object.keys(e.metrics).slice(0, 3)
    const metricStr = metricKeys.map(k => `${k}=${e.metrics[k].toFixed(3)}`).join(" ")
    return [time, e.agent, e.model_version ?? "—", comp, metricStr]
  })

  console.log(formatTable(headers, rows))
  console.log(chalk.gray(`\n  ${filtered.length} total entries (showing last ${recent.length})\n`))
}

async function trajectoryCommand(options: { agent: string; metric?: string }): Promise<void> {
  const metric = options.metric ?? "composite"
  const points = getTrajectory(options.agent, metric)

  if (points.length === 0) {
    console.log(chalk.gray(`\n  No trajectory data for ${options.agent} / ${metric}\n`))
    return
  }

  console.log(chalk.bold(`\n  Trajectory: ${options.agent} — ${metric}`))
  console.log()

  // Try kuva line plot
  const kuvaPoints = points.map(p => ({
    ts: p.ts,
    value: p.value,
    series: options.agent,
  }))

  const plot = linePlot(kuvaPoints, `${options.agent} ${metric}`)
  if (plot) {
    console.log(plot)
  } else {
    // Fallback to sparkline + table
    const spark = sparkline(points.map(p => p.value))
    console.log(`  ${spark}`)
    console.log()
  }

  // Always show table
  const headers = ["#", "Time", "Version", metric]
  const rows = points.map((p, i) => [
    String(i + 1),
    p.ts.replace("T", " ").slice(0, 19),
    p.model_version ?? "—",
    p.value.toFixed(4),
  ])
  console.log(formatTable(headers, rows))

  const first = points[0].value
  const last = points[points.length - 1].value
  const delta = last - first
  const pct = first > 0 ? ((delta / first) * 100).toFixed(1) : "—"
  console.log(chalk.gray(`\n  ${delta >= 0 ? "+" : ""}${delta.toFixed(4)} (${pct}%) over ${points.length} evals\n`))
}

async function logCommand(options: {
  agent: string
  metrics: string
  composite?: string
  modelVersion?: string
  dataset?: string
  runId?: string
  notes?: string
}): Promise<void> {
  let metrics: Record<string, number>
  try {
    metrics = JSON.parse(options.metrics)
  } catch {
    console.error(chalk.red("  Error: --metrics must be valid JSON, e.g. '{\"composite\":0.58}'"))
    process.exit(1)
  }

  const entry: EvalEntry = {
    v: 1,
    ts: new Date().toISOString(),
    agent: options.agent,
    run_id: options.runId ?? `manual-${Date.now()}`,
    metrics,
    composite: options.composite ? parseFloat(options.composite) : metrics.composite,
    model_version: options.modelVersion,
    dataset: options.dataset,
    notes: options.notes,
  }

  appendEval(entry)
  console.log(chalk.green(`\n  Logged eval for ${options.agent}`))
  if (entry.composite !== undefined) {
    console.log(chalk.gray(`  composite: ${entry.composite}`))
  }
  console.log()
}

async function compareCommand(options: { agents: string; metric?: string }): Promise<void> {
  const agentNames = options.agents.split(",").map(s => s.trim())
  const metric = options.metric ?? "composite"

  console.log(chalk.bold(`\n  Compare: ${agentNames.join(" vs ")} — ${metric}`))
  console.log()

  const agentData: Array<{ agent: string; latest: number | null; count: number; trend: number[] }> = []

  for (const agent of agentNames) {
    const trajectory = getTrajectory(agent, metric)
    const latest = trajectory.length > 0 ? trajectory[trajectory.length - 1].value : null
    agentData.push({
      agent,
      latest,
      count: trajectory.length,
      trend: trajectory.map(p => p.value),
    })
  }

  const headers = ["Agent", `Latest ${metric}`, "Evals", "Trend"]
  const rows = agentData.map(d => [
    d.agent,
    d.latest !== null ? d.latest.toFixed(4) : "—",
    String(d.count),
    d.trend.length > 1 ? sparkline(d.trend) : "—",
  ])

  console.log(formatTable(headers, rows))
  console.log()
}

async function tuplesCommand(options: { team?: string; since?: string; report?: boolean }): Promise<void> {
  const journalDirs = getScopedJournalDirs()

  if (journalDirs.length === 0) {
    console.log(chalk.gray("\n  No journal directories found.\n"))
    return
  }

  let allTuples: ReturnType<typeof extractTuples> = []

  for (const dir of journalDirs) {
    const tuples = extractTuples(dir, options.team)
    allTuples.push(...tuples)
  }

  // Filter by since
  if (options.since) {
    const sinceDate = new Date(options.since)
    allTuples = allTuples.filter(t => new Date(t.timestamp) >= sinceDate)
  }

  // Dedupe by id
  const seen = new Set<string>()
  allTuples = allTuples.filter(t => {
    if (seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })

  allTuples.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  if (allTuples.length === 0) {
    console.log(chalk.gray("\n  No training tuples found.\n"))
    return
  }

  if (options.report) {
    console.log(formatTuplesReport(allTuples))
    return
  }

  console.log(chalk.bold(`\n  Training Tuples (${allTuples.length} total)`))
  console.log(chalk.gray(`  Sources: ${journalDirs.length} journal directories\n`))

  const headers = ["#", "Time", "Team", "Type", "Reward", "Score Delta"]
  const rows = allTuples.slice(-20).map((t, i) => [
    String(i + 1),
    t.timestamp.replace("T", " ").slice(0, 19),
    t.team,
    t.action.type,
    t.reward.qualitative,
    t.reward.scoreDelta !== null ? t.reward.scoreDelta.toFixed(4) : "—",
  ])

  console.log(formatTable(headers, rows))

  // Summary
  const byTeam = new Map<string, number>()
  const byReward = new Map<string, number>()
  for (const t of allTuples) {
    byTeam.set(t.team, (byTeam.get(t.team) ?? 0) + 1)
    byReward.set(t.reward.qualitative, (byReward.get(t.reward.qualitative) ?? 0) + 1)
  }

  console.log(chalk.gray(`\n  By team: ${[...byTeam].map(([k, v]) => `${k}=${v}`).join(", ")}`))
  console.log(chalk.gray(`  By reward: ${[...byReward].map(([k, v]) => `${k}=${v}`).join(", ")}\n`))
}

export function registerEvalCommand(program: Command): void {
  const evalCmd = program
    .command("eval")
    .description("Eval framework — track agent metrics over time")

  evalCmd
    .command("list")
    .description("List recent eval entries")
    .option("--agent <name>", "Filter by agent name")
    .option("--limit <n>", "Max entries to show", "20")
    .action(listCommand)

  evalCmd
    .command("trajectory")
    .description("Show metric trajectory over time")
    .requiredOption("--agent <name>", "Agent name")
    .option("--metric <name>", "Metric to plot (default: composite)")
    .action(trajectoryCommand)

  evalCmd
    .command("log")
    .description("Log an eval entry")
    .requiredOption("--agent <name>", "Agent name")
    .requiredOption("--metrics <json>", "Metrics as JSON object")
    .option("--composite <n>", "Composite score")
    .option("--model-version <v>", "Model version")
    .option("--dataset <ds>", "Dataset name")
    .option("--run-id <id>", "Run ID")
    .option("--notes <text>", "Notes")
    .action(logCommand)

  evalCmd
    .command("compare")
    .description("Compare agents side-by-side")
    .requiredOption("--agents <list>", "Comma-separated agent names")
    .option("--metric <name>", "Metric to compare (default: composite)")
    .action(compareCommand)

  evalCmd
    .command("tuples")
    .description("Extract training tuples from journals")
    .option("--team <name>", "Filter by team")
    .option("--since <date>", "Only tuples after this date")
    .option("--report", "Full markdown report")
    .action(tuplesCommand)

  evalCmd.action(async () => {
    // Default: show list
    await listCommand({})
  })
}
