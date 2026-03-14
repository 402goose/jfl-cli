/**
 * @purpose CLI commands for policy head training — train, status, export, threshold check
 */

import chalk from "chalk"
import type { Command } from "commander"
import { existsSync, readFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { spawnSync } from "child_process"
import { fileURLToPath } from "url"
import { TrainingBuffer } from "../lib/training-buffer.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface TrainingThreshold {
  min_entries: number
  min_new_since_last: number
  min_hours_since_last: number
}

const DEFAULT_THRESHOLD: TrainingThreshold = {
  min_entries: 50,
  min_new_since_last: 25,
  min_hours_since_last: 12,
}

function findProjectRoot(): string {
  let dir = process.cwd()
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".jfl", "config.json"))) return dir
    if (existsSync(join(dir, ".jfl"))) return dir
    dir = dirname(dir)
  }
  return process.cwd()
}

function getTrainingMeta(projectRoot: string): Record<string, any> | null {
  const metaPath = join(projectRoot, ".jfl", "training-meta.json")
  if (!existsSync(metaPath)) return null
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8"))
  } catch {
    return null
  }
}

function getWeights(projectRoot: string): Record<string, any> | null {
  const weightsPath = join(projectRoot, ".jfl", "policy-weights.json")
  if (!existsSync(weightsPath)) return null
  try {
    return JSON.parse(readFileSync(weightsPath, "utf-8"))
  } catch {
    return null
  }
}

function checkThreshold(projectRoot: string, threshold: TrainingThreshold): {
  ready: boolean
  reason: string
  total: number
  newSinceLast: number
  hoursSinceLast: number | null
} {
  const buffer = new TrainingBuffer(projectRoot)
  const entries = buffer.readAll()
  const meta = getTrainingMeta(projectRoot)

  const total = entries.length
  let newSinceLast = total
  let hoursSinceLast: number | null = null

  if (meta?.trained_at) {
    const lastTrained = new Date(meta.trained_at).getTime()
    hoursSinceLast = (Date.now() - lastTrained) / (1000 * 60 * 60)
    newSinceLast = entries.filter(e => new Date(e.ts).getTime() > lastTrained).length
  }

  if (total < threshold.min_entries) {
    return {
      ready: false,
      reason: `Need ${threshold.min_entries} entries, have ${total}`,
      total, newSinceLast, hoursSinceLast,
    }
  }

  if (newSinceLast < threshold.min_new_since_last) {
    return {
      ready: false,
      reason: `Need ${threshold.min_new_since_last} new entries since last training, have ${newSinceLast}`,
      total, newSinceLast, hoursSinceLast,
    }
  }

  if (hoursSinceLast !== null && hoursSinceLast < threshold.min_hours_since_last) {
    return {
      ready: false,
      reason: `Last trained ${hoursSinceLast.toFixed(1)}h ago (min: ${threshold.min_hours_since_last}h)`,
      total, newSinceLast, hoursSinceLast,
    }
  }

  return {
    ready: true,
    reason: `${total} entries, ${newSinceLast} new, ready to train`,
    total, newSinceLast, hoursSinceLast,
  }
}

export async function trainPolicyHead(options: {
  force?: boolean
  epochs?: string
  lr?: string
  batchSize?: string
  minEntries?: string
  output?: string
  agent?: string
}): Promise<void> {
  const projectRoot = findProjectRoot()
  const bufferPath = join(projectRoot, ".jfl", "training-buffer.jsonl")
  const outputPath = options.output || join(projectRoot, ".jfl", "policy-weights.json")

  if (!options.force) {
    const threshold = checkThreshold(projectRoot, DEFAULT_THRESHOLD)
    if (!threshold.ready) {
      console.log(chalk.yellow(`\n  Training threshold not met: ${threshold.reason}`))
      console.log(chalk.gray("  Use --force to train anyway\n"))
      return
    }
  }

  if (!existsSync(bufferPath)) {
    const allBuffer = join(projectRoot, ".jfl", "training-buffer.jsonl")
    if (!existsSync(allBuffer)) {
      console.log(chalk.red("\n  No training data found at .jfl/training-buffer.jsonl"))
      console.log(chalk.gray("  Run agents to generate training data, or use: jfl eval mine\n"))
      return
    }
  }

  const trainScript = join(__dirname, "..", "..", "scripts", "train", "train-policy-head.py")
  if (!existsSync(trainScript)) {
    console.log(chalk.red(`\n  Training script not found: ${trainScript}`))
    return
  }

  // Find Python with PyTorch — check venv first, then system
  const cliRoot = join(__dirname, "..", "..")
  const venvPython = join(cliRoot, ".venv", "bin", "python3")
  let pythonBin = "python3"

  if (existsSync(venvPython)) {
    const venvCheck = spawnSync(venvPython, ["-c", "import torch"], { encoding: "utf-8" })
    if (venvCheck.status === 0) {
      pythonBin = venvPython
    }
  }

  if (pythonBin === "python3") {
    const sysCheck = spawnSync("python3", ["-c", "import torch"], { encoding: "utf-8" })
    if (sysCheck.status !== 0) {
      console.log(chalk.red("\n  PyTorch not installed."))
      console.log(chalk.gray("  Install with: python3 -m venv .venv && .venv/bin/pip install torch numpy requests scipy"))
      console.log(chalk.gray(`  Or: cd ${cliRoot} && pip install -r scripts/train/requirements.txt\n`))
      return
    }
  }

  console.log(chalk.bold("\n  Training Policy Head"))
  console.log(chalk.gray("  ─".repeat(30)))

  const buffer = new TrainingBuffer(projectRoot)
  const stats = buffer.stats()
  console.log(chalk.gray(`  Data: ${stats.total} entries, ${Object.keys(stats.byAgent).length} agents`))
  console.log(chalk.gray(`  Avg reward: ${stats.avgReward.toFixed(4)}, Improved rate: ${(stats.improvedRate * 100).toFixed(1)}%`))

  const args = [
    trainScript,
    "--data", bufferPath,
    "--output", outputPath,
  ]

  if (options.epochs) args.push("--epochs", options.epochs)
  if (options.lr) args.push("--lr", options.lr)
  if (options.batchSize) args.push("--batch-size", options.batchSize)
  if (options.minEntries) args.push("--min-entries", options.minEntries)

  console.log(chalk.gray(`  Running: ${pythonBin.split("/").pop()} ${trainScript.split("/").slice(-2).join("/")}`))
  console.log()

  const result = spawnSync(pythonBin, args, {
    cwd: projectRoot,
    encoding: "utf-8",
    stdio: "inherit",
    timeout: 30 * 60 * 1000,
    env: { ...process.env },
  })

  if (result.status === 0) {
    console.log(chalk.green("\n  Training complete."))
    const weights = getWeights(projectRoot)
    if (weights) {
      console.log(chalk.gray(`  Direction accuracy: ${weights.direction_accuracy?.toFixed(3)}`))
      console.log(chalk.gray(`  Rank correlation: ${weights.rank_correlation?.toFixed(3)}`))
      console.log(chalk.gray(`  Trained on: ${weights.trained_on} entries`))
    }
  } else {
    console.log(chalk.red(`\n  Training failed (exit code ${result.status})`))
  }
  console.log()
}

export async function trainStatus(): Promise<void> {
  const projectRoot = findProjectRoot()
  const buffer = new TrainingBuffer(projectRoot)
  const stats = buffer.stats()
  const meta = getTrainingMeta(projectRoot)
  const weights = getWeights(projectRoot)
  const threshold = checkThreshold(projectRoot, DEFAULT_THRESHOLD)

  console.log(chalk.bold("\n  Policy Head Training Status"))
  console.log(chalk.gray("  ─".repeat(30)))

  console.log(chalk.bold("\n  Training Data"))
  console.log(`    Total entries:    ${stats.total}`)
  console.log(`    By agent:         ${Object.entries(stats.byAgent).map(([k, v]) => `${k}(${v})`).join(", ") || "none"}`)
  console.log(`    By source:        ${Object.entries(stats.bySource).map(([k, v]) => `${k}(${v})`).join(", ") || "none"}`)
  console.log(`    Avg reward:       ${stats.avgReward.toFixed(4)}`)
  console.log(`    Improved rate:    ${(stats.improvedRate * 100).toFixed(1)}%`)

  if (meta) {
    console.log(chalk.bold("\n  Last Training"))
    console.log(`    Trained at:       ${meta.trained_at}`)
    console.log(`    Entries used:     ${meta.entries}`)
    console.log(`    Best epoch:       ${meta.best_epoch} / ${meta.epochs_run}`)
    console.log(`    Val loss:         ${meta.best_val_loss?.toFixed(6)}`)
    console.log(`    Device:           ${meta.device}`)
    console.log(`    Parameters:       ${meta.param_count?.toLocaleString()}`)
    if (meta.metrics) {
      console.log(`    Direction acc:    ${meta.metrics.direction_accuracy?.toFixed(3)}`)
      console.log(`    Rank correlation: ${meta.metrics.rank_correlation?.toFixed(3)}`)
    }
  } else {
    console.log(chalk.yellow("\n  No training history found"))
  }

  if (weights) {
    console.log(chalk.bold("\n  Active Weights"))
    console.log(`    Architecture:     ${weights.architecture}`)
    console.log(`    Embed dim:        ${weights.embed_dim}`)
    console.log(`    Direction acc:    ${weights.direction_accuracy?.toFixed(3)}`)
    console.log(`    Rank correlation: ${weights.rank_correlation?.toFixed(3)}`)
  } else {
    console.log(chalk.yellow("\n  No policy weights loaded"))
  }

  console.log(chalk.bold("\n  Training Threshold"))
  console.log(`    Ready:            ${threshold.ready ? chalk.green("YES") : chalk.yellow("NO")}`)
  console.log(`    Reason:           ${threshold.reason}`)
  console.log(`    Total entries:    ${threshold.total}`)
  console.log(`    New since last:   ${threshold.newSinceLast}`)
  if (threshold.hoursSinceLast !== null) {
    console.log(`    Hours since last: ${threshold.hoursSinceLast.toFixed(1)}h`)
  }
  console.log()
}

export async function trainExport(options: { format?: string }): Promise<void> {
  const projectRoot = findProjectRoot()
  const buffer = new TrainingBuffer(projectRoot)
  const exported = buffer.exportForTraining()

  if (exported.length === 0) {
    console.log(chalk.yellow("\n  No training data to export\n"))
    return
  }

  const format = options.format || "jsonl"
  const exportDir = join(projectRoot, ".jfl", "train-export")
  mkdirSync(exportDir, { recursive: true })

  if (format === "jsonl") {
    const outPath = join(exportDir, "training-data.jsonl")
    const lines = exported.map(e => JSON.stringify(e)).join("\n") + "\n"
    const { writeFileSync } = await import("fs")
    writeFileSync(outPath, lines)
    console.log(chalk.green(`\n  Exported ${exported.length} entries to ${outPath}\n`))
  } else if (format === "csv") {
    const outPath = join(exportDir, "training-data.csv")
    const header = "state_text,action_text,reward,agent,ts\n"
    const rows = exported.map(e =>
      `"${e.state_text.replace(/"/g, '""')}","${e.action_text.replace(/"/g, '""')}",${e.reward},"${e.agent}","${e.ts}"`
    ).join("\n") + "\n"
    const { writeFileSync } = await import("fs")
    writeFileSync(outPath, header + rows)
    console.log(chalk.green(`\n  Exported ${exported.length} entries to ${outPath}\n`))
  }
}

export async function trainThresholdCheck(options: { quiet?: boolean }): Promise<boolean> {
  const projectRoot = findProjectRoot()
  const threshold = checkThreshold(projectRoot, DEFAULT_THRESHOLD)

  if (!options.quiet) {
    if (threshold.ready) {
      console.log(chalk.green(`\n  Ready to train: ${threshold.reason}\n`))
    } else {
      console.log(chalk.yellow(`\n  Not ready: ${threshold.reason}\n`))
    }
  }

  return threshold.ready
}

export function registerTrainCommands(parent: Command): void {
  const train = parent.command("train").description("Policy head training pipeline")

  train
    .command("policy-head")
    .description("Train policy head from training buffer data")
    .option("-f, --force", "Train even if threshold not met")
    .option("--epochs <n>", "Max training epochs (default: 500)")
    .option("--lr <rate>", "Learning rate (default: 3e-4)")
    .option("--batch-size <n>", "Batch size (default: 64)")
    .option("--min-entries <n>", "Minimum entries required (default: 50)")
    .option("-o, --output <path>", "Output path for weights JSON")
    .option("-a, --agent <name>", "Filter training data to specific agent")
    .action(async (options) => {
      await trainPolicyHead(options)
    })

  train
    .command("status")
    .description("Show training data stats, last training, and threshold")
    .action(async () => {
      await trainStatus()
    })

  train
    .command("export")
    .description("Export training data for external tools")
    .option("--format <fmt>", "Export format: jsonl or csv (default: jsonl)")
    .action(async (options) => {
      await trainExport(options)
    })

  train
    .command("check")
    .description("Check if training threshold is met")
    .option("-q, --quiet", "Quiet mode — exit code only")
    .action(async (options) => {
      const ready = await trainThresholdCheck(options)
      if (!ready) process.exitCode = 1
    })

  train.action(async () => {
    await trainStatus()
  })
}
