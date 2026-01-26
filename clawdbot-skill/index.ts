/**
 * JFL GTM Clawdbot Skill
 *
 * Thin wrapper around jfl CLI - just shells out to actual commands.
 * No custom session management - uses jfl's built-in worktree system.
 */

import { exec } from "child_process"
import { promisify } from "util"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const execAsync = promisify(exec)

interface Context {
  threadId: string
  platform: "telegram" | "slack" | "discord"
  userId: string
}

interface GTM {
  name: string
  path: string
}

/**
 * Boot sequence - runs when skill first activates
 */
export async function onBoot(ctx: Context) {
  // Check if JFL CLI is installed
  const hasJFL = await checkJFLInstalled()

  if (!hasJFL) {
    return {
      text: "⚠️ JFL CLI not found\n\n" +
            "Install: npm install -g jfl\n\n" +
            "Then run /jfl again",
      buttons: []
    }
  }

  // Find available GTMs
  const gtms = await findGTMs()

  if (gtms.length === 0) {
    return {
      text: "🚀 JFL - Just Fucking Launch\n\n" +
            "No GTMs found.\n\n" +
            "Create one: jfl init\n" +
            "Then run /jfl again"
    }
  }

  // Show GTM picker (like screenshot)
  const buttons = gtms.map(g => ({
    text: `📂 ${g.name}`,
    callbackData: `select:${g.path}`
  }))

  return {
    text: "🚀 JFL - Just Fucking Launch\n\n" +
          "Your team's context layer. Any AI. Any task.\n\n" +
          "Open a project:",
    buttons
  }
}

/**
 * Handle button clicks
 */
export async function onCallback(data: string, ctx: Context) {
  const [action, value] = data.split(":")

  if (action === "select") {
    return await handleSelectGTM(value, ctx)
  }

  if (action === "cmd") {
    return await handleCommand(value, ctx)
  }

  return { text: "Unknown action" }
}

/**
 * Handle slash commands
 */
export async function onCommand(cmd: string, args: string[], ctx: Context) {
  const session = getSession(ctx.threadId)

  if (!session && cmd !== "gtm") {
    return {
      text: "⚠️ No GTM selected.\n\nRun /jfl to select a project."
    }
  }

  switch (cmd) {
    case "gtm":
      return await onBoot(ctx)

    case "hud":
      return await runJFLCommand(session!, "hud")

    case "crm":
      if (args.length === 0) {
        return showCRMMenu()
      }
      return await runCRMCommand(session!, args)

    case "brand":
      return showBrandMenu()

    case "content":
      if (args.length === 0) {
        return showContentMenu()
      }
      return await runJFLCommand(session!, `content ${args.join(" ")}`)

    default:
      return { text: `Unknown command: /${cmd}` }
  }
}

/**
 * Check if JFL CLI is installed
 */
async function checkJFLInstalled(): Promise<boolean> {
  try {
    await execAsync("jfl --version")
    return true
  } catch {
    return false
  }
}

/**
 * Find GTMs on this machine
 */
async function findGTMs(): Promise<GTM[]> {
  const gtms: GTM[] = []

  // Strategy 1: Check common locations
  const searchPaths = [
    join(homedir(), "CascadeProjects"),
    join(homedir(), "Projects"),
    join(homedir(), "code"),
  ]

  for (const basePath of searchPaths) {
    if (!existsSync(basePath)) continue

    try {
      const { stdout } = await execAsync(`find ${basePath} -maxdepth 2 -name .jfl -type d`)
      const dirs = stdout.trim().split("\n").filter(Boolean)

      for (const dir of dirs) {
        const gtmPath = dir.replace("/.jfl", "")
        const name = gtmPath.split("/").pop() || "unknown"
        gtms.push({ name, path: gtmPath })
      }
    } catch {
      // Skip if find fails
    }
  }

  return gtms
}

/**
 * Session storage (in-memory for now)
 */
const sessions = new Map<string, { gtmPath: string; gtmName: string; worktree?: string }>()

function getSession(threadId: string) {
  return sessions.get(threadId)
}

function setSession(threadId: string, gtmPath: string, gtmName: string) {
  sessions.set(threadId, { gtmPath, gtmName })
}

/**
 * Handle GTM selection
 */
async function handleSelectGTM(gtmPath: string, ctx: Context) {
  const gtmName = gtmPath.split("/").pop() || "unknown"

  // Store session
  setSession(ctx.threadId, gtmPath, gtmName)

  // Show command menu
  const commands = [
    [
      { text: "📊 Dashboard", callbackData: "cmd:hud" },
      { text: "👥 CRM", callbackData: "cmd:crm" }
    ],
    [
      { text: "🎨 Brand", callbackData: "cmd:brand" },
      { text: "✍️ Content", callbackData: "cmd:content" }
    ],
    [
      { text: "🔄 Sync", callbackData: "cmd:sync" },
      { text: "📝 Status", callbackData: "cmd:status" }
    ]
  ]

  return {
    text: `✓ Opened ${gtmName}\n\n` +
          `Path: ${gtmPath}\n\n` +
          `What do you want to do?`,
    buttons: commands
  }
}

/**
 * Handle command button
 */
async function handleCommand(cmd: string, ctx: Context) {
  const session = getSession(ctx.threadId)

  if (!session) {
    return { text: "⚠️ Session expired. Run /jfl to select a GTM." }
  }

  switch (cmd) {
    case "hud":
      return await runJFLCommand(session, "hud")

    case "crm":
      return showCRMMenu()

    case "brand":
      return showBrandMenu()

    case "content":
      return showContentMenu()

    case "sync":
      return await runGitSync(session)

    case "status":
      return await runGitStatus(session)

    default:
      return { text: "Unknown command" }
  }
}

/**
 * Run JFL command (actual CLI)
 */
async function runJFLCommand(session: any, command: string) {
  try {
    const { stdout, stderr } = await execAsync(`cd ${session.gtmPath} && jfl ${command}`, {
      env: { ...process.env, JFL_PLATFORM: "telegram" }
    })

    const output = stdout || stderr
    const formatted = formatForTelegram(output)

    return {
      text: formatted,
      parseMode: "Markdown"
    }
  } catch (error: any) {
    return {
      text: `❌ Error running jfl ${command}\n\n${error.message}`
    }
  }
}

/**
 * Run CRM command (actual ./crm script)
 */
async function runCRMCommand(session: any, args: string[]) {
  try {
    const { stdout } = await execAsync(`cd ${session.gtmPath} && ./crm ${args.join(" ")}`)
    const formatted = formatForTelegram(stdout)

    return {
      text: formatted,
      parseMode: "Markdown"
    }
  } catch (error: any) {
    return {
      text: `❌ Error running crm\n\n${error.message}`
    }
  }
}

/**
 * Show CRM menu
 */
function showCRMMenu() {
  return {
    text: "👥 CRM\n\nWhat do you want to do?",
    buttons: [
      [
        { text: "📋 List Pipeline", callbackData: "crm:list" },
        { text: "⏰ Stale Deals", callbackData: "crm:stale" }
      ],
      [
        { text: "📞 Prep Call", callbackData: "crm:prep" },
        { text: "✏️ Log Touch", callbackData: "crm:touch" }
      ]
    ]
  }
}

/**
 * Show brand menu
 */
function showBrandMenu() {
  return {
    text: "🎨 Brand Architect\n\nWhat do you want to create?",
    buttons: [
      [
        { text: "Logo Marks", callbackData: "brand:marks" },
        { text: "Color Palette", callbackData: "brand:colors" }
      ],
      [
        { text: "Typography", callbackData: "brand:typography" },
        { text: "Full System", callbackData: "brand:full" }
      ]
    ]
  }
}

/**
 * Show content menu
 */
function showContentMenu() {
  return {
    text: "✍️ Content Creator\n\nWhat do you want to create?",
    buttons: [
      [
        { text: "Twitter Thread", callbackData: "content:thread" },
        { text: "Single Post", callbackData: "content:post" }
      ],
      [
        { text: "Article", callbackData: "content:article" },
        { text: "One-Pager", callbackData: "content:onepager" }
      ]
    ]
  }
}

/**
 * Git sync
 */
async function runGitSync(session: any) {
  try {
    const { stdout } = await execAsync(
      `cd ${session.gtmPath} && ./product/scripts/session/session-sync.sh`
    )

    return {
      text: `✓ Synced ${session.gtmName}\n\n${stdout}`
    }
  } catch (error: any) {
    return {
      text: `❌ Sync failed\n\n${error.message}`
    }
  }
}

/**
 * Git status
 */
async function runGitStatus(session: any) {
  try {
    const { stdout } = await execAsync(
      `cd ${session.gtmPath} && git status --short && echo '---' && git log --oneline -5`
    )

    return {
      text: `📊 Status: ${session.gtmName}\n\n\`\`\`\n${stdout}\n\`\`\``,
      parseMode: "Markdown"
    }
  } catch (error: any) {
    return {
      text: `❌ Status failed\n\n${error.message}`
    }
  }
}

/**
 * Format CLI output for Telegram
 */
function formatForTelegram(output: string): string {
  return output
    // Strip ANSI color codes
    .replace(/\x1b\[[0-9;]*m/g, "")
    // Convert box-drawing to ASCII
    .replace(/[━─]/g, "-")
    .replace(/[│┃]/g, "|")
    .replace(/[┌┐└┘├┤┬┴┼]/g, "+")
    // Preserve emoji
    .trim()
}

export default {
  onBoot,
  onCallback,
  onCommand
}
