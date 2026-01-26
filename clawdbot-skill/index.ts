/**
 * JFL GTM Clawdbot Skill
 *
 * Provides full JFL CLI access from Telegram/Slack with proper session isolation.
 * Uses `jfl session create` and `jfl session exec` for worktree isolation, auto-commit, and journaling.
 * Session state persisted to ~/.clawd/memory/jfl-sessions.json
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
 *
 * A GTM has: .jfl/ + knowledge/ + CLAUDE.md
 * Product repos (jfl-cli, jfl-platform) have .jfl/ but aren't GTMs
 */
async function findGTMs(): Promise<GTM[]> {
  const gtms: GTM[] = []

  // Check common locations
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

        // Filter: Must have knowledge/ and CLAUDE.md to be a GTM
        const hasKnowledge = existsSync(join(gtmPath, "knowledge"))
        const hasClaude = existsSync(join(gtmPath, "CLAUDE.md"))

        if (!hasKnowledge || !hasClaude) {
          continue // Skip product repos
        }

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
 * Session storage (persisted to disk)
 */
const SESSIONS_FILE = join(homedir(), ".clawd", "memory", "jfl-sessions.json")

interface SessionData {
  gtmPath: string
  gtmName: string
  sessionId: string
  platform: string
}

function loadSessions(): Map<string, SessionData> {
  try {
    if (existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(readFileSync(SESSIONS_FILE, "utf-8"))
      return new Map(Object.entries(data))
    }
  } catch {
    // Ignore parse errors
  }
  return new Map()
}

function saveSessions(sessions: Map<string, SessionData>) {
  try {
    const data = Object.fromEntries(sessions)
    const fs = require("fs")
    fs.mkdirSync(join(homedir(), ".clawd", "memory"), { recursive: true })
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2))
  } catch (error) {
    console.error("Failed to save sessions:", error)
  }
}

const sessions = loadSessions()

function getSession(threadId: string) {
  return sessions.get(threadId)
}

function setSession(threadId: string, data: SessionData) {
  sessions.set(threadId, data)
  saveSessions(sessions)
}

/**
 * Handle GTM selection
 */
async function handleSelectGTM(gtmPath: string, ctx: Context) {
  const gtmName = gtmPath.split("/").pop() || "unknown"

  try {
    // Create or get session with proper worktree isolation
    const { stdout } = await execAsync(
      `cd ${gtmPath} && jfl session create --platform ${ctx.platform} --thread ${ctx.threadId}`
    )
    const sessionId = stdout.trim()

    // Store session with ID
    setSession(ctx.threadId, {
      gtmPath,
      gtmName,
      sessionId,
      platform: ctx.platform
    })

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
      text: `✓ Session created: ${gtmName}\n\n` +
            `Session ID: ${sessionId}\n` +
            `Isolated worktree with auto-commit enabled.\n\n` +
            `What do you want to do?`,
      buttons: commands
    }
  } catch (error: any) {
    return {
      text: `❌ Failed to create session\n\n${error.message}\n\n` +
            `Make sure you're in a JFL GTM directory.`
    }
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
 * Run JFL command (uses session exec for isolation)
 */
async function runJFLCommand(session: SessionData, command: string) {
  try {
    // Use jfl session exec to run command in isolated worktree
    const { stdout, stderr } = await execAsync(
      `cd ${session.gtmPath} && jfl session exec "${session.sessionId}" "${command}"`,
      {
        env: { ...process.env, JFL_PLATFORM: session.platform }
      }
    )

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
 * Run CRM command (uses session exec for isolation)
 */
async function runCRMCommand(session: SessionData, args: string[]) {
  try {
    // Use session exec to run CRM in isolated worktree
    const { stdout } = await execAsync(
      `cd ${session.gtmPath} && jfl session exec "${session.sessionId}" "./crm ${args.join(" ")}"`
    )
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
 * Git sync (runs in session worktree)
 */
async function runGitSync(session: SessionData) {
  try {
    // Session exec automatically runs session-sync.sh before command
    const { stdout } = await execAsync(
      `cd ${session.gtmPath} && jfl session exec "${session.sessionId}" "git status --short"`
    )

    return {
      text: `✓ Synced ${session.gtmName}\n\nSession-sync runs automatically before each command.\n\n${stdout || "Working tree clean"}`
    }
  } catch (error: any) {
    return {
      text: `❌ Sync failed\n\n${error.message}`
    }
  }
}

/**
 * Git status (runs in session worktree)
 */
async function runGitStatus(session: SessionData) {
  try {
    // Use session exec to check status in isolated worktree
    const { stdout } = await execAsync(
      `cd ${session.gtmPath} && jfl session exec "${session.sessionId}" "git status --short && echo '---' && git log --oneline -5"`
    )

    return {
      text: `📊 Status: ${session.gtmName}\nSession: ${session.sessionId}\n\n\`\`\`\n${stdout}\n\`\`\``,
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
 * Optimized for mobile viewing
 */
function formatForTelegram(output: string): string {
  return output
    // Strip ANSI color codes
    .replace(/\x1b\[[0-9;]*m/g, "")
    // Convert long separator lines to short ones (mobile-friendly)
    .replace(/[━─]{20,}/g, "━━━━━━━━━")
    // Keep single box-drawing characters as-is (they render fine)
    .replace(/[┌┐└┘├┤┬┴┼]/g, "")
    // Convert vertical bars
    .replace(/[│┃]/g, "")
    // Add spacing around emoji headers for readability
    .replace(/^(📊|👥|🎨|✍️|🔄|📝)/gm, "\n$1")
    // Preserve emoji and structure
    .trim()
}

export default {
  onBoot,
  onCallback,
  onCommand
}
