/**
 * Session Management Commands
 *
 * Manages isolated GTM sessions across platforms (CLI, Telegram, Slack, Web)
 * Each session = git worktree + auto-commit daemon + journal
 */

import { execSync } from "child_process"
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs"
import { join } from "path"
import chalk from "chalk"

interface SessionInfo {
  id: string
  platform: string
  thread?: string
  user?: string
  path: string
  branch: string
  created: string
  lastActive: string
  status: "active" | "idle"
}

/**
 * Session state file location
 */
function getSessionsFile(): string {
  const cwd = process.cwd()
  const jflDir = join(cwd, ".jfl")

  if (!existsSync(jflDir)) {
    throw new Error("Not in a JFL GTM. Run from project root.")
  }

  return join(jflDir, "sessions.json")
}

/**
 * Load all sessions
 */
function loadSessions(): Record<string, SessionInfo> {
  const file = getSessionsFile()

  if (!existsSync(file)) {
    return {}
  }

  return JSON.parse(readFileSync(file, "utf-8"))
}

/**
 * Save sessions
 */
function saveSessions(sessions: Record<string, SessionInfo>) {
  const file = getSessionsFile()
  writeFileSync(file, JSON.stringify(sessions, null, 2))
}

/**
 * Create or get existing session
 */
export async function sessionCreate(opts: {
  platform: string
  thread?: string
  user?: string
}) {
  const cwd = process.cwd()
  const sessions = loadSessions()

  // Generate session ID
  const threadPart = opts.thread ? `-${opts.thread}` : `-${Date.now()}`
  const sessionId = `session-${opts.platform}${threadPart}`

  // Check if already exists
  if (sessions[sessionId]) {
    console.log(chalk.green(`✓ Using existing session: ${sessionId}`))

    // Update last active
    sessions[sessionId].lastActive = new Date().toISOString()
    saveSessions(sessions)

    return sessionId
  }

  console.log(chalk.cyan(`Creating session: ${sessionId}`))

  // Create worktree
  const worktreePath = join(cwd, "worktrees", sessionId)
  const branch = sessionId

  try {
    execSync(`git worktree add ${worktreePath} -b ${branch}`, {
      stdio: "pipe"
    })
    console.log(chalk.green(`✓ Worktree created: worktrees/${sessionId}`))
  } catch (error: any) {
    throw new Error(`Failed to create worktree: ${error.message}`)
  }

  // Initialize session (run session-init if exists)
  const initScript = join(cwd, "product/scripts/session/session-init.sh")
  if (existsSync(initScript)) {
    try {
      execSync(initScript, {
        cwd: worktreePath,
        stdio: "pipe"
      })
      console.log(chalk.green("✓ Session initialized"))
    } catch (error) {
      console.log(chalk.yellow("⚠️  Session init script failed (continuing)"))
    }
  }

  // Start auto-commit daemon
  const autoCommitScript = join(cwd, "product/scripts/session/auto-commit.sh")
  if (existsSync(autoCommitScript)) {
    try {
      execSync(`${autoCommitScript} start 120 &`, {
        cwd: worktreePath,
        stdio: "pipe"
      })
      console.log(chalk.green("✓ Auto-commit daemon started"))
    } catch (error) {
      console.log(chalk.yellow("⚠️  Auto-commit daemon failed to start"))
    }
  }

  // Create journal file
  const journalDir = join(cwd, ".jfl/journal")
  const journalFile = join(journalDir, `${sessionId}.jsonl`)

  if (!existsSync(journalFile)) {
    writeFileSync(journalFile, "")
    console.log(chalk.green("✓ Journal file created"))
  }

  // Store session info
  sessions[sessionId] = {
    id: sessionId,
    platform: opts.platform,
    thread: opts.thread,
    user: opts.user,
    path: worktreePath,
    branch,
    created: new Date().toISOString(),
    lastActive: new Date().toISOString(),
    status: "active"
  }

  saveSessions(sessions)

  console.log(chalk.green(`\n✓ Session created: ${sessionId}`))
  console.log(chalk.gray(`  Path: ${worktreePath}`))
  console.log(chalk.gray(`  Branch: ${branch}\n`))

  return sessionId
}

/**
 * Execute command in session context
 */
export async function sessionExec(sessionId: string, command: string) {
  const sessions = loadSessions()
  const session = sessions[sessionId]

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  // Update last active
  session.lastActive = new Date().toISOString()
  saveSessions(sessions)

  // CD to worktree and execute
  const cwd = session.path

  // Session-sync before command
  const syncScript = join(process.cwd(), "product/scripts/session/session-sync.sh")
  if (existsSync(syncScript)) {
    try {
      execSync(syncScript, {
        cwd,
        stdio: "pipe"
      })
    } catch (error) {
      console.error(chalk.yellow("⚠️  Session sync failed"))
    }
  }

  // Execute command
  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
      env: {
        ...process.env,
        JFL_SESSION_ID: sessionId,
        JFL_PLATFORM: session.platform
      }
    })

    return output
  } catch (error: any) {
    // Return stderr if command failed
    return error.stderr || error.stdout || error.message
  }
}

/**
 * List all sessions
 */
export async function sessionList() {
  const cwd = process.cwd()
  const worktreesDir = join(cwd, "worktrees")

  // Scan worktrees directory for session-* directories
  const detectedSessions: Record<string, SessionInfo> = {}

  if (existsSync(worktreesDir)) {
    const entries = readdirSync(worktreesDir)

    for (const entry of entries) {
      if (!entry.startsWith("session-")) continue

      const worktreePath = join(worktreesDir, entry)
      const stat = statSync(worktreePath)

      if (!stat.isDirectory()) continue

      // Extract session info from directory name
      // Format: session-{platform}-{thread} or session-{user}-{date}-{time}-{id}
      const parts = entry.split("-")
      let platform = "cli"
      let thread: string | undefined

      if (parts.length >= 3) {
        // Check if it matches platform-thread pattern
        if (["telegram", "slack", "discord", "web"].includes(parts[1])) {
          platform = parts[1]
          thread = parts.slice(2).join("-")
        }
      }

      detectedSessions[entry] = {
        id: entry,
        platform,
        thread,
        path: worktreePath,
        branch: entry,
        created: stat.birthtime.toISOString(),
        lastActive: stat.mtime.toISOString(),
        status: "active"
      }
    }
  }

  // Merge with sessions.json if it exists
  const registeredSessions = loadSessions()
  const allSessions = { ...detectedSessions, ...registeredSessions }

  const sessionIds = Object.keys(allSessions)

  if (sessionIds.length === 0) {
    console.log(chalk.yellow("No active sessions"))
    return
  }

  console.log(chalk.bold("\nActive Sessions:\n"))

  for (const id of sessionIds) {
    const session = allSessions[id]
    const lastActive = new Date(session.lastActive)
    const now = new Date()
    const diffMs = now.getTime() - lastActive.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    let timeAgo = ""
    if (diffMins < 1) {
      timeAgo = "just now"
    } else if (diffMins < 60) {
      timeAgo = `${diffMins}m ago`
    } else {
      const diffHours = Math.floor(diffMins / 60)
      timeAgo = `${diffHours}h ago`
    }

    // Check if auto-commit daemon is running (check PID)
    const pidFile = join(session.path, ".jfl/auto-commit.pid")
    let isActive = false

    if (existsSync(pidFile)) {
      try {
        const pid = parseInt(readFileSync(pidFile, "utf-8").trim())
        // Check if process is running
        process.kill(pid, 0) // Signal 0 = existence check
        isActive = true
      } catch {
        // PID doesn't exist or not accessible
        isActive = false
      }
    }

    const status = isActive ? chalk.green("🟢 active") : chalk.yellow("🟡 idle")
    const platform = chalk.cyan(session.platform.padEnd(10))
    const thread = session.thread ? chalk.gray(`thread:${session.thread}`) : ""

    console.log(`${chalk.bold(id.padEnd(40))} ${platform} ${status.padEnd(20)} ${timeAgo.padEnd(10)} ${thread}`)
  }

  console.log()
}

/**
 * Destroy session
 */
export async function sessionDestroy(sessionId: string, opts?: { force?: boolean }) {
  const sessions = loadSessions()
  const session = sessions[sessionId]

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  console.log(chalk.cyan(`Destroying session: ${sessionId}`))

  // Stop auto-commit daemon
  const pidFile = join(session.path, ".jfl/auto-commit.pid")
  if (existsSync(pidFile)) {
    try {
      const pid = readFileSync(pidFile, "utf-8").trim()
      execSync(`kill ${pid}`, { stdio: "pipe" })
      console.log(chalk.green("✓ Auto-commit daemon stopped"))
    } catch (error) {
      console.log(chalk.yellow("⚠️  Daemon already stopped"))
    }
  }

  // Run session-end hook
  const endScript = join(process.cwd(), "product/scripts/session/session-end.sh")
  if (existsSync(endScript) && !opts?.force) {
    try {
      execSync(endScript, {
        cwd: session.path,
        stdio: "pipe"
      })
      console.log(chalk.green("✓ Session end hook completed"))
    } catch (error) {
      console.log(chalk.yellow("⚠️  Session end hook failed"))
    }
  }

  // Check for uncommitted changes
  try {
    const status = execSync("git status --porcelain", {
      cwd: session.path,
      encoding: "utf-8"
    })

    if (status.trim() && !opts?.force) {
      console.log(chalk.yellow("\n⚠️  Uncommitted changes found:"))
      console.log(status)
      console.log(chalk.yellow("\nRun with --force to destroy anyway\n"))
      return
    }
  } catch (error) {
    // Ignore
  }

  // Delete worktree
  try {
    execSync(`git worktree remove ${session.path} --force`, {
      stdio: "pipe"
    })
    console.log(chalk.green("✓ Worktree removed"))
  } catch (error: any) {
    throw new Error(`Failed to remove worktree: ${error.message}`)
  }

  // Delete branch
  try {
    execSync(`git branch -D ${session.branch}`, {
      stdio: "pipe"
    })
    console.log(chalk.green("✓ Branch deleted"))
  } catch (error) {
    console.log(chalk.yellow("⚠️  Branch already deleted"))
  }

  // Remove from sessions
  delete sessions[sessionId]
  saveSessions(sessions)

  console.log(chalk.green(`\n✓ Session destroyed: ${sessionId}\n`))
}

/**
 * Get session info
 */
export async function sessionInfo(sessionId: string) {
  const sessions = loadSessions()
  const session = sessions[sessionId]

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`)
  }

  console.log(chalk.bold(`\nSession: ${sessionId}\n`))
  console.log(chalk.gray("Platform:    ") + session.platform)
  console.log(chalk.gray("Thread:      ") + (session.thread || "N/A"))
  console.log(chalk.gray("User:        ") + (session.user || "N/A"))
  console.log(chalk.gray("Path:        ") + session.path)
  console.log(chalk.gray("Branch:      ") + session.branch)
  console.log(chalk.gray("Created:     ") + new Date(session.created).toLocaleString())
  console.log(chalk.gray("Last Active: ") + new Date(session.lastActive).toLocaleString())

  // Check daemon status
  const pidFile = join(session.path, ".jfl/auto-commit.pid")
  const isActive = existsSync(pidFile)
  console.log(chalk.gray("Status:      ") + (isActive ? chalk.green("active") : chalk.yellow("idle")))

  console.log()
}
