#!/usr/bin/env node
/**
 * JFL CLI - Just Fucking Launch
 *
 * Free tier: Works standalone with BYOAI
 * Paid tier: Connects to platform for dashboard, integrations, hosted agents
 */

import { Command } from "commander"
import chalk from "chalk"
import { initCommand } from "./commands/init.js"
import { repairCommand } from "./commands/repair.js"
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
import {
  listSkillsCommand,
  installSkillCommand,
  removeSkillCommand,
  updateSkillsCommand,
  searchSkillsCommand,
} from "./commands/skills.js"
import { ralphCommand, showRalphHelp } from "./commands/ralph.js"
import {
  ensureDayPass,
  showDayPassStatus,
  requiresPayment,
  hasWallet,
  getWalletAddress,
} from "./utils/auth-guard.js"
import { getDayPassTimeRemaining } from "./utils/x402-client.js"

const program = new Command()

program
  .name("jfl")
  .description("Just Fucking Launch - AI-powered GTM and development")
  .version("0.0.0")
  .option("-u, --update", "Pull latest JFL updates before starting")
  .action(async (options) => {
    // If --update flag, run update first
    if (options.update) {
      await updateCommand()
      console.log() // Add spacing before session starts
    }
    await sessionCommand()
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
  .command("hud")
  .description("Show campaign dashboard")
  .option("-c, --compact", "Show compact one-line status")
  .action(hudCommand)

program
  .command("status")
  .description("Show project status")
  .action(statusCommand)

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

program
  .command("context-hub")
  .description("Manage Context Hub daemon")
  .argument("[action]", "start, stop, restart, status, ensure, query")
  .option("-p, --port <port>", "Port to run on", "4242")
  .action((action, options) => contextHubCommand(action, { port: parseInt(options.port) }))

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

// ============================================================================
// HELP
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
    console.log("    jfl update            Pull latest JFL updates")
    console.log("    jfl hud               Project dashboard")
    console.log("    jfl status            Project status")
    console.log("    jfl brand             Brand architect")
    console.log("    jfl content           Content creator")
<<<<<<< HEAD
    console.log("    jfl ralph             AI agent loop (ralph-tui)")
=======
    console.log("    jfl voice             Voice input commands")
>>>>>>> origin/main

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
