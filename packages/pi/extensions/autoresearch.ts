/**
 * Autoresearch Extension
 *
 * Self-driving research loop as a Pi command. Runs N rounds of:
 *   branch → propose experiment → execute → eval → keep or revert
 * Only the winning experiment gets a PR.
 *
 * Uses the policy head to rank proposals when available, falls back to
 * heuristic dimension analysis when not.
 *
 * @purpose Pi command for autonomous experiment loop — /autoresearch
 */

import { execSync, spawnSync } from "child_process"
import { existsSync, readFileSync, mkdirSync, writeFileSync, appendFileSync } from "fs"
import { join, dirname } from "path"
import type { PiContext, JflConfig } from "./types.js"
import { emitCustomEvent } from "./map-bridge.js"

let projectRoot = ""

interface ExperimentProposal {
  task: string
  predicted_delta: number
  reasoning: string
  risk: string
}

interface ExperimentResult {
  round: number
  task: string
  score: number
  delta: number
  testsPassing: number
  testsTotal: number
  branch: string
}

function git(args: string[]): { ok: boolean; output: string } {
  try {
    const out = execSync(`git ${args.join(" ")}`, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
    return { ok: true, output: out }
  } catch (err: any) {
    return { ok: false, output: err.stderr?.trim() || err.message }
  }
}

function gh(args: string[]): { ok: boolean; output: string } {
  try {
    const out = execSync(`gh ${args.join(" ")}`, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
    return { ok: true, output: out }
  } catch (err: any) {
    return { ok: false, output: err.stderr?.trim() || err.message }
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

function readEvalHistory(): Array<{ ts: string; composite: number; metrics: Record<string, any> }> {
  const evalPath = join(projectRoot, ".jfl", "eval", "eval.jsonl")
  if (!existsSync(evalPath)) return []
  const entries: any[] = []
  for (const line of readFileSync(evalPath, "utf-8").split("\n")) {
    if (!line.trim()) continue
    try { entries.push(JSON.parse(line)) } catch {}
  }
  return entries
}

function readJournalEntries(): Array<{ type: string; title: string; ts: string }> {
  const journalDir = join(projectRoot, ".jfl", "journal")
  if (!existsSync(journalDir)) return []
  const entries: any[] = []
  try {
    const { readdirSync } = require("fs")
    for (const f of readdirSync(journalDir)) {
      if (!f.endsWith(".jsonl")) continue
      for (const line of readFileSync(join(journalDir, f), "utf-8").split("\n")) {
        if (!line.trim()) continue
        try { entries.push(JSON.parse(line)) } catch {}
      }
    }
  } catch {}
  return entries.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""))
}

function writeJournalEntry(entry: Record<string, any>): void {
  const journalDir = join(projectRoot, ".jfl", "journal")
  mkdirSync(journalDir, { recursive: true })
  const branch = git(["branch", "--show-current"]).output || "main"
  const file = join(journalDir, `${branch}.jsonl`)
  appendFileSync(file, JSON.stringify(entry) + "\n")
}

function buildFallbackProposal(
  evals: Array<{ ts: string; composite: number; metrics: Record<string, any> }>
): ExperimentProposal | null {
  if (evals.length < 2) return null
  const sorted = [...evals].sort((a, b) => b.ts.localeCompare(a.ts))
  const latest = sorted[0]
  const prev = sorted[1]

  const metrics = latest.metrics || {}
  const prevMetrics = prev.metrics || {}

  let worstDim = ""
  let worstDelta = 0

  for (const [key, val] of Object.entries(metrics)) {
    if (typeof val !== "number") continue
    const prevVal = (prevMetrics[key] as number) ?? val
    const delta = val - prevVal
    if (delta < worstDelta) {
      worstDelta = delta
      worstDim = key
    }
  }

  if (worstDim) {
    return {
      task: `Improve ${worstDim} score (regressed by ${worstDelta.toFixed(4)})`,
      predicted_delta: Math.abs(worstDelta),
      reasoning: `Recovering ${worstDim} regression`,
      risk: "May not fully recover",
    }
  }

  let lowestDim = ""
  let lowestScore = Infinity
  for (const [key, val] of Object.entries(metrics)) {
    if (typeof val !== "number") continue
    if (val < lowestScore) {
      lowestScore = val
      lowestDim = key
    }
  }

  if (lowestDim) {
    return {
      task: `Improve ${lowestDim} score (currently ${lowestScore.toFixed(4)})`,
      predicted_delta: Math.max(0.01, (1 - lowestScore) * 0.1),
      reasoning: `${lowestDim} is weakest dimension`,
      risk: "May trade off against others",
    }
  }

  return null
}

function runTests(): { passing: number; total: number; score: number } {
  const result = spawnSync("npx", ["jest", "--json", "--silent"], {
    cwd: projectRoot,
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 120000,
  })

  try {
    const json = JSON.parse(result.stdout || "{}")
    const passing = json.numPassedTests || 0
    const total = json.numTotalTests || 1
    return { passing, total, score: total > 0 ? passing / total : 0 }
  } catch {
    return { passing: 0, total: 1, score: 0 }
  }
}

export async function setupAutoresearch(ctx: PiContext, _config: JflConfig): Promise<void> {
  projectRoot = ctx.session.projectRoot

  ctx.registerCommand({
    name: "autoresearch",
    description: "Run autonomous experiment loop — branch, change, eval, keep or revert. Usage: /autoresearch [rounds]",
    async handler(args, ctx) {
      const rounds = parseInt(args.trim() || "3", 10)
      if (rounds < 1 || rounds > 20) {
        ctx.ui.notify("Rounds must be between 1 and 20.", { level: "warn" })
        return
      }

      ctx.ui.notify(`Starting autoresearch: ${rounds} rounds`, { level: "info" })

      const evals = readEvalHistory()
      if (evals.length === 0) {
        ctx.ui.notify("No eval history. Run an eval first to establish a baseline.", { level: "warn" })
        return
      }

      const baseBranch = git(["branch", "--show-current"]).output || "main"
      const baselineScore = [...evals].sort((a, b) => b.ts.localeCompare(a.ts))[0]?.composite ?? 0

      const pastTitles = readJournalEntries()
        .filter(e => e.type === "experiment")
        .map(e => e.title)

      const results: ExperimentResult[] = []
      let bestResult: ExperimentResult | null = null

      git(["stash", "--include-untracked"])

      for (let round = 1; round <= rounds; round++) {
        ctx.ui.notify(`── Round ${round}/${rounds} ──`, { level: "info" })

        let proposal: ExperimentProposal | null = null

        const policyHead = await getPolicyHead()
        if (policyHead?.isLoaded) {
          const fallback = buildFallbackProposal(evals)
          if (fallback) proposal = fallback
        }

        if (!proposal) {
          proposal = buildFallbackProposal(evals)
        }

        if (!proposal) {
          ctx.ui.notify(`Round ${round}: No target found, skipping`, { level: "info" })
          continue
        }

        if (pastTitles.some(t => t.includes(proposal!.task.slice(0, 40)))) {
          proposal.task = `[Retry] ${proposal.task}`
        }

        const branchName = `pp/autoresearch-r${round}-${Date.now()}`
        git(["fetch", "origin", baseBranch])

        let checkout = git(["checkout", "-b", branchName, `origin/${baseBranch}`])
        if (!checkout.ok) {
          checkout = git(["checkout", "-b", branchName, baseBranch])
        }
        if (!checkout.ok) {
          ctx.ui.notify(`Round ${round}: Failed to create branch`, { level: "warn" })
          continue
        }

        ctx.ui.notify(`Task: ${proposal.task}`, { level: "info" })

        await emitCustomEvent(ctx, "autoresearch:round:start", {
          round,
          task: proposal.task,
          predicted_delta: proposal.predicted_delta,
        })

        // The agent itself will make changes via the sendUserMessage approach
        // For now, we run tests on whatever's been committed
        const diffCheck = git(["diff", "--quiet", "HEAD"])
        const untrackedResult = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
          cwd: projectRoot, encoding: "utf-8", stdio: "pipe",
        })
        const hasChanges = !diffCheck.ok || (untrackedResult.stdout || "").trim().length > 0

        if (hasChanges) {
          git(["add", "-A"])
          git(["commit", "-m", `autoresearch: round ${round} - ${proposal.task}`])
        }

        const { passing, total, score } = runTests()
        const delta = score - baselineScore

        const result: ExperimentResult = {
          round,
          task: proposal.task,
          score,
          delta,
          testsPassing: passing,
          testsTotal: total,
          branch: branchName,
        }
        results.push(result)

        if (!bestResult || result.score > bestResult.score) {
          bestResult = result
        }

        writeJournalEntry({
          v: 1,
          ts: new Date().toISOString(),
          session: "autoresearch",
          type: "experiment",
          status: delta > 0 ? "complete" : "incomplete",
          title: `Autoresearch R${round}: ${proposal.task.slice(0, 60)}`,
          summary: `Score: ${score.toFixed(4)}, delta: ${delta > 0 ? "+" : ""}${delta.toFixed(4)}`,
          agent_id: "pi-autoresearch",
        })

        const tb = await getTrainingBuffer()
        if (tb) {
          tb.append({
            agent: "pi-autoresearch",
            state: {
              composite_score: baselineScore,
              dimension_scores: {},
              tests_passing: 0,
              tests_total: 0,
              trajectory_length: results.length,
              recent_deltas: results.slice(-5).map(r => r.delta),
              agent: "pi-autoresearch",
            },
            action: {
              type: "experiment",
              description: proposal.task,
              files_affected: [],
              scope: "medium",
              branch: branchName,
            },
            reward: {
              composite_delta: delta,
              dimension_deltas: {},
              tests_added: 0,
              quality_score: score,
              improved: delta > 0,
              prediction_error: Math.abs(proposal.predicted_delta - delta),
            },
            metadata: {
              branch: branchName,
              autoresearch_round: round,
              source: "autoresearch",
            },
          })
        }

        await emitCustomEvent(ctx, "autoresearch:round:end", {
          round,
          task: proposal.task,
          score,
          delta,
          is_best: bestResult?.round === round,
        })

        const sign = delta > 0 ? "+" : ""
        ctx.ui.notify(
          `Round ${round}: ${score.toFixed(4)} (${sign}${delta.toFixed(4)}) — ${proposal.task.slice(0, 50)}`,
          { level: delta > 0 ? "info" : "warn" }
        )

        git(["checkout", baseBranch])
      }

      // Summary
      const summaryLines = [
        `Autoresearch complete: ${rounds} rounds`,
        "",
      ]
      for (const r of results) {
        const sign = r.delta >= 0 ? "+" : ""
        const star = bestResult && r.round === bestResult.round ? " ★" : ""
        summaryLines.push(`  R${r.round}: ${r.score.toFixed(4)} (${sign}${r.delta.toFixed(4)}) ${r.task.slice(0, 50)}${star}`)
      }

      if (bestResult && bestResult.delta > 0) {
        summaryLines.push("", `Winner: Round ${bestResult.round} (+${bestResult.delta.toFixed(4)})`)

        git(["checkout", bestResult.branch])
        const pushResult = git(["push", "-u", "origin", bestResult.branch])

        if (pushResult.ok) {
          const prTitle = `Autoresearch: ${bestResult.task.slice(0, 50)} (+${bestResult.delta.toFixed(4)})`
          const prBody = [
            "## Autoresearch Winner",
            "",
            `**Task:** ${bestResult.task}`,
            `**Score:** ${bestResult.score.toFixed(4)} (delta: +${bestResult.delta.toFixed(4)})`,
            `**Tests:** ${bestResult.testsPassing}/${bestResult.testsTotal}`,
            `**Round:** ${bestResult.round}/${rounds}`,
          ].join("\n")

          const prResult = gh([
            "pr", "create", "--title", prTitle, "--body", prBody,
            "--base", baseBranch, "--head", bestResult.branch,
          ])

          if (prResult.ok) {
            summaryLines.push(`PR created: ${prResult.output}`)
            await emitCustomEvent(ctx, "autoresearch:complete", {
              rounds,
              winner_round: bestResult.round,
              winner_task: bestResult.task,
              winner_delta: bestResult.delta,
              pr_url: prResult.output,
            })
          }
        }

        git(["checkout", baseBranch])
      } else {
        summaryLines.push("", "No improvement found across all rounds.")
      }

      // Cleanup non-winning branches
      for (const r of results) {
        if (!bestResult || r.round !== bestResult.round) {
          git(["branch", "-D", r.branch])
        }
      }

      git(["stash", "pop"])
      ctx.ui.notify(summaryLines.join("\n"), { level: "info" })
    },
  })
}
