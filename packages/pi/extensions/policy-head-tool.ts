/**
 * Policy Head Tool
 *
 * Exposes the RL policy head to the agent as a tool. The agent can score
 * candidate actions before executing them — "should I fix this test or
 * refactor that module?" — and get a predicted reward delta.
 *
 * Also registers /policy command to show policy head stats and rank
 * ad-hoc proposals interactively.
 *
 * @purpose Pi tool for RL policy head — score candidate actions, rank proposals
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import type { PiContext, JflConfig } from "./types.js"
import { emitCustomEvent } from "./map-bridge.js"

let projectRoot = ""

interface PolicyWeights {
  version: number
  trained_on: number
  direction_accuracy: number
  rank_correlation: number
  target_mean: number
  target_std: number
}

function getWeightsInfo(): PolicyWeights | null {
  const weightsPath = join(projectRoot, ".jfl", "policy-weights.json")
  if (!existsSync(weightsPath)) return null
  try {
    return JSON.parse(readFileSync(weightsPath, "utf-8")) as PolicyWeights
  } catch {
    return null
  }
}

async function getPolicyHead(): Promise<any> {
  try {
    // @ts-ignore — resolved from jfl package at runtime
    const { PolicyHeadInference } = await import("../../src/lib/policy-head.js")
    return new PolicyHeadInference(projectRoot)
  } catch {
    return null
  }
}

async function getTrainingBuffer(): Promise<any> {
  try {
    // @ts-ignore — resolved from jfl package at runtime
    const { TrainingBuffer } = await import("../../src/lib/training-buffer.js")
    return new TrainingBuffer(projectRoot)
  } catch {
    return null
  }
}

export async function setupPolicyHeadTool(ctx: PiContext, _config: JflConfig): Promise<void> {
  projectRoot = ctx.session.projectRoot

  ctx.registerTool({
    name: "jfl_policy_score",
    description: "Score a candidate action using the RL policy head. Returns predicted reward delta to help decide which action to take next. Requires trained policy weights (.jfl/policy-weights.json).",
    inputSchema: {
      type: "object",
      properties: {
        action_type: {
          type: "string",
          description: "Type of action",
          enum: ["fix", "refactor", "feature", "test", "config", "experiment"],
        },
        description: {
          type: "string",
          description: "What the action does (1-2 sentences)",
        },
        files: {
          type: "string",
          description: "Comma-separated list of files affected",
        },
        scope: {
          type: "string",
          description: "Scope of change",
          enum: ["small", "medium", "large"],
        },
      },
      required: ["action_type", "description"],
    },
    async handler(input) {
      const {
        action_type,
        description,
        files,
        scope,
      } = input as {
        action_type: string
        description: string
        files?: string
        scope?: string
      }

      const policyHead = await getPolicyHead()
      if (!policyHead || !policyHead.isLoaded) {
        return "Policy head not available. No trained weights found at .jfl/policy-weights.json. Run `jfl eval train` to train the policy head from existing training tuples."
      }

      const tb = await getTrainingBuffer()
      const entries: any[] = tb ? tb.read() : []
      const recentDeltas = entries.slice(-10).map((e: any) => e.reward.composite_delta)

      const state = {
        composite_score: entries.length > 0
          ? entries[entries.length - 1].reward.composite_delta + entries[entries.length - 1].state.composite_score
          : 0,
        dimension_scores: {} as Record<string, number>,
        tests_passing: 0,
        tests_total: 0,
        trajectory_length: entries.length,
        recent_deltas: recentDeltas,
        agent: "pi-agent",
      }

      const action = {
        type: action_type as "fix" | "refactor" | "feature" | "test" | "config" | "experiment",
        description,
        files_affected: files ? files.split(",").map(f => f.trim()) : [],
        scope: (scope || "medium") as "small" | "medium" | "large",
        branch: ctx.session.branch,
      }

      try {
        const predicted = await policyHead.predictReward(state, action)
        const stats = policyHead.stats

        await emitCustomEvent(ctx, "policy:scored", {
          action_type,
          description: description.slice(0, 80),
          predicted_reward: predicted,
        })

        const lines = [
          `Predicted reward delta: ${predicted >= 0 ? "+" : ""}${predicted.toFixed(4)}`,
          `Recommendation: ${predicted > 0.01 ? "PROCEED — positive expected outcome" : predicted > -0.005 ? "NEUTRAL — marginal expected impact" : "SKIP — negative expected outcome"}`,
          "",
          `Policy head stats:`,
          `  Trained on: ${stats?.trained_on ?? "?"} tuples`,
          `  Direction accuracy: ${stats?.direction_accuracy ? (stats.direction_accuracy * 100).toFixed(1) + "%" : "?"}`,
          `  Rank correlation: ${stats?.rank_correlation?.toFixed(3) ?? "?"}`,
        ]

        return lines.join("\n")
      } catch (err) {
        return `Policy head inference failed: ${err}. Ensure STRATUS_API_KEY is set for embedding generation.`
      }
    },
  })

  ctx.registerTool({
    name: "jfl_policy_rank",
    description: "Rank multiple candidate actions by predicted reward. Pass 2-5 actions as JSON array. Returns ranked list with predicted deltas.",
    inputSchema: {
      type: "object",
      properties: {
        actions: {
          type: "string",
          description: 'JSON array of actions, each with: {"type": "fix|refactor|feature|test|config|experiment", "description": "what it does", "files": ["file1.ts"], "scope": "small|medium|large"}',
        },
      },
      required: ["actions"],
    },
    async handler(input) {
      const { actions: actionsStr } = input as { actions: string }

      const policyHead = await getPolicyHead()
      if (!policyHead || !policyHead.isLoaded) {
        return "Policy head not available. No trained weights at .jfl/policy-weights.json."
      }

      let candidates: Array<{
        type: string
        description: string
        files?: string[]
        scope?: string
      }>
      try {
        candidates = JSON.parse(actionsStr)
        if (!Array.isArray(candidates) || candidates.length < 2) {
          return "Provide at least 2 actions as a JSON array."
        }
      } catch {
        return "Invalid JSON. Provide a JSON array of action objects."
      }

      const tb = await getTrainingBuffer()
      const entries: any[] = tb ? tb.read() : []

      const state = {
        composite_score: entries.length > 0
          ? entries[entries.length - 1].reward.composite_delta + entries[entries.length - 1].state.composite_score
          : 0,
        dimension_scores: {} as Record<string, number>,
        tests_passing: 0,
        tests_total: 0,
        trajectory_length: entries.length,
        recent_deltas: entries.slice(-10).map((e: any) => e.reward.composite_delta),
        agent: "pi-agent",
      }

      const rlActions = candidates.map(c => ({
        type: (c.type || "feature") as "fix" | "refactor" | "feature" | "test" | "config" | "experiment",
        description: c.description,
        files_affected: c.files || [],
        scope: (c.scope || "medium") as "small" | "medium" | "large",
        branch: ctx.session.branch,
      }))

      try {
        const ranked = await policyHead.rankActions(state, rlActions)

        await emitCustomEvent(ctx, "policy:ranked", {
          count: ranked.length,
          top: ranked[0]?.action.description.slice(0, 60),
        })

        const lines = ["Ranked actions (best first):", ""]
        for (const r of ranked) {
          const sign = r.predictedReward >= 0 ? "+" : ""
          lines.push(`  #${r.rank} [${sign}${r.predictedReward.toFixed(4)}] ${r.action.type}: ${r.action.description.slice(0, 80)}`)
        }

        return lines.join("\n")
      } catch (err) {
        return `Ranking failed: ${err}`
      }
    },
  })

  ctx.registerCommand({
    name: "policy",
    description: "Show policy head status and training buffer stats",
    async handler(_args, ctx) {
      const weights = getWeightsInfo()
      const tb = await getTrainingBuffer()
      const stats = tb ? tb.stats() : null

      const lines: string[] = []

      if (weights) {
        lines.push(
          "Policy Head: LOADED",
          `  Trained on: ${weights.trained_on} tuples`,
          `  Direction accuracy: ${(weights.direction_accuracy * 100).toFixed(1)}%`,
          `  Rank correlation: ${weights.rank_correlation.toFixed(3)}`,
          "",
        )
      } else {
        lines.push("Policy Head: NOT LOADED (no .jfl/policy-weights.json)", "")
      }

      if (stats) {
        lines.push(
          `Training Buffer: ${stats.total} tuples`,
          `  Avg reward: ${stats.avgReward.toFixed(4)}`,
          `  Improvement rate: ${(stats.improvedRate * 100).toFixed(1)}%`,
          `  By agent: ${Object.entries(stats.byAgent).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
          `  By source: ${Object.entries(stats.bySource).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
        )
      } else {
        lines.push("Training Buffer: empty or unavailable")
      }

      ctx.ui.notify(lines.join("\n"), { level: "info" })
    },
  })
}
