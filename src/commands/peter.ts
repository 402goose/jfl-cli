/**
 * Peter Parker Command
 *
 * Orchestrator that wraps ralph-tui with model routing and event bridging.
 * Spidey-sense for which model to use per agent role.
 *
 * @purpose CLI command for Peter Parker orchestrator — setup, run, status
 */

import chalk from "chalk"
import { execSync, spawn, spawnSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import type { CostProfile } from "../types/map.js"
import { writePeterParkerConfig, readCurrentProfile } from "../lib/peter-parker-config.js"
import { PeterParkerBridge } from "../lib/peter-parker-bridge.js"
import { getProjectHubUrl } from "../utils/context-hub-port.js"

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

    default: {
      console.log(chalk.bold("\n  Peter Parker - Model-Routed Agent Orchestrator\n"))
      console.log(chalk.gray("  Commands:"))
      console.log("    jfl peter setup [--cost|--balanced|--quality]  Generate agent config")
      console.log("    jfl peter run [--task <task>]                  Run orchestrator")
      console.log("    jfl peter pr --task <task>                     Run + branch + PR")
      console.log("    jfl peter status                               Show status + recent events")
      console.log("    jfl peter dashboard                            Live event stream dashboard")
      console.log()
    }
  }
}
