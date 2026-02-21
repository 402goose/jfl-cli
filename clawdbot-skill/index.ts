/**
 * JFL GTM Clawdbot Skill
 *
 * Uses OpenClaw protocol for session management, context, journaling, and coordination.
 * Auto-installs jfl CLI if missing. Auto-registers agent with GTM on first use.
 *
 * @purpose Clawdbot skill using OpenClaw for full JFL integration
 * @spec specs/OPENCLAW_SPEC.md
 */

import { exec } from "child_process"
import { promisify } from "util"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
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

interface SessionState {
  gtmPath: string
  gtmName: string
  agentId: string
  sessionBranch: string | null
}

// ============================================================================
// State persistence
// ============================================================================

const STATE_DIR = join(homedir(), ".clawd", "memory")
const STATE_FILE = join(STATE_DIR, "jfl-openclaw.json")

function loadState(): Map<string, SessionState> {
  try {
    if (existsSync(STATE_FILE)) {
      return new Map(Object.entries(JSON.parse(readFileSync(STATE_FILE, "utf-8"))))
    }
  } catch { /* ignore */ }
  return new Map()
}

function saveState(state: Map<string, SessionState>) {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(state), null, 2))
}

const state = loadState()

function getState(threadId: string): SessionState | undefined {
  return state.get(threadId)
}

function setState(threadId: string, s: SessionState) {
  state.set(threadId, s)
  saveState(state)
}

// ============================================================================
// OpenClaw helpers
// ============================================================================

async function openclaw(cmd: string): Promise<string> {
  const { stdout } = await execAsync(`jfl openclaw ${cmd}`, {
    timeout: 30000,
    env: { ...process.env },
  })
  return stdout.trim()
}

async function openclawJSON(cmd: string): Promise<any> {
  const raw = await openclaw(`${cmd} --json`)
  return JSON.parse(raw)
}

async function ensureJFL(): Promise<boolean> {
  try {
    await execAsync("jfl --version", { timeout: 5000 })
    return true
  } catch {
    // Try to install
    try {
      await execAsync("npm install -g jfl", { timeout: 60000 })
      return true
    } catch {
      return false
    }
  }
}

function agentId(ctx: Context): string {
  return `clawd-${ctx.platform}-${ctx.userId}`.slice(0, 30)
}

// ============================================================================
// Boot
// ============================================================================

export async function onBoot(ctx: Context) {
  const hasJFL = await ensureJFL()
  if (!hasJFL) {
    return {
      text: "JFL CLI not found and auto-install failed.\n\nInstall manually: npm install -g jfl\nThen run /jfl again",
      buttons: [],
    }
  }

  // Check if already connected
  const existing = getState(ctx.threadId)
  if (existing?.sessionBranch) {
    // Resume existing session
    return await showDashboard(existing)
  }

  // Find GTMs
  const gtms = await findGTMs()
  if (gtms.length === 0) {
    return {
      text: "JFL - Just Fucking Launch\n\nNo GTM workspaces found.\n\nCreate one:\n  jfl init -n 'My Project'\n\nThen run /jfl again",
    }
  }

  const buttons = gtms.map((g) => ({
    text: g.name,
    callbackData: `select:${g.path}`,
  }))

  return {
    text: "JFL - Just Fucking Launch\n\nSelect a project:",
    buttons,
  }
}

// ============================================================================
// GTM selection + auto-register + session start
// ============================================================================

async function handleSelectGTM(gtmPath: string, ctx: Context) {
  const agent = agentId(ctx)
  const gtmName = gtmPath.split("/").pop() || "unknown"

  try {
    // Register agent with GTM (idempotent)
    await openclawJSON(`register -g "${gtmPath}" -a ${agent}`)

    // Start session
    const session = await openclawJSON(`session-start -a ${agent} -g "${gtmPath}"`)

    setState(ctx.threadId, {
      gtmPath,
      gtmName,
      agentId: agent,
      sessionBranch: session.session_id,
    })

    return await showDashboard({
      gtmPath,
      gtmName,
      agentId: agent,
      sessionBranch: session.session_id,
    })
  } catch (error: any) {
    return { text: `Failed to start session\n\n${error.message}` }
  }
}

// ============================================================================
// Dashboard
// ============================================================================

async function showDashboard(s: SessionState) {
  let contextSummary = ""
  try {
    const items = await openclawJSON(`context -q "current priorities"`)
    if (Array.isArray(items) && items.length > 0) {
      contextSummary = items
        .slice(0, 3)
        .map((i: any) => `  ${i.title}`)
        .join("\n")
    }
  } catch { /* hub may be down */ }

  const text = [
    `${s.gtmName}`,
    `Session: ${s.sessionBranch || "none"}`,
    "",
    contextSummary ? `Recent context:\n${contextSummary}` : "",
    "",
    "What do you want to do?",
  ].filter(Boolean).join("\n")

  return {
    text,
    buttons: [
      [
        { text: "Dashboard", callbackData: "cmd:hud" },
        { text: "CRM", callbackData: "cmd:crm" },
      ],
      [
        { text: "Context", callbackData: "cmd:context" },
        { text: "Status", callbackData: "cmd:status" },
      ],
      [
        { text: "Brand", callbackData: "cmd:brand" },
        { text: "Content", callbackData: "cmd:content" },
      ],
    ],
  }
}

// ============================================================================
// Callbacks
// ============================================================================

export async function onCallback(data: string, ctx: Context) {
  const [action, value] = data.split(":")

  if (action === "select") return await handleSelectGTM(value, ctx)
  if (action === "cmd") return await handleCommand(value, ctx)

  return { text: "Unknown action" }
}

async function handleCommand(cmd: string, ctx: Context) {
  const s = getState(ctx.threadId)
  if (!s) return { text: "No session. Run /jfl to select a project." }

  switch (cmd) {
    case "hud":
      return await runInGTM(s, "jfl hud")
    case "crm":
      return showCRMMenu()
    case "context":
      return await runContext(s)
    case "status":
      return await runStatus(s)
    case "brand":
      return showBrandMenu()
    case "content":
      return showContentMenu()
    default:
      return { text: "Unknown command" }
  }
}

// ============================================================================
// Commands
// ============================================================================

export async function onCommand(cmd: string, args: string[], ctx: Context) {
  const s = getState(ctx.threadId)

  if (cmd === "jfl" || cmd === "gtm") return await onBoot(ctx)

  if (!s) return { text: "No session active. Run /jfl to select a project." }

  switch (cmd) {
    case "hud":
      return await runInGTM(s, "jfl hud")

    case "crm":
      if (args.length === 0) return showCRMMenu()
      return await runInGTM(s, `./crm ${args.join(" ")}`)

    case "context":
      if (args.length === 0) return await runContext(s)
      return await runContextQuery(s, args.join(" "))

    case "journal": {
      const type = args[0] || "discovery"
      const title = args.slice(1).join(" ") || "Note"
      await openclaw(`journal --type ${type} --title "${title}" --summary "${title}"`)
      return { text: `Journal entry written: ${title}` }
    }

    case "brand":
      return showBrandMenu()

    case "content":
      if (args.length === 0) return showContentMenu()
      return await runInGTM(s, `jfl content ${args.join(" ")}`)

    default:
      return { text: `Unknown command: /${cmd}` }
  }
}

// ============================================================================
// Runners
// ============================================================================

async function runInGTM(s: SessionState, command: string): Promise<any> {
  try {
    const { stdout } = await execAsync(command, {
      cwd: s.gtmPath,
      timeout: 30000,
      env: { ...process.env },
    })
    return { text: stripAnsi(stdout).slice(0, 4000), parseMode: "Markdown" }
  } catch (error: any) {
    return { text: `Command failed: ${error.message}` }
  }
}

async function runContext(s: SessionState) {
  try {
    const items = await openclawJSON("context")
    if (!Array.isArray(items) || items.length === 0) {
      return { text: "No context items found. Context Hub may not be running.\n\nStart it: jfl context-hub start" }
    }
    const lines = items.slice(0, 8).map((i: any) =>
      `[${i.source || i.type}] ${i.title}\n  ${(i.content || "").slice(0, 100)}`
    )
    return { text: `Project Context\n\n${lines.join("\n\n")}` }
  } catch (error: any) {
    return { text: `Context Hub unreachable: ${error.message}` }
  }
}

async function runContextQuery(s: SessionState, query: string) {
  try {
    const items = await openclawJSON(`context -q "${query}"`)
    if (!Array.isArray(items) || items.length === 0) {
      return { text: `No results for: ${query}` }
    }
    const lines = items.slice(0, 5).map((i: any) =>
      `[${i.source || i.type}] ${i.title}\n  ${(i.content || "").slice(0, 120)}`
    )
    return { text: `Results for "${query}"\n\n${lines.join("\n\n")}` }
  } catch (error: any) {
    return { text: `Search failed: ${error.message}` }
  }
}

async function runStatus(s: SessionState) {
  try {
    const status = await openclawJSON("status")
    const lines = [
      `Agent: ${status.agent || "none"}`,
      `Session: ${status.session?.branch || "none"}`,
      `GTM: ${status.gtm_name || "unknown"}`,
      `Context Hub: ${status.context_hub?.healthy ? "healthy" : "unreachable"}`,
      `Agents: ${status.registered_agents?.length || 0} registered`,
    ]
    return { text: `OpenClaw Status\n\n${lines.join("\n")}` }
  } catch (error: any) {
    return { text: `Status failed: ${error.message}` }
  }
}

// ============================================================================
// Menus
// ============================================================================

function showCRMMenu() {
  return {
    text: "CRM\n\nWhat do you want to do?",
    buttons: [
      [
        { text: "Pipeline", callbackData: "crm:list" },
        { text: "Stale Deals", callbackData: "crm:stale" },
      ],
      [
        { text: "Prep Call", callbackData: "crm:prep" },
        { text: "Log Touch", callbackData: "crm:touch" },
      ],
    ],
  }
}

function showBrandMenu() {
  return {
    text: "Brand Architect\n\nWhat do you want to create?",
    buttons: [
      [
        { text: "Logo Marks", callbackData: "brand:marks" },
        { text: "Colors", callbackData: "brand:colors" },
      ],
      [
        { text: "Typography", callbackData: "brand:typography" },
        { text: "Full System", callbackData: "brand:full" },
      ],
    ],
  }
}

function showContentMenu() {
  return {
    text: "Content Creator\n\nWhat do you want to create?",
    buttons: [
      [
        { text: "Thread", callbackData: "content:thread" },
        { text: "Post", callbackData: "content:post" },
      ],
      [
        { text: "Article", callbackData: "content:article" },
        { text: "One-Pager", callbackData: "content:onepager" },
      ],
    ],
  }
}

// ============================================================================
// GTM discovery
// ============================================================================

async function findGTMs(): Promise<GTM[]> {
  // First try OpenClaw registry
  try {
    const gtms = await openclawJSON("gtm-list")
    if (Array.isArray(gtms) && gtms.length > 0) {
      return gtms.map((g: any) => ({ name: g.name, path: g.path }))
    }
  } catch { /* fall through to filesystem scan */ }

  // Fallback: scan filesystem
  const gtms: GTM[] = []
  const searchPaths = [
    join(homedir(), "CascadeProjects"),
    join(homedir(), "Projects"),
    join(homedir(), "code"),
  ]

  for (const basePath of searchPaths) {
    if (!existsSync(basePath)) continue
    try {
      const { stdout } = await execAsync(
        `find "${basePath}" -maxdepth 2 -name .jfl -type d 2>/dev/null`
      )
      for (const dir of stdout.trim().split("\n").filter(Boolean)) {
        const gtmPath = dir.replace("/.jfl", "")
        if (existsSync(join(gtmPath, "knowledge")) && existsSync(join(gtmPath, "CLAUDE.md"))) {
          gtms.push({ name: gtmPath.split("/").pop() || "unknown", path: gtmPath })
        }
      }
    } catch { /* skip */ }
  }

  return gtms
}

// ============================================================================
// Util
// ============================================================================

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "")
}

export default { onBoot, onCallback, onCommand }
