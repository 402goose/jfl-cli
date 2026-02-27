import chalk from "chalk"
import ora from "ora"
import * as p from "@clack/prompts"
import { execSync, spawn } from "child_process"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import Conf from "conf"
import { ensureContextHub, getContextHubConfig } from "../utils/ensure-context-hub.js"
import { isRunning as getContextHubStatus, ensureDaemonInstalled } from "./context-hub.js"
import { initCommand } from "./init.js"
import {
  authenticateWithGitHub,
  discoverJflProjects,
  cloneRepository,
  type JflProject,
} from "../utils/github-auth.js"
import { renderBanner, showHowItWorksNotice, theme } from "../ui/index.js"
import axios from "axios"

const config = new Conf({ projectName: "jfl" })

type AIProvider = "claude" | "codex" | "aider" | "pi" | "none"

interface DetectedCLI {
  name: string
  command: string
  provider: AIProvider
  version?: string
}

interface SessionOptions {
  autoLaunch?: boolean
}

const AUTONOMOUS_FLAGS: Record<AIProvider, string | undefined> = {
  claude: "--dangerously-skip-permissions",
  codex: "--full-auto",
  aider: "--yes-always",
  pi: "--yolo",
  none: undefined,
}

const CHROME_FLAG = "--chrome"

export async function sessionCommand(options: SessionOptions = {}) {
  const cwd = process.cwd()

  const hasJflConfig = existsSync(join(cwd, "CLAUDE.md")) || existsSync(join(cwd, "knowledge"))

  if (!hasJflConfig) {
    await onboardNewUser(cwd)
    return
  }

  // Track this project
  const projects = (config.get("projects") as string[]) || []
  if (!projects.includes(cwd)) {
    projects.push(cwd)
    config.set("projects", projects)
  }

  // Auto-install daemon (fire-and-forget, silent)
  ensureDaemonInstalled({ quiet: true }).catch(() => {})

  // Check for saved CLI preference
  let preferredCLI = config.get("aiCLI") as string | undefined

  // Detect available CLIs
  const available = detectAICLIs()

  if (available.length === 0) {
    await onboardAICLI()
    return
  }

  // If preference is set and still available, use it
  if (preferredCLI) {
    const preferred = available.find(cli => cli.command === preferredCLI)
    if (preferred) {
      await launchCLI(preferred, cwd)
      return
    }
  }

  // If only one option, use it
  if (available.length === 1) {
    config.set("aiCLI", available[0].command)
    await launchCLI(available[0], cwd)
    return
  }

  // Multiple options - let them choose
  console.log(chalk.bold("\n🤖 JFL - AI Session\n"))
  console.log(chalk.gray("Multiple AI CLIs detected:\n"))

  const selected = await p.select({
    message: "Which AI do you want to use?",
    options: available.map(cli => ({
      label: `${cli.name}${cli.version ? ` (${cli.version})` : ""}`,
      value: cli.command,
    })),
  })

  if (p.isCancel(selected)) {
    p.cancel("Session cancelled.")
    return
  }

  const remember = await p.confirm({
    message: "Remember this choice?",
    initialValue: true,
  })

  if (!p.isCancel(remember) && remember) {
    config.set("aiCLI", selected)
  }

  const cli = available.find(c => c.command === selected)!
  await launchCLI(cli, cwd)
}

function detectAICLIs(): DetectedCLI[] {
  const clis: DetectedCLI[] = []

  try {
    const version = execSync("claude --version 2>/dev/null", { encoding: "utf-8" }).trim()
    clis.push({
      name: "Claude Code",
      command: "claude",
      provider: "claude",
      version: version.split("\n")[0],
    })
  } catch {}

  try {
    const version = execSync("codex --version 2>/dev/null", { encoding: "utf-8" }).trim()
    clis.push({
      name: "Codex CLI",
      command: "codex",
      provider: "codex",
      version,
    })
  } catch {}

  try {
    const version = execSync("aider --version 2>/dev/null", { encoding: "utf-8" }).trim()
    clis.push({
      name: "Aider",
      command: "aider",
      provider: "aider",
      version,
    })
  } catch {}

  try {
    const version = execSync("pi --version 2>/dev/null", { encoding: "utf-8" }).trim()
    clis.push({
      name: "Pi",
      command: "pi",
      provider: "pi",
      version: version.split("\n")[0],
    })
  } catch {}

  return clis
}

async function promptAutonomousMode(cli: DetectedCLI): Promise<boolean> {
  const savedPref = config.get(`autonomous_${cli.provider}`) as boolean | undefined
  if (savedPref !== undefined) return savedPref

  const flag = AUTONOMOUS_FLAGS[cli.provider]
  if (!flag) return false

  console.log()
  const autonomous = await p.confirm({
    message: `Run in autonomous mode? (${flag})`,
    initialValue: false,
  })

  if (p.isCancel(autonomous)) return false

  if (autonomous) {
    console.log(chalk.yellow("\n⚠️  Autonomous mode: AI can execute without asking permission."))
  }

  const remember = await p.confirm({
    message: "Remember this choice?",
    initialValue: true,
  })

  if (!p.isCancel(remember) && remember) {
    config.set(`autonomous_${cli.provider}`, autonomous)
  }

  return autonomous
}

async function promptChromeMode(cli: DetectedCLI): Promise<boolean> {
  if (cli.provider !== "claude") return false

  const savedPref = config.get("chrome_claude") as boolean | undefined
  if (savedPref !== undefined) return savedPref

  console.log()
  const chrome = await p.confirm({
    message: `Enable browser capabilities? (${CHROME_FLAG})`,
    initialValue: false,
  })

  if (p.isCancel(chrome)) return false

  if (chrome) {
    console.log(chalk.cyan("\n🌐 Chrome mode: Claude can browse and interact with web pages."))
  }

  const remember = await p.confirm({
    message: "Remember this choice?",
    initialValue: true,
  })

  if (!p.isCancel(remember) && remember) {
    config.set("chrome_claude", chrome)
  }

  return chrome
}

function showBanner() {
  let version: string | undefined
  try {
    const pkgPath = new URL("../../package.json", import.meta.url)
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    version = pkg.version
  } catch {}

  console.log(renderBanner({ version }))
}

async function showGatewayDashboard() {
  console.log(chalk.bold.cyan("\n┌─────────────────────────────────────────┐"))
  console.log(chalk.bold.cyan("│        JFL Gateway Dashboard            │"))
  console.log(chalk.bold.cyan("└─────────────────────────────────────────┘\n"))

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

  console.log()
  console.log(chalk.bold("Gateway Endpoints:"))
  console.log(chalk.gray("  Context Hub:     ") + chalk.cyan(`http://localhost:${contextHubConfig.port}`))
  console.log(chalk.gray("  Service Manager: ") + chalk.cyan("http://localhost:3401"))
  console.log(chalk.gray("  MCP Server:      ") + chalk.cyan("Connected via MCP"))
  console.log()
}

async function checkServiceManager(): Promise<{ running: boolean; services?: number }> {
  try {
    const response = await axios.get("http://localhost:3401/health", { timeout: 2000 })
    const services = response.data.stats?.total_services || 0
    return { running: true, services }
  } catch {
    return { running: false }
  }
}

async function launchCLI(cli: DetectedCLI, cwd: string) {
  const autonomous = await promptAutonomousMode(cli)
  let chrome = false
  if (cli.provider === "claude") {
    chrome = await promptChromeMode(cli)
  }

  // Ensure Context Hub is running and show dashboard before launch
  await showGatewayDashboard()

  // Build args
  const args: string[] = []
  if (autonomous && AUTONOMOUS_FLAGS[cli.provider]) {
    args.push(AUTONOMOUS_FLAGS[cli.provider]!)
  }
  if (chrome) {
    args.push(CHROME_FLAG)
  }

  // Show banner + mode indicators
  showBanner()

  const modes: string[] = []
  if (autonomous) modes.push("autonomous")
  if (chrome) modes.push("chrome")
  const modeStr = modes.length > 0 ? theme.dim(` (${modes.join(", ")})`) : ""

  console.log(theme.accent(`Launching ${cli.name}`) + modeStr)
  console.log(theme.dim("Context loaded from CLAUDE.md + knowledge/\n"))
  console.log(theme.dimmer("─".repeat(50)))
  console.log()

  const child = spawn(cli.command, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      JFL_PROJECT: cwd,
    },
  })

  child.on("error", (err) => {
    console.error(chalk.red(`\nFailed to launch ${cli.name}:`), err.message)
  })

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.log(chalk.yellow(`\n${cli.name} exited with code ${code}`))
    }
    console.log(chalk.gray("\nJFL session ended.\n"))
  })
}

async function onboardNewUser(cwd: string) {
  showBanner()
  showHowItWorksNotice()

  const knownProjects = (config.get("projects") as string[]) || []
  const existingProjects = knownProjects.filter(
    (proj) => existsSync(join(proj, "CLAUDE.md")) || existsSync(join(proj, "knowledge"))
  )

  p.intro(chalk.hex("#FFD700")("┌  JFL onboarding"))

  if (existingProjects.length > 0) {
    const selected = await p.select({
      message: "Open a project or create new?",
      options: [
        ...existingProjects.map((proj) => ({
          label: proj.replace(process.env.HOME || "", "~"),
          value: proj,
        })),
        { label: "Join existing project (I was invited)", value: "__join__" },
        { label: "Create new project", value: "__new__" },
      ],
    })

    if (p.isCancel(selected)) {
      p.cancel("Setup cancelled.")
      process.exit(0)
    }

    if (selected === "__join__") {
      await joinExistingProject()
      return
    }

    if (selected !== "__new__") {
      config.set("projects", existingProjects)
      process.chdir(selected as string)
      p.outro(chalk.hex("#FFA500")(`Opening ${(selected as string).replace(process.env.HOME || "", "~")}`))

      const available = detectAICLIs()
      if (available.length > 0) {
        await launchCLI(available[0], selected as string)
      } else {
        await onboardAICLI()
      }
      return
    }
  }

  const action = await p.select({
    message: "What do you want to do?",
    options: [
      { label: "Join existing project (I was invited)", value: "join" },
      { label: "Create a new project", value: "create" },
    ],
  })

  if (p.isCancel(action)) {
    p.cancel("Setup cancelled.")
    process.exit(0)
  }

  if (action === "join") {
    await joinExistingProject()
    return
  }

  p.outro(chalk.hex("#FFA500")("Launching project setup..."))
  await initCommand()
}

async function joinExistingProject() {
  console.log(chalk.cyan("\n🔗 Join Existing Project\n"))

  let username: string
  try {
    username = await authenticateWithGitHub()
  } catch (error) {
    console.error(chalk.red("\nGitHub authentication failed"))
    console.error(chalk.gray(error instanceof Error ? error.message : String(error)))
    return
  }

  let projects: JflProject[]
  try {
    projects = await discoverJflProjects()
  } catch (error) {
    console.error(chalk.red("\nFailed to discover projects"))
    console.error(chalk.gray(error instanceof Error ? error.message : String(error)))
    return
  }

  if (projects.length === 0) {
    console.log(chalk.yellow("\nNo JFL projects found that you have access to.\n"))
    console.log(chalk.gray("Ask the project owner to add you as a collaborator."))
    console.log(chalk.gray("The project needs a CLAUDE.md file or .jfl/ directory.\n"))
    return
  }

  const selectedProject = await p.select({
    message: "Which project do you want to join?",
    options: projects.map((proj) => ({
      label: `${proj.fullName}${proj.hasUserSuggestions ? chalk.green(" (you're invited)") : ""}${proj.description ? chalk.gray(` - ${proj.description}`) : ""}`,
      value: proj,
    })),
  })

  if (p.isCancel(selectedProject)) {
    p.cancel("Cancelled.")
    return
  }

  const project = selectedProject as JflProject

  // Check if already cloned locally
  const trackedProjects = (config.get("projects") as string[]) || []
  const existingLocal = trackedProjects.find((proj) => {
    const projectName = proj.split("/").pop()
    return projectName === project.name &&
           (existsSync(join(proj, "CLAUDE.md")) || existsSync(join(proj, ".jfl")))
  })

  const commonPaths = [
    join(process.env.HOME || "", "Projects", project.name),
    join(process.env.HOME || "", project.name),
    join(process.cwd(), project.name),
  ]
  const existingAtCommonPath = commonPaths.find((proj) =>
    existsSync(proj) && (existsSync(join(proj, "CLAUDE.md")) || existsSync(join(proj, ".jfl")))
  )

  const alreadyCloned = existingLocal || existingAtCommonPath

  if (alreadyCloned) {
    console.log(chalk.green(`\n✓ Already have ${project.name} at ${alreadyCloned}\n`))

    const openExisting = await p.confirm({
      message: "Open it?",
      initialValue: true,
    })

    if (!p.isCancel(openExisting) && openExisting) {
      if (!trackedProjects.includes(alreadyCloned)) {
        trackedProjects.push(alreadyCloned)
        config.set("projects", trackedProjects)
      }

      process.chdir(alreadyCloned)
      const available = detectAICLIs()
      if (available.length > 0) {
        await launchCLI(available[0], alreadyCloned)
      } else {
        await onboardAICLI()
      }
    }
    return
  }

  // Show project info
  console.log()
  console.log(chalk.bold(`Project: ${project.fullName}`))
  if (project.description) {
    console.log(chalk.gray(project.description))
  }
  if (project.projectConfig?.wallet) {
    console.log(chalk.gray(`Wallet: ${project.projectConfig.wallet.slice(0, 10)}...`))
  }
  if (project.hasUserSuggestions) {
    console.log(chalk.green(`✓ Your suggestions file exists (suggestions/${username}.md)`))
  }
  console.log()

  const defaultPath = join(process.env.HOME || "", "Projects", project.name)
  const clonePath = await p.text({
    message: "Where to clone?",
    defaultValue: defaultPath,
    placeholder: defaultPath,
  })

  if (p.isCancel(clonePath)) {
    p.cancel("Cancelled.")
    return
  }

  const expandedPath = (clonePath as string).replace(/^~/, process.env.HOME || "")

  let clonedPath: string
  try {
    clonedPath = await cloneRepository(project, expandedPath)
  } catch (error) {
    console.error(chalk.red("\nClone failed"))
    console.error(chalk.gray(error instanceof Error ? error.message : String(error)))
    return
  }

  // Track this project
  const allProjects = (config.get("projects") as string[]) || []
  if (!allProjects.includes(clonedPath)) {
    allProjects.push(clonedPath)
    config.set("projects", allProjects)
  }

  config.set("hasOnboarded", true)

  console.log(chalk.green(`\n✓ Joined ${project.name}!\n`))

  if (project.projectConfig?.wallet) {
    console.log(chalk.gray("Project Configuration:"))
    console.log(chalk.gray(`  Owner: ${project.projectConfig.walletOwner || project.owner}`))
    console.log(chalk.gray(`  Wallet: ${project.projectConfig.wallet} (configured)`))
    console.log(chalk.gray(`  Your role: Contributor`))
    console.log()
  }

  console.log(chalk.gray(`Location: ${clonedPath}`))
  console.log(chalk.cyan(`\nTo start working:\n`))
  console.log(chalk.white(`  cd ${clonedPath}`))
  console.log(chalk.white(`  jfl\n`))

  const launchNow = await p.confirm({
    message: "Open project now?",
    initialValue: true,
  })

  if (!p.isCancel(launchNow) && launchNow) {
    process.chdir(clonedPath)
    const available = detectAICLIs()
    if (available.length > 0) {
      await launchCLI(available[0], clonedPath)
    } else {
      await onboardAICLI()
    }
  }
}

async function onboardAICLI() {
  console.log(chalk.bold("\n🤖 JFL - Setup AI Assistant\n"))
  console.log(chalk.gray("JFL works with your AI of choice. Let's get you set up.\n"))

  const experience = await p.select({
    message: "How technical are you?",
    options: [
      { label: "I'm a developer - comfortable with terminal", value: "dev" },
      { label: "Somewhat technical - can follow instructions", value: "some" },
      { label: "Not technical - need the easy path", value: "none" },
    ],
  })

  if (p.isCancel(experience)) return

  if (experience === "none") {
    console.log(chalk.cyan("\n📱 Easiest options for you:\n"))
    console.log(chalk.bold("1. Claude.ai (browser)"))
    console.log(chalk.gray("   Go to claude.ai, sign up, and chat directly"))
    console.log(chalk.gray("   You can paste your project files into the chat\n"))
    console.log(chalk.bold("2. Claude Desktop App"))
    console.log(chalk.gray("   Download from claude.ai/download"))
    console.log(chalk.gray("   Works like ChatGPT but with Claude\n"))
    console.log(chalk.bold("3. Cursor (AI-powered code editor)"))
    console.log(chalk.gray("   Download from cursor.com"))
    console.log(chalk.gray("   Like VS Code but with AI built in\n"))
    console.log(chalk.yellow("For the full JFL experience, Claude Code is best."))
    console.log(chalk.gray("But start with what's comfortable.\n"))
    return
  }

  console.log(chalk.yellow("\nNo AI CLI detected.\n"))

  const choice = await p.select({
    message: "Which AI do you want to use?",
    options: [
      { label: "Claude Code (recommended for JFL)", value: "claude" },
      { label: "Codex CLI (OpenAI)", value: "codex" },
      { label: "Aider (works with multiple models)", value: "aider" },
      { label: "I'll set it up myself", value: "manual" },
    ],
  })

  if (p.isCancel(choice)) return

  if (choice === "manual") {
    console.log(chalk.gray("\nSupported AI CLIs:"))
    console.log("  • Claude Code: npm install -g @anthropic-ai/claude-code")
    console.log("  • Codex CLI:   npm install -g @openai/codex")
    console.log("  • Aider:       pip install aider-chat")
    console.log(chalk.gray("\nRun 'jfl' again after installing.\n"))
    return
  }

  const installCommands: Record<string, { cmd: string; name: string }> = {
    claude: { cmd: "npm install -g @anthropic-ai/claude-code", name: "Claude Code" },
    codex: { cmd: "npm install -g @openai/codex", name: "Codex CLI" },
    aider: { cmd: "pip install aider-chat", name: "Aider" },
  }

  const install = installCommands[choice as string]

  console.log(chalk.cyan(`\nInstalling ${install.name}...\n`))
  console.log(chalk.gray(`$ ${install.cmd}\n`))

  const proceed = await p.confirm({
    message: "Run this command?",
    initialValue: true,
  })

  if (p.isCancel(proceed) || !proceed) {
    console.log(chalk.gray(`\nRun manually: ${install.cmd}`))
    console.log(chalk.gray("Then run 'jfl' again.\n"))
    return
  }

  try {
    execSync(install.cmd, { stdio: "inherit" })
    console.log(chalk.green(`\n✓ ${install.name} installed!\n`))

    if (choice === "claude") {
      console.log(chalk.gray("Set your Anthropic API key:"))
      console.log(chalk.white("  export ANTHROPIC_API_KEY=your-key-here\n"))
      console.log(chalk.gray("Or run 'claude' to authenticate interactively.\n"))
    } else if (choice === "codex") {
      console.log(chalk.gray("Set your OpenAI API key:"))
      console.log(chalk.white("  export OPENAI_API_KEY=your-key-here\n"))
    } else if (choice === "aider") {
      console.log(chalk.gray("Set your API key (Anthropic or OpenAI):"))
      console.log(chalk.white("  export ANTHROPIC_API_KEY=your-key-here"))
      console.log(chalk.white("  # or"))
      console.log(chalk.white("  export OPENAI_API_KEY=your-key-here\n"))
    }

    console.log(chalk.cyan("Run 'jfl' to start your AI session.\n"))
  } catch {
    console.error(chalk.red("\nInstallation failed."))
    console.log(chalk.gray(`\nTry manually: ${install.cmd}\n`))
  }
}

export { showGatewayDashboard }
