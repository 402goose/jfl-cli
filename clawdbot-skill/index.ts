/**
 * JFL GTM Clawdbot Skill
 *
 * Dormant until user engages via /jfl. Then activates sessions, context,
 * journaling, and coordination via OpenClaw protocol.
 *
 * On install: explains what JFL does and how to use it.
 * On /jfl: lets user pick a GTM workspace, then activates.
 * While active: auto-injects context, captures decisions, auto-commits.
 *
 * @purpose Clawdbot skill using OpenClaw for full JFL integration
 * @spec specs/OPENCLAW_SPEC.md
 */

import { exec } from "child_process"
import { promisify } from "util"
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs"
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
  activated: boolean
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
// Welcome / Intro (shown on first use or install)
// ============================================================================

const WELCOME_MESSAGE = `JFL - Just Fucking Launch

Your project context layer. I track decisions, save context, and keep everything synced across sessions.

What I do when active:
- Search project context before responding
- Capture decisions into the journal automatically
- Auto-commit your work every 2 minutes
- Coordinate with other agents on the team

Commands:
/jfl — Activate / select a project
/context <query> — Search project knowledge
/journal <type> <title> | <summary> — Log work
/hud — Project dashboard

To get started, use /jfl to pick a project.`

const ACTIVATION_MESSAGE = (gtmName: string) => `JFL activated: ${gtmName}

I'll now:
- Search context before each response
- Capture decisions automatically
- Auto-commit work periodically

Commands:
/context <query> — Search project context
/journal <type> <title> | <summary> — Log work
/hud — Project dashboard
/jfl — Status`

// ============================================================================
// Boot (on /jfl command)
// ============================================================================

export async function onBoot(ctx: Context) {
  const hasJFL = await ensureJFL()
  if (!hasJFL) {
    return {
      text: "JFL CLI not found and auto-install failed.\n\nInstall manually:\n  npm install -g jfl\n\nThen run /jfl again.",
    }
  }

  // Check if already activated
  const existing = getState(ctx.threadId)
  if (existing?.activated && existing?.sessionBranch) {
    return await showStatus(existing)
  }

  // Find available GTMs
  const gtms = await findGTMs()
  if (gtms.length === 0) {
    return {
      text: "No GTM workspaces found.\n\nCreate one:\n  jfl init -n 'My Project'\n\nThen run /jfl again.",
    }
  }

  // Single GTM → auto-activate
  if (gtms.length === 1) {
    return await activateGTM(gtms[0].path, ctx)
  }

  // Multiple GTMs → let user pick
  const buttons = gtms.map((g) => ({
    text: g.name,
    callbackData: `select:${g.path}`,
  }))

  return {
    text: "Select a project:",
    buttons,
  }
}

// ============================================================================
// Activation
// ============================================================================

async function activateGTM(gtmPath: string, ctx: Context) {
  const agent = agentId(ctx)

  // Read GTM name from config
  let gtmName = gtmPath.split("/").pop() || "unknown"
  try {
    const cfg = JSON.parse(readFileSync(join(gtmPath, ".jfl", "config.json"), "utf-8"))
    if (cfg.name) gtmName = cfg.name
  } catch {}

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
      activated: true,
    })

    return { text: ACTIVATION_MESSAGE(gtmName) }
  } catch (error: any) {
    // Session start failed but registration may have worked
    setState(ctx.threadId, {
      gtmPath,
      gtmName,
      agentId: agent,
      sessionBranch: null,
      activated: true,
    })
    return { text: `JFL activated: ${gtmName}\n\nSession start failed: ${error.message}\nContext and journaling still work.` }
  }
}

// ============================================================================
// Status (shown when /jfl is called while active)
// ============================================================================

async function showStatus(s: SessionState) {
  let hubStatus = "unknown"
  try {
    const status = await openclawJSON("status")
    hubStatus = status.context_hub?.healthy ? "running" : "offline"
  } catch {
    hubStatus = "offline"
  }

  return {
    text: [
      `JFL active: ${s.gtmName}`,
      `Session: ${s.sessionBranch || "none"}`,
      `Context Hub: ${hubStatus}`,
      ``,
      `Commands:`,
      `/context <query> — Search`,
      `/journal <type> <title> | <summary> — Log`,
      `/hud — Dashboard`,
    ].join("\n"),
    buttons: [
      [
        { text: "Dashboard", callbackData: "cmd:hud" },
        { text: "Search Context", callbackData: "cmd:context" },
      ],
      [
        { text: "Switch Project", callbackData: "cmd:switch" },
        { text: "End Session", callbackData: "cmd:end" },
      ],
    ],
  }
}

// ============================================================================
// Callbacks
// ============================================================================

export async function onCallback(data: string, ctx: Context) {
  const [action, value] = data.split(":")

  if (action === "select") return await activateGTM(value, ctx)
  if (action === "cmd") return await handleCommand(value, ctx)

  return { text: "Unknown action" }
}

async function handleCommand(cmd: string, ctx: Context) {
  const s = getState(ctx.threadId)
  if (!s?.activated) return { text: "JFL not active. Use /jfl to select a project." }

  switch (cmd) {
    case "hud":
      return await runInGTM(s, "jfl hud")
    case "crm":
      return showCRMMenu()
    case "context":
      return await runContext(s)
    case "status":
      return await showStatus(s)
    case "brand":
      return showBrandMenu()
    case "content":
      return showContentMenu()
    case "switch": {
      // Deactivate current
      setState(ctx.threadId, { ...s, activated: false, sessionBranch: null })
      try { await openclawJSON("session-end --sync") } catch {}
      return await onBoot(ctx)
    }
    case "end": {
      try { await openclawJSON("session-end --sync") } catch {}
      setState(ctx.threadId, { ...s, activated: false, sessionBranch: null })
      return { text: `Session ended for ${s.gtmName}.\n\nUse /jfl to start again.` }
    }
    default:
      return { text: "Unknown command" }
  }
}

// ============================================================================
// Commands
// ============================================================================

export async function onCommand(cmd: string, args: string[], ctx: Context) {
  if (cmd === "jfl" || cmd === "gtm") return await onBoot(ctx)

  const s = getState(ctx.threadId)
  if (!s?.activated) return { text: "JFL not active. Use /jfl to select a project first." }

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
      return { text: `Journal entry written: [${type}] ${title}` }
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
// GTM discovery (only returns type:"gtm", never services)
// ============================================================================

function readJflConfig(dir: string): { type?: string; name?: string } | null {
  try {
    return JSON.parse(readFileSync(join(dir, ".jfl", "config.json"), "utf-8"))
  } catch {
    return null
  }
}

async function findGTMs(): Promise<GTM[]> {
  // First try OpenClaw registry
  try {
    const gtms = await openclawJSON("gtm-list")
    if (Array.isArray(gtms) && gtms.length > 0) {
      return gtms.map((g: any) => ({ name: g.name, path: g.path }))
    }
  } catch { /* fall through to filesystem scan */ }

  // Fallback: scan filesystem for type:"gtm" directories
  const gtms: GTM[] = []
  const searchPaths = [
    join(homedir(), "CascadeProjects"),
    join(homedir(), "Projects"),
    join(homedir(), "code"),
  ]

  for (const basePath of searchPaths) {
    if (!existsSync(basePath)) continue
    try {
      const entries = readdirSync(basePath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const candidate = join(basePath, entry.name)
        const config = readJflConfig(candidate)
        if (!config) continue

        // Only include GTMs, not services
        if (config.type === "gtm") {
          gtms.push({ name: config.name || entry.name, path: candidate })
        } else if (!config.type && existsSync(join(candidate, "knowledge"))) {
          // Legacy: no type field but has knowledge/ → probably a GTM
          gtms.push({ name: config.name || entry.name, path: candidate })
        }
        // type:"service" → skip entirely
      }
    } catch { /* skip */ }
  }

  return gtms
}

// ============================================================================
// LIFECYCLE HOOKS (Clawdbot calls these automatically)
// All hooks check activation state. When dormant, they're no-ops.
// ============================================================================

/**
 * session_start — fires when Clawdbot session begins.
 * Does NOT auto-activate. Just checks if JFL is available and notes it.
 * User must run /jfl to activate.
 */
export async function onSessionStart(event: { agentId: string; platform: string; threadId: string }) {
  const existing = getState(event.threadId)

  // If already activated from a previous session, re-inject context
  if (existing?.activated && existing?.gtmPath) {
    const agent = existing.agentId || event.agentId || `clawd-${event.platform}`

    try {
      // Try to resume or start a new session
      const session = await openclawJSON(`session-start -a ${agent} -g "${existing.gtmPath}"`)
      setState(event.threadId, { ...existing, sessionBranch: session.session_id })

      return {
        prependContext: [
          `<jfl-session>`,
          `GTM: ${existing.gtmName} (${existing.gtmPath})`,
          `Session: ${session.session_id}`,
          `Use /jfl for status. Use /context <query> to search.`,
          `</jfl-session>`,
        ].join("\n"),
      }
    } catch {
      // Session start failed but we're still "activated" for the GTM
      return {
        prependContext: `<jfl-session>GTM: ${existing.gtmName} (session start failed, commands still work)</jfl-session>`,
      }
    }
  }

  // Not activated — stay quiet. Don't inject anything.
  // Just check if JFL is available for the welcome message later
  const hasJFL = await ensureJFL()
  if (hasJFL) {
    const gtms = await findGTMs()
    if (gtms.length > 0) {
      return {
        prependContext: `<jfl-available>JFL is installed with ${gtms.length} project(s) available. User can activate with /jfl.</jfl-available>`,
      }
    }
  }

  return { prependContext: "" }
}

/**
 * before_turn — fires before each agent response.
 * Only injects context when JFL is active.
 */
export async function onBeforeTurn(event: { agentId: string; threadId: string; message?: string }) {
  const s = getState(event.threadId)
  if (!s?.activated || !s?.sessionBranch) return { prependContext: "" }

  let contextBlock = ""
  try {
    const query = event.message?.slice(0, 100) || ""
    if (query.length > 10) {
      const items = await openclawJSON(`context -q "${query.replace(/"/g, '\\"')}"`)
      if (Array.isArray(items) && items.length > 0) {
        const relevant = items.slice(0, 3).map((i: any) =>
          `- [${i.type}] ${i.title}: ${(i.content || "").slice(0, 150)}`
        ).join("\n")
        contextBlock = `<jfl-context>\nRelevant context:\n${relevant}\n</jfl-context>`
      }
    }
  } catch { /* non-fatal */ }

  return { prependContext: contextBlock }
}

/**
 * after_turn — fires after each agent response.
 * Only runs heartbeat + capture when JFL is active.
 */
export async function onAfterTurn(event: {
  agentId: string
  threadId: string
  response?: string
  detectedIntent?: string
}) {
  const s = getState(event.threadId)
  if (!s?.activated || !s?.sessionBranch) return

  // Heartbeat (auto-commit)
  try {
    await openclaw("heartbeat --json")
  } catch { /* non-fatal */ }

  // Auto-capture decisions/completions
  if (event.detectedIntent && event.response) {
    const intentMap: Record<string, string> = {
      decision: "decision",
      completed: "feature",
      fixed: "fix",
      learned: "discovery",
    }
    const type = intentMap[event.detectedIntent]
    if (type) {
      const title = event.response.slice(0, 80).replace(/\n/g, " ")
      try {
        await openclaw(`journal --type ${type} --title "${title.replace(/"/g, '\\"')}" --summary "${title.replace(/"/g, '\\"')}"`)
      } catch { /* non-fatal */ }
    }
  }
}

/**
 * session_end — fires when Clawdbot session ends.
 * Only cleans up if JFL was active.
 */
export async function onSessionEnd(event: { agentId: string; threadId: string }) {
  const s = getState(event.threadId)
  if (!s?.activated || !s?.sessionBranch) return

  try {
    await openclawJSON("session-end --sync")
  } catch { /* never block shutdown */ }

  // Keep activated state but clear session
  setState(event.threadId, { ...s, sessionBranch: null })
}

// ============================================================================
// Util
// ============================================================================

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "")
}

export default {
  // Interactive (user-triggered)
  onBoot,
  onCallback,
  onCommand,
  // Lifecycle (Clawdbot-triggered, gated by activation)
  onSessionStart,
  onBeforeTurn,
  onAfterTurn,
  onSessionEnd,
}
