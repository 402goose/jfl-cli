/**
 * Session Lock Registry + Merge Sequencer
 *
 * File-based concurrency control for multiple JFL sessions in the same project.
 * Uses flock(2) for atomic operations and heartbeat files for liveness detection.
 *
 * Lock Registry: Sessions register on start, heartbeat every 30s, detected as
 * stale after 90s of no heartbeat. Zero external dependencies.
 *
 * Merge Sequencer: FIFO queue with flock-based locking so only one session
 * merges at a time. Others wait and retry.
 *
 * @purpose Concurrency control for multi-session JFL projects
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  statSync,
  openSync,
  closeSync,
  appendFileSync,
} from "fs"
import { join } from "path"
import { execSync } from "child_process"
import { createHash } from "crypto"

const HEARTBEAT_INTERVAL_MS = 30_000
const STALE_THRESHOLD_MS = 90_000
const MERGE_LOCK_TIMEOUT_MS = 120_000
const MERGE_RETRY_INTERVAL_MS = 2_000

export interface SessionLock {
  id: string
  pid: number
  branch: string
  worktree: string | null
  user: string
  claiming: string[]
  started: string
  heartbeat: string
}

export interface MergeQueueEntry {
  session: string
  branch: string
  targetBranch: string
  ts: string
  status: "pending" | "merging" | "done" | "failed"
  error?: string
}

function sessionsDir(projectRoot: string): string {
  return join(projectRoot, ".jfl", "sessions")
}

function lockFilePath(projectRoot: string, sessionId: string): string {
  return join(sessionsDir(projectRoot), `${sessionId}.lock`)
}

function mergeQueuePath(projectRoot: string): string {
  return join(sessionsDir(projectRoot), "merge-queue.jsonl")
}

function mergeLockPath(projectRoot: string): string {
  return join(sessionsDir(projectRoot), "merge.lock")
}

function eventsPath(projectRoot: string): string {
  return join(sessionsDir(projectRoot), "events.jsonl")
}

function ensureSessionsDir(projectRoot: string): void {
  const dir = sessionsDir(projectRoot)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export const SESSION_ID_PATTERN = /^[a-zA-Z0-9._-]+$/

export function validateSessionId(sessionId: string): void {
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(
      `Invalid session ID: "${sessionId}". Must match /^[a-zA-Z0-9._-]+$/.`
    )
  }
}

function flockWrite(filePath: string, content: string): void {
  try {
    execSync(
      `(flock -x 200; cat > "${filePath}" <<'LOCKEOF'\n${content}\nLOCKEOF\n) 200>"${filePath}.flock"`,
      { encoding: "utf-8", stdio: "pipe", timeout: 5000 }
    )
  } catch {
    writeFileSync(filePath, content)
  }
}

function flockRead(filePath: string): string {
  try {
    return execSync(
      `(flock -s 200; cat "${filePath}") 200>"${filePath}.flock"`,
      { encoding: "utf-8", stdio: "pipe", timeout: 5000 }
    ).trim()
  } catch {
    return existsSync(filePath) ? readFileSync(filePath, "utf-8").trim() : ""
  }
}

function flockAppend(filePath: string, line: string): void {
  try {
    execSync(
      `(flock -x 200; echo '${line.replace(/'/g, "'\\''")}' >> "${filePath}") 200>"${filePath}.flock"`,
      { encoding: "utf-8", stdio: "pipe", timeout: 5000 }
    )
  } catch {
    appendFileSync(filePath, line + "\n")
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Lock Registry
// ---------------------------------------------------------------------------

export function registerSession(
  projectRoot: string,
  session: Omit<SessionLock, "heartbeat">
): SessionLock {
  validateSessionId(session.id)
  ensureSessionsDir(projectRoot)

  const lock: SessionLock = {
    ...session,
    heartbeat: new Date().toISOString(),
  }

  flockWrite(lockFilePath(projectRoot, session.id), JSON.stringify(lock, null, 2))

  emitEvent(projectRoot, {
    session: session.id,
    event: "session:register",
    user: session.user,
    branch: session.branch,
  })

  return lock
}

export function heartbeat(projectRoot: string, sessionId: string): boolean {
  validateSessionId(sessionId)
  const path = lockFilePath(projectRoot, sessionId)
  if (!existsSync(path)) return false

  const raw = flockRead(path)
  if (!raw) return false

  try {
    const lock: SessionLock = JSON.parse(raw)
    lock.heartbeat = new Date().toISOString()
    flockWrite(path, JSON.stringify(lock, null, 2))
    return true
  } catch {
    return false
  }
}

export function updateClaims(
  projectRoot: string,
  sessionId: string,
  claiming: string[]
): boolean {
  validateSessionId(sessionId)
  const path = lockFilePath(projectRoot, sessionId)
  if (!existsSync(path)) return false

  const raw = flockRead(path)
  if (!raw) return false

  try {
    const lock: SessionLock = JSON.parse(raw)
    lock.claiming = claiming
    lock.heartbeat = new Date().toISOString()
    flockWrite(path, JSON.stringify(lock, null, 2))
    return true
  } catch {
    return false
  }
}

export function unregisterSession(
  projectRoot: string,
  sessionId: string
): void {
  validateSessionId(sessionId)
  const path = lockFilePath(projectRoot, sessionId)
  const flockPath = `${path}.flock`

  emitEvent(projectRoot, {
    session: sessionId,
    event: "session:unregister",
  })

  try { unlinkSync(path) } catch {}
  try { unlinkSync(flockPath) } catch {}
}

export function getActiveSessions(projectRoot: string): SessionLock[] {
  const dir = sessionsDir(projectRoot)
  if (!existsSync(dir)) return []

  const now = Date.now()
  const active: SessionLock[] = []

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".lock") || file.endsWith(".flock")) continue

    const filePath = join(dir, file)
    try {
      const raw = flockRead(filePath)
      if (!raw) continue

      const lock: SessionLock = JSON.parse(raw)
      const heartbeatAge = now - new Date(lock.heartbeat).getTime()

      if (isNaN(heartbeatAge) || heartbeatAge > STALE_THRESHOLD_MS) continue
      if (!isPidAlive(lock.pid)) continue

      active.push(lock)
    } catch {
      continue
    }
  }

  return active
}

export function getStaleSessions(projectRoot: string): SessionLock[] {
  const dir = sessionsDir(projectRoot)
  if (!existsSync(dir)) return []

  const now = Date.now()
  const stale: SessionLock[] = []

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".lock") || file.endsWith(".flock")) continue

    const filePath = join(dir, file)
    try {
      const raw = flockRead(filePath)
      if (!raw) continue

      const lock: SessionLock = JSON.parse(raw)
      const heartbeatAge = now - new Date(lock.heartbeat).getTime()
      const pidAlive = isPidAlive(lock.pid)

      if (isNaN(heartbeatAge) || heartbeatAge > STALE_THRESHOLD_MS || !pidAlive) {
        stale.push(lock)
      }
    } catch {
      continue
    }
  }

  return stale
}

export function cleanStaleSessions(projectRoot: string): number {
  const stale = getStaleSessions(projectRoot)
  for (const session of stale) {
    unregisterSession(projectRoot, session.id)
  }
  return stale.length
}

export function checkClaimConflict(
  projectRoot: string,
  sessionId: string,
  paths: string[]
): { conflicting: boolean; claimedBy: string[]; paths: string[] } {
  const active = getActiveSessions(projectRoot)
  const conflicts: string[] = []
  const claimedBy: string[] = []

  for (const session of active) {
    if (session.id === sessionId) continue

    for (const claimed of session.claiming) {
      for (const requested of paths) {
        if (requested.startsWith(claimed) || claimed.startsWith(requested)) {
          conflicts.push(claimed)
          if (!claimedBy.includes(session.id)) {
            claimedBy.push(session.id)
          }
        }
      }
    }
  }

  return {
    conflicting: conflicts.length > 0,
    claimedBy,
    paths: [...new Set(conflicts)],
  }
}

// ---------------------------------------------------------------------------
// Heartbeat Daemon (in-process)
// ---------------------------------------------------------------------------

const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>()

export function startHeartbeat(
  projectRoot: string,
  sessionId: string
): void {
  validateSessionId(sessionId)
  stopHeartbeat(sessionId)

  const timer = setInterval(() => {
    const ok = heartbeat(projectRoot, sessionId)
    if (!ok) {
      stopHeartbeat(sessionId)
    }
  }, HEARTBEAT_INTERVAL_MS)

  timer.unref()
  heartbeatTimers.set(sessionId, timer)
}

export function stopHeartbeat(sessionId: string): void {
  const timer = heartbeatTimers.get(sessionId)
  if (timer) {
    clearInterval(timer)
    heartbeatTimers.delete(sessionId)
  }
}

// ---------------------------------------------------------------------------
// Merge Sequencer
// ---------------------------------------------------------------------------

export function enqueueMerge(
  projectRoot: string,
  sessionBranch: string,
  targetBranch: string,
  sessionId: string
): void {
  ensureSessionsDir(projectRoot)

  const entry: MergeQueueEntry = {
    session: sessionId,
    branch: sessionBranch,
    targetBranch,
    ts: new Date().toISOString(),
    status: "pending",
  }

  flockAppend(mergeQueuePath(projectRoot), JSON.stringify(entry))

  emitEvent(projectRoot, {
    session: sessionId,
    event: "merge:enqueued",
    branch: sessionBranch,
    targetBranch,
  })
}

export async function acquireMergeLock(
  projectRoot: string,
  sessionId: string,
  timeoutMs: number = MERGE_LOCK_TIMEOUT_MS
): Promise<boolean> {
  ensureSessionsDir(projectRoot)

  const lockPath = mergeLockPath(projectRoot)
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (!existsSync(lockPath)) {
      try {
        const fd = openSync(lockPath, "wx")
        writeFileSync(lockPath, JSON.stringify({ session: sessionId, ts: new Date().toISOString() }))
        closeSync(fd)
        return true
      } catch (err: any) {
        if (err.code !== "EEXIST") throw err
      }
    } else {
      try {
        const raw = readFileSync(lockPath, "utf-8")
        const lock = JSON.parse(raw)
        const age = Date.now() - new Date(lock.ts).getTime()
        if (age > MERGE_LOCK_TIMEOUT_MS) {
          unlinkSync(lockPath)
          continue
        }
      } catch {
        try { unlinkSync(lockPath) } catch {}
        continue
      }
    }

    await sleep(MERGE_RETRY_INTERVAL_MS)
  }

  return false
}

export function releaseMergeLock(projectRoot: string): void {
  const lockPath = mergeLockPath(projectRoot)
  try { unlinkSync(lockPath) } catch {}
}

export interface MergeResult {
  success: boolean
  merged: boolean
  error?: string
  conflictFiles?: string[]
}

export async function sequencedMerge(
  projectRoot: string,
  sessionBranch: string,
  targetBranch: string,
  sessionId: string,
  cwd?: string
): Promise<MergeResult> {
  const workDir = cwd || projectRoot

  enqueueMerge(projectRoot, sessionBranch, targetBranch, sessionId)

  const acquired = await acquireMergeLock(projectRoot, sessionId)
  if (!acquired) {
    return {
      success: false,
      merged: false,
      error: "Timed out waiting for merge lock",
    }
  }

  try {
    emitEvent(projectRoot, {
      session: sessionId,
      event: "merge:start",
      branch: sessionBranch,
      targetBranch,
    })

    const checkout = gitSync(["checkout", targetBranch], workDir)
    if (!checkout.ok) {
      return {
        success: false,
        merged: false,
        error: `Failed to checkout ${targetBranch}: ${checkout.output}`,
      }
    }

    const pull = gitSync(["pull", "--rebase", "origin", targetBranch], workDir)
    if (!pull.ok) {
      gitSync(["rebase", "--abort"], workDir)
      gitSync(["pull", "origin", targetBranch], workDir)
    }

    const merge = gitSync(["merge", sessionBranch, "--no-ff", "-m",
      `merge: session ${sessionId} (${sessionBranch})`], workDir)

    if (!merge.ok) {
      const conflictResult = gitSync(["diff", "--name-only", "--diff-filter=U"], workDir)
      const conflictFiles = conflictResult.output.split("\n").filter(Boolean)

      gitSync(["merge", "--abort"], workDir)

      emitEvent(projectRoot, {
        session: sessionId,
        event: "merge:conflict",
        branch: sessionBranch,
        targetBranch,
        conflictFiles,
      })

      return {
        success: false,
        merged: false,
        error: `Merge conflict: ${conflictFiles.join(", ")}`,
        conflictFiles,
      }
    }

    const push = gitSync(["push", "origin", targetBranch], workDir)

    emitEvent(projectRoot, {
      session: sessionId,
      event: "merge:complete",
      branch: sessionBranch,
      targetBranch,
      pushed: push.ok,
    })

    return { success: true, merged: true }
  } finally {
    releaseMergeLock(projectRoot)
  }
}

// ---------------------------------------------------------------------------
// Event Bus
// ---------------------------------------------------------------------------

export function emitEvent(
  projectRoot: string,
  data: Record<string, unknown>
): void {
  ensureSessionsDir(projectRoot)

  const event = { ...data, ts: new Date().toISOString() }
  try {
    flockAppend(eventsPath(projectRoot), JSON.stringify(event))
  } catch {}
}

export function readRecentEvents(
  projectRoot: string,
  count: number = 20
): Record<string, unknown>[] {
  const path = eventsPath(projectRoot)
  if (!existsSync(path)) return []

  try {
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
    return lines.slice(-count).map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gitSync(
  args: string[],
  cwd: string
): { ok: boolean; output: string } {
  try {
    const output = execSync(`git ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`, {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30_000,
    })
    return { ok: true, output: output.trim() }
  } catch (err: any) {
    return { ok: false, output: (err.stderr || err.stdout || err.message || "").trim() }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
