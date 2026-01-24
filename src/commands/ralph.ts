/**
 * Ralph TUI Command
 *
 * Pass-through to ralph-tui for autonomous task execution.
 * Requires Bun runtime.
 */

import { spawn, execSync } from "child_process"
import chalk from "chalk"

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

export async function ralphCommand(args: string[]): Promise<void> {
  // Check if ralph-tui is installed
  if (!hasRalphTui()) {
    console.log(chalk.yellow("\n⚠️  ralph-tui is not installed\n"))

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

  // Pass through to ralph-tui with all args
  const child = spawn("ralph-tui", args, {
    stdio: "inherit",
    shell: true,
  })

  child.on("error", (error) => {
    console.error(chalk.red(`Failed to start ralph-tui: ${error.message}`))
  })

  child.on("exit", (code) => {
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

  console.log(chalk.cyan("\n  Shortcuts:"))
  console.log("    jfl ralph run                         Same as: ralph-tui run")
  console.log("    jfl ralph prime                       Same as: ralph-tui create-prd --chat")

  console.log(chalk.gray("\n  All ralph-tui commands work via: jfl ralph <command>"))
  console.log(chalk.gray("  Docs: https://ralph-tui.com/docs\n"))
}
