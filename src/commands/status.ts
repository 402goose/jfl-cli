import chalk from "chalk"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { getAuthMethod, getToken, getX402Address, getUser, isAuthenticated } from "./login.js"
import { ensureInProject } from "../utils/ensure-project.js"
import { getContextHubConfig } from "../utils/ensure-context-hub.js"
import { isRunning as getContextHubStatus } from "./context-hub.js"

const PLATFORM_URL = process.env.JFL_PLATFORM_URL || "https://jfl.run"

export async function statusCommand() {
  console.log(chalk.bold("\n📊 JFL - Project Status\n"))

  // Check if in a JFL project, offer navigation if not
  const inProject = await ensureInProject()
  if (!inProject) {
    return
  }

  const cwd = process.cwd()
  const hasGit = existsSync(join(cwd, ".git"))

  // Project info
  console.log(chalk.cyan("Project"))
  const projectName = getProjectName(cwd)
  console.log(`  Name: ${chalk.white(projectName)}`)
  console.log(`  Path: ${chalk.gray(cwd)}`)
  console.log(`  Git:  ${hasGit ? chalk.green("✓") : chalk.yellow("✗")}`)

  // Authentication status
  console.log(chalk.cyan("\nAuthentication"))
  if (isAuthenticated()) {
    const method = getAuthMethod()
    if (method === "x402") {
      const address = getX402Address()
      console.log(`  Method: ${chalk.blue("x402 Wallet")}`)
      console.log(`  Address: ${chalk.gray(address?.slice(0, 10) + "..." + address?.slice(-6))}`)
      console.log(`  Billing: ${chalk.yellow("$5/day (when active)")}`)
    } else {
      const user = getUser()
      console.log(`  Method: ${chalk.blue("GitHub")}`)
      console.log(`  User: ${chalk.white(user?.name || user?.email || "Unknown")}`)
      console.log(`  Tier: ${chalk.white(user?.tier || "FREE")}`)
    }
  } else {
    console.log(`  ${chalk.yellow("Not authenticated")}`)
    console.log(chalk.gray("  Run 'jfl login' to access platform features"))
  }

  // Knowledge files
  console.log(chalk.cyan("\nKnowledge Layer"))
  const knowledgeFiles = [
    "VISION.md",
    "NARRATIVE.md",
    "THESIS.md",
    "ROADMAP.md",
    "BRAND_BRIEF.md",
    "BRAND_DECISIONS.md",
    "VOICE_AND_TONE.md",
    "TASKS.md",
    "CRM.md",
  ]

  const knowledgePath = join(cwd, "knowledge")
  let foundCount = 0

  for (const file of knowledgeFiles) {
    const exists = existsSync(join(knowledgePath, file))
    if (exists) foundCount++
    const status = exists ? chalk.green("✓") : chalk.gray("○")
    console.log(`  ${status} ${file}`)
  }

  console.log(chalk.gray(`\n  ${foundCount}/${knowledgeFiles.length} files configured`))

  // Context Hub status
  console.log(chalk.cyan("\nContext Hub"))
  const contextHubConfig = getContextHubConfig()
  const contextHubStatus = getContextHubStatus(contextHubConfig.mode === "global" ? homedir() : cwd)

  if (contextHubStatus.running) {
    console.log(`  Status: ${chalk.green("Running")}`)
    console.log(`  Mode: ${chalk.white(contextHubConfig.mode === "global" ? "Global" : "Local")}`)
    console.log(`  Port: ${chalk.white(contextHubConfig.port)}`)
    console.log(`  PID: ${chalk.gray(contextHubStatus.pid)}`)
  } else {
    console.log(`  Status: ${chalk.yellow("Not running")}`)
    console.log(chalk.gray("  (Auto-starts with 'jfl')"))
  }

  // Skills available
  console.log(chalk.cyan("\nSkills Available"))
  const skillsPath = join(cwd, "skills")
  const skills = [
    { name: "brand-architect", desc: "Generate brand identity" },
    { name: "content-creator", desc: "Create threads, posts, articles" },
    { name: "hud", desc: "Project dashboard" },
    { name: "web-architect", desc: "Generate web assets" },
  ]

  for (const skill of skills) {
    const exists = existsSync(join(skillsPath, skill.name))
    const status = exists ? chalk.green("✓") : chalk.gray("○")
    console.log(`  ${status} /${skill.name.replace("-", "")} - ${skill.desc}`)
  }

  // Platform features
  console.log(chalk.cyan("\nPlatform Features"))
  const authMethod = getAuthMethod()
  const user = getUser()
  const tier = user?.tier || "FREE"

  const features = [
    { name: "Local toolkit", available: true },
    { name: "Git collaboration", available: true },
    { name: "Bring your own AI", available: true },
    { name: "Dashboard", available: tier !== "FREE" || authMethod === "x402" },
    { name: "Integrations", available: tier !== "FREE" || authMethod === "x402" },
    { name: "Deploy to jfl.run", available: tier !== "FREE" || authMethod === "x402" },
    { name: "Parallel agents", available: tier === "PRO" || tier === "ENTERPRISE" },
    { name: "Analytics", available: tier === "PRO" || tier === "ENTERPRISE" },
  ]

  for (const feature of features) {
    const status = feature.available ? chalk.green("✓") : chalk.gray("○")
    console.log(`  ${status} ${feature.name}`)
  }

  // Quick actions
  console.log(chalk.cyan("\nQuick Actions"))
  console.log("  jfl hud              Project dashboard")
  console.log("  jfl login            Authenticate")
  if (isAuthenticated()) {
    console.log("  jfl deploy           Deploy to platform")
    if (tier === "PRO" || tier === "ENTERPRISE") {
      console.log("  jfl agents           Manage parallel agents")
    }
  }
  console.log()
}

function getProjectName(cwd: string): string {
  // Try to get from package.json
  const pkgPath = join(cwd, "package.json")
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
      if (pkg.name) return pkg.name
    } catch {
      // ignore
    }
  }

  // Fall back to directory name
  return cwd.split("/").pop() || "unknown"
}
