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
        const proposals: ExperimentProposal[] = JSON.parse(jsonMatch[0])
        if (proposals.length > 0) {
          proposals.sort((a, b) => b.predicted_delta - a.predicted_delta)

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

export async function peterCommand(
  action?: string,
  options: { cost?: boolean; quality?: boolean; balanced?: boolean; task?: string } = {}
) {
  const projectRoot = process.cwd()

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
      await runExperiment(projectRoot)
      break
    }

    default: {
      console.log(chalk.bold("\n  Peter Parker - Model-Routed Agent Orchestrator\n"))
      console.log(chalk.gray("  Commands:"))
      console.log("    jfl peter setup [--cost|--balanced|--quality]  Generate agent config")
      console.log("    jfl peter run [--task <task>]                  Run orchestrator")
      console.log("    jfl peter pr --task <task>                     Run + branch + PR")
      console.log("    jfl peter experiment                           Proactive: pick + execute next experiment")
      console.log("    jfl peter status                               Show status + recent events")
      console.log("    jfl peter dashboard                            Live event stream dashboard")
      console.log()
    }
  }
}
