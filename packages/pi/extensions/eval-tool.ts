/**
 * Eval Tool
 *
 * Exposes eval scoring and history to the agent. The agent can check
 * project quality, view eval trends, and trigger eval runs.
 *
 * @purpose Pi tool for eval system — check scores, view trends, trigger evals
 */

import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import type { PiContext, JflConfig } from "./types.js"
import { emitCustomEvent } from "./map-bridge.js"

let projectRoot = ""

interface EvalEntry {
  v: number
  ts: string
  agent: string
  run_id: string
  composite: number
  metrics: Record<string, any>
  model_version?: string
  branch?: string
  pr_number?: number
  delta?: number
  improved?: boolean
}

function readEvals(): EvalEntry[] {
  const evalPath = join(projectRoot, ".jfl", "eval", "eval.jsonl")
  if (!existsSync(evalPath)) return []
  const entries: EvalEntry[] = []
  for (const line of readFileSync(evalPath, "utf-8").split("\n")) {
    if (!line.trim()) continue
    try { entries.push(JSON.parse(line)) } catch {}
  }
  return entries.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""))
}

function readServiceEvents(): Array<Record<string, any>> {
  const eventsPath = join(projectRoot, ".jfl", "service-events.jsonl")
  if (!existsSync(eventsPath)) return []
  const entries: any[] = []
  for (const line of readFileSync(eventsPath, "utf-8").split("\n")) {
    if (!line.trim()) continue
    try { entries.push(JSON.parse(line)) } catch {}
  }
  return entries
}

export async function setupEvalTool(ctx: PiContext, _config: JflConfig): Promise<void> {
  projectRoot = ctx.session.projectRoot

  ctx.registerTool({
    name: "jfl_eval_status",
    description: "Get current eval status — latest scores, trends, and quality metrics. Use to understand project health before making changes.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "string",
          description: "Number of recent eval entries to show (default: 5)",
        },
      },
    },
    async handler(input) {
      const { limit: limitStr } = input as { limit?: string }
      const limit = parseInt(limitStr || "5", 10)

      const evals = readEvals()
      if (evals.length === 0) {
        return "No eval history found. Run `jfl eval` or push a PR to trigger CI eval."
      }

      const recent = evals.slice(-limit)
      const latest = recent[recent.length - 1]

      const lines = [
        `Eval History: ${evals.length} total entries`,
        "",
        `Latest composite: ${latest.composite.toFixed(4)}`,
        `Latest agent: ${latest.agent}`,
        `Latest time: ${latest.ts}`,
      ]

      if (latest.metrics) {
        lines.push("", "Dimensions:")
        for (const [key, val] of Object.entries(latest.metrics)) {
          if (typeof val === "number") {
            lines.push(`  ${key}: ${val.toFixed(4)}`)
          }
        }
      }

      if (recent.length > 1) {
        lines.push("", "Trend (recent):")
        for (const e of recent) {
          const delta = e.delta ?? 0
          const sign = delta >= 0 ? "+" : ""
          const improved = e.improved ? "✓" : "✗"
          lines.push(`  ${e.ts.slice(0, 16)} ${e.composite.toFixed(4)} (${sign}${delta.toFixed(4)}) ${improved} [${e.agent}]`)
        }
      }

      const deltas = evals.slice(-10).map(e => e.delta ?? 0)
      const avgDelta = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0
      const improving = deltas.filter(d => d > 0).length
      lines.push(
        "",
        `10-run trend: avg delta ${avgDelta >= 0 ? "+" : ""}${avgDelta.toFixed(4)}, ${improving}/${deltas.length} improved`,
      )

      return lines.join("\n")
    },
  })

  ctx.registerTool({
    name: "jfl_eval_compare",
    description: "Compare two eval snapshots by index (0 = oldest, -1 = latest). Useful for understanding what changed between versions.",
    inputSchema: {
      type: "object",
      properties: {
        a: {
          type: "string",
          description: "Index of first snapshot (default: -2, second-to-last)",
        },
        b: {
          type: "string",
          description: "Index of second snapshot (default: -1, latest)",
        },
      },
    },
    async handler(input) {
      const { a: aStr, b: bStr } = input as { a?: string; b?: string }

      const evals = readEvals()
      if (evals.length < 2) {
        return "Need at least 2 eval entries to compare."
      }

      const idxA = parseInt(aStr || "-2", 10)
      const idxB = parseInt(bStr || "-1", 10)

      const resolveIdx = (idx: number) => idx < 0 ? evals.length + idx : idx
      const evalA = evals[resolveIdx(idxA)]
      const evalB = evals[resolveIdx(idxB)]

      if (!evalA || !evalB) {
        return `Invalid indices. Have ${evals.length} entries (0 to ${evals.length - 1}).`
      }

      const lines = [
        "Eval Comparison",
        "",
        `A: ${evalA.ts.slice(0, 16)} (composite: ${evalA.composite.toFixed(4)}) [${evalA.agent}]`,
        `B: ${evalB.ts.slice(0, 16)} (composite: ${evalB.composite.toFixed(4)}) [${evalB.agent}]`,
        "",
        `Composite delta: ${(evalB.composite - evalA.composite) >= 0 ? "+" : ""}${(evalB.composite - evalA.composite).toFixed(4)}`,
        "",
        "Dimension changes:",
      ]

      const allKeys = new Set([
        ...Object.keys(evalA.metrics || {}),
        ...Object.keys(evalB.metrics || {}),
      ])

      for (const key of allKeys) {
        const valA = (evalA.metrics?.[key] as number) ?? 0
        const valB = (evalB.metrics?.[key] as number) ?? 0
        if (typeof valA !== "number" || typeof valB !== "number") continue
        const diff = valB - valA
        const sign = diff >= 0 ? "+" : ""
        const arrow = diff > 0.001 ? "↑" : diff < -0.001 ? "↓" : "="
        lines.push(`  ${arrow} ${key}: ${valA.toFixed(4)} → ${valB.toFixed(4)} (${sign}${diff.toFixed(4)})`)
      }

      return lines.join("\n")
    },
  })

  ctx.registerCommand({
    name: "eval",
    description: "Show eval status and recent scores",
    async handler(_args, ctx) {
      const evals = readEvals()
      if (evals.length === 0) {
        ctx.ui.notify("No eval history. Push a PR or run jfl eval.", { level: "info" })
        return
      }

      const latest = evals[evals.length - 1]
      const recent = evals.slice(-5)

      const lines = [
        `Eval: ${evals.length} entries | Latest: ${latest.composite.toFixed(4)}`,
        "",
      ]

      for (const e of recent) {
        const delta = e.delta ?? 0
        const sign = delta >= 0 ? "+" : ""
        lines.push(`  ${e.ts.slice(0, 10)} ${e.composite.toFixed(4)} (${sign}${delta.toFixed(4)}) [${e.agent}]`)
      }

      const serviceEvents = readServiceEvents()
      const recentPRs = serviceEvents
        .filter(e => e.type === "eval:scored")
        .slice(-3)

      if (recentPRs.length > 0) {
        lines.push("", "Recent PR evals:")
        for (const e of recentPRs) {
          const d = e.data || {}
          lines.push(`  PR #${d.pr_number || "?"}: ${d.composite?.toFixed(4) || "?"} (delta: ${d.delta?.toFixed(4) || "?"})`)
        }
      }

      ctx.ui.notify(lines.join("\n"), { level: "info" })
    },
  })
}
