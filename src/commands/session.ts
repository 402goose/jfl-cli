import chalk from "chalk"
import ora from "ora"
import * as p from "@clack/prompts"
import { execSync } from "child_process"
import { existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import Conf from "conf"
import { ensureDayPass, isTrialMode } from "../utils/auth-guard.js"
import { ensureContextHub, getContextHubConfig } from "../utils/ensure-context-hub.js"
import { isRunning as getContextHubStatus } from "./context-hub.js"
import { initCommand } from "./init.js"
import axios from "axios"

const config = new Conf({ projectName: "jfl" })

interface SessionOptions {
  autoLaunch?: boolean
}

export async function sessionCommand(options: SessionOptions = {}) {
  const cwd = process.cwd()

  // Check if in a JFL project
  const hasJflConfig = existsSync(join(cwd, "CLAUDE.md")) || existsSync(join(cwd, "knowledge"))

  if (!hasJflConfig) {
    await onboardNewUser(cwd)
    return
  }

  // Check day pass for paid users (trial mode is free)
  if (!isTrialMode()) {
    console.log(chalk.yellow("\n💳 Payment required (teammates detected)\n"))
    const dayPass = await ensureDayPass()
    if (!dayPass) {
      console.log(chalk.red("\n❌ Cannot start session without active Day Pass\n"))
      console.log(chalk.gray("Run: jfl login --x402"))
      console.log()
      return
    }
    console.log(chalk.green("✓ Day Pass verified\n"))
  } else {
    console.log(chalk.green("🎁 Trial Mode") + chalk.gray(" - Free until foundation complete\n"))
  }

  // Track this project
  const projects = (config.get("projects") as string[]) || []
  if (!projects.includes(cwd)) {
    projects.push(cwd)
    config.set("projects", projects)
  }

  // Show JFL Gateway Dashboard
  await showGatewayDashboard()
}

async function showGatewayDashboard() {
  console.log(chalk.bold.cyan("\n┌─────────────────────────────────────────┐"))
  console.log(chalk.bold.cyan("│        JFL Gateway Dashboard            │"))
  console.log(chalk.bold.cyan("└─────────────────────────────────────────┘\n"))

  // 1. Ensure and check Context Hub
  const spinner1 = ora("Checking Context Hub...").start()
  await ensureContextHub()

  const contextHubConfig = getContextHubConfig()
  const contextHubStatus = getContextHubStatus(
    contextHubConfig.mode === "global" ? homedir() : process.cwd()
  )

  if (contextHubStatus.running) {
    spinner1.succeed(
      chalk.green("Context Hub") +
        chalk.gray(` (${contextHubConfig.mode} mode, port ${contextHubConfig.port}, PID ${contextHubStatus.pid})`)
    )
  } else {
    spinner1.fail(chalk.red("Context Hub not running"))
  }

  // 2. Check Service Manager
  const spinner2 = ora("Checking Service Manager...").start()
  const serviceManagerStatus = await checkServiceManager()

  if (serviceManagerStatus.running) {
    spinner2.succeed(
      chalk.green("Service Manager") +
        chalk.gray(` (port 3401, ${serviceManagerStatus.services} services)`)
    )
  } else {
    spinner2.warn(chalk.yellow("Service Manager not running"))
    console.log(chalk.gray("   Start with: pm2 start ~/.jfl/service-manager/ecosystem.config.js"))
  }

  // 3. Show connection info
  console.log()
  console.log(chalk.bold("Gateway Endpoints:"))
  console.log(chalk.gray("  Context Hub:     ") + chalk.cyan(`http://localhost:${contextHubConfig.port}`))
  console.log(chalk.gray("  Service Manager: ") + chalk.cyan("http://localhost:3401"))
  console.log(chalk.gray("  MCP Server:      ") + chalk.cyan("Connected via MCP"))

  // 4. Show how to connect
  console.log()
  console.log(chalk.bold("AI Tools Connection:"))
  console.log(chalk.gray("  Claude Code connects via MCP automatically"))
  console.log(chalk.gray("  Cursor connects via MCP automatically"))
  console.log(chalk.gray("  Custom tools can use HTTP API"))

  // 5. Show available commands
  console.log()
  console.log(chalk.bold("Manage Services:"))
  console.log(chalk.gray("  jfl-services list       ") + "# List all services")
  console.log(chalk.gray("  jfl-services start <id> ") + "# Start a service")
  console.log(chalk.gray("  jfl-services logs <id>  ") + "# View service logs")

  console.log()
  console.log(chalk.bold("View Status:"))
  console.log(chalk.gray("  jfl status              ") + "# Project status")
  console.log(chalk.gray("  jfl hud                 ") + "# Campaign dashboard")

  console.log()
  console.log(chalk.green("✓ JFL Gateway is ready!"))
  console.log(chalk.gray("  Open Claude Code or Cursor to connect via MCP\n"))
}

async function checkServiceManager(): Promise<{ running: boolean; services?: number }> {
  try {
    const response = await axios.get("http://localhost:3401/health", { timeout: 2000 })
    const services = response.data.stats?.total_services || 0
    return { running: true, services }
  } catch (err) {
    return { running: false }
  }
}

async function onboardNewUser(cwd: string) {
  console.log(chalk.yellow("\n⚠️  Not in a JFL project\n"))

  const shouldInit = await p.confirm({
    message: "Initialize this directory as a JFL project?",
    initialValue: true,
  })

  if (p.isCancel(shouldInit) || !shouldInit) {
    console.log(chalk.gray("\nRun 'jfl init' when ready\n"))
    return
  }

  await initCommand()
}
