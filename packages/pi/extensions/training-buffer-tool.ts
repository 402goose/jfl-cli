/**
 * Training Buffer Tool
 *
 * Wraps the RL training buffer for the Pi agent. Two modes:
 * 1. Automatic: captures (state, action, reward) tuples on agent_end events
 * 2. Manual: jfl_training_buffer tool lets the agent record tuples explicitly
 *
 * Also provides /tuples command for inspecting the buffer and /mine command
 * for extracting tuples from project history.
 *
 * @purpose RL training buffer — automatic + manual tuple capture, mining from history
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import type { PiContext, JflConfig, AgentEndEvent } from "./types.js"
import { emitCustomEvent } from "./map-bridge.js"

let projectRoot = ""

async function getTrainingBuffer(): Promise<any> {
  try {
    // @ts-ignore — resolved from jfl package at runtime
    const { TrainingBuffer } = await import("../../src/lib/training-buffer.js")
    return new TrainingBuffer(projectRoot)
  } catch {
    return null
  }
}

async function getTupleMiner(): Promise<any> {
  try {
    // @ts-ignore — resolved from jfl package at runtime
    return await import("../../src/lib/tuple-miner.js")
  } catch {
    return null
  }
}

export async function setupTrainingBufferTool(ctx: PiContext, _config: JflConfig): Promise<void> {
  projectRoot = ctx.session.projectRoot

  ctx.registerTool({
    name: "jfl_training_buffer",
    description: "Record a training tuple (state, action, reward) in the RL training buffer. Use after completing a task to capture the outcome for policy head training.",
    inputSchema: {
      type: "object",
      properties: {
        action_type: {
          type: "string",
          description: "Type of action taken",
          enum: ["fix", "refactor", "feature", "test", "config", "experiment"],
        },
        description: {
          type: "string",
          description: "What was done (1-2 sentences)",
        },
        files: {
          type: "string",
          description: "Comma-separated list of files changed",
        },
        scope: {
          type: "string",
          description: "Scope of change",
          enum: ["small", "medium", "large"],
        },
        outcome: {
          type: "string",
          description: "Did it improve things?",
          enum: ["improved", "neutral", "regressed"],
        },
        delta: {
          type: "string",
          description: "Numeric score delta if known (e.g. 0.02 or -0.01)",
        },
      },
      required: ["action_type", "description", "outcome"],
    },
    async handler(input) {
      const {
        action_type,
        description,
        files,
        scope,
        outcome,
        delta: deltaStr,
      } = input as {
        action_type: string
        description: string
        files?: string
        scope?: string
        outcome: string
        delta?: string
      }

      const tb = await getTrainingBuffer()
      if (!tb) {
        return "Training buffer unavailable. Ensure jfl-cli is built (npm run build)."
      }

      const delta = deltaStr ? parseFloat(deltaStr) : (
        outcome === "improved" ? 0.02 :
        outcome === "regressed" ? -0.01 :
        0.0
      )

      const existing: any[] = tb.read()
      const recentDeltas = existing.slice(-10).map((e: any) => e.reward.composite_delta)
      const currentScore = existing.length > 0
        ? existing[existing.length - 1].state.composite_score + existing[existing.length - 1].reward.composite_delta
        : 0

      const entry = tb.append({
        agent: "pi-agent",
        state: {
          composite_score: currentScore,
          dimension_scores: {},
          tests_passing: 0,
          tests_total: 0,
          trajectory_length: existing.length,
          recent_deltas: recentDeltas,
          agent: "pi-agent",
        },
        action: {
          type: action_type as "fix" | "refactor" | "feature" | "test" | "config" | "experiment",
          description,
          files_affected: files ? files.split(",").map(f => f.trim()) : [],
          scope: (scope || "medium") as "small" | "medium" | "large",
          branch: ctx.session.branch,
        },
        reward: {
          composite_delta: delta,
          dimension_deltas: {},
          tests_added: 0,
          quality_score: outcome === "improved" ? 1.0 : outcome === "regressed" ? 0.0 : 0.5,
          improved: outcome === "improved",
        },
        metadata: {
          branch: ctx.session.branch,
          source: "manual",
        },
      })

      await emitCustomEvent(ctx, "training:tuple:added", { id: entry.id, delta })

      return [
        `Training tuple recorded: ${entry.id}`,
        `  Action: ${action_type} — ${description.slice(0, 60)}`,
        `  Delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(4)}`,
        `  Buffer now has ${existing.length + 1} tuples`,
      ].join("\n")
    },
  })

  ctx.registerTool({
    name: "jfl_mine_tuples",
    description: "Mine training tuples from project history (journals, MAP events, eval results, telemetry). Extracts (state, action, reward) data that can train the policy head.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "What to mine from",
          enum: ["journals", "flows", "sessions", "evals", "all"],
        },
        write: {
          type: "string",
          description: "Write mined tuples to training buffer? (yes/no, default: no)",
          enum: ["yes", "no"],
        },
      },
      required: ["source"],
    },
    async handler(input) {
      const { source, write: writeFlag } = input as { source: string; write?: string }

      const miner = await getTupleMiner()
      if (!miner) {
        return "Tuple miner unavailable. Ensure jfl-cli is built."
      }

      const tb = await getTrainingBuffer()
      let tuples: any[] = []

      switch (source) {
        case "journals":
          tuples = miner.mineJournalTuples(projectRoot)
          break
        case "flows":
          tuples = miner.mineFlowTuples(projectRoot)
          break
        case "sessions":
          tuples = miner.mineSessionTuples(projectRoot)
          break
        case "evals":
          tuples = miner.mineEvalTuples(projectRoot)
          break
        case "all": {
          const result = miner.mineAll({ dirs: [projectRoot], telemetry: true })
          tuples = result.tuples
          break
        }
      }

      if (writeFlag === "yes" && tb && tuples.length > 0) {
        for (const t of tuples) {
          tb.append(t)
        }
        await emitCustomEvent(ctx, "training:mined", { count: tuples.length, source })
      }

      const improved = tuples.filter((t: any) => t.reward.improved).length
      const avgDelta = tuples.length > 0
        ? tuples.reduce((sum: number, t: any) => sum + t.reward.composite_delta, 0) / tuples.length
        : 0

      const lines = [
        `Mined ${tuples.length} tuples from ${source}`,
        `  Improved: ${improved}/${tuples.length} (${tuples.length > 0 ? ((improved / tuples.length) * 100).toFixed(0) : 0}%)`,
        `  Avg delta: ${avgDelta >= 0 ? "+" : ""}${avgDelta.toFixed(4)}`,
        `  Agents: ${[...new Set(tuples.map((t: any) => t.agent))].join(", ") || "none"}`,
      ]

      if (writeFlag === "yes") {
        lines.push(`  Written to training buffer ✓`)
      } else {
        lines.push(`  Dry run — pass write="yes" to persist`)
      }

      return lines.join("\n")
    },
  })

  ctx.registerCommand({
    name: "tuples",
    description: "Show training buffer stats and recent tuples",
    async handler(_args, ctx) {
      const tb = await getTrainingBuffer()
      if (!tb) {
        ctx.ui.notify("Training buffer unavailable.", { level: "warn" })
        return
      }

      const stats = tb.stats()
      const entries: any[] = tb.read()
      const recent = entries.slice(-5)

      const lines = [
        `Training Buffer: ${stats.total} tuples`,
        `  Avg reward: ${stats.avgReward >= 0 ? "+" : ""}${stats.avgReward.toFixed(4)}`,
        `  Improvement rate: ${(stats.improvedRate * 100).toFixed(1)}%`,
        `  By agent: ${Object.entries(stats.byAgent).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
        `  By source: ${Object.entries(stats.bySource).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
        "",
        "Recent tuples:",
      ]

      for (const e of recent as any[]) {
        const sign = e.reward.composite_delta >= 0 ? "+" : ""
        lines.push(`  [${sign}${e.reward.composite_delta.toFixed(4)}] ${e.action.type}: ${e.action.description.slice(0, 60)}`)
      }

      ctx.ui.notify(lines.join("\n"), { level: "info" })
    },
  })

  ctx.registerCommand({
    name: "mine",
    description: "Mine training tuples from project history and write to buffer",
    async handler(args, ctx) {
      const source = args.trim() || "all"
      const miner = await getTupleMiner()
      if (!miner) {
        ctx.ui.notify("Tuple miner unavailable.", { level: "warn" })
        return
      }

      const tb = await getTrainingBuffer()
      if (!tb) {
        ctx.ui.notify("Training buffer unavailable.", { level: "warn" })
        return
      }

      const result = miner.mineAll({
        dirs: [projectRoot],
        telemetry: source === "all",
      })

      for (const t of result.tuples) {
        tb.append(t)
      }

      await emitCustomEvent(ctx, "training:mined", {
        count: result.tuples.length,
        stats: result.stats,
      })

      ctx.ui.notify(
        [
          `Mined ${result.stats.totalMined} tuples:`,
          `  Journals: ${result.stats.journalTuples}`,
          `  Sessions: ${result.stats.sessionTuples}`,
          `  Flows: ${result.stats.flowTuples}`,
          `  Evals: ${result.stats.evalTuples}`,
          `  Telemetry: ${result.stats.telemetryTuples}`,
          `Written to training buffer ✓`,
        ].join("\n"),
        { level: "info" }
      )
    },
  })
}

export async function onTrainingAgentEnd(
  ctx: PiContext,
  event: AgentEndEvent
): Promise<void> {
  const turnCount = event.messages?.length ?? event.turnCount ?? 0
  if (turnCount < 2) return

  const tb = await getTrainingBuffer()
  if (!tb) return

  const existing: any[] = tb.read()
  const recentDeltas = existing.slice(-10).map((e: any) => e.reward.composite_delta)
  const currentScore = existing.length > 0
    ? existing[existing.length - 1].state.composite_score + existing[existing.length - 1].reward.composite_delta
    : 0

  const filesChanged = event.filesChanged || []
  const exitReason = event.exitReason as string | undefined
  const isSuccess = exitReason !== "error" && exitReason !== "timeout"

  const entry = tb.append({
    agent: "pi-agent",
    state: {
      composite_score: currentScore,
      dimension_scores: {},
      tests_passing: 0,
      tests_total: 0,
      trajectory_length: existing.length,
      recent_deltas: recentDeltas,
      agent: "pi-agent",
    },
    action: {
      type: filesChanged.some(f => f.endsWith(".test.ts") || f.endsWith(".test.js")) ? "test"
        : filesChanged.some(f => f.includes("config") || f.includes(".json")) ? "config"
        : "feature",
      description: `Agent turn: ${turnCount} turns, ${filesChanged.length} files changed`,
      files_affected: filesChanged.slice(0, 20),
      scope: filesChanged.length > 10 ? "large" : filesChanged.length > 3 ? "medium" : "small",
      branch: ctx.session.branch,
    },
    reward: {
      composite_delta: isSuccess ? 0.01 : -0.005,
      dimension_deltas: {},
      tests_added: 0,
      quality_score: isSuccess ? 0.7 : 0.3,
      improved: isSuccess,
    },
    metadata: {
      branch: ctx.session.branch,
      source: "ci",
    },
  })

  await emitCustomEvent(ctx, "training:tuple:auto", { id: entry.id })
}
