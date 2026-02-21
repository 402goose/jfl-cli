/**
 * OpenClaw CLI Commands
 *
 * Runtime-agnostic agent plugin protocol for JFL.
 * Provides session management, context, journaling, multi-GTM, and service tagging.
 *
 * @purpose CLI command tree for OpenClaw agent protocol
 * @spec specs/OPENCLAW_SPEC.md
 */

import chalk from "chalk"
import ora from "ora"
import { execSync } from "child_process"
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "fs"
import { join, basename, resolve } from "path"
import axios from "axios"
import {
  ensureAgent,
  getAgent,
  listAgents,
  registerGtm,
  getActiveGtm,
  switchGtm,
  listGtms,
  updateSession,
  clearSession,
  getRegistryPath,
  type AgentSession,
} from "../lib/openclaw-registry.js"
import { findProjectRoot, isInJFLProject } from "../utils/jfl-config.js"

const CONTEXT_HUB_URL = process.env.CONTEXT_HUB_URL || "http://localhost:4242"

// ============================================================================
// Helpers
// ============================================================================

function jsonOutput(data: any): void {
  console.log(JSON.stringify(data, null, 2))
}

function errorOutput(code: string, message: string, suggestion?: string): any {
  return { error: true, code, message, suggestion }
}

function getAuthToken(gtmPath: string): string | null {
  const tokenPath = join(gtmPath, ".jfl", "context-hub.token")
  if (!existsSync(tokenPath)) return null
  return readFileSync(tokenPath, "utf-8").trim()
}

function getCurrentBranch(): string | null {
  try {
    return execSync("git branch --show-current", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
  } catch {
    return null
  }
}

function resolveGtmPath(agentId?: string, gtmPathArg?: string): string | null {
  // Explicit path takes priority
  if (gtmPathArg) {
    const resolved = resolve(gtmPathArg)
    if (isInJFLProject(resolved)) return resolved
    return null
  }

  // Try agent registry
  if (agentId) {
    const gtm = getActiveGtm(agentId)
    if (gtm && existsSync(gtm.path)) return gtm.path
  }

  // Try current directory
  const projectRoot = findProjectRoot()
  if (projectRoot) return projectRoot

  return null
}

function generateSessionName(agentId: string): string {
  const date = new Date()
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "")
  const timeStr = date.toISOString().slice(11, 16).replace(/:/g, "")
  const randomId = Math.random().toString(16).slice(2, 8)
  return `session-${agentId}-${dateStr}-${timeStr}-${randomId}`
}

// ============================================================================
// session-start
// ============================================================================

export async function sessionStartCommand(options: {
  agent: string
  gtm?: string
  json?: boolean
}) {
  const { agent, gtm, json } = options

  if (!agent) {
    if (json) return jsonOutput(errorOutput("MISSING_AGENT", "Agent name required", "Use --agent <name>"))
    console.log(chalk.red("Error: --agent <name> is required"))
    return
  }

  const spinner = json ? null : ora("Starting session...").start()

  // Ensure agent exists in registry
  const agentEntry = ensureAgent(agent)

  // Resolve GTM path
  const gtmPath = resolveGtmPath(agent, gtm)
  if (!gtmPath) {
    if (spinner) spinner.fail("No GTM workspace found")
    if (json) return jsonOutput(errorOutput("GTM_NOT_FOUND", "No GTM workspace found", "Use --gtm <path> or register with: jfl openclaw register --gtm <path>"))
    console.log(chalk.gray("Use --gtm <path> or register with: jfl openclaw register --gtm <path>"))
    return
  }

  // Check for existing session
  if (agentEntry.session) {
    if (spinner) spinner.warn("Agent already has an active session")
    if (json) return jsonOutput(errorOutput("SESSION_ALREADY_ACTIVE", `Session ${agentEntry.session.branch} already active`, "End it first: jfl openclaw session-end"))
    console.log(chalk.yellow(`Active session: ${agentEntry.session.branch}`))
    console.log(chalk.gray("End it first: jfl openclaw session-end"))
    return
  }

  // Register GTM if not already registered
  const gtmName = readGtmName(gtmPath)
  registerGtm(agent, gtmPath, gtmName, true)

  // Create session branch
  const sessionName = generateSessionName(agent)

  try {
    execSync(`git -C "${gtmPath}" checkout -b "${sessionName}" 2>&1`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })
  } catch (err: any) {
    // Branch might already exist or we're in detached HEAD
    if (spinner) spinner.fail("Failed to create session branch")
    if (json) return jsonOutput(errorOutput("SESSION_START_FAILED", `Could not create branch: ${err.message}`))
    return
  }

  // Ensure journal directory
  mkdirSync(join(gtmPath, ".jfl", "journal"), { recursive: true })

  // Save session info
  const sessionInfo: AgentSession = {
    branch: sessionName,
    started_at: new Date().toISOString(),
    worktree: null,
  }
  updateSession(agent, sessionInfo)

  // Write session branch file
  writeFileSync(join(gtmPath, ".jfl", "current-session-branch.txt"), sessionName)

  // Start auto-commit if available
  let autoCommitRunning = false
  const autoCommitScript = join(gtmPath, "scripts", "session", "auto-commit.sh")
  if (existsSync(autoCommitScript)) {
    try {
      execSync(`bash "${autoCommitScript}" start >> "${join(gtmPath, ".jfl", "logs", "auto-commit.log")}" 2>&1 &`, {
        cwd: gtmPath,
        stdio: ["pipe", "pipe", "pipe"],
      })
      autoCommitRunning = true
    } catch {
      // Non-fatal
    }
  }

  // Check Context Hub health
  let hubHealthy = false
  try {
    const resp = await axios.get(`${CONTEXT_HUB_URL}/api/health`, { timeout: 3000 })
    hubHealthy = resp.data?.status === "ok"
  } catch {
    // Hub not running - try to start it
    try {
      execSync("jfl context-hub ensure", { cwd: gtmPath, stdio: ["pipe", "pipe", "pipe"], timeout: 10000 })
      hubHealthy = true
    } catch {
      // Non-fatal
    }
  }

  if (spinner) spinner.succeed(`Session started: ${sessionName}`)

  const result = {
    session_id: sessionName,
    branch: sessionName,
    gtm_path: gtmPath,
    gtm_name: gtmName,
    context_hub: { url: CONTEXT_HUB_URL, healthy: hubHealthy },
    auto_commit: { running: autoCommitRunning, interval: 120 },
  }

  if (json) return jsonOutput(result)

  console.log(chalk.gray(`  Branch: ${sessionName}`))
  console.log(chalk.gray(`  GTM: ${gtmName} (${gtmPath})`))
  console.log(chalk.gray(`  Context Hub: ${hubHealthy ? chalk.green("healthy") : chalk.yellow("unreachable")}`))
  console.log(chalk.gray(`  Auto-commit: ${autoCommitRunning ? chalk.green("running") : chalk.yellow("not started")}`))
}

// ============================================================================
// session-end
// ============================================================================

export async function sessionEndCommand(options: {
  sync?: boolean
  json?: boolean
}) {
  const { sync, json } = options

  const spinner = json ? null : ora("Ending session...").start()

  // Find active agent session
  const agents = listAgents()
  const activeAgent = agents.find((a) => a.session !== null)

  if (!activeAgent) {
    if (spinner) spinner.fail("No active session found")
    if (json) return jsonOutput(errorOutput("NO_ACTIVE_SESSION", "No agent has an active session"))
    return
  }

  const gtmPath = resolveGtmPath(activeAgent.id)
  if (!gtmPath) {
    if (spinner) spinner.fail("GTM workspace not found")
    if (json) return jsonOutput(errorOutput("GTM_NOT_FOUND", "Could not resolve GTM path"))
    return
  }

  // Run session cleanup script if available
  const cleanupScript = join(gtmPath, "scripts", "session", "session-cleanup.sh")
  if (existsSync(cleanupScript)) {
    try {
      execSync(`bash "${cleanupScript}"`, {
        cwd: gtmPath,
        encoding: "utf-8",
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"],
      })
    } catch (err: any) {
      // Cleanup scripts should not block session end
      if (!json) console.log(chalk.yellow(`  Cleanup warning: ${err.message}`))
    }
  } else {
    // Manual cleanup: commit, merge
    try {
      execSync(`git -C "${gtmPath}" add -A && git -C "${gtmPath}" commit -m "session: end ${new Date().toISOString()}" 2>&1 || true`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      })
    } catch {
      // Non-fatal
    }
  }

  // Sync to GTM if requested and this is a service
  if (sync) {
    try {
      execSync("jfl services sync 2>&1", {
        cwd: gtmPath,
        encoding: "utf-8",
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      })
    } catch {
      // Non-fatal
    }
  }

  // Clear session in registry
  clearSession(activeAgent.id)

  if (spinner) spinner.succeed("Session ended")

  if (json) {
    return jsonOutput({
      agent: activeAgent.id,
      session: activeAgent.session?.branch,
      merged: true,
      synced: !!sync,
    })
  }

  console.log(chalk.gray(`  Agent: ${activeAgent.id}`))
  console.log(chalk.gray(`  Session: ${activeAgent.session?.branch}`))
}

// ============================================================================
// heartbeat
// ============================================================================

export async function heartbeatCommand(options: { json?: boolean }) {
  const { json } = options

  const agents = listAgents()
  const activeAgent = agents.find((a) => a.session !== null)

  if (!activeAgent || !activeAgent.session) {
    if (json) return jsonOutput(errorOutput("NO_ACTIVE_SESSION", "No active session"))
    console.log(chalk.yellow("No active session"))
    return
  }

  const gtmPath = resolveGtmPath(activeAgent.id)

  // Auto-commit
  let uncommittedChanges = false
  if (gtmPath) {
    try {
      const status = execSync(`git -C "${gtmPath}" status --porcelain`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim()
      uncommittedChanges = status.length > 0

      if (uncommittedChanges) {
        execSync(
          `git -C "${gtmPath}" add knowledge/ content/ suggestions/ CLAUDE.md .jfl/ 2>/dev/null; git -C "${gtmPath}" commit -m "auto: heartbeat ${new Date().toISOString().slice(0, 19)}" 2>/dev/null || true`,
          { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
        )
      }
    } catch {
      // Non-fatal
    }
  }

  // Check Context Hub
  let hubHealthy = false
  try {
    const resp = await axios.get(`${CONTEXT_HUB_URL}/api/health`, { timeout: 3000 })
    hubHealthy = resp.data?.status === "ok"
  } catch {
    // Hub down
  }

  // Calculate duration
  const startedAt = activeAgent.session.started_at
  const durationSeconds = Math.floor(
    (Date.now() - new Date(startedAt).getTime()) / 1000
  )

  // Get last commit time
  let lastCommit: string | null = null
  if (gtmPath) {
    try {
      lastCommit = execSync(`git -C "${gtmPath}" log -1 --format=%cI`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim()
    } catch {
      // Non-fatal
    }
  }

  const result = {
    healthy: hubHealthy && !uncommittedChanges,
    context_hub: hubHealthy,
    uncommitted_changes: uncommittedChanges,
    last_commit: lastCommit,
    session_duration_seconds: durationSeconds,
  }

  if (json) return jsonOutput(result)

  console.log(
    chalk.bold(result.healthy ? chalk.green("Healthy") : chalk.yellow("Degraded"))
  )
  console.log(chalk.gray(`  Context Hub: ${hubHealthy ? "ok" : "unreachable"}`))
  console.log(chalk.gray(`  Uncommitted: ${uncommittedChanges ? "yes" : "no"}`))
  console.log(chalk.gray(`  Duration: ${Math.floor(durationSeconds / 60)}m`))
}

// ============================================================================
// context
// ============================================================================

export async function contextCommand(options: {
  query?: string
  taskType?: string
  json?: boolean
}) {
  const { query, taskType, json } = options

  const spinner = json ? null : ora("Fetching context...").start()

  // Find GTM path for auth token
  const agents = listAgents()
  const activeAgent = agents.find((a) => a.session !== null)
  const gtmPath = resolveGtmPath(activeAgent?.id)

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (gtmPath) {
    const token = getAuthToken(gtmPath)
    if (token) headers["Authorization"] = `Bearer ${token}`
  }

  try {
    const resp = await axios.post(
      `${CONTEXT_HUB_URL}/api/context`,
      { query, taskType, maxItems: 30 },
      { headers, timeout: 10000 }
    )

    const items = resp.data?.items || resp.data || []

    if (spinner) spinner.succeed(`Got ${items.length} context items`)

    if (json) return jsonOutput(items)

    if (items.length === 0) {
      console.log(chalk.gray("  No context items found"))
      return
    }

    for (const item of items) {
      console.log(chalk.cyan(`  [${item.source || item.type}] `) + chalk.bold(item.title))
      if (item.content) {
        const preview = item.content.slice(0, 120).replace(/\n/g, " ")
        console.log(chalk.gray(`    ${preview}${item.content.length > 120 ? "..." : ""}`))
      }
    }
  } catch (err: any) {
    if (spinner) spinner.fail("Context Hub unreachable")
    if (json) return jsonOutput(errorOutput("CONTEXT_HUB_UNREACHABLE", "Context Hub not responding", "Run: jfl context-hub start"))
    console.log(chalk.gray("Run: jfl context-hub start"))
  }
}

// ============================================================================
// journal
// ============================================================================

export async function journalCommand(options: {
  type: string
  title: string
  summary: string
  detail?: string
  files?: string
  json?: boolean
}) {
  const { type, title, summary, detail, files, json } = options

  if (!type || !title || !summary) {
    if (json) return jsonOutput(errorOutput("MISSING_FIELDS", "Required: --type, --title, --summary"))
    console.log(chalk.red("Required: --type, --title, --summary"))
    return
  }

  // Find session and GTM
  const agents = listAgents()
  const activeAgent = agents.find((a) => a.session !== null)
  const session = activeAgent?.session?.branch || getCurrentBranch() || "unknown"
  const gtmPath = resolveGtmPath(activeAgent?.id) || process.cwd()

  const journalDir = join(gtmPath, ".jfl", "journal")
  mkdirSync(journalDir, { recursive: true })

  const entry = {
    v: 1,
    ts: new Date().toISOString(),
    session,
    type,
    status: "complete",
    title,
    summary,
    ...(detail && { detail }),
    ...(files && { files: files.split(",").map((f) => f.trim()) }),
  }

  const journalFile = join(journalDir, `${session}.jsonl`)
  appendFileSync(journalFile, JSON.stringify(entry) + "\n")

  if (json) return jsonOutput({ written: true, file: journalFile, entry })

  console.log(chalk.green(`Journal entry written: ${title}`))
  console.log(chalk.gray(`  Type: ${type} | Session: ${session}`))
  console.log(chalk.gray(`  File: ${journalFile}`))
}

// ============================================================================
// status
// ============================================================================

export async function statusCommand(options: { json?: boolean }) {
  const { json } = options

  const agents = listAgents()
  const activeAgent = agents.find((a) => a.session !== null)

  // Check Context Hub
  let hubHealthy = false
  try {
    const resp = await axios.get(`${CONTEXT_HUB_URL}/api/health`, { timeout: 3000 })
    hubHealthy = resp.data?.status === "ok"
  } catch {
    // Down
  }

  const gtmPath = resolveGtmPath(activeAgent?.id)

  const status = {
    agent: activeAgent?.id || null,
    session: activeAgent?.session || null,
    gtm_path: gtmPath,
    gtm_name: gtmPath ? readGtmName(gtmPath) : null,
    context_hub: { url: CONTEXT_HUB_URL, healthy: hubHealthy },
    registry_path: getRegistryPath(),
    registered_agents: agents.map((a) => ({
      id: a.id,
      runtime: a.runtime,
      active: !!a.session,
      gtm_count: a.registered_gtms.length,
    })),
  }

  if (json) return jsonOutput(status)

  console.log(chalk.bold("\nOpenClaw Status\n"))

  if (activeAgent?.session) {
    console.log(chalk.green("  Active Session"))
    console.log(chalk.gray(`    Agent: ${activeAgent.id}`))
    console.log(chalk.gray(`    Branch: ${activeAgent.session.branch}`))
    console.log(chalk.gray(`    Started: ${activeAgent.session.started_at}`))
  } else {
    console.log(chalk.gray("  No active session"))
  }

  console.log()
  console.log(chalk.gray(`  GTM: ${status.gtm_name || "none"} (${gtmPath || "not found"})`))
  console.log(chalk.gray(`  Context Hub: ${hubHealthy ? chalk.green("healthy") : chalk.yellow("unreachable")}`))
  console.log(chalk.gray(`  Agents: ${agents.length} registered`))
  console.log(chalk.gray(`  Registry: ${getRegistryPath()}`))
  console.log()
}

// ============================================================================
// gtm-list
// ============================================================================

export async function gtmListCommand(options: { json?: boolean }) {
  const { json } = options

  // Find agent - use first agent with GTMs or show all
  const agents = listAgents()
  const activeAgent = agents.find((a) => a.session !== null) || agents[0]

  if (!activeAgent) {
    if (json) return jsonOutput([])
    console.log(chalk.gray("No agents registered. Use: jfl openclaw register --gtm <path>"))
    return
  }

  const gtms = listGtms(activeAgent.id)

  if (json) return jsonOutput(gtms)

  if (gtms.length === 0) {
    console.log(chalk.gray("No GTMs registered for agent. Use: jfl openclaw register --gtm <path>"))
    return
  }

  console.log(chalk.bold(`\nGTM Workspaces (${activeAgent.id})\n`))

  for (const g of gtms) {
    const marker = g.default ? chalk.green(" (default)") : ""
    const active = activeAgent.active_gtm === g.id ? chalk.cyan(" [active]") : ""
    console.log(`  ${chalk.bold(g.name)}${marker}${active}`)
    console.log(chalk.gray(`    ID: ${g.id} | Path: ${g.path}`))
  }

  console.log()
}

// ============================================================================
// gtm-switch
// ============================================================================

export async function gtmSwitchCommand(gtmId: string, options: { json?: boolean }) {
  const { json } = options

  if (!gtmId) {
    if (json) return jsonOutput(errorOutput("MISSING_GTM_ID", "GTM ID required"))
    console.log(chalk.red("Error: GTM ID required"))
    return
  }

  const agents = listAgents()
  const activeAgent = agents.find((a) => a.session !== null) || agents[0]

  if (!activeAgent) {
    if (json) return jsonOutput(errorOutput("AGENT_NOT_REGISTERED", "No agents registered"))
    console.log(chalk.red("No agents registered"))
    return
  }

  try {
    const gtm = switchGtm(activeAgent.id, gtmId)

    if (json) return jsonOutput({ switched: true, gtm })

    console.log(chalk.green(`Switched to GTM: ${gtm.name}`))
    console.log(chalk.gray(`  Path: ${gtm.path}`))
  } catch (err: any) {
    if (json) return jsonOutput(errorOutput("GTM_NOT_FOUND", err.message))
    console.log(chalk.red(err.message))
  }
}

// ============================================================================
// gtm-create
// ============================================================================

export async function gtmCreateCommand(name: string, options: { path?: string; json?: boolean }) {
  const { path: targetPath, json } = options

  if (!name) {
    if (json) return jsonOutput(errorOutput("MISSING_NAME", "GTM name required"))
    console.log(chalk.red("Error: GTM name required"))
    return
  }

  const spinner = json ? null : ora(`Creating GTM workspace: ${name}`).start()

  const gtmDir = targetPath || join(process.cwd(), name.toLowerCase().replace(/\s+/g, "-"))

  try {
    // Use jfl init to create the workspace
    execSync(`jfl init -n "${name}"`, {
      cwd: resolve(targetPath || process.cwd()),
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    })

    // Register with current agent if one exists
    const agents = listAgents()
    const activeAgent = agents.find((a) => a.session !== null) || agents[0]

    if (activeAgent) {
      registerGtm(activeAgent.id, gtmDir, name)
    }

    if (spinner) spinner.succeed(`GTM workspace created: ${name}`)

    if (json) return jsonOutput({ created: true, name, path: gtmDir })

    console.log(chalk.gray(`  Path: ${gtmDir}`))
  } catch (err: any) {
    if (spinner) spinner.fail("Failed to create GTM workspace")
    if (json) return jsonOutput(errorOutput("CREATE_FAILED", err.message))
    console.log(chalk.gray(err.message))
  }
}

// ============================================================================
// register
// ============================================================================

export async function registerCommand(options: {
  agent?: string
  gtm: string
  json?: boolean
}) {
  const { agent, gtm, json } = options

  if (!gtm) {
    if (json) return jsonOutput(errorOutput("MISSING_GTM", "GTM path required. Use --gtm <path>"))
    console.log(chalk.red("Error: --gtm <path> required"))
    return
  }

  const gtmPath = resolve(gtm)
  if (!isInJFLProject(gtmPath)) {
    if (json) return jsonOutput(errorOutput("GTM_NOT_FOUND", `Not a JFL project: ${gtmPath}`))
    console.log(chalk.red(`Not a JFL project: ${gtmPath}`))
    return
  }

  // Detect agent from manifest or use provided name
  let agentId = agent || "default"
  let runtime = "custom"

  // Check for openclaw.plugin.json in current directory
  const manifestPath = join(process.cwd(), "openclaw.plugin.json")
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"))
      agentId = manifest.id || agentId
      runtime = manifest.runtime?.type || runtime
    } catch {
      // Use defaults
    }
  }

  const agentEntry = ensureAgent(agentId, runtime)
  const gtmName = readGtmName(gtmPath)
  const registration = registerGtm(agentId, gtmPath, gtmName, true)

  // Also register in GTM's config
  try {
    const gtmConfigPath = join(gtmPath, ".jfl", "config.json")
    if (existsSync(gtmConfigPath)) {
      const gtmConfig = JSON.parse(readFileSync(gtmConfigPath, "utf-8"))
      if (!gtmConfig.openclaw_agents) gtmConfig.openclaw_agents = []

      const existing = gtmConfig.openclaw_agents.find((a: any) => a.id === agentId)
      if (!existing) {
        gtmConfig.openclaw_agents.push({
          id: agentId,
          runtime,
          registered_at: new Date().toISOString(),
        })
        writeFileSync(gtmConfigPath, JSON.stringify(gtmConfig, null, 2) + "\n")
      }
    }
  } catch {
    // Non-fatal
  }

  if (json) return jsonOutput({ registered: true, agent: agentId, gtm: registration })

  console.log(chalk.green(`Registered agent "${agentId}" with GTM "${gtmName}"`))
  console.log(chalk.gray(`  GTM path: ${gtmPath}`))
  console.log(chalk.gray(`  GTM ID: ${registration.id}`))
}

// ============================================================================
// tag
// ============================================================================

export async function tagCommand(service: string, message: string, options: { json?: boolean }) {
  const { json } = options

  if (!service || !message) {
    if (json) return jsonOutput(errorOutput("MISSING_ARGS", "Usage: jfl openclaw tag <service> <message>"))
    console.log(chalk.red("Usage: jfl openclaw tag <service> <message>"))
    return
  }

  const agents = listAgents()
  const activeAgent = agents.find((a) => a.session !== null)
  const session = activeAgent?.session?.branch || getCurrentBranch() || "unknown"
  const gtmPath = resolveGtmPath(activeAgent?.id) || process.cwd()

  const event = {
    ts: new Date().toISOString(),
    source: `openclaw:${activeAgent?.id || "unknown"}`,
    target: service,
    type: "tag",
    message,
    session,
  }

  // Append to service events
  const eventsFile = join(gtmPath, ".jfl", "service-events.jsonl")
  appendFileSync(eventsFile, JSON.stringify(event) + "\n")

  // Create inbox trigger if directory exists
  const inboxDir = join(gtmPath, ".jfl", "inbox", service)
  if (existsSync(join(gtmPath, ".jfl", "inbox"))) {
    mkdirSync(inboxDir, { recursive: true })
    const triggerFile = join(inboxDir, `${Date.now()}.json`)
    writeFileSync(triggerFile, JSON.stringify(event, null, 2) + "\n")
  }

  if (json) return jsonOutput({ sent: true, event })

  console.log(chalk.green(`Tagged ${service}: ${message}`))
  console.log(chalk.gray(`  Event logged to ${eventsFile}`))
}

// ============================================================================
// Utility
// ============================================================================

function readGtmName(gtmPath: string): string {
  try {
    const configPath = join(gtmPath, ".jfl", "config.json")
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"))
      if (config.name) return config.name
    }
  } catch {
    // Fall through
  }

  // Try knowledge/VISION.md first heading
  try {
    const visionPath = join(gtmPath, "knowledge", "VISION.md")
    if (existsSync(visionPath)) {
      const content = readFileSync(visionPath, "utf-8")
      const match = content.match(/^#\s+(.+)/m)
      if (match) return match[1].trim()
    }
  } catch {
    // Fall through
  }

  return basename(gtmPath)
}
