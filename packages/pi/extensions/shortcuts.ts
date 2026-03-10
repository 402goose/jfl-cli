/**
 * Keyboard Shortcuts Extension
 *
 * Registers Ctrl+H (HUD overlay), Ctrl+J (quick journal), Ctrl+G (agent grid).
 * Each opens an interactive overlay — no slash commands needed.
 *
 * @purpose Keyboard shortcuts for instant TUI overlays
 */

import { existsSync, readFileSync, readdirSync, appendFileSync, mkdirSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import type { PiContext, PiTheme, JflConfig } from "./types.js"
import { getCurrentBranch } from "./session.js"

let projectRoot = ""

// ─── HUD Overlay ────────────────────────────────────────────────────────────

function buildHudOverlayData(root: string) {
  const config = existsSync(join(root, ".jfl", "config.json"))
    ? JSON.parse(readFileSync(join(root, ".jfl", "config.json"), "utf-8"))
    : {}

  const name = config.name ?? root.split("/").pop() ?? "JFL"
  const type = config.type ?? "gtm"

  let phase = "unknown"
  let launchDate = ""
  const roadmapPath = join(root, "knowledge", "ROADMAP.md")
  if (existsSync(roadmapPath)) {
    const content = readFileSync(roadmapPath, "utf-8")
    const phaseMatch = content.match(/## (?:Phase|Current Phase)[:\s]*([^\n]+)/i)
    if (phaseMatch) phase = phaseMatch[1].trim()
    const dateMatch = content.match(/(\d{4}-\d{2}-\d{2})/m)
    if (dateMatch) {
      launchDate = dateMatch[1]
      const diff = Math.ceil((new Date(dateMatch[1]).getTime() - Date.now()) / 86400000)
      launchDate = diff > 0 ? `${dateMatch[1]} (${diff}d away)` : `${dateMatch[1]} (${Math.abs(diff)}d ago)`
    }
  }

  const journalDir = join(root, ".jfl", "journal")
  const recentJournal: string[] = []
  if (existsSync(journalDir)) {
    const files = readdirSync(journalDir).filter(f => f.endsWith(".jsonl")).sort()
    for (const f of files.slice(-3)) {
      try {
        const lines = readFileSync(join(journalDir, f), "utf-8").trim().split("\n").filter(Boolean)
        for (const l of lines.slice(-3)) {
          const e = JSON.parse(l)
          recentJournal.push(`[${e.type}] ${e.title}`)
        }
      } catch {}
    }
  }

  let branch = "main"
  try { branch = execSync("git branch --show-current", { cwd: root, stdio: ["pipe", "pipe", "ignore"] }).toString().trim() } catch {}

  return { name, type, phase, launchDate, branch, recentJournal: recentJournal.slice(-5) }
}

async function showHudOverlay(ctx: PiContext): Promise<void> {
  if (!ctx.ui.hasUI) return

  const data = buildHudOverlayData(projectRoot)

  await ctx.ui.custom<void>((tui: any, theme: PiTheme, _kb: any, done: (r: void) => void) => {
    return {
      handleInput(key: string) {
        // Any of: escape, q, h
        if (key === "\x1b" || key === "q" || key === "h") done(undefined)
      },

      render(width: number): string[] {
        const w = Math.min(width, 72)
        const inner = w - 4
        const lines: string[] = []

        const hr = theme.fg("border", "─".repeat(w))
        const pad = (s: string) => `  ${s}`

        lines.push("")
        lines.push(pad(`${theme.fg("accent", "◆")} ${theme.bold(data.name)} ${theme.fg("muted", `[${data.type}]`)} ${theme.fg("dim", `on ${data.branch}`)}`))
        lines.push(hr)
        lines.push("")

        lines.push(pad(`${theme.fg("accent", "Phase")}   ${theme.fg("text", data.phase)}`))
        if (data.launchDate) {
          lines.push(pad(`${theme.fg("accent", "Launch")}  ${theme.fg("text", data.launchDate)}`))
        }

        lines.push("")
        lines.push(pad(theme.fg("accent", "Recent Journal")))
        if (data.recentJournal.length === 0) {
          lines.push(pad(theme.fg("dim", "  No entries yet")))
        } else {
          for (const entry of data.recentJournal) {
            lines.push(pad(theme.fg("muted", `  ${entry}`)))
          }
        }

        lines.push("")
        lines.push(pad(theme.fg("dim", "Esc/q close  │  /hud full dashboard")))
        lines.push("")

        return lines
      },

      invalidate() {},
    }
  }, { overlay: true })
}

// ─── Quick Journal Overlay ──────────────────────────────────────────────────

async function showJournalOverlay(ctx: PiContext): Promise<void> {
  if (!ctx.ui.hasUI) return

  const types = ["feature", "fix", "decision", "discovery", "milestone"]

  const type = await ctx.ui.select("Journal Entry Type", types.map(t => ({
    value: t,
    label: t,
    description: t === "feature" ? "Something built" : t === "fix" ? "Bug fixed" : t === "decision" ? "Choice made" : t === "discovery" ? "Insight learned" : "Goal reached",
  })))

  if (!type) return

  const title = await ctx.ui.input("Title", "What happened?")
  if (!title?.trim()) return

  const summary = await ctx.ui.input("Summary", "2-3 sentences")
  if (!summary?.trim()) return

  const entry = {
    v: 1,
    ts: new Date().toISOString(),
    session: getCurrentBranch(projectRoot),
    type,
    status: "complete",
    title: title.trim(),
    summary: summary.trim(),
  }

  const journalPath = join(projectRoot, ".jfl", "journal", `${getCurrentBranch(projectRoot)}.jsonl`)
  mkdirSync(join(projectRoot, ".jfl", "journal"), { recursive: true })
  appendFileSync(journalPath, JSON.stringify(entry) + "\n")

  ctx.ui.notify(`Journal: ${title.trim()}`, { level: "success" })
  ctx.emit("journal:written", entry)
}

// ─── Agent Grid Overlay ─────────────────────────────────────────────────────

async function showGridOverlay(ctx: PiContext): Promise<void> {
  if (!ctx.ui.hasUI) return

  await ctx.ui.custom<void>((_tui: any, theme: PiTheme, _kb: any, done: (r: void) => void) => {
    let interval: ReturnType<typeof setInterval> | null = null
    const agents: Array<{ name: string; status: string; task: string; age: string }> = []

    function refreshAgents() {
      agents.length = 0
      const journalDir = join(projectRoot, ".jfl", "journal")
      if (!existsSync(journalDir)) return
      const now = Date.now()
      for (const f of readdirSync(journalDir)) {
        if (!f.startsWith("session-") || !f.endsWith(".jsonl")) continue
        try {
          const stat = require("fs").statSync(join(journalDir, f))
          const age = now - stat.mtimeMs
          if (age < 600000) {
            const name = f.replace(".jsonl", "").replace("session-", "").slice(0, 20)
            agents.push({
              name,
              status: age < 120000 ? "active" : "idle",
              task: "session",
              age: age < 60000 ? `${Math.floor(age / 1000)}s` : `${Math.floor(age / 60000)}m`,
            })
          }
        } catch {}
      }
    }

    refreshAgents()
    interval = setInterval(() => { refreshAgents(); _tui.requestRender() }, 5000)

    return {
      handleInput(key: string) {
        if (key === "\x1b" || key === "q" || key === "g") {
          if (interval) clearInterval(interval)
          done(undefined)
        }
      },

      render(width: number): string[] {
        const lines: string[] = []
        lines.push("")
        lines.push(`  ${theme.fg("accent", "◆")} ${theme.bold("Agent Grid")} ${theme.fg("dim", `(${agents.length} sessions)`)}`)
        lines.push(`  ${theme.fg("border", "─".repeat(Math.min(width - 4, 60)))}`)
        lines.push("")

        if (agents.length === 0) {
          lines.push(`  ${theme.fg("dim", "No active sessions detected")}`)
          lines.push(`  ${theme.fg("dim", "Sessions appear here when .jfl/journal/ files are recent")}`)
        } else {
          for (const a of agents) {
            const icon = a.status === "active" ? theme.fg("success", "●") : theme.fg("dim", "○")
            lines.push(`  ${icon} ${theme.fg("text", a.name)} ${theme.fg("dim", a.age)}`)
          }
        }

        lines.push("")
        lines.push(`  ${theme.fg("dim", "Esc/q close  │  refreshes every 5s")}`)
        lines.push("")
        return lines
      },

      invalidate() {},
    }
  }, { overlay: true })
}

// ─── Setup ──────────────────────────────────────────────────────────────────

export function setupShortcuts(ctx: PiContext, _config: JflConfig): void {
  projectRoot = ctx.session.projectRoot

  ctx.registerShortcut("ctrl+shift+h", {
    description: "JFL: HUD overlay",
    handler: () => showHudOverlay(ctx),
  })

  ctx.registerShortcut("ctrl+shift+j", {
    description: "JFL: Quick journal entry",
    handler: () => showJournalOverlay(ctx),
  })

  ctx.registerShortcut("ctrl+shift+g", {
    description: "JFL: Agent grid",
    handler: () => showGridOverlay(ctx),
  })

  ctx.registerCommand({
    name: "shortcuts",
    description: "Show JFL keyboard shortcuts",
    async handler(_args, ctx) {
      ctx.ui.notify([
        "JFL Shortcuts:",
        "  Ctrl+Shift+H  HUD overlay",
        "  Ctrl+Shift+J  Quick journal",
        "  Ctrl+Shift+G  Agent grid",
      ].join("\n"), { level: "info" })
    },
  })
}
