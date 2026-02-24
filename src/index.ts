#!/usr/bin/env node
/**
 * JFL CLI - Just Fucking Launch
 *
 * Free tier: Works standalone with BYOAI
 * Paid tier: Connects to platform for dashboard, integrations, hosted agents
 */

import { Command } from "commander"
import chalk from "chalk"
import { spawn, execSync } from "child_process"
import { existsSync, symlinkSync, mkdirSync, unlinkSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import * as path from "path"
import { fileURLToPath } from "url"
import { initCommand } from "./commands/init.js"
import { repairCommand } from "./commands/repair.js"
import { validateSettingsCommand } from "./commands/validate-settings.js"
import { loginCommand, logout, getX402Address } from "./commands/login.js"
import { statusCommand } from "./commands/status.js"
import { deployCommand } from "./commands/deploy.js"
import { agentsCommand } from "./commands/agents.js"
import { hudCommand } from "./commands/hud.js"
import { sessionCommand } from "./commands/session.js"
import { feedbackCommand } from "./commands/feedback.js"
import { updateCommand } from "./commands/update.js"
import { contextHubCommand } from "./commands/context-hub.js"
import { voiceCommand } from "./commands/voice.js"
import { synopsisCommand } from "./commands/synopsis.js"
import { onboardCommand } from "./commands/onboard.js"
import { profileCommand } from "./commands/profile.js"
import { migrateServices } from "./commands/migrate-services.js"
import {
  memoryInitCommand,
  memoryStatusCommand,
  memorySearchCommand,
  memoryIndexCommand
} from "./commands/memory.js"
import {
  listSkillsCommand,
  installSkillCommand,
  removeSkillCommand,
  updateSkillsCommand,
  searchSkillsCommand,
} from "./commands/skills.js"
import { ralphCommand, showRalphHelp } from "./commands/ralph.js"
import { peterCommand } from "./commands/peter.js"
import { clawdbotSetupCommand, clawdbotStatusCommand } from "./commands/clawdbot.js"
import {
  showDayPassStatus,
  requiresPayment,
  hasWallet,
  getWalletAddress,
} from "./utils/auth-guard.js"
import { getDayPassTimeRemaining } from "./utils/x402-client.js"
import { checkAndMigrate } from "./utils/jfl-migration.js"
import { JFL_PATHS } from "./utils/jfl-paths.js"

// Auto-migrate from ~/.jfl/ to XDG directories if needed
await checkAndMigrate({ silent: true })

const program = new Command()

program
  .name("jfl")
  .description("Just Fucking Launch - AI gateway for GTM")
  .version("0.2.2")
  .option("--no-update", "Skip automatic update check")
  .action(async (options) => {
    // Always update on session start (unless --no-update flag)
    if (options.update !== false) {
      await updateCommand({ autoUpdate: true })
      console.log() // Add spacing before session starts
    }
    await sessionCommand({})
  })

// ============================================================================
// FREE TIER COMMANDS (work offline/standalone)
// ============================================================================

program
  .command("init")
  .description("Initialize a new JFL project")
  .option("-n, --name <name>", "Project name")
  .action(initCommand)

program
  .command("repair")
  .description("Repair a JFL project missing .jfl directory")
  .action(repairCommand)

program
  .command("validate-settings")
  .description("Validate and repair .claude/settings.json")
  .option("--fix", "Attempt to auto-repair common issues")
  .option("--json", "Output in JSON format")
  .action(validateSettingsCommand)

program
  .command("hud")
  .description("Show campaign dashboard")
  .option("-c, --compact", "Show compact one-line status")
  .action(hudCommand)

program
  .command("status")
  .description("Show project status")
  .action(statusCommand)

program
  .command("context-hub")
  .description("Manage Context Hub daemon (unified context for AI agents)")
  .argument("[action]", "start, stop, restart, status, ensure, query, serve")
  .option("-p, --port <port>", "Port to run on (default: per-project)")
  .option("-g, --global", "Run in global mode (serve all GTM projects)")
  .action(async (action, options) => {
    await contextHubCommand(action, {
      port: options.port ? parseInt(options.port, 10) : undefined,
      global: options.global || false,
    })
  })

program
  .command("synopsis")
  .description("Show work summary (journal + commits + code)")
  .argument("[hours]", "Hours to look back (default: 24)", "24")
  .argument("[author]", "Filter by author name")
  .action(async (hours, author) => {
    await synopsisCommand(hours, author)
  })

program
  .command("service-manager")
  .description("Manage Service Manager API daemon")
  .argument("[action]", "start, stop, restart, status, serve")
  .option("-p, --port <port>", "Port to run on (default: from config or 3402)")
  .action(async (action, options) => {
    const { serviceManagerCommand } = await import("./commands/service-manager.js")
    await serviceManagerCommand(action, {
      port: options.port ? parseInt(options.port, 10) : undefined
    })
  })

program
  .command("services")
  .description("Manage services across all GTM projects (interactive TUI or CLI)")
  .argument("[action]", "create, scan, list, status, start, stop, deps, validate, sync-agents, or leave empty for TUI")
  .argument("[service]", "Service name")
  .option("--dry-run", "Preview what would be discovered (for scan) or preview sync changes (for sync-agents)")
  .option("--current", "Sync only current service (for sync-agents)")
  .option("--path <path>", "Path to scan (default: current directory)")
  .option("--force", "Force operation (for stop with dependents)")
  .option("--verbose", "Verbose output")
  .option("--fix", "Auto-repair issues (for validate)")
  .option("--json", "Output JSON (for validate)")
  .option("--skip-ai", "Skip AI tool, just scaffold (for create)")
  .action(async (action, service, options) => {
    // Handle scan action
    if (action === "scan") {
      const { scanServices } = await import("./commands/services-scan.js")
      await scanServices({
        path: options.path,
        dryRun: options.dryRun
      })
      return
    }

    // Handle dependency actions
    if (action === "deps" || action === "dependencies") {
      const { buildDependencyGraph, visualizeDependencies, validateDependencies } = await import("./lib/service-dependencies.js")
      const fs = await import("fs")
      const servicesConfigPath = path.join(JFL_PATHS.data, "services.json")
      const servicesConfig = JSON.parse(fs.readFileSync(servicesConfigPath, "utf-8"))

      if (service === "validate") {
        const result = validateDependencies(servicesConfig.services)
        if (result.valid) {
          console.log(chalk.green("\n✓ All dependencies valid\n"))
        } else {
          console.log(chalk.red("\n✗ Dependency validation failed:\n"))
          result.errors.forEach(err => console.log(chalk.red(`  - ${err}`)))
          console.log()
        }
      } else {
        console.log(visualizeDependencies(servicesConfig.services))
      }
      return
    }

    // If no action, launch interactive TUI
    if (!action) {
      const { spawn } = await import("child_process")
      const { fileURLToPath } = await import("url")
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = path.dirname(__filename)

      const tui = spawn(process.execPath, [
        path.join(__dirname, "../dist/ui/services-manager.js")
      ], {
        stdio: "inherit"
      })

      tui.on("exit", (code: number) => {
        process.exit(code || 0)
      })
    } else {
      // CLI mode
      const { servicesCommand } = await import("./commands/services.js")
      await servicesCommand(action, service, {
        fix: options.fix,
        json: options.json,
        dryRun: options.dryRun,
        current: options.current,
        skipAI: options.skipAi
      })
    }
  })

program
  .command("onboard <path-or-url>")
  .description("Onboard a service repo as a service agent")
  .option("-n, --name <name>", "Override service name")
  .option("-t, --type <type>", "Override service type (web, api, container, worker, cli, infrastructure, library)")
  .option("-d, --description <desc>", "Override service description")
  .option("--skip-git", "Skip git clone (treat URL as local path)")
  .action(async (pathOrUrl, options) => {
    await onboardCommand(pathOrUrl, options)
  })

program
  .command("orchestrate [name]")
  .description("Execute multi-service orchestration workflows")
  .option("--dry-run", "Preview orchestration steps without executing")
  .option("--list", "List available orchestrations")
  .option("--create <name>", "Create new orchestration template")
  .action(async (name, options) => {
    const { orchestrate, listOrchestrations, createOrchestration } = await import("./commands/orchestrate.js")

    if (options.list) {
      await listOrchestrations()
    } else if (options.create) {
      await createOrchestration(options.create)
    } else if (name) {
      await orchestrate(name, { dryRun: options.dryRun })
    } else {
      await listOrchestrations()
    }
  })

program
  .command("dashboard")
  .description("Launch interactive service monitoring dashboard")
  .action(async () => {
    const { startDashboard } = await import("./ui/service-dashboard.js")
    await startDashboard()
  })

program
  .command("service-agent <action> [name]")
  .description("Manage service MCP agents (init, generate, register, list)")
  .action(async (action, name) => {
    const { init, generate, generateAll, register, unregister, list, clean } = await import("./commands/service-agent.js")

    switch (action) {
      case "init":
        await init(name) // name is optional path
        break
      case "generate":
        if (!name) {
          console.log(chalk.red("Error: service name required"))
          console.log(chalk.gray("Usage: jfl service-agent generate <service-name>"))
          process.exit(1)
        }
        await generate(name)
        break
      case "generate-all":
        await generateAll()
        break
      case "register":
        await register(name)
        break
      case "unregister":
        if (!name) {
          console.log(chalk.red("Error: service name required"))
          console.log(chalk.gray("Usage: jfl service-agent unregister <service-name>"))
          process.exit(1)
        }
        await unregister(name)
        break
      case "list":
        await list()
        break
      case "clean":
        await clean()
        break
      default:
        console.log(chalk.red(`Unknown action: ${action}`))
        console.log(chalk.gray("Available actions: init, generate, generate-all, register, unregister, list, clean"))
        process.exit(1)
    }
  })

program
  .command("profile [action]")
  .description("Manage your JFL profile (stored in config)")
  .argument("[action]", "show, edit, export, import, generate")
  .option("-f, --file <path>", "File path for export/import/generate output")
  .action(async (action, options) => {
    await profileCommand(action, options)
  })

program
  .command("migrate-services")
  .description("Migrate services from references/ to service manager")
  .argument("[gtm-path]", "Path to GTM project (default: current directory)")
  .action(async (gtmPath) => {
    await migrateServices(gtmPath)
  })

// ============================================================================
// PLATFORM COMMANDS (require login for full features)
// ============================================================================

program
  .command("login")
  .description("Login to JFL platform")
  .option("--platform", "Use Platform Account (recommended)")
  .option("--x402", "Use x402 Day Pass ($5/day, crypto)")
  .option("--solo", "Use Solo plan ($49/mo)")
  .option("--team", "Use Team plan ($199/mo)")
  .option("--free", "Stay on trial")
  .option("--force", "Force re-authentication")
  .action(loginCommand)

program
  .command("logout")
  .description("Logout from JFL platform")
  .action(() => {
    logout()
    console.log(chalk.green("Logged out successfully."))
  })

program
  .command("preferences")
  .description("Manage JFL preferences")
  .option("--clear-ai", "Clear saved AI CLI preference")
  .option("--show", "Show current preferences")
  .action(async (options) => {
    const { getConfigValue, deleteConfigKey, getConfig } = await import("./utils/jfl-config.js")

    if (options.clearAi) {
      deleteConfigKey("aiCLI")
      console.log(chalk.green("\n✓ Cleared AI CLI preference"))
      console.log(chalk.gray("  Next 'jfl' will show selection menu\n"))
      return
    }

    if (options.show || !options.clearAi) {
      console.log(chalk.bold("\n⚙️  JFL Preferences\n"))
      console.log(chalk.gray("AI CLI:") + " " + (getConfigValue("aiCLI") || chalk.gray("none")))
      console.log(chalk.gray("Projects tracked:") + " " + ((getConfigValue("projects") as string[] || []).length))
      console.log()
      console.log(chalk.gray("To clear AI preference: jfl preferences --clear-ai"))
      console.log()
    }
  })

program
  .command("wallet")
  .description("Show wallet and day pass status")
  .action(() => {
    const address = getWalletAddress()
    if (!address) {
      console.log(chalk.yellow("\n⚠️  No wallet configured"))
      console.log(chalk.gray("   Run: jfl login\n"))
      return
    }

    console.log(chalk.bold("\n💰 Wallet Status\n"))
    console.log(chalk.gray("Address: ") + chalk.cyan(address))

    if (!hasWallet()) {
      console.log(chalk.yellow("Mode: View-only (cannot sign payments)"))
      console.log(chalk.gray("Run 'jfl login' to import signing key"))
    } else {
      console.log(chalk.green("Mode: Full (can sign payments)"))
    }

    console.log()
    showDayPassStatus()
    console.log()
  })

program
  .command("deploy")
  .description("Deploy project to JFL platform")
  .option("-f, --force", "Force deploy even if no changes")
  .action(deployCommand)

program
  .command("agents")
  .description("Manage parallel agents")
  .argument("[action]", "Action: list, create, start, stop, destroy")
  .option("-n, --name <name>", "Agent name")
  .option("-t, --task <task>", "Task for agent")
  .action(agentsCommand)

program
  .command("feedback")
  .description("Rate your JFL session")
  .argument("[action]", "view or sync")
  .action(feedbackCommand)

program
  .command("update")
  .description("Pull latest JFL product updates")
  .option("--dry", "Show what would be updated without making changes")
  .action(updateCommand)

// ============================================================================
// SKILL MANAGEMENT (work offline)
// ============================================================================

const skills = program.command("skills").description("Manage JFL skills")

skills
  .command("list")
  .description("List installed or available skills")
  .option("-a, --available", "Show all available skills")
  .option("-c, --category <category>", "Filter by category (core or catalog)")
  .option("-t, --tag <tag>", "Filter by tag")
  .action(listSkillsCommand)

skills
  .command("install <skills...>")
  .description("Install skill(s)")
  .action(installSkillCommand)

skills
  .command("remove <skills...>")
  .description("Remove skill(s)")
  .action(removeSkillCommand)

skills
  .command("update [skill]")
  .description("Update installed skill(s)")
  .option("--dry", "Show what would be updated without making changes")
  .action((skill, options) => updateSkillsCommand({ ...options, skillName: skill }))

skills
  .command("search <query>")
  .description("Search for skills")
  .action(searchSkillsCommand)

// ============================================================================
// VOICE INPUT (work offline)
// ============================================================================

const voice = program.command("voice").description("Voice input for JFL")

voice
  .command("model")
  .description("Manage whisper models")
  .argument("[action]", "list, download, or default")
  .argument("[name]", "Model name (tiny, base, small, etc.)")
  .option("-f, --force", "Force re-download")
  .action(async (action, name, options) => {
    await voiceCommand("model", action, name, options)
  })

voice
  .command("devices")
  .description("List audio input devices")
  .action(async () => {
    await voiceCommand("devices")
  })

voice
  .command("test")
  .description("Test voice input (record 3s and transcribe)")
  .option("-d, --device <id>", "Device ID to use")
  .action(async (options) => {
    await voiceCommand("test", undefined, undefined, {
      device: options.device,
    })
  })

voice
  .command("recording")
  .description("Test recording only (no transcription)")
  .option("-d, --device <id>", "Device ID to use")
  .option("-t, --duration <seconds>", "Recording duration in seconds", "5")
  .action(async (options) => {
    await voiceCommand("recording", undefined, undefined, {
      device: options.device,
      duration: parseInt(options.duration, 10),
    })
  })

voice
  .command("setup")
  .description("First-time setup wizard for voice input")
  .action(async () => {
    await voiceCommand("setup")
  })

voice
  .command("record")
  .description("Record voice with VAD (same as running jfl voice)")
  .option("-d, --device <id>", "Device ID to use")
  .action(async (options) => {
    await voiceCommand("record", undefined, undefined, {
      device: options.device,
    })
  })

voice
  .command("help")
  .description("Show voice command help")
  .action(async () => {
    await voiceCommand("help")
  })

voice
  .command("hotkey")
  .description("Start global hotkey listener (macOS only)")
  .option("-d, --device <id>", "Device ID to use")
  .option("-m, --mode <mode>", "Hotkey mode: auto, tap, or hold (default: auto)")
  .action(async (options) => {
    await voiceCommand("hotkey", undefined, undefined, {
      device: options.device,
      mode: options.mode,
    })
  })

// VS-013: Daemon commands for background hotkey listening
const daemon = voice
  .command("daemon")
  .description("Background hotkey listener daemon (macOS only)")

daemon
  .command("start")
  .description("Start hotkey listener in background")
  .option("-m, --mode <mode>", "Hotkey mode: auto, tap, or hold (default: auto)")
  .action(async (options) => {
    await voiceCommand("daemon", "start", undefined, {
      mode: options.mode,
    })
  })

daemon
  .command("stop")
  .description("Stop the background daemon")
  .action(async () => {
    await voiceCommand("daemon", "stop")
  })

daemon
  .command("status")
  .description("Show daemon status and uptime")
  .action(async () => {
    await voiceCommand("daemon", "status")
  })

// Default daemon action (show status)
daemon.action(async () => {
  await voiceCommand("daemon", "status")
})

// Running `jfl voice` without subcommand starts recording with VAD
voice
  .option("-d, --device <id>", "Device ID to use")
  .action(async (options) => {
    await voiceCommand(undefined, undefined, undefined, {
      device: options.device,
    })
  })

// ============================================================================
// MEMORY SYSTEM (work offline)
// ============================================================================

const memory = program.command("memory").description("Memory system management")

memory
  .command("init")
  .description("Initialize memory database")
  .action(memoryInitCommand)

memory
  .command("status")
  .description("Show memory statistics")
  .action(memoryStatusCommand)

memory
  .command("search <query>")
  .description("Search memories")
  .option("-t, --type <type>", "Filter by type (feature, fix, decision, etc.)")
  .option("-n, --max <n>", "Maximum results", "10")
  .action(memorySearchCommand)

memory
  .command("index")
  .description("Reindex journal entries")
  .option("-f, --force", "Force full reindex")
  .action(memoryIndexCommand)

// Alias: jfl ask <question> → jfl memory search <question>
program
  .command("ask <question>")
  .description("Ask a question - searches memory system")
  .option("-t, --type <type>", "Filter by type (feature, fix, decision, etc.)")
  .option("-n, --max <n>", "Maximum results", "5")
  .action(async (question, options) => {
    await memorySearchCommand(question, options)
  })

// ============================================================================
// SKILL SHORTCUTS (work offline)
// ============================================================================

program
  .command("brand")
  .description("Run brand architect skill")
  .argument("[subcommand]", "marks, colors, typography, or full")
  .action(async (subcommand) => {
    console.log(chalk.cyan("Running /brand-architect..."))
    console.log(chalk.gray("This skill runs in your Claude Code session."))
    console.log(chalk.yellow("\nRun in Claude Code:"), "/brand-architect", subcommand || "")
  })

program
  .command("content")
  .description("Run content creator skill")
  .argument("<type>", "thread, post, article, or one-pager")
  .argument("[topic]", "Topic for content")
  .action(async (type, topic) => {
    console.log(chalk.cyan("Running /content..."))
    console.log(chalk.gray("This skill runs in your Claude Code session."))
    console.log(chalk.yellow("\nRun in Claude Code:"), "/content", type, topic || "")
  })

// ============================================================================
// RALPH TUI (autonomous task execution)
// ============================================================================

program
  .command("ralph")
  .description("AI agent loop orchestrator (ralph-tui)")
  .argument("[command...]", "ralph-tui command and args")
  .option("-h, --help", "Show ralph-tui help")
  .allowUnknownOption()
  .action(async (args, options) => {
    if (options.help || args.length === 0) {
      showRalphHelp()
      return
    }
    await ralphCommand(args)
  })

program
  .command("peter")
  .description("Peter Parker - model-routed agent orchestrator")
  .argument("[action]", "setup, run, or status")
  .option("--cost", "Cost-optimized model routing (haiku-heavy)")
  .option("--balanced", "Balanced model routing (default)")
  .option("--quality", "Quality-first model routing (opus-heavy)")
  .option("-t, --task <task>", "Task to run (for run action)")
  .action(async (action, options) => {
    await peterCommand(action, options)
  })

// ============================================================================
// TEST MODE (for development)
// ============================================================================

program
  .command("test")
  .description("Test onboarding flow (isolated environment)")
  .action(() => {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = join(__filename, "..")
    const scriptPath = join(__dirname, "../scripts/test-onboarding.sh")

    const test = spawn("bash", [scriptPath], {
      stdio: "inherit",
    })

    test.on("error", (err: Error) => {
      console.log(chalk.red("\n❌ Failed to launch test mode"))
      console.log(chalk.gray("  Make sure the test script exists at: scripts/test-onboarding.sh"))
    })
  })

// ============================================================================
// CLAWDBOT INTEGRATION
// ============================================================================

const clawdbot = program.command("clawdbot").description("Manage JFL plugin for Clawdbot gateway")

clawdbot
  .command("setup")
  .description("Install JFL plugin into Clawdbot and configure it")
  .action(clawdbotSetupCommand)

clawdbot
  .command("status")
  .description("Show JFL Clawdbot plugin installation status")
  .action(clawdbotStatusCommand)

// Default action: show status
clawdbot.action(clawdbotStatusCommand)

// ============================================================================
// OPENCLAW (runtime-agnostic agent protocol)
// ============================================================================

const openclaw = program.command("openclaw").description("OpenClaw agent protocol - runtime-agnostic JFL integration")

openclaw
  .command("session-start")
  .description("Start an agent session (branch, auto-commit, Context Hub)")
  .requiredOption("-a, --agent <name>", "Agent name/ID")
  .option("-g, --gtm <path>", "GTM workspace path")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { sessionStartCommand } = await import("./commands/openclaw.js")
    await sessionStartCommand(options)
  })

openclaw
  .command("session-end")
  .description("End session (commit, merge, cleanup)")
  .option("-s, --sync", "Sync to GTM parent (for services)")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { sessionEndCommand } = await import("./commands/openclaw.js")
    await sessionEndCommand(options)
  })

openclaw
  .command("heartbeat")
  .description("Health pulse (auto-commit, check Context Hub)")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { heartbeatCommand: openclawHeartbeat } = await import("./commands/openclaw.js")
    await openclawHeartbeat(options)
  })

openclaw
  .command("context")
  .description("Get unified context from Context Hub")
  .option("-q, --query <query>", "Search query")
  .option("-t, --task-type <type>", "Task type (code, spec, content, strategy, general)")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { contextCommand } = await import("./commands/openclaw.js")
    await contextCommand(options)
  })

openclaw
  .command("journal")
  .description("Write a journal entry")
  .requiredOption("--type <type>", "Entry type (feature, fix, decision, milestone, spec, discovery)")
  .requiredOption("--title <title>", "Entry title")
  .requiredOption("--summary <summary>", "Entry summary")
  .option("--detail <detail>", "Full detail")
  .option("--files <files>", "Comma-separated file paths")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { journalCommand } = await import("./commands/openclaw.js")
    await journalCommand(options)
  })

openclaw
  .command("status")
  .description("Show agent session state and health")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { statusCommand: openclawStatus } = await import("./commands/openclaw.js")
    await openclawStatus(options)
  })

openclaw
  .command("gtm-list")
  .description("List registered GTM workspaces")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { gtmListCommand } = await import("./commands/openclaw.js")
    await gtmListCommand(options)
  })

openclaw
  .command("gtm-switch")
  .description("Switch active GTM workspace")
  .argument("<gtm-id>", "GTM ID to switch to")
  .option("--json", "Output JSON")
  .action(async (gtmId, options) => {
    const { gtmSwitchCommand } = await import("./commands/openclaw.js")
    await gtmSwitchCommand(gtmId, options)
  })

openclaw
  .command("gtm-create")
  .description("Create and register a new GTM workspace")
  .argument("<name>", "GTM workspace name")
  .option("-p, --path <dir>", "Target directory")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const { gtmCreateCommand } = await import("./commands/openclaw.js")
    await gtmCreateCommand(name, options)
  })

openclaw
  .command("register")
  .description("Register agent with a GTM workspace")
  .requiredOption("-g, --gtm <path>", "GTM workspace path")
  .option("-a, --agent <name>", "Agent name (auto-detected from manifest)")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const { registerCommand } = await import("./commands/openclaw.js")
    await registerCommand(options)
  })

openclaw
  .command("tag")
  .description("Send message to a service agent")
  .argument("<service>", "Service name")
  .argument("<message>", "Message to send")
  .option("--json", "Output JSON")
  .action(async (service, message, options) => {
    const { tagCommand } = await import("./commands/openclaw.js")
    await tagCommand(service, message, options)
  })

// ============================================================================
// HELP
// ============================================================================
// GTM COMMANDS
// ============================================================================

const gtm = program.command("gtm").description("GTM workspace management")

gtm
  .command("process-service-update [event-file]")
  .description("Process service sync notification (called by hooks)")
  .action(async (eventFile) => {
    const { gtmProcessUpdate } = await import("./commands/gtm-process-update.js")
    await gtmProcessUpdate(eventFile)
  })

// ============================================================================

program
  .command("help")
  .description("Show help")
  .action(() => {
    console.log(chalk.bold("\n  JFL - Just Fucking Launch\n"))
    console.log(chalk.gray("  Your team's context layer. Any AI. Any task.\n"))

    console.log(chalk.cyan("  Free Tier (works offline):"))
    console.log("    jfl init              Initialize project")
    console.log("    jfl repair            Repair missing .jfl directory")
    console.log("    jfl validate-settings Validate .claude/settings.json")
    console.log("    jfl update            Pull latest JFL updates")
    console.log("    jfl profile           Manage your profile")
    console.log("    jfl profile generate  Generate CLAUDE.md w/ AI")
    console.log("    jfl hud               Project dashboard")
    console.log("    jfl status            Project status")
    console.log("    jfl onboard           Onboard service as agent")
    console.log("    jfl services          Manage services")
    console.log("    jfl brand             Brand architect")
    console.log("    jfl content           Content creator")
    console.log("    jfl voice             Voice input commands")
    console.log("    jfl ralph             AI agent loop (ralph-tui)")
    console.log("    jfl peter             Peter Parker orchestrator (model routing)")
    console.log("    jfl context-hub       Context Hub (unified AI context + MAP event bus)")
    console.log("    jfl openclaw          OpenClaw agent protocol")
    console.log("    jfl test              Test onboarding (isolated)")

    console.log(chalk.cyan("\n  Platform (requires login):"))
    console.log("    jfl login             Login to platform")
    console.log("    jfl deploy            Deploy to platform")
    console.log("    jfl agents            Parallel agents (Pro)")

    console.log(chalk.gray("\n  Pricing (pay when you get value):"))
    console.log("    Trial   $0      Free until foundation + brand done")
    console.log("    x402    $5/day  Per person, pay as you go")
    console.log("    Solo    $49/mo  Just you, fixed monthly")
    console.log("    Pro     $199/mo Team (up to 5, +$25/seat)")

    console.log(chalk.gray("\n  Learn more: https://jfl.run"))
    console.log()
  })

// Parse and run
program.parse()
