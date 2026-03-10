/**
 * Custom Footer Extension
 *
 * Rich status footer showing project name, branch, turn count, session
 * duration, model, pipeline deals, active agents, and eval score.
 * Reactive to branch changes and turn updates.
 *
 * Layout: ◆ project [branch] │ T3 2m │ model │ 3 deals │ ✓ 0.89
 *
 * @purpose Custom footer with live project telemetry
 */

import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import type { PiContext, PiTheme, JflConfig } from "./types.js"

interface FooterState {
  turnCount: () => number
  sessionStart: () => number
  model: () => string
}

let projectRoot = ""
let projectName = ""
let projectType = ""
let state: FooterState
let cachedPipelineCount: number | null = null
let pipelineCacheTime = 0
let cachedEvalScore: string | null = null
let evalCacheTime = 0

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h${rm > 0 ? `${rm}m` : ""}`
}

function getPipelineCount(): number | null {
  const now = Date.now()
  if (cachedPipelineCount !== null && now - pipelineCacheTime < 60000) return cachedPipelineCount

  try {
    const output = execSync("./crm list --compact 2>/dev/null | wc -l", {
      cwd: projectRoot,
      timeout: 3000,
      encoding: "utf-8",
    }).trim()
    cachedPipelineCount = parseInt(output, 10) || 0
    pipelineCacheTime = now
    return cachedPipelineCount
  } catch {
    return cachedPipelineCount
  }
}

function getActiveAgentCount(): number {
  try {
    const journalDir = join(projectRoot, ".jfl", "journal")
    if (!existsSync(journalDir)) return 0
    const files = readdirSync(journalDir).filter(f => f.startsWith("session-") && f.endsWith(".jsonl"))
    const now = Date.now()
    let active = 0
    for (const f of files) {
      try {
        const stat = require("fs").statSync(join(journalDir, f))
        if (now - stat.mtimeMs < 300000) active++
      } catch {}
    }
    return active
  } catch {
    return 0
  }
}

function getEvalScore(): string | null {
  const now = Date.now()
  if (cachedEvalScore !== null && now - evalCacheTime < 30000) return cachedEvalScore

  try {
    const evalPath = join(projectRoot, ".jfl", "eval-store.jsonl")
    if (!existsSync(evalPath)) return null
    const lines = readFileSync(evalPath, "utf-8").trim().split("\n").filter(Boolean)
    if (lines.length === 0) return null
    const last = JSON.parse(lines[lines.length - 1])
    if (last.composite !== undefined) {
      cachedEvalScore = last.composite.toFixed(2)
      evalCacheTime = now
      return cachedEvalScore
    }
    return null
  } catch {
    return cachedEvalScore
  }
}

function getJournalCount(): number {
  try {
    const journalDir = join(projectRoot, ".jfl", "journal")
    if (!existsSync(journalDir)) return 0
    let count = 0
    for (const f of readdirSync(journalDir).filter(f => f.endsWith(".jsonl"))) {
      const content = readFileSync(join(journalDir, f), "utf-8").trim()
      count += content.split("\n").filter(Boolean).length
    }
    return count
  } catch {
    return 0
  }
}

export function setupFooter(
  ctx: PiContext,
  config: JflConfig,
  footerState: FooterState
): void {
  projectRoot = ctx.session.projectRoot
  state = footerState

  const configPath = join(projectRoot, ".jfl", "config.json")
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8"))
      projectName = cfg.name ?? projectRoot.split("/").pop() ?? "JFL"
      projectType = cfg.type ?? "gtm"
    } catch {
      projectName = projectRoot.split("/").pop() ?? "JFL"
      projectType = "gtm"
    }
  } else {
    projectName = projectRoot.split("/").pop() ?? "JFL"
    projectType = "gtm"
  }

  if (config.pi?.disable_footer) return

  ctx.ui.setFooter((tui: any, theme: PiTheme, footerData: any) => {
    let disposed = false
    const unsub = footerData?.onBranchChange?.(() => {
      if (!disposed) tui.requestRender()
    })

    return {
      dispose: () => {
        disposed = true
        if (typeof unsub === "function") unsub()
      },

      invalidate() {},

      render(width: number): string[] {
        const turns = state.turnCount()
        const elapsed = formatDuration(Date.now() - state.sessionStart())
        const model = state.model()
        const branch = footerData?.getGitBranch?.() ?? ctx.session.branch

        // ─── Left side: project identity + session info ───────────────
        const bullet = theme.fg("accent", "◆")
        const name = theme.fg("text", projectName)
        const branchStr = theme.fg("muted", `[${branch}]`)
        const turnStr = theme.fg("dim", `T${turns}`)
        const timeStr = theme.fg("dim", elapsed)
        const modelStr = model ? theme.fg("muted", model.split("/").pop() ?? model) : ""

        const leftParts = [
          `${bullet} ${name} ${branchStr}`,
          `${turnStr} ${timeStr}`,
          modelStr,
        ].filter(Boolean)

        const left = leftParts.join(theme.fg("dim", " │ "))

        // ─── Right side: pipeline + agents + eval ─────────────────────
        const rightParts: string[] = []

        const pipeline = getPipelineCount()
        if (pipeline !== null && pipeline > 0) {
          rightParts.push(theme.fg("accent", `${pipeline} deal${pipeline !== 1 ? "s" : ""}`))
        }

        const agents = getActiveAgentCount()
        if (agents > 0) {
          rightParts.push(theme.fg("warning", `${agents} agent${agents !== 1 ? "s" : ""}`))
        }

        const journals = getJournalCount()
        if (journals > 0) {
          rightParts.push(theme.fg("dim", `${journals}j`))
        }

        const evalScore = getEvalScore()
        if (evalScore) {
          const score = parseFloat(evalScore)
          const color = score >= 0.8 ? "success" : score >= 0.5 ? "warning" : "error"
          rightParts.push(theme.fg(color, `✓${evalScore}`))
        }

        const right = rightParts.join(theme.fg("dim", " │ "))

        // ─── Compose line ─────────────────────────────────────────────
        const leftLen = stripAnsi(left).length
        const rightLen = stripAnsi(right).length
        const gap = Math.max(1, width - leftLen - rightLen)

        const line = left + " ".repeat(gap) + right
        return [truncateVisible(line, width)]
      },
    }
  })

  ctx.on("turn:start", () => {
    // Footer auto-rerenders via requestRender when data changes
  })
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "")
}

function truncateVisible(str: string, maxWidth: number): string {
  const visible = stripAnsi(str)
  if (visible.length <= maxWidth) return str
  // Rough truncation — find where visible chars exceed width
  let visCount = 0
  let i = 0
  while (i < str.length && visCount < maxWidth - 1) {
    if (str[i] === "\x1b") {
      const end = str.indexOf("m", i)
      if (end !== -1) { i = end + 1; continue }
    }
    visCount++
    i++
  }
  return str.slice(0, i) + "…"
}
