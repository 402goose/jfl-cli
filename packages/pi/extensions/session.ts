/**
 * JFL Session Extension
 *
 * Handles worktree lifecycle, auto-commit, and session-scoped shell scripts.
 * Delegates to existing shell scripts — doesn't reimplement what already works.
 *
 * @purpose Pi lifecycle → shell script delegation for JFL session management
 */

import { execSync, spawn } from "child_process"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import type { PiContext, JflConfig } from "./types.js"

let autoCommitProcess: ReturnType<typeof spawn> | null = null

function findScript(root: string, scriptName: string): string | null {
  const candidates = [
    join(root, "scripts", "session", scriptName),
    join(root, "scripts", scriptName),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

export async function setupSession(ctx: PiContext, _config: JflConfig): Promise<void> {
  const root = ctx.session.projectRoot

  const initScript = findScript(root, "session-init.sh")
  if (initScript) {
    try {
      execSync(`bash "${initScript}"`, { cwd: root, stdio: "inherit" })
    } catch (err) {
      ctx.log(`session-init.sh failed: ${err}`, "warn")
    }
  }

  const autoCommitScript = findScript(root, "auto-commit.sh")
  if (autoCommitScript) {
    autoCommitProcess = spawn("bash", [autoCommitScript, "start", "120"], {
      cwd: root,
      detached: true,
      stdio: "ignore",
    })
    autoCommitProcess.unref()
    ctx.log("Auto-commit daemon started (120s interval)", "debug")
  }

  ctx.emit("hook:session-start", {
    session: ctx.session.id,
    branch: ctx.session.branch,
    projectRoot: root,
    ts: new Date().toISOString(),
  })
}

export async function onShutdown(ctx: PiContext): Promise<void> {
  const root = ctx.session.projectRoot

  if (autoCommitProcess) {
    try {
      autoCommitProcess.kill()
    } catch {}
    autoCommitProcess = null
  }

  const cleanupScript = findScript(root, "session-cleanup.sh")
  if (cleanupScript) {
    try {
      execSync(`bash "${cleanupScript}"`, { cwd: root, stdio: "inherit" })
    } catch (err) {
      ctx.log(`session-cleanup.sh failed: ${err}`, "warn")
    }
  }

  ctx.emit("hook:session-end", {
    session: ctx.session.id,
    branch: ctx.session.branch,
    ts: new Date().toISOString(),
  })
}

export function getCurrentBranch(root: string): string {
  try {
    return execSync("git branch --show-current", { cwd: root }).toString().trim()
  } catch {
    try {
      const saved = readFileSync(join(root, ".jfl", "current-session-branch.txt"), "utf-8").trim()
      return saved
    } catch {
      return "main"
    }
  }
}
