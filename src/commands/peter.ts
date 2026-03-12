/**
 * Peter Parker Command
 *
 * Orchestrator that wraps ralph-tui with model routing and event bridging.
 * Spidey-sense for which model to use per agent role.
 * Includes proactive experiment selection — PP picks its own next task.
 *
 * @purpose CLI command for Peter Parker orchestrator — setup, run, status, experiment
 */

import chalk from "chalk"
import { execSync, spawn, spawnSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import type { CostProfile } from "../types/map.js"
import { writePeterParkerConfig, readCurrentProfile } from "../lib/peter-parker-config.js"
import { PeterParkerBridge } from "../lib/peter-parker-bridge.js"
import { getProjectHubUrl } from "../utils/context-hub-port.js"
import { TrajectoryLoader } from "../lib/trajectory-loader.js"
import { readEvals } from "../lib/eval-store.js"
import type { EvalEntry } from "../types/eval.js"
import { TrainingBuffer } from "../lib/training-buffer.js"
import { PolicyHeadInference } from "../lib/policy-head.js"
import type { RLState, RLAction } from "../lib/training-buffer.js"

function hasRalphTui(): boolean {
  try {
    execSync("which ralph-tui", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function getAuthToken(projectRoot: string): string | null {
  const tokenPath = path.join(projectRoot, ".jfl", "context-hub.token")
  if (fs.existsSync(tokenPath)) {
    return fs.readFileSync(tokenPath, "utf-8").trim()
  }
  return null
}

async function setup(projectRoot: string, profile: CostProfile) {
  const configPath = writePeterParkerConfig(projectRoot, profile)
  console.log(chalk.green(`\n  Peter Parker config generated`))
  console.log(chalk.gray(`  Profile: ${profile}`))
  console.log(chalk.gray(`  Config:  ${path.relative(projectRoot, configPath)}`))
  console.log(chalk.gray(`\n  Agents: scout, planner, builder (default), reviewer, tester`))
  console.log(chalk.gray(`  Each has a fallback agent at next tier up\n`))
}

async function run(projectRoot: string, task?: string) {
  if (!hasRalphTui()) {
    console.log(chalk.yellow("\n  ralph-tui is not installed"))
    console.log(chalk.gray("  Install: bun install -g ralph-tui\n"))
    return
  }

  const configPath = path.join(projectRoot, ".ralph-tui", "config.toml")
  if (!fs.existsSync(configPath)) {
    console.log(chalk.yellow("\n  No Peter Parker config found"))
    console.log(chalk.gray("  Run: jfl peter setup\n"))
    return
  }

  const args = ["run", "--listen"]
  let prdPath: string | null = null

  if (task) {
    const ralphDir = path.join(projectRoot, ".ralph-tui")
    if (!fs.existsSync(ralphDir)) {
      fs.mkdirSync(ralphDir, { recursive: true })
    }

    prdPath = path.join(ralphDir, "peter-task.json")
    const titleLine = task.split("\n")[0].slice(0, 80)
    const prd = {
      name: "Peter Parker Task",
      branchName: `ralph/peter-task-${Date.now()}`,
      description: task,
      userStories: [{
        id: "US-001",
        title: titleLine,
        description: task,
        acceptanceCriteria: ["Task completed as described"],
        priority: 1,
        passes: false,
        notes: "",
        dependsOn: [],
      }],
      metadata: { updatedAt: new Date().toISOString() },
    }
    fs.writeFileSync(prdPath, JSON.stringify(prd, null, 2))
    args.push("--prd", prdPath, "--headless")
  }

  console.log(chalk.cyan("\n  Starting Peter Parker orchestrator..."))
  console.log(chalk.gray(`  ralph-tui ${args.join(" ")}\n`))

  const token = getAuthToken(projectRoot)
  const hubUrl = getProjectHubUrl(projectRoot)
  let bridge: PeterParkerBridge | null = null

  if (token) {
    bridge = new PeterParkerBridge({
      contextHubUrl: hubUrl,
      authToken: token,
      onEvent: (event) => {
        console.log(chalk.gray(`  [MAP] ${event.type}`))
      },
    })
  }

  const env = { ...process.env }
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE

  const child = spawn("ralph-tui", args, {
    cwd: projectRoot,
    stdio: "inherit",
    env,
  })

  if (bridge) {
    setTimeout(() => bridge!.start(), 1000)
  }

  function cleanup() {
    if (prdPath && fs.existsSync(prdPath)) {
      try { fs.unlinkSync(prdPath) } catch {}
    }
  }

  child.on("error", (error) => {
    cleanup()
    console.error(chalk.red(`Failed to start ralph-tui: ${error.message}`))
  })

  child.on("exit", (code) => {
    cleanup()
    if (bridge) bridge.stop()
    process.exit(code || 0)
  })
}

async function status(projectRoot: string) {
  console.log(chalk.bold("\n  Peter Parker Status\n"))

  const profile = readCurrentProfile(projectRoot)
  if (profile) {
    console.log(chalk.gray("  Config profile: ") + chalk.cyan(profile))
  } else {
    console.log(chalk.yellow("  No config found. Run: jfl peter setup"))
  }

  const token = getAuthToken(projectRoot)
  const hubUrl = getProjectHubUrl(projectRoot)

  if (token) {
    try {
      const params = new URLSearchParams({ pattern: "peter:*", limit: "5" })
      const response = await fetch(`${hubUrl}/api/events?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2000),
      })

      if (response.ok) {
        const data = await response.json() as { events: any[]; count: number }
        console.log(chalk.gray(`  Recent events: ${data.count}`))
        for (const event of data.events) {
          const time = new Date(event.ts).toISOString().replace("T", " ").slice(11, 19)
          console.log(chalk.gray(`    [${time}] ${event.type}`))
        }
      }
    } catch {
      console.log(chalk.gray("  Event bus: not reachable"))
    }
  } else {
    console.log(chalk.gray("  Event bus: no auth token"))
  }

  console.log()
}

function gitExec(args: string[], cwd: string): { ok: boolean; output: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" })
  return { ok: result.status === 0, output: (result.stdout || "").trim() }
}

function ghExec(args: string[], cwd: string): { ok: boolean; output: string } {
  const result = spawnSync("gh", args, { cwd, encoding: "utf-8", stdio: "pipe" })
  return { ok: result.status === 0, output: (result.stdout || "").trim() }
}

async function postHubEvent(
  projectRoot: string,
  eventType: string,
  data: Record<string, unknown>
): Promise<void> {
  const token = getAuthToken(projectRoot)
  const hubUrl = getProjectHubUrl(projectRoot)
  if (!token) return

  try {
    await fetch(`${hubUrl}/api/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        type: eventType,
        source: "peter-parker",
        data,
      }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    console.log(chalk.gray("  PP: Warning - could not post event to hub"))
  }
}

async function runWithPR(projectRoot: string, task?: string): Promise<void> {
  if (!task) {
    console.log(chalk.yellow("\n  --task is required for pr mode"))
    console.log(chalk.gray("  Usage: jfl peter pr --task \"fix the login bug\"\n"))
    return
  }

  if (!hasRalphTui()) {
    console.log(chalk.yellow("\n  ralph-tui is not installed"))
    console.log(chalk.gray("  Install: bun install -g ralph-tui\n"))
    return
  }

  const configPath = path.join(projectRoot, ".ralph-tui", "config.toml")
  if (!fs.existsSync(configPath)) {
    console.log(chalk.yellow("\n  No Peter Parker config found"))
    console.log(chalk.gray("  Run: jfl peter setup\n"))
    return
  }

  const baseBranch = "main"
  const branchName = `pp/fix-${Date.now()}`

  console.log(chalk.cyan(`\n  PP: Creating branch ${branchName}`))

  gitExec(["fetch", "origin", baseBranch], projectRoot)

  let checkout = gitExec(["checkout", "-b", branchName, `origin/${baseBranch}`], projectRoot)
  if (!checkout.ok) {
    checkout = gitExec(["checkout", "-b", branchName, baseBranch], projectRoot)
  }
  if (!checkout.ok) {
    console.log(chalk.red(`  PP: Failed to create branch ${branchName}`))
    return
  }

  console.log(chalk.cyan(`  PP: Running agent on task: ${task}`))

  await new Promise<void>((resolve) => {
    const ralphDir = path.join(projectRoot, ".ralph-tui")
    if (!fs.existsSync(ralphDir)) {
      fs.mkdirSync(ralphDir, { recursive: true })
    }

    const prdPath = path.join(ralphDir, "peter-task.json")
    const titleLine = task.split("\n")[0].slice(0, 80)
    const prd = {
      name: "Peter Parker Task",
      branchName: `ralph/peter-task-${Date.now()}`,
      description: task,
      userStories: [{
        id: "US-001",
        title: titleLine,
        description: task,
        acceptanceCriteria: ["Task completed as described"],
        priority: 1,
        passes: false,
        notes: "",
        dependsOn: [],
      }],
      metadata: { updatedAt: new Date().toISOString() },
    }
    fs.writeFileSync(prdPath, JSON.stringify(prd, null, 2))

    const args = ["run", "--listen", "--prd", prdPath, "--headless"]

    const token = getAuthToken(projectRoot)
    let bridge: PeterParkerBridge | null = null

    if (token) {
      bridge = new PeterParkerBridge({
        contextHubUrl: getProjectHubUrl(projectRoot),
        authToken: token,
        onEvent: (event) => {
          console.log(chalk.gray(`  [MAP] ${event.type}`))
        },
      })
    }

    const env = { ...process.env }
    delete env.CLAUDECODE
    delete env.CLAUDE_CODE

    const child = spawn("ralph-tui", args, {
      cwd: projectRoot,
      stdio: "inherit",
      env,
    })

    if (bridge) {
      setTimeout(() => bridge!.start(), 1000)
    }

    function cleanup() {
      if (prdPath && fs.existsSync(prdPath)) {
        try { fs.unlinkSync(prdPath) } catch {}
      }
    }

    child.on("error", (error) => {
      cleanup()
      console.error(chalk.red(`  PP: Failed to start ralph-tui: ${error.message}`))
      resolve()
    })

    child.on("exit", () => {
      cleanup()
      if (bridge) bridge.stop()
      resolve()
    })
  })

  const diffCheck = gitExec(["diff", "--quiet", "HEAD"], projectRoot)
  const untrackedResult = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: projectRoot,
    encoding: "utf-8",
    stdio: "pipe",
  })
  const untracked = (untrackedResult.stdout || "").trim()

  if (diffCheck.ok && !untracked) {
    console.log(chalk.yellow("\n  PP: No changes made, cleaning up"))
    gitExec(["checkout", baseBranch], projectRoot)
    gitExec(["branch", "-D", branchName], projectRoot)
    return
  }

  console.log(chalk.cyan("  PP: Changes detected, committing..."))

  gitExec(["add", "-A"], projectRoot)

  const commitMsg = [
    `fix(pp): ${task}`,
    "",
    `Agent: peter-parker`,
    `Branch: ${branchName}`,
    `Auto-generated by JFL self-driving loop`,
    "",
    `Co-authored-by: Peter Parker <pp@jfl.dev>`,
  ].join("\n")

  const commitResult = gitExec(["commit", "-m", commitMsg], projectRoot)
  if (!commitResult.ok) {
    console.log(chalk.red("  PP: Commit failed"))
    console.log(chalk.gray(`  ${commitResult.output}`))
    return
  }

  console.log(chalk.cyan("  PP: Pushing branch..."))

  const pushResult = gitExec(["push", "-u", "origin", branchName], projectRoot)
  if (!pushResult.ok) {
    console.log(chalk.red("  PP: Push failed"))
    console.log(chalk.gray(`  ${pushResult.output}`))
    return
  }

  console.log(chalk.cyan("  PP: Creating PR..."))

  const prTitle = `PP: ${task.slice(0, 60)}`
  const prBody = [
    "## Auto-generated by Peter Parker",
    "",
    `**Task:** ${task}`,
    `**Branch:** \`${branchName}\``,
    "",
    "### Eval Suite",
    "This PR will be evaluated by the CI eval suite.",
    "Auto-merge will trigger if eval score improves over baseline.",
    "",
    "---",
    "*Generated by JFL self-driving loop*",
  ].join("\n")

  let prResult = ghExec([
    "pr", "create",
    "--title", prTitle,
    "--body", prBody,
    "--base", baseBranch,
    "--head", branchName,
    "--label", "pp-generated",
  ], projectRoot)

  if (!prResult.ok) {
    prResult = ghExec([
      "pr", "create",
      "--title", prTitle,
      "--body", prBody,
      "--base", baseBranch,
      "--head", branchName,
    ], projectRoot)
  }

  if (!prResult.ok) {
    console.log(chalk.red("  PP: Failed to create PR"))
    console.log(chalk.gray(`  ${prResult.output}`))
  } else {
    const prUrl = prResult.output
    console.log(chalk.green(`\n  PP: PR created at ${prUrl}`))

    await postHubEvent(projectRoot, "pr:created", {
      task,
      pr_url: prUrl,
      branch: branchName,
    })
  }

  gitExec(["checkout", baseBranch], projectRoot)
  console.log(chalk.green("  PP: Done\n"))
}

interface ExperimentProposal {
  task: string
  predicted_delta: number
  reasoning: string
  risk: string
}

function buildRLState(evals: EvalEntry[], trajectoryLength: number, recentDeltas: number[]): RLState {
  const latest = evals.sort((a, b) => b.ts.localeCompare(a.ts))[0]
  return {
    composite_score: latest?.composite ?? 0,
    dimension_scores: latest?.metrics ?? {},
    tests_passing: (latest?.metrics?.tests_passed as number) ?? 0,
    tests_total: (latest?.metrics?.tests_total as number) ?? 1,
    trajectory_length: trajectoryLength,
    recent_deltas: recentDeltas,
    agent: "peter-parker",
  }
}

function proposalToRLAction(p: ExperimentProposal): RLAction {
  return {
    type: "experiment",
    description: p.task,
    files_affected: [],
    scope: "medium",
    branch: "",
  }
}

async function rerankWithPolicyHead(
  projectRoot: string,
  proposals: ExperimentProposal[],
  evals: EvalEntry[],
  recentDeltas: number[],
): Promise<ExperimentProposal[]> {
  const ph = new PolicyHeadInference(projectRoot)
  if (!ph.isLoaded || proposals.length < 2) return proposals

  const state = buildRLState(evals, 0, recentDeltas)
  const actions = proposals.map(proposalToRLAction)

  try {
    const ranked = await ph.rankActions(state, actions)
    const reordered = ranked.map(r => proposals[actions.indexOf(r.action)])

    const stats = ph.stats!
    console.log(chalk.magenta(`  Policy head re-ranked ${proposals.length} proposals (trained on ${stats.trained_on} tuples, rank_corr=${stats.rank_correlation.toFixed(3)})`))

    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i]
      const p = reordered[i]
      console.log(chalk.gray(`    #${i + 1} [pred=${r.predictedReward.toFixed(4)}] ${p.task.slice(0, 60)}`))
    }
    console.log()

    return reordered
  } catch (err: any) {
    console.log(chalk.yellow(`  Policy head ranking failed: ${err.message}`))
    return proposals
  }
}

function writeJournalEntry(projectRoot: string, entry: Record<string, unknown>): void {
  const journalDir = path.join(projectRoot, ".jfl", "journal")
  if (!fs.existsSync(journalDir)) {
    fs.mkdirSync(journalDir, { recursive: true })
  }
  const journalFile = path.join(journalDir, "peter-experiment.jsonl")
  fs.appendFileSync(journalFile, JSON.stringify(entry) + "\n")
}

function buildEvalSummary(evals: EvalEntry[], limit: number = 10): string {
  if (evals.length === 0) return "No eval entries found."

  const recent = evals
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, limit)

  const lines: string[] = []
  for (const e of recent) {
    const metricsStr = Object.entries(e.metrics)
      .map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(4) : v}`)
      .join(", ")
    lines.push(
      `[${e.ts}] agent=${e.agent} composite=${e.composite?.toFixed(4) ?? "N/A"} ${metricsStr}`
    )
  }
  return lines.join("\n")
}

function findLowestDimension(evals: EvalEntry[]): { dimension: string; score: number } | null {
  if (evals.length === 0) return null

  const latest = evals
    .sort((a, b) => b.ts.localeCompare(a.ts))[0]

  if (!latest.metrics || Object.keys(latest.metrics).length === 0) return null

  let lowestDim = ""
  let lowestScore = Infinity
  for (const [dim, score] of Object.entries(latest.metrics)) {
    if (typeof score === "number" && score < lowestScore) {
      lowestScore = score
      lowestDim = dim
    }
  }

  if (!lowestDim) return null
  return { dimension: lowestDim, score: lowestScore }
}

function findRegressedDimensions(evals: EvalEntry[]): Array<{ dimension: string; delta: number }> {
  if (evals.length < 2) return []

  const sorted = evals.sort((a, b) => b.ts.localeCompare(a.ts))
  const latest = sorted[0]
  const previous = sorted[1]

  const regressed: Array<{ dimension: string; delta: number }> = []
  for (const [dim, score] of Object.entries(latest.metrics)) {
    const prevScore = previous.metrics[dim]
    if (typeof score === "number" && typeof prevScore === "number" && score < prevScore) {
      regressed.push({ dimension: dim, delta: score - prevScore })
    }
  }

  return regressed.sort((a, b) => a.delta - b.delta)
}

async function runExperiment(projectRoot: string): Promise<void> {
  console.log(chalk.bold("\n  Peter Parker - Proactive Experiment Selection\n"))

  const loader = new TrajectoryLoader(projectRoot)
  const evals = readEvals(projectRoot)

  if (evals.length === 0) {
    console.log(chalk.yellow("  No eval history yet -- run `jfl peter pr` first to build a baseline.\n"))
    return
  }

  const trajectoryEntries = loader.load({ maxAge: "30d", limit: 50 })
  const experimentEntries = loader.load({ type: "experiment", maxAge: "30d", limit: 20 })
  const pastTitles = experimentEntries.map(e => e.title)

  console.log(chalk.gray(`  Loaded ${evals.length} eval entries, ${trajectoryEntries.length} trajectory entries`))

  let proposal: ExperimentProposal | null = null

  const stratusKey = process.env.STRATUS_API_KEY
  const stratusUrl = process.env.STRATUS_API_URL || "https://api.stratus.run"

  if (stratusKey) {
    console.log(chalk.gray("  Using Stratus to rank experiment proposals...\n"))

    try {
      const { StratusClient } = await import("../lib/stratus-client.js")
      const stratus = new StratusClient({
        baseUrl: stratusUrl,
        apiKey: stratusKey,
        model: "stratus-x1ac-base-claude-sonnet-4-6",
        timeout: 60000,
      })

      const evalSummary = buildEvalSummary(evals, 15)
      const trajectoryContext = loader.renderForContext(
        loader.deduplicate(experimentEntries.slice(0, 10))
      )

      const prompt = `Given the following experiment trajectory and eval history, suggest the top 3 improvements that would most increase the composite eval score.

Recent eval entries:
${evalSummary}

Recent experiment outcomes:
${trajectoryContext}

What has been tried (avoid repeats):
${pastTitles.length > 0 ? pastTitles.map(t => `- ${t}`).join("\n") : "Nothing yet"}

For each suggestion, provide a JSON array with objects having these fields:
- task: one-line description of what to implement
- predicted_delta: estimated score improvement (0.0 to 1.0)
- reasoning: why this would help
- risk: what could go wrong

Respond with ONLY a JSON array, no other text.`

      const response = await stratus.reason(prompt, {
        temperature: 0.7,
        maxTokens: 1500,
        featureContext: "experiment-selection",
      })

      const content = response.choices[0]?.message?.content || ""

      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        let proposals: ExperimentProposal[] = JSON.parse(jsonMatch[0])
        if (proposals.length > 0) {
          proposals.sort((a, b) => b.predicted_delta - a.predicted_delta)

          const recentDeltas = experimentEntries
            .slice(0, 5)
            .map(e => (e as any).score_delta ?? 0)
            .filter((d: number) => typeof d === "number")

          proposals = await rerankWithPolicyHead(projectRoot, proposals, evals, recentDeltas)

          console.log(chalk.bold("  Top 3 Proposals:\n"))
          for (let i = 0; i < Math.min(3, proposals.length); i++) {
            const p = proposals[i]
            const rank = i + 1
            console.log(chalk.cyan(`  ${rank}. ${p.task}`))
            console.log(chalk.gray(`     Delta: +${p.predicted_delta.toFixed(4)}  |  Risk: ${p.risk}`))
            console.log(chalk.gray(`     Reasoning: ${p.reasoning}\n`))
          }

          proposal = proposals[0]
        }
      }

      if (!proposal) {
        console.log(chalk.yellow("  Stratus returned no parseable proposals, falling back to heuristic"))
      }
    } catch (err: any) {
      console.log(chalk.yellow(`  Stratus call failed: ${err.message}`))
      console.log(chalk.gray("  Falling back to heuristic approach\n"))
    }
  }

  if (!proposal) {
    console.log(chalk.gray("  Using heuristic: targeting lowest-scoring eval dimension\n"))

    const regressed = findRegressedDimensions(evals)
    const lowest = findLowestDimension(evals)

    if (regressed.length > 0) {
      const worst = regressed[0]
      proposal = {
        task: `Improve ${worst.dimension} score which regressed by ${worst.delta.toFixed(4)} in the latest eval. Analyze recent changes that may have caused the regression and fix them.`,
        predicted_delta: Math.abs(worst.delta),
        reasoning: `${worst.dimension} regressed by ${worst.delta.toFixed(4)} -- recovering this regression is the highest-value action`,
        risk: "Fix may not fully recover the regression if root cause is structural",
      }
      console.log(chalk.cyan(`  Target: ${worst.dimension} (regressed by ${worst.delta.toFixed(4)})`))
    } else if (lowest) {
      proposal = {
        task: `Improve ${lowest.dimension} score (currently ${lowest.score.toFixed(4)}) which is the lowest-performing eval dimension. Focus changes on improving this specific metric.`,
        predicted_delta: Math.max(0.01, (1 - lowest.score) * 0.1),
        reasoning: `${lowest.dimension} at ${lowest.score.toFixed(4)} is the weakest dimension -- improving it has the most room for composite score gains`,
        risk: "Improvements to one dimension may trade off against others",
      }
      console.log(chalk.cyan(`  Target: ${lowest.dimension} (score: ${lowest.score.toFixed(4)})`))
    } else {
      console.log(chalk.yellow("  Could not determine a target dimension from eval history.\n"))
      return
    }
  }

  console.log(chalk.bold(`\n  Selected experiment:`))
  console.log(chalk.white(`  Task: ${proposal.task}`))
  console.log(chalk.gray(`  Predicted delta: +${proposal.predicted_delta.toFixed(4)}`))
  console.log(chalk.gray(`  Risk: ${proposal.risk}\n`))

  writeJournalEntry(projectRoot, {
    v: 1,
    ts: new Date().toISOString(),
    session: "peter-experiment",
    type: "experiment",
    status: "incomplete",
    title: `Experiment: ${proposal.task.slice(0, 80)}`,
    summary: `Proactive experiment selected. Predicted delta: +${proposal.predicted_delta.toFixed(4)}. ${proposal.reasoning}`,
    detail: `Task: ${proposal.task}\nRisk: ${proposal.risk}`,
    hypothesis: `Implementing "${proposal.task}" will improve composite score by ~${proposal.predicted_delta.toFixed(4)}`,
    agent_id: "peter-parker",
  })

  await postHubEvent(projectRoot, "peter:task-selected", {
    task: proposal.task,
    predicted_delta: proposal.predicted_delta,
    source: "experiment",
    reasoning: proposal.reasoning,
  })

  console.log(chalk.cyan("  Dispatching to Peter Parker PR workflow...\n"))
  await runWithPR(projectRoot, proposal.task)
}

async function runAutoresearch(projectRoot: string, rounds: number): Promise<void> {
  console.log(chalk.bold(`\n  Peter Parker - Autoresearch Mode (${rounds} rounds)\n`))
  console.log(chalk.gray("  Pattern: branch → change → eval → keep|revert → repeat"))
  console.log(chalk.gray("  Only the winning experiment gets a PR.\n"))

  if (!hasRalphTui()) {
    console.log(chalk.yellow("  ralph-tui is not installed"))
    console.log(chalk.gray("  Install: bun install -g ralph-tui\n"))
    return
  }

  const configPath = path.join(projectRoot, ".ralph-tui", "config.toml")
  if (!fs.existsSync(configPath)) {
    console.log(chalk.yellow("  No Peter Parker config found"))
    console.log(chalk.gray("  Run: jfl peter setup\n"))
    return
  }

  const loader = new TrajectoryLoader(projectRoot)
  const evals = readEvals(projectRoot)

  if (evals.length === 0) {
    console.log(chalk.yellow("  No eval history. Run `jfl peter pr` first.\n"))
    return
  }

  const baseBranch = "main"
  const latestEval = evals.sort((a, b) => b.ts.localeCompare(a.ts))[0]
  const baselinePassRate = latestEval?.composite ?? 0
  const baselineTotal = (latestEval?.metrics?.tests_total as number) ?? 0
  const baselineScore = baselinePassRate + (baselineTotal > 0 ? baselineTotal * 0.001 : 0)

  console.log(chalk.gray(`  Baseline composite: ${baselineScore.toFixed(4)} (${baselineTotal} tests)`))

  interface ExperimentResult {
    round: number
    task: string
    score: number
    delta: number
    testsPassing: number
    testsTotal: number
    branch: string
  }

  const results: ExperimentResult[] = []
  let bestResult: ExperimentResult | null = null

  for (let round = 1; round <= rounds; round++) {
    console.log(chalk.bold(`\n  ── Round ${round}/${rounds} ${"─".repeat(40)}\n`))

    const experimentEntries = loader.load({ type: "experiment", maxAge: "30d", limit: 20 })
    const pastTitles = [
      ...experimentEntries.map(e => e.title),
      ...results.map(r => r.task),
    ]

    let proposal: ExperimentProposal | null = null

    const stratusKey = process.env.STRATUS_API_KEY
    if (stratusKey) {
      try {
        const { StratusClient } = await import("../lib/stratus-client.js")
        const stratus = new StratusClient({
          baseUrl: process.env.STRATUS_API_URL || "https://api.stratus.run",
          apiKey: stratusKey,
          model: "stratus-x1ac-base-claude-sonnet-4-6",
          timeout: 60000,
        })

        const evalSummary = buildEvalSummary(evals.concat(
          results.map(r => ({
            v: 1 as const, ts: new Date().toISOString(), agent: "autoresearch",
            run_id: `autoresearch-r${r.round}`,
            metrics: { composite: r.score }, composite: r.score,
            model_version: `round-${r.round}`,
          }))
        ), 15)

        const policyHead = new PolicyHeadInference(projectRoot)
        const useMultiProposal = policyHead.isLoaded

        const prompt = useMultiProposal
          ? `Autoresearch round ${round}/${rounds}. Suggest 3 specific improvements ranked by expected impact.

Eval history:
${evalSummary}

Already tried (avoid these):
${pastTitles.map(t => `- ${t}`).join("\n") || "Nothing yet"}

Previous rounds this session:
${results.map(r => `- Round ${r.round}: "${r.task}" → delta=${r.delta > 0 ? "+" : ""}${r.delta.toFixed(4)}`).join("\n") || "None yet"}

Respond with ONLY a JSON array of 3 objects: [{"task": "...", "predicted_delta": 0.0-1.0, "reasoning": "...", "risk": "..."}, ...]`
          : `Autoresearch round ${round}/${rounds}. Suggest ONE specific improvement.

Eval history:
${evalSummary}

Already tried (avoid these):
${pastTitles.map(t => `- ${t}`).join("\n") || "Nothing yet"}

Previous rounds this session:
${results.map(r => `- Round ${r.round}: "${r.task}" → delta=${r.delta > 0 ? "+" : ""}${r.delta.toFixed(4)}`).join("\n") || "None yet"}

Suggest the SINGLE highest-value change. JSON format:
{"task": "...", "predicted_delta": 0.0-1.0, "reasoning": "...", "risk": "..."}`

        const response = await stratus.reason(prompt, {
          temperature: 0.8 + (round * 0.05),
          maxTokens: useMultiProposal ? 1500 : 500,
          featureContext: "autoresearch",
        })

        const content = response.choices[0]?.message?.content || ""

        if (useMultiProposal) {
          const jsonMatch = content.match(/\[[\s\S]*\]/)
          if (jsonMatch) {
            let proposals: ExperimentProposal[] = JSON.parse(jsonMatch[0])
            const recentDeltas = results.slice(-5).map(r => r.delta)
            proposals = await rerankWithPolicyHead(projectRoot, proposals, evals, recentDeltas)
            if (proposals.length > 0) proposal = proposals[0]
          }
        }

        if (!proposal) {
          const jsonMatch = content.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            proposal = JSON.parse(jsonMatch[0]) as ExperimentProposal
          }
        }
      } catch (err: any) {
        console.log(chalk.yellow(`  Stratus failed: ${err.message}`))
      }
    }

    if (!proposal) {
      const regressed = findRegressedDimensions(evals)
      const lowest = findLowestDimension(evals)

      if (regressed.length > 0) {
        const worst = regressed[0]
        proposal = {
          task: `Improve ${worst.dimension} score (regressed by ${worst.delta.toFixed(4)})`,
          predicted_delta: Math.abs(worst.delta),
          reasoning: `Recovering ${worst.dimension} regression`,
          risk: "May not fully recover",
        }
      } else if (lowest) {
        proposal = {
          task: `Improve ${lowest.dimension} score (currently ${lowest.score.toFixed(4)})`,
          predicted_delta: Math.max(0.01, (1 - lowest.score) * 0.1),
          reasoning: `${lowest.dimension} is weakest dimension`,
          risk: "May trade off against others",
        }
      } else {
        console.log(chalk.yellow("  No target found, skipping round"))
        continue
      }
    }

    console.log(chalk.cyan(`  Task: ${proposal.task}`))
    console.log(chalk.gray(`  Predicted: +${proposal.predicted_delta.toFixed(4)}\n`))

    const branchName = `pp/autoresearch-r${round}-${Date.now()}`

    gitExec(["stash", "--include-untracked"], projectRoot)
    gitExec(["fetch", "origin", baseBranch], projectRoot)

    let checkout = gitExec(["checkout", "-b", branchName, `origin/${baseBranch}`], projectRoot)
    if (!checkout.ok) {
      checkout = gitExec(["checkout", "-b", branchName, baseBranch], projectRoot)
    }
    if (!checkout.ok) {
      console.log(chalk.red(`  Failed to create branch ${branchName}`))
      continue
    }

    await new Promise<void>((resolve) => {
      const ralphDir = path.join(projectRoot, ".ralph-tui")
      if (!fs.existsSync(ralphDir)) fs.mkdirSync(ralphDir, { recursive: true })

      const prdPath = path.join(ralphDir, "autoresearch-task.json")
      const prd = {
        name: "Autoresearch Task",
        branchName: `ralph/autoresearch-${Date.now()}`,
        description: proposal!.task,
        userStories: [{
          id: "US-001",
          title: proposal!.task.slice(0, 80),
          description: proposal!.task,
          acceptanceCriteria: ["Task completed"],
          priority: 1, passes: false, notes: "", dependsOn: [],
        }],
        metadata: { updatedAt: new Date().toISOString() },
      }
      fs.writeFileSync(prdPath, JSON.stringify(prd, null, 2))

      const env = { ...process.env }
      delete env.CLAUDECODE
      delete env.CLAUDE_CODE

      const child = spawn("claude", [
        "--dangerously-skip-permissions",
        "-p", proposal!.task,
        "--output-format", "text",
      ], {
        cwd: projectRoot, stdio: "inherit", env,
      })

      child.on("error", () => { try { fs.unlinkSync(prdPath) } catch {} resolve() })
      child.on("exit", () => { try { fs.unlinkSync(prdPath) } catch {} resolve() })
    })

    const diffCheck = gitExec(["diff", "--quiet", "HEAD"], projectRoot)
    const untrackedResult = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd: projectRoot, encoding: "utf-8", stdio: "pipe",
    })
    const hasChanges = !diffCheck.ok || (untrackedResult.stdout || "").trim().length > 0

    if (!hasChanges) {
      console.log(chalk.yellow(`  Round ${round}: No changes, skipping eval`))
      gitExec(["checkout", baseBranch], projectRoot)
      gitExec(["branch", "-D", branchName], projectRoot)
      continue
    }

    gitExec(["add", "-A"], projectRoot)
    gitExec(["commit", "-m", `autoresearch: round ${round} - ${proposal.task}`], projectRoot)

    console.log(chalk.gray("  Running local eval..."))
    const testResult = spawnSync("npx", ["jest", "--json", "--silent"], {
      cwd: projectRoot, encoding: "utf-8", stdio: "pipe", timeout: 120000,
    })

    let passing = 0, total = 1
    try {
      const json = JSON.parse(testResult.stdout || "{}")
      passing = json.numPassedTests || 0
      total = json.numTotalTests || 1
    } catch {}

    const passRate = total > 0 ? passing / total : 0
    const testsAdded = total - baselineTotal
    const score = passRate + (testsAdded > 0 ? testsAdded * 0.001 : 0)
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

    const emoji = delta > 0 ? "+" : delta < 0 ? "" : "="
    console.log(chalk.bold(`  Round ${round} result: ${score.toFixed(4)} (${emoji}${delta.toFixed(4)})`))
    console.log(chalk.gray(`  Tests: ${passing}/${total}${testsAdded > 0 ? chalk.green(` (+${testsAdded} new)`) : ""}`))

    if (!bestResult || result.delta > bestResult.delta) {
      bestResult = result
      console.log(chalk.green(`  New best! (round ${round})`))
    }

    writeJournalEntry(projectRoot, {
      v: 1,
      ts: new Date().toISOString(),
      session: "autoresearch",
      type: "experiment",
      status: (delta > 0 || testsAdded > 0) ? "complete" : "incomplete",
      title: `Autoresearch R${round}: ${proposal.task.slice(0, 60)}`,
      summary: `Score: ${score.toFixed(4)}, delta: ${delta > 0 ? "+" : ""}${delta.toFixed(4)}`,
      detail: `Task: ${proposal.task}\nResult: ${passing}/${total} tests passing`,
      hypothesis: `"${proposal.task}" improves composite by ~${proposal.predicted_delta.toFixed(4)}`,
      outcome: delta > 0 ? "confirmed" : delta < 0 ? "rejected" : "inconclusive",
      score_delta: delta,
      agent_id: "peter-parker",
    })

    const tb = new TrainingBuffer(projectRoot)
    tb.append({
      agent: "peter-parker",
      state: {
        composite_score: baselineScore,
        dimension_scores: evals.sort((a, b) => b.ts.localeCompare(a.ts))[0]?.metrics ?? {},
        tests_passing: evals.sort((a, b) => b.ts.localeCompare(a.ts))[0]?.metrics?.tests_passed as number ?? 0,
        tests_total: evals.sort((a, b) => b.ts.localeCompare(a.ts))[0]?.metrics?.tests_total as number ?? 1,
        trajectory_length: results.length,
        recent_deltas: results.slice(-5).map(r => r.delta),
        agent: "peter-parker",
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
        tests_added: testsAdded,
        quality_score: passRate,
        improved: delta > 0 || testsAdded > 0,
        prediction_error: Math.abs(proposal.predicted_delta - delta),
      },
      metadata: {
        branch: branchName,
        autoresearch_round: round,
        source: "autoresearch",
      },
    })

    gitExec(["checkout", baseBranch], projectRoot)
  }

  console.log(chalk.bold(`\n  ── Autoresearch Complete ${"─".repeat(35)}\n`))
  console.log(chalk.gray(`  Rounds: ${rounds}`))
  console.log(chalk.gray(`  Results:`))

  for (const r of results) {
    const emoji = r.delta > 0 ? chalk.green("+") : r.delta < 0 ? chalk.red("-") : chalk.gray("=")
    const best = bestResult && r.round === bestResult.round ? chalk.yellow(" ★") : ""
    console.log(chalk.gray(`    R${r.round}: ${r.score.toFixed(4)} (${emoji}${Math.abs(r.delta).toFixed(4)}) ${r.task.slice(0, 50)}${best}`))
  }

  if (bestResult && bestResult.delta > 0) {
    console.log(chalk.green(`\n  Winner: Round ${bestResult.round} (${bestResult.delta > 0 ? "+" : ""}${bestResult.delta.toFixed(4)})`))
    console.log(chalk.cyan("  Creating PR for winning experiment...\n"))

    gitExec(["checkout", bestResult.branch], projectRoot)
    const pushResult = gitExec(["push", "-u", "origin", bestResult.branch], projectRoot)

    if (pushResult.ok) {
      const prTitle = `PP autoresearch: ${bestResult.task.slice(0, 50)} (+${bestResult.delta.toFixed(4)})`
      const prBody = [
        "## Autoresearch Winner",
        "",
        `**Task:** ${bestResult.task}`,
        `**Score:** ${bestResult.score.toFixed(4)} (delta: +${bestResult.delta.toFixed(4)})`,
        `**Tests:** ${bestResult.testsPassing}/${bestResult.testsTotal}`,
        `**Round:** ${bestResult.round}/${rounds}`,
        "",
        "### All Rounds",
        ...results.map(r =>
          `- R${r.round}: ${r.score.toFixed(4)} (${r.delta > 0 ? "+" : ""}${r.delta.toFixed(4)}) ${r.task.slice(0, 60)}${r.round === bestResult!.round ? " **← winner**" : ""}`
        ),
        "",
        "---",
        "*Generated by JFL autoresearch loop*",
      ].join("\n")

      let prResult = ghExec([
        "pr", "create", "--title", prTitle, "--body", prBody,
        "--base", baseBranch, "--head", bestResult.branch, "--label", "pp-generated",
      ], projectRoot)
      if (!prResult.ok) {
        prResult = ghExec([
          "pr", "create", "--title", prTitle, "--body", prBody,
          "--base", baseBranch, "--head", bestResult.branch,
        ], projectRoot)
      }

      if (prResult.ok) {
        console.log(chalk.green(`  PR created: ${prResult.output}`))
        await postHubEvent(projectRoot, "autoresearch:complete", {
          rounds,
          winner_round: bestResult.round,
          winner_task: bestResult.task,
          winner_delta: bestResult.delta,
          pr_url: prResult.output,
          all_results: results.map(r => ({
            round: r.round, task: r.task, score: r.score, delta: r.delta,
          })),
        })
      } else {
        console.log(chalk.red(`  Failed to create PR: ${prResult.output}`))
      }
    } else {
      console.log(chalk.red(`  Failed to push: ${pushResult.output}`))
    }

    gitExec(["checkout", baseBranch], projectRoot)
  } else {
    console.log(chalk.yellow("\n  No improvement found across all rounds."))
    console.log(chalk.gray("  All experiment branches preserved for review.\n"))
  }

  for (const r of results) {
    if (!bestResult || r.round !== bestResult.round) {
      gitExec(["branch", "-D", r.branch], projectRoot)
    }
  }

  gitExec(["stash", "pop"], projectRoot)
  console.log()
}

// ============================================================================
// Scoped Agent Commands
// ============================================================================

async function agentCreate(projectRoot: string): Promise<void> {
  const { writeAgentConfig, generateAgentToml } = await import("../lib/agent-config.js")
  const readline = await import("readline")

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const ask = (q: string): Promise<string> =>
    new Promise(resolve => rl.question(q, resolve))

  console.log(chalk.bold("\n  Create Scoped Agent\n"))

  const name = await ask("  Agent name (e.g., search-quality): ")
  const scope = await ask("  Scope (e.g., search, tests, quality): ")
  const metric = await ask("  Metric (e.g., ndcg@10, test_pass_rate): ")
  const direction = await ask("  Direction (maximize/minimize) [maximize]: ") || "maximize"
  const timeBudget = await ask("  Time budget seconds [300]: ") || "300"
  const evalScript = await ask("  Eval script path [eval/eval.ts]: ") || "eval/eval.ts"
  const evalData = await ask("  Eval data path [eval/fixtures/data.jsonl]: ") || "eval/fixtures/data.jsonl"
  const filesInScope = await ask("  Files in scope (glob, comma-sep) [src/**]: ") || "src/**"

  rl.close()

  const configPath = writeAgentConfig(projectRoot, {
    name,
    scope,
    metric,
    direction: direction as "maximize" | "minimize",
    time_budget_seconds: parseInt(timeBudget, 10),
    eval: {
      script: evalScript,
      data: evalData,
    },
    constraints: {
      files_in_scope: filesInScope.split(",").map(s => s.trim()),
      files_readonly: ["eval/**"],
      max_file_changes: 10,
    },
    policy: {
      embedding_model: "stratus-x1ac-base-claude-sonnet-4-6",
      exploration_rate: 0.2,
      decay_per_round: 0.01,
      min_exploration: 0.05,
    },
  })

  console.log(chalk.green(`\n  Agent config created: ${configPath}\n`))
}

async function agentList(projectRoot: string): Promise<void> {
  const { listAgentConfigs, loadAgentConfig } = await import("../lib/agent-config.js")

  const agents = listAgentConfigs(projectRoot)

  if (agents.length === 0) {
    console.log(chalk.yellow("\n  No agents configured."))
    console.log(chalk.gray("  Run: jfl peter agent create\n"))
    return
  }

  console.log(chalk.bold("\n  Configured Agents\n"))

  for (const name of agents) {
    try {
      const config = loadAgentConfig(projectRoot, name)
      console.log(chalk.cyan(`  ${name}`))
      console.log(chalk.gray(`    Scope: ${config.scope}`))
      console.log(chalk.gray(`    Metric: ${config.metric} (${config.direction})`))
      console.log(chalk.gray(`    Time budget: ${config.time_budget_seconds}s`))
      console.log(chalk.gray(`    Files: ${config.constraints.files_in_scope.join(", ")}`))
      console.log()
    } catch (err: any) {
      console.log(chalk.red(`  ${name}: Error loading config - ${err.message}`))
    }
  }
}

async function agentRun(projectRoot: string, agentName: string, rounds: number): Promise<void> {
  const { loadAgentConfig, validateAgentConfig } = await import("../lib/agent-config.js")
  const { startSession, runBaseline, runRound, endSession, saveSessionState } = await import("../lib/agent-session.js")
  const { ReplayBuffer } = await import("../lib/replay-buffer.js")
  const { StratusClient } = await import("../lib/stratus-client.js")

  // Load and validate config
  let config
  try {
    config = loadAgentConfig(projectRoot, agentName)
  } catch (err: any) {
    console.log(chalk.red(`\n  Agent not found: ${agentName}`))
    console.log(chalk.gray("  Run: jfl peter agent list\n"))
    return
  }

  const validation = validateAgentConfig(config, projectRoot)
  if (!validation.valid) {
    console.log(chalk.red(`\n  Invalid agent config:`))
    for (const err of validation.errors) {
      console.log(chalk.red(`    - ${err}`))
    }
    console.log()
    return
  }

  console.log(chalk.bold(`\n  Running Scoped Agent: ${agentName} (${rounds} rounds)\n`))
  console.log(chalk.gray(`  Metric: ${config.metric} (${config.direction})`))
  console.log(chalk.gray(`  Time budget: ${config.time_budget_seconds}s per round`))
  console.log(chalk.gray(`  Pattern: branch → change → eval → keep|revert → repeat\n`))

  // Start session
  const session = startSession(config, projectRoot)
  saveSessionState(session)

  console.log(chalk.cyan(`  Session: ${session.id}`))
  console.log(chalk.cyan(`  Branch: ${session.branch}`))
  console.log(chalk.gray(`  Eval snapshot: ${session.evalSnapshot.hash.slice(0, 8)}\n`))

  // Run baseline
  console.log(chalk.gray("  Running baseline eval..."))
  let baseline
  try {
    baseline = await runBaseline(session)
  } catch (err: any) {
    console.log(chalk.red(`  Baseline eval failed: ${err.message}`))
    return
  }
  console.log(chalk.green(`  Baseline: ${baseline.toFixed(4)}\n`))

  const replayBuffer = new ReplayBuffer(projectRoot)
  const transitions: any[] = []

  // Stratus for task generation
  const stratus = process.env.STRATUS_API_KEY
    ? new StratusClient({ apiKey: process.env.STRATUS_API_KEY })
    : null

  for (let round = 1; round <= rounds; round++) {
    console.log(chalk.bold(`\n  ── Round ${round}/${rounds} ${"─".repeat(40)}\n`))

    // Generate task
    let task = `Improve ${config.metric} by modifying files matching ${config.constraints.files_in_scope.join(", ")}`
    if (stratus) {
      try {
        const prompt = `Suggest ONE specific code change to improve the ${config.metric} metric. Scope: ${config.scope}. Files: ${config.constraints.files_in_scope.join(", ")}. Be concrete and actionable. Return just the task description.`
        const response = await stratus.reason(prompt, { maxTokens: 200, temperature: 0.7 + round * 0.05 })
        task = response.choices[0]?.message?.content || task
      } catch {}
    }

    const hypothesis = `Implementing this will improve ${config.metric}`

    console.log(chalk.cyan(`  Task: ${task.slice(0, 80)}...`))

    const { result, transition } = await runRound(session, round, task, hypothesis)
    transitions.push(transition)

    // Write to replay buffer
    replayBuffer.write({
      agent: config.name,
      session_id: session.id,
      state_hash: transition.state_hash,
      state: transition.state,
      action_diff: transition.action_diff,
      action: transition.action,
      hypothesis,
      reward: result.delta,
      timestamp: new Date().toISOString(),
    })

    const emoji = result.kept ? chalk.green("✓") : chalk.red("✗")
    const deltaStr = result.delta > 0 ? `+${result.delta.toFixed(4)}` : result.delta.toFixed(4)
    console.log(`  ${emoji} Result: ${result.metricAfter.toFixed(4)} (${deltaStr}) ${result.kept ? "KEPT" : "REVERTED"}`)
  }

  // End session
  const summary = await endSession(session, transitions)

  console.log(chalk.bold(`\n  ── Session Complete ${"─".repeat(35)}\n`))
  console.log(chalk.gray(`  Rounds: ${summary.rounds}`))
  console.log(chalk.gray(`  Improved: ${summary.improvedRounds}`))
  console.log(chalk.gray(`  Total delta: ${summary.totalDelta > 0 ? "+" : ""}${summary.totalDelta.toFixed(4)}`))
  console.log(chalk.gray(`  Best delta: +${summary.bestDelta.toFixed(4)}`))

  if (summary.prUrl) {
    console.log(chalk.green(`\n  PR created: ${summary.prUrl}`))
  }
  console.log()
}

async function agentSwarm(projectRoot: string, rounds: number): Promise<void> {
  const { MetaOrchestrator } = await import("../lib/meta-orchestrator.js")

  const orchestrator = new MetaOrchestrator(projectRoot)
  const agents = orchestrator.getAgents()

  if (agents.length === 0) {
    console.log(chalk.yellow("\n  No agents configured."))
    console.log(chalk.gray("  Run: jfl peter agent create\n"))
    return
  }

  console.log(chalk.bold(`\n  Agent Swarm: ${agents.length} agents, ${rounds} rounds total\n`))

  for (const agent of agents) {
    console.log(chalk.gray(`    - ${agent.name} (${agent.metric})`))
  }
  console.log()

  const result = await orchestrator.runSwarm(rounds, (agent, round, reward, reason) => {
    const emoji = reward > 0 ? chalk.green("+") : reward < 0 ? chalk.red("-") : chalk.gray("=")
    console.log(chalk.gray(`  [${round}/${rounds}] ${agent} → ${emoji}${Math.abs(reward).toFixed(4)} (${reason})`))
  })

  console.log(chalk.bold(`\n  ── Swarm Complete ${"─".repeat(38)}\n`))

  const stats = orchestrator.getStats()
  console.log(chalk.gray(`  Total rounds: ${stats.totalRounds}`))
  console.log(chalk.gray(`  Avg EMA reward: ${stats.avgEmaReward.toFixed(4)}`))
  console.log(chalk.gray(`  Overall win rate: ${(stats.overallWinRate * 100).toFixed(1)}%`))

  if (stats.bestAgent) {
    console.log(chalk.green(`  Best agent: ${stats.bestAgent.name} (EMA: ${stats.bestAgent.emaReward.toFixed(4)})`))
  }

  console.log(chalk.bold("\n  Per-Agent Results:\n"))
  for (const [name, data] of Object.entries(result.perAgent)) {
    console.log(chalk.cyan(`    ${name}: ${data.rounds} rounds, total delta: ${data.totalReward > 0 ? "+" : ""}${data.totalReward.toFixed(4)}`))
  }
  console.log()
}

export async function peterCommand(
  action?: string,
  options: { cost?: boolean; quality?: boolean; balanced?: boolean; task?: string; rounds?: string; mode?: string; name?: string } = {}
) {
  const projectRoot = process.cwd()

  // Handle "agent" subcommand
  if (action === "agent") {
    const subAction = options.name || options.task  // name is the subcommand, task might be agent name
    if (subAction === "create") {
      await agentCreate(projectRoot)
      return
    } else if (subAction === "list") {
      await agentList(projectRoot)
      return
    } else if (subAction === "run") {
      // jfl peter agent run <name> --rounds N
      // The agent name would be in a different position
      console.log(chalk.yellow("\n  Usage: jfl peter agent run <name> --rounds N\n"))
      return
    } else if (subAction === "swarm") {
      const rounds = parseInt(options.rounds || "20", 10)
      await agentSwarm(projectRoot, rounds)
      return
    } else if (subAction) {
      // Assume it's an agent name for "run"
      const rounds = parseInt(options.rounds || "5", 10)
      await agentRun(projectRoot, subAction, rounds)
      return
    }

    // Show agent help
    console.log(chalk.bold("\n  Peter Parker - Scoped Agent Commands\n"))
    console.log(chalk.gray("  Commands:"))
    console.log("    jfl peter agent create                    Interactive agent creation")
    console.log("    jfl peter agent list                      List configured agents")
    console.log("    jfl peter agent run <name> [--rounds N]   Run a specific agent")
    console.log("    jfl peter agent swarm [--rounds N]        Run all agents with meta-orchestrator")
    console.log()
    return
  }

  switch (action) {
    case "setup": {
      let profile: CostProfile = "balanced"
      if (options.cost) profile = "cost-optimized"
      if (options.quality) profile = "quality-first"
      if (options.balanced) profile = "balanced"
      await setup(projectRoot, profile)
      break
    }

    case "run": {
      await run(projectRoot, options.task)
      break
    }

    case "status": {
      await status(projectRoot)
      break
    }

    case "pr": {
      await runWithPR(projectRoot, options.task)
      break
    }

    case "dashboard": {
      const { startEventDashboard } = await import("../ui/event-dashboard.js")
      await startEventDashboard()
      break
    }

    case "experiment": {
      if (options.mode === "autoresearch") {
        const rounds = parseInt(options.rounds || "5", 10)
        await runAutoresearch(projectRoot, rounds)
      } else {
        await runExperiment(projectRoot)
      }
      break
    }

    case "autoresearch": {
      const rounds = parseInt(options.rounds || "5", 10)
      await runAutoresearch(projectRoot, rounds)
      break
    }

    default: {
      console.log(chalk.bold("\n  Peter Parker - Model-Routed Agent Orchestrator\n"))
      console.log(chalk.gray("  Commands:"))
      console.log("    jfl peter setup [--cost|--balanced|--quality]  Generate agent config")
      console.log("    jfl peter run [--task <task>]                  Run orchestrator")
      console.log("    jfl peter pr --task <task>                     Run + branch + PR")
      console.log("    jfl peter experiment                           Proactive: pick + execute next experiment")
      console.log("    jfl peter autoresearch [--rounds N]            Shortcut for autoresearch mode")
      console.log("    jfl peter status                               Show status + recent events")
      console.log("    jfl peter dashboard                            Live event stream dashboard")
      console.log()
      console.log(chalk.bold("  Scoped Agents (new):\n"))
      console.log("    jfl peter agent create                    Interactive agent creation")
      console.log("    jfl peter agent list                      List configured agents")
      console.log("    jfl peter agent run <name> [--rounds N]   Run a specific scoped agent")
      console.log("    jfl peter agent swarm [--rounds N]        Run all agents with orchestrator")
      console.log()
    }
  }
}
