/**
 * Peter Parker Command
 *
 * Orchestrator that wraps ralph-tui with model routing and event bridging.
 * Spidey-sense for which model to use per agent role.
 *
 * @purpose CLI command for Peter Parker orchestrator — setup, run, status
 */

import chalk from "chalk"
import { execSync, spawn } from "child_process"
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
  if (task) {
    args.push("--task", task)
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

  const child = spawn("ralph-tui", args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: true,
  })

  if (bridge) {
    setTimeout(() => bridge!.start(), 1000)
  }

  child.on("error", (error) => {
    console.error(chalk.red(`Failed to start ralph-tui: ${error.message}`))
  })

  child.on("exit", (code) => {
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

    default: {
      console.log(chalk.bold("\n  Peter Parker - Model-Routed Agent Orchestrator\n"))
      console.log(chalk.gray("  Commands:"))
      console.log("    jfl peter setup [--cost|--balanced|--quality]  Generate agent config")
      console.log("    jfl peter run [--task <task>]                  Run orchestrator")
      console.log("    jfl peter status                               Show status + recent events")
      console.log()
    }
  }
}
