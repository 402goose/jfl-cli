/**
 * Ralph TUI Command
 *
 * Pass-through to ralph-tui for autonomous task execution.
 * Injects --listen for event bridge when available.
 *
 * @purpose CLI pass-through to ralph-tui with MAP event bridge integration
 */

import { spawn, execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import chalk from "chalk"
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

function hasBun(): boolean {
  try {
    execSync("bun --version", { stdio: "ignore" })
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

export async function ralphCommand(args: string[]): Promise<void> {
  if (!hasRalphTui()) {
    console.log(chalk.yellow("\n  ralph-tui is not installed\n"))

    if (!hasBun()) {
      console.log(chalk.gray("ralph-tui requires Bun runtime."))
      console.log(chalk.gray("Install Bun first:\n"))
      console.log(chalk.cyan("  curl -fsSL https://bun.sh/install | bash\n"))
    }

    console.log(chalk.gray("Then install ralph-tui:\n"))
    console.log(chalk.cyan("  bun install -g ralph-tui\n"))
    console.log(chalk.gray("Or run: jfl update\n"))
    return
  }

  const projectRoot = process.cwd()
  const finalArgs = [...args]

  // Inject --listen if running a task and not already set
  const isRunCommand = finalArgs[0] === "run"
  const hasListen = finalArgs.includes("--listen")
  if (isRunCommand && !hasListen) {
    finalArgs.push("--listen")
  }

  // Start event bridge if Context Hub token available
  const token = getAuthToken(projectRoot)
  let bridge: PeterParkerBridge | null = null

  if (token && isRunCommand) {
    bridge = new PeterParkerBridge({
      contextHubUrl: getProjectHubUrl(projectRoot),
      authToken: token,
    })
    setTimeout(() => bridge!.start(), 1000)
  }

  const child = spawn("ralph-tui", finalArgs, {
    stdio: "inherit",
    shell: true,
  })

  child.on("error", (error) => {
    console.error(chalk.red(`Failed to start ralph-tui: ${error.message}`))
  })

  child.on("exit", (code) => {
    if (bridge) bridge.stop()
    process.exit(code || 0)
  })
}

export function showRalphHelp(): void {
  console.log(chalk.bold("\n  jfl ralph - AI Agent Loop Orchestrator\n"))
  console.log(chalk.gray("  Autonomous task execution powered by ralph-tui.\n"))

  console.log(chalk.cyan("  Commands:"))
  console.log("    jfl ralph run --prd ./tasks/prd.json   Run autonomous loop")
  console.log("    jfl ralph create-prd --chat           Create PRD with AI")
  console.log("    jfl ralph setup                       Initialize in project")
  console.log("    jfl ralph status                      Show session status")

  console.log(chalk.cyan("\n  Peter Parker (model routing):"))
  console.log("    jfl peter setup [--cost|--balanced|--quality]")
  console.log("    jfl peter run [--task <task>]")
  console.log("    jfl peter status")

  console.log(chalk.cyan("\n  Shortcuts:"))
  console.log("    jfl ralph run                         Same as: ralph-tui run")
  console.log("    jfl ralph prime                       Same as: ralph-tui create-prd --chat")

  console.log(chalk.gray("\n  All ralph-tui commands work via: jfl ralph <command>"))
  console.log(chalk.gray("  Docs: https://ralph-tui.com/docs\n"))
}
