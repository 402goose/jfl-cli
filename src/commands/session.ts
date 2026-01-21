import chalk from "chalk"
import ora from "ora"
import inquirer from "inquirer"
import { execSync, spawn } from "child_process"
import { existsSync } from "fs"
import { join } from "path"
import Conf from "conf"
import { ensureDayPass, isTrialMode, showDayPassStatus, markTeammateJoined } from "../utils/auth-guard.js"
import {
  authenticateWithGitHub,
  discoverJflProjects,
  cloneRepository,
  isGitHubAuthenticated,
  getGitHubUsername,
  type JflProject,
} from "../utils/github-auth.js"

const config = new Conf({ projectName: "jfl" })

type AIProvider = "claude" | "codex" | "aider" | "none"

interface DetectedCLI {
  name: string
  command: string
  provider: AIProvider
  version?: string
  autonomousFlag?: string
}

// Flags for running in autonomous/yolo mode
const AUTONOMOUS_FLAGS: Record<AIProvider, string | undefined> = {
  claude: "--dangerously-skip-permissions",
  codex: "--full-auto",
  aider: "--yes-always",
  none: undefined,
}

// Flag for enabling Chrome/browser capabilities (Claude only)
const CHROME_FLAG = "--chrome"

export async function sessionCommand() {
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
      // User cancelled or failed to purchase day pass
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

  // Check for saved preference
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

  const { selected } = await inquirer.prompt([
    {
      type: "list",
      name: "selected",
      message: "Which AI do you want to use?",
      choices: available.map(cli => ({
        name: `${cli.name}${cli.version ? ` (${cli.version})` : ""}`,
        value: cli.command,
      })),
    },
  ])

  const { remember } = await inquirer.prompt([
    {
      type: "confirm",
      name: "remember",
      message: "Remember this choice?",
      default: true,
    },
  ])

  if (remember) {
    config.set("aiCLI", selected)
  }

  const cli = available.find(c => c.command === selected)!
  await launchCLI(cli, cwd)
}

function detectAICLIs(): DetectedCLI[] {
  const clis: DetectedCLI[] = []

  // Claude Code
  try {
    const version = execSync("claude --version 2>/dev/null", { encoding: "utf-8" }).trim()
    clis.push({
      name: "Claude Code",
      command: "claude",
      provider: "claude",
      version: version.split("\n")[0],
    })
  } catch {
    // Not installed
  }

  // OpenAI Codex CLI
  try {
    const version = execSync("codex --version 2>/dev/null", { encoding: "utf-8" }).trim()
    clis.push({
      name: "Codex CLI",
      command: "codex",
      provider: "codex",
      version,
    })
  } catch {
    // Not installed
  }

  // Aider
  try {
    const version = execSync("aider --version 2>/dev/null", { encoding: "utf-8" }).trim()
    clis.push({
      name: "Aider",
      command: "aider",
      provider: "aider",
      version,
    })
  } catch {
    // Not installed
  }

  return clis
}

async function promptAutonomousMode(cli: DetectedCLI): Promise<boolean> {
  const savedPref = config.get(`autonomous_${cli.provider}`) as boolean | undefined

  // If they've already set a preference, use it
  if (savedPref !== undefined) {
    return savedPref
  }

  const flag = AUTONOMOUS_FLAGS[cli.provider]
  if (!flag) return false

  console.log()
  const { autonomous } = await inquirer.prompt([
    {
      type: "confirm",
      name: "autonomous",
      message: `Run in autonomous mode? (${flag})`,
      default: false,
    },
  ])

  if (autonomous) {
    console.log(chalk.yellow("\n⚠️  Autonomous mode: AI can execute without asking permission."))
  }

  const { remember } = await inquirer.prompt([
    {
      type: "confirm",
      name: "remember",
      message: "Remember this choice?",
      default: true,
    },
  ])

  if (remember) {
    config.set(`autonomous_${cli.provider}`, autonomous)
  }

  return autonomous
}

async function promptChromeMode(cli: DetectedCLI): Promise<boolean> {
  // Chrome mode only available for Claude
  if (cli.provider !== "claude") return false

  const savedPref = config.get("chrome_claude") as boolean | undefined

  // If they've already set a preference, use it
  if (savedPref !== undefined) {
    return savedPref
  }

  console.log()
  const { chrome } = await inquirer.prompt([
    {
      type: "confirm",
      name: "chrome",
      message: `Enable browser capabilities? (${CHROME_FLAG})`,
      default: false,
    },
  ])

  if (chrome) {
    console.log(chalk.cyan("\n🌐 Chrome mode: Claude can browse and interact with web pages."))
  }

  const { remember } = await inquirer.prompt([
    {
      type: "confirm",
      name: "remember",
      message: "Remember this choice?",
      default: true,
    },
  ])

  if (remember) {
    config.set("chrome_claude", chrome)
  }

  return chrome
}

function showBanner() {
  const banner = `
${chalk.bold.cyan("     ██╗███████╗██╗     ")}
${chalk.bold.cyan("     ██║██╔════╝██║     ")}
${chalk.bold.cyan("     ██║█████╗  ██║     ")}
${chalk.bold.cyan("██   ██║██╔══╝  ██║     ")}
${chalk.bold.cyan("╚█████╔╝██║     ███████╗")}
${chalk.bold.cyan(" ╚════╝ ╚═╝     ╚══════╝")}

${chalk.bold("    JUST F*CKING LAUNCH")}
${chalk.gray("Your context layer for building and launching.")}
`
  console.log(banner)
}

async function launchCLI(cli: DetectedCLI, cwd: string, skipAutonomousPrompt = false) {
  // Check for autonomous mode
  let autonomous = false
  if (!skipAutonomousPrompt) {
    autonomous = await promptAutonomousMode(cli)
  } else {
    autonomous = (config.get(`autonomous_${cli.provider}`) as boolean) || false
  }

  // Check for chrome mode (Claude only)
  let chrome = false
  if (cli.provider === "claude") {
    if (!skipAutonomousPrompt) {
      chrome = await promptChromeMode(cli)
    } else {
      chrome = (config.get("chrome_claude") as boolean) || false
    }
  }

  // Build args array
  const args: string[] = []
  if (autonomous && AUTONOMOUS_FLAGS[cli.provider]) {
    args.push(AUTONOMOUS_FLAGS[cli.provider]!)
  }
  if (chrome) {
    args.push(CHROME_FLAG)
  }

  showBanner()

  // Show trial/day pass status
  if (isTrialMode()) {
    console.log(chalk.green("🎁 Trial Mode") + chalk.gray(" - Free until foundation complete\n"))
  } else {
    showDayPassStatus()
    console.log()
  }

  // Build mode indicators
  const modes: string[] = []
  if (autonomous) modes.push("autonomous")
  if (chrome) modes.push("chrome")
  const modeStr = modes.length > 0 ? ` (${modes.join(", ")})` : ""

  console.log(chalk.cyan(`Launching ${cli.name}${modeStr}...`))
  console.log(chalk.gray("Context loaded from CLAUDE.md + knowledge/\n"))
  console.log(chalk.gray("─".repeat(40)))
  console.log()

  // Spawn the CLI in the current directory
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
  console.log(chalk.bold("\n🚀 JFL - Just Fucking Launch\n"))
  console.log(chalk.gray("Your team's context layer. Any AI. Any task.\n"))

  // Check for known projects first
  const knownProjects = (config.get("projects") as string[]) || []
  const existingProjects = knownProjects.filter(
    (p) => existsSync(join(p, "CLAUDE.md")) || existsSync(join(p, "knowledge"))
  )

  // If we have known projects, show them upfront
  if (existingProjects.length > 0) {
    console.log(chalk.cyan("Your projects:\n"))

    const { selected } = await inquirer.prompt([
      {
        type: "list",
        name: "selected",
        message: "Open a project or create new?",
        choices: [
          ...existingProjects.map((p) => ({
            name: p.replace(process.env.HOME || "", "~"),
            value: p,
          })),
          new inquirer.Separator("─────────────────"),
          { name: "Join existing project (I was invited)", value: "join" },
          { name: "Create new project", value: "new" },
        ],
      },
    ])

    if (selected === "join") {
      await joinExistingProject()
      return
    }

    if (selected !== "new") {
      // Update config with cleaned list
      config.set("projects", existingProjects)

      process.chdir(selected)
      console.log(chalk.gray(`\nOpening ${selected}\n`))

      // Launch
      const available = detectAICLIs()
      if (available.length > 0) {
        await launchCLI(available[0], selected)
      } else {
        await onboardAICLI()
      }
      return
    }
  }

  // No known projects or they want to create new
  const hasUsedBefore = config.get("hasOnboarded")

  if (!hasUsedBefore && existingProjects.length === 0) {
    console.log(chalk.cyan("Welcome! Let's get you set up.\n"))
  }

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What do you want to do?",
      choices: [
        {
          name: "Join existing project (I was invited)",
          value: "join",
        },
        {
          name: "Create a new project here",
          value: "here",
        },
        {
          name: "Create a project somewhere else",
          value: "elsewhere",
        },
      ],
    },
  ])

  if (action === "join") {
    await joinExistingProject()
    return
  }

  let projectPath = cwd
  let projectName: string

  if (action === "elsewhere") {
    const { path } = await inquirer.prompt([
      {
        type: "input",
        name: "path",
        message: "Where? (path to parent directory):",
        default: "~/Projects",
      },
    ])
    // Expand ~ to home directory
    projectPath = path.replace(/^~/, process.env.HOME || "")
  }

  // Get project name
  const { name } = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Project name:",
      default: "my-project",
      validate: (input: string) => {
        if (!/^[a-z0-9-]+$/.test(input)) {
          return "Use lowercase letters, numbers, and hyphens only"
        }
        return true
      },
    },
  ])
  projectName = name

  const fullPath = join(projectPath, projectName)

  // Check if directory exists
  if (existsSync(fullPath)) {
    console.log(chalk.red(`\nDirectory ${fullPath} already exists.`))
    return
  }

  // Clone template
  const spinner = ora("Creating project...").start()

  const TEMPLATE_REPO = "https://github.com/402goose/just-fucking-launch.git"

  try {
    // Ensure parent directory exists
    if (!existsSync(projectPath)) {
      execSync(`mkdir -p "${projectPath}"`, { stdio: "pipe" })
    }

    execSync(`git clone --depth 1 ${TEMPLATE_REPO} "${fullPath}"`, {
      stdio: "pipe",
    })

    // Remove .git to start fresh
    execSync(`rm -rf "${join(fullPath, ".git")}"`, { stdio: "pipe" })

    // Initialize new git repo
    execSync(`git init`, { cwd: fullPath, stdio: "pipe" })

    spinner.succeed("Project created!")

    config.set("hasOnboarded", true)

    // Track this project
    const projects = (config.get("projects") as string[]) || []
    if (!projects.includes(fullPath)) {
      projects.push(fullPath)
      config.set("projects", projects)
    }

    console.log(chalk.green(`\n✓ Created ${fullPath}\n`))

    // Now onboard AI CLI
    const available = detectAICLIs()

    if (available.length === 0) {
      await onboardAICLI()
      console.log(chalk.cyan(`\nTo start working:`))
      console.log(chalk.white(`  cd ${fullPath}`))
      console.log(chalk.white(`  jfl\n`))
    } else {
      // They have an AI CLI, offer to launch
      const { launch } = await inquirer.prompt([
        {
          type: "confirm",
          name: "launch",
          message: `Launch ${available[0].name} in your new project?`,
          default: true,
        },
      ])

      if (launch) {
        process.chdir(fullPath)
        await launchCLI(available[0], fullPath)
      } else {
        console.log(chalk.cyan(`\nTo start working:`))
        console.log(chalk.white(`  cd ${fullPath}`))
        console.log(chalk.white(`  jfl\n`))
      }
    }
  } catch (error) {
    spinner.fail("Failed to create project")
    console.error(chalk.red(error))
  }
}

async function joinExistingProject() {
  console.log(chalk.cyan("\n🔗 Join Existing Project\n"))

  // Authenticate with GitHub using Device Flow
  let username: string
  try {
    username = await authenticateWithGitHub()
  } catch (error) {
    console.error(chalk.red("\nGitHub authentication failed"))
    console.error(chalk.gray(error instanceof Error ? error.message : String(error)))
    return
  }

  // Discover JFL projects
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

  // Show projects with details
  console.log()
  const { selectedProject } = await inquirer.prompt([
    {
      type: "list",
      name: "selectedProject",
      message: "Which project do you want to join?",
      choices: projects.map((p) => ({
        name: `${p.fullName}${p.hasUserSuggestions ? chalk.green(" (you're invited)") : ""}${p.description ? chalk.gray(` - ${p.description}`) : ""}`,
        value: p,
      })),
    },
  ])

  // Check if we already have this project locally
  const trackedProjects = (config.get("projects") as string[]) || []
  const existingLocal = trackedProjects.find((p) => {
    const projectName = p.split("/").pop()
    return projectName === selectedProject.name &&
           (existsSync(join(p, "CLAUDE.md")) || existsSync(join(p, ".jfl")))
  })

  // Also check common locations
  const commonPaths = [
    join(process.env.HOME || "", "Projects", selectedProject.name),
    join(process.env.HOME || "", selectedProject.name),
    join(process.cwd(), selectedProject.name),
  ]
  const existingAtCommonPath = commonPaths.find((p) =>
    existsSync(p) && (existsSync(join(p, "CLAUDE.md")) || existsSync(join(p, ".jfl")))
  )

  const alreadyCloned = existingLocal || existingAtCommonPath

  if (alreadyCloned) {
    console.log(chalk.green(`\n✓ Already have ${selectedProject.name} at ${alreadyCloned}\n`))

    const { openExisting } = await inquirer.prompt([
      {
        type: "confirm",
        name: "openExisting",
        message: "Open it?",
        default: true,
      },
    ])

    if (openExisting) {
      // Track if not already
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
  console.log(chalk.bold(`Project: ${selectedProject.fullName}`))
  if (selectedProject.description) {
    console.log(chalk.gray(selectedProject.description))
  }
  if (selectedProject.projectConfig?.wallet) {
    console.log(chalk.gray(`Wallet: ${selectedProject.projectConfig.wallet.slice(0, 10)}...`))
  }
  if (selectedProject.hasUserSuggestions) {
    console.log(chalk.green(`✓ Your suggestions file exists (suggestions/${username}.md)`))
  }
  console.log()

  // Ask where to clone
  const defaultPath = join(process.env.HOME || "", "Projects", selectedProject.name)
  const { clonePath } = await inquirer.prompt([
    {
      type: "input",
      name: "clonePath",
      message: "Where to clone?",
      default: defaultPath,
    },
  ])

  const expandedPath = clonePath.replace(/^~/, process.env.HOME || "")

  // Clone the repo
  let clonedPath: string
  try {
    clonedPath = await cloneRepository(selectedProject, expandedPath)
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

  // Mark this teammate as joined (adds <!-- joined: DATE --> marker)
  markTeammateJoined(username)

  console.log(chalk.green(`\n✓ Joined ${selectedProject.name}!\n`))

  // Show project configuration
  if (selectedProject.projectConfig?.wallet) {
    console.log(chalk.gray("Project Configuration:"))
    console.log(chalk.gray(`  Owner: ${selectedProject.projectConfig.walletOwner || selectedProject.owner}`))
    console.log(chalk.gray(`  Wallet: ${selectedProject.projectConfig.wallet} (configured)`))
    console.log(chalk.gray(`  Your role: Contributor`))
    console.log()
  }

  console.log(chalk.gray(`Location: ${clonedPath}`))
  console.log(chalk.cyan(`\nTo start working:\n`))
  console.log(chalk.white(`  cd ${clonedPath}`))
  console.log(chalk.white(`  jfl\n`))

  // Offer to launch now
  const { launchNow } = await inquirer.prompt([
    {
      type: "confirm",
      name: "launchNow",
      message: "Open project now?",
      default: true,
    },
  ])

  if (launchNow) {
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

  const { experience } = await inquirer.prompt([
    {
      type: "list",
      name: "experience",
      message: "How technical are you?",
      choices: [
        { name: "I'm a developer - comfortable with terminal", value: "dev" },
        { name: "Somewhat technical - can follow instructions", value: "some" },
        { name: "Not technical - need the easy path", value: "none" },
      ],
    },
  ])

  if (experience === "none") {
    // Non-technical path - recommend browser-based or desktop app
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

  // Technical path - CLI tools
  console.log(chalk.yellow("\nNo AI CLI detected.\n"))

  const { choice } = await inquirer.prompt([
    {
      type: "list",
      name: "choice",
      message: "Which AI do you want to use?",
      choices: [
        {
          name: "Claude Code (recommended for JFL)",
          value: "claude",
        },
        {
          name: "Codex CLI (OpenAI)",
          value: "codex",
        },
        {
          name: "Aider (works with multiple models)",
          value: "aider",
        },
        {
          name: "I'll set it up myself",
          value: "manual",
        },
      ],
    },
  ])

  if (choice === "manual") {
    console.log(chalk.gray("\nSupported AI CLIs:"))
    console.log("  • Claude Code: npm install -g @anthropic-ai/claude-code")
    console.log("  • Codex CLI:   npm install -g @openai/codex")
    console.log("  • Aider:       pip install aider-chat")
    console.log(chalk.gray("\nRun 'jfl' again after installing.\n"))
    return
  }

  const installCommands: Record<string, { cmd: string; name: string }> = {
    claude: {
      cmd: "npm install -g @anthropic-ai/claude-code",
      name: "Claude Code",
    },
    codex: {
      cmd: "npm install -g @openai/codex",
      name: "Codex CLI",
    },
    aider: {
      cmd: "pip install aider-chat",
      name: "Aider",
    },
  }

  const install = installCommands[choice]

  console.log(chalk.cyan(`\nInstalling ${install.name}...\n`))
  console.log(chalk.gray(`$ ${install.cmd}\n`))

  const { proceed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message: "Run this command?",
      default: true,
    },
  ])

  if (!proceed) {
    console.log(chalk.gray(`\nRun manually: ${install.cmd}`))
    console.log(chalk.gray("Then run 'jfl' again.\n"))
    return
  }

  try {
    execSync(install.cmd, { stdio: "inherit" })
    console.log(chalk.green(`\n✓ ${install.name} installed!\n`))

    // Prompt for API key setup
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
  } catch (error) {
    console.error(chalk.red("\nInstallation failed."))
    console.log(chalk.gray(`\nTry manually: ${install.cmd}\n`))
  }
}
