/**
 * @purpose CLI commands for prediction engine — predict eval deltas, resolve actuals, view accuracy
 */

import chalk from "chalk"
import type { Command } from "commander"
import { Predictor } from "../lib/predictor.js"
import type { PredictionInput, PredictionRecord, Proposal } from "../lib/predictor.js"
import { sparkline } from "../lib/kuva.js"

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

function colorDelta(delta: number): string {
  const sign = delta >= 0 ? "+" : ""
  const str = `${sign}${delta.toFixed(4)}`
  if (delta > 0) return chalk.green(str)
  if (delta < 0) return chalk.red(str)
  return chalk.gray(str)
}

function colorRecommendation(rec: string): string {
  switch (rec) {
    case "proceed": return chalk.green(rec)
    case "revise": return chalk.yellow(rec)
    case "abandon": return chalk.red(rec)
    default: return rec
  }
}

function colorSeverity(severity: string): string {
  switch (severity) {
    case "low": return chalk.gray(`[${severity}]`)
    case "medium": return chalk.yellow(`[${severity}]`)
    case "high": return chalk.red(`[${severity}]`)
    default: return `[${severity}]`
  }
}

function colorConfidence(confidence: number): string {
  const pct = `${Math.round(confidence * 100)}%`
  if (confidence >= 0.7) return chalk.green(pct)
  if (confidence >= 0.4) return chalk.yellow(pct)
  return chalk.red(pct)
}

async function predictCommand(options: {
  proposal: string
  goal: string
  score?: string
  type?: string
  scope?: string
  files?: string
  failingEvals?: string
}): Promise<void> {
  if (!process.env.STRATUS_API_KEY) {
    console.error(chalk.red("\n  STRATUS_API_KEY not set."))
    console.error(chalk.gray("  export STRATUS_API_KEY=stratus_sk_live_...\n"))
    process.exit(1)
  }

  const currentScore = parseFloat(options.score ?? "0")
  if (isNaN(currentScore)) {
    console.error(chalk.red("\n  --score must be a number\n"))
    process.exit(1)
  }

  const proposal: Proposal = {
    description: options.proposal,
    change_type: (options.type as Proposal["change_type"]) || "fix",
    scope: (options.scope as Proposal["scope"]) || "medium",
    files_affected: options.files ? options.files.split(",").map(f => f.trim()) : undefined,
  }

  const failingEvals = options.failingEvals
    ? options.failingEvals.split(",").map(e => e.trim())
    : undefined

  const input: PredictionInput = {
    proposal,
    current_score: currentScore,
    failing_evals: failingEvals,
    goal: options.goal,
    recent_trajectory: [],
  }

  const predictor = new Predictor()

  console.log(chalk.gray("\n  Querying Stratus (rollout + chat)...\n"))

  try {
    const result = await predictor.predict(input)

    console.log(chalk.bold("  Prediction\n"))
    console.log(chalk.gray("  Proposal:    ") + result.reasoning.split(".")[0])
    console.log(chalk.gray("  Current:     ") + currentScore.toFixed(4))
    console.log(chalk.gray("  Predicted:   ") + `${result.predicted_score.toFixed(4)} (${colorDelta(result.predicted_delta)})`)
    console.log(chalk.gray("  Confidence:  ") + colorConfidence(result.confidence))
    console.log()
    console.log(chalk.gray("  Recommendation: ") + colorRecommendation(result.recommendation))
    console.log()
    console.log(chalk.gray("  Reasoning: ") + result.reasoning)

    if (result.risks.length > 0) {
      console.log()
      console.log(chalk.gray("  Risks:"))
      for (const risk of result.risks) {
        console.log(`    ${colorSeverity(risk.severity)}  ${risk.description}`)
      }
    }

    console.log()
    console.log(chalk.gray("  Brain Goal Proximity: ") + result.brain_goal_proximity.toFixed(4))
    console.log(chalk.gray("  Method: ") + result.method + (result.method === "ensemble" ? " (rollout + chat)" : ""))
    console.log()
    console.log(chalk.gray("  ID: ") + chalk.cyan(result.prediction_id) + chalk.gray(" (use to resolve later)"))
    console.log()
  } catch (err: any) {
    console.error(chalk.red(`\n  Prediction failed: ${err.message}\n`))
    process.exit(1)
  }
}

async function resolveCommand(options: {
  resolve: string
  actualDelta: string
  actualScore: string
  evalRun: string
}): Promise<void> {
  const actualDelta = parseFloat(options.actualDelta)
  const actualScore = parseFloat(options.actualScore)

  if (isNaN(actualDelta) || isNaN(actualScore)) {
    console.error(chalk.red("\n  --actual-delta and --actual-score must be numbers\n"))
    process.exit(1)
  }

  const predictor = new Predictor()

  try {
    await predictor.resolve(options.resolve, actualDelta, actualScore, options.evalRun)

    console.log(chalk.green(`\n  Resolved prediction ${chalk.cyan(options.resolve)}`))
    console.log(chalk.gray(`  Actual delta: ${colorDelta(actualDelta)}`))
    console.log(chalk.gray(`  Actual score: ${actualScore.toFixed(4)}`))
    console.log(chalk.gray(`  Eval run:     ${options.evalRun}\n`))
  } catch (err: any) {
    console.error(chalk.red(`\n  Resolve failed: ${err.message}\n`))
    process.exit(1)
  }
}

async function accuracyCommand(): Promise<void> {
  const predictor = new Predictor()
  const stats = predictor.getAccuracy()

  console.log(chalk.bold("\n  Prediction Accuracy\n"))

  if (stats.resolved === 0) {
    console.log(chalk.gray("  No resolved predictions yet."))
    console.log(chalk.gray("  Resolve with: jfl predict --resolve <id> --actual-delta <n> --actual-score <n> --eval-run <id>\n"))
    if (stats.total > 0) {
      console.log(chalk.gray(`  ${stats.total} pending prediction(s)\n`))
    }
    return
  }

  console.log(chalk.gray("  Total predictions:    ") + stats.total)
  console.log(chalk.gray("  Resolved:             ") + stats.resolved)
  console.log(chalk.gray("  Direction accuracy:   ") + colorConfidence(stats.direction_accuracy))
  console.log(chalk.gray("  Mean delta error:     ") + stats.mean_delta_error.toFixed(4))
  console.log(chalk.gray("  Calibration:          ") + colorConfidence(stats.calibration))
  console.log()
}

async function historyCommand(options: { limit?: string }): Promise<void> {
  const predictor = new Predictor()
  const limit = parseInt(options.limit ?? "20", 10)
  const records = predictor.getHistory(limit)

  if (records.length === 0) {
    console.log(chalk.gray("\n  No predictions yet.\n"))
    console.log(chalk.gray('  Create one: jfl predict --proposal "..." --goal "..."\n'))
    return
  }

  console.log(chalk.bold(`\n  Prediction History (last ${records.length})\n`))

  const headers = ["Time", "ID", "Type", "Predicted", "Actual", "Rec", "Method"]
  const rows: string[][] = records.map(r => {
    const time = r.ts.replace("T", " ").slice(0, 16)
    const predicted = `${r.prediction.delta >= 0 ? "+" : ""}${r.prediction.delta.toFixed(4)}`
    const actual = r.actual
      ? `${r.actual.delta >= 0 ? "+" : ""}${r.actual.delta.toFixed(4)}`
      : "pending"
    return [
      time,
      r.prediction_id,
      r.proposal.change_type,
      predicted,
      actual,
      r.prediction.recommendation,
      r.prediction.method,
    ]
  })

  console.log(formatTable(headers, rows))

  const deltas = records.map(r => r.prediction.delta)
  if (deltas.length > 1) {
    console.log(chalk.gray(`\n  Predicted deltas: ${sparkline(deltas)}`))
  }

  const resolved = records.filter(r => r.actual !== null)
  if (resolved.length > 0) {
    const dirCorrect = resolved.filter(r => r.accuracy?.direction_correct).length
    console.log(chalk.gray(`  Direction accuracy: ${dirCorrect}/${resolved.length} (${Math.round(dirCorrect / resolved.length * 100)}%)`))
  }
  console.log()
}

export function registerPredictCommand(program: Command): void {
  const predictCmd = program
    .command("predict")
    .description("Predict eval score delta before executing changes (Stratus world model)")

  predictCmd
    .command("run")
    .description("Generate a prediction for a proposed change")
    .requiredOption("--proposal <text>", "Description of the proposed change")
    .requiredOption("--goal <text>", "Goal expression (e.g. 'test_pass_rate > 0.9')")
    .option("--score <n>", "Current composite score", "0")
    .option("--type <type>", "Change type: fix, refactor, feature, config", "fix")
    .option("--scope <scope>", "Change scope: small, medium, large", "medium")
    .option("--files <list>", "Comma-separated affected files")
    .option("--failing-evals <list>", "Comma-separated failing eval names")
    .action(predictCommand)

  predictCmd
    .command("resolve")
    .description("Resolve a prediction with actual results")
    .requiredOption("--id <prediction_id>", "Prediction ID to resolve")
    .requiredOption("--actual-delta <n>", "Actual score delta")
    .requiredOption("--actual-score <n>", "Actual final score")
    .requiredOption("--eval-run <id>", "Eval run ID")
    .action((options) => resolveCommand({
      resolve: options.id,
      actualDelta: options.actualDelta,
      actualScore: options.actualScore,
      evalRun: options.evalRun,
    }))

  predictCmd
    .command("accuracy")
    .description("Show prediction accuracy statistics")
    .action(accuracyCommand)

  predictCmd
    .command("history")
    .description("Show recent predictions")
    .option("--limit <n>", "Max entries to show", "20")
    .action(historyCommand)

  predictCmd.action(async () => {
    console.log(chalk.bold("\n  Stratus Prediction Engine\n"))
    console.log(chalk.gray("  Commands:"))
    console.log(chalk.gray('    jfl predict run --proposal "..." --goal "..."  Generate prediction'))
    console.log(chalk.gray("    jfl predict resolve --id <id> ...              Resolve with actuals"))
    console.log(chalk.gray("    jfl predict accuracy                           Show accuracy stats"))
    console.log(chalk.gray("    jfl predict history                            Recent predictions"))
    console.log()
  })
}
