/**
 * Journal Extension
 *
 * Detects git commits via tool_execution_end, prompts for journal entries,
 * registers the /journal command with interactive type selection,
 * shows themed journal stream in below-editor widget.
 *
 * @purpose Auto-journal detection + interactive /journal command + themed widget
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import type { PiContext, PiTheme, JflConfig, AgentEndEvent, ToolExecutionEvent } from "./types.js"
import { getCurrentBranch } from "./session.js"
import { emitCustomEvent } from "./map-bridge.js"

let projectRoot = ""

interface JournalEntry {
  v: number
  ts: string
  session: string
  type: string
  status: string
  title: string
  summary: string
  detail?: string
  files?: string[]
  incomplete?: string[]
  next?: string
  learned?: string[]
}

function getJournalPath(root: string): string {
  const branch = getCurrentBranch(root)
  return join(root, ".jfl", "journal", `${branch}.jsonl`)
}

function appendJournalEntry(root: string, entry: JournalEntry): void {
  const journalPath = getJournalPath(root)
  mkdirSync(join(root, ".jfl", "journal"), { recursive: true })
  appendFileSync(journalPath, JSON.stringify(entry) + "\n")
}

function readRecentEntries(root: string, count = 5): JournalEntry[] {
  const journalPath = getJournalPath(root)
  if (!existsSync(journalPath)) return []
  try {
    const lines = readFileSync(journalPath, "utf-8")
      .split("\n")
      .filter(Boolean)
      .slice(-count)
    return lines.map(l => JSON.parse(l) as JournalEntry)
  } catch {
    return []
  }
}

function hasJournalEntryForSession(root: string, sessionBranch: string): boolean {
  const journalPath = join(root, ".jfl", "journal", `${sessionBranch}.jsonl`)
  if (!existsSync(journalPath)) return false
  const content = readFileSync(journalPath, "utf-8").trim()
  return content.length > 0
}

const TYPE_ICONS: Record<string, string> = {
  feature: "✦",
  fix: "✧",
  decision: "◆",
  discovery: "◇",
  milestone: "★",
  "session-end": "●",
  spec: "□",
}

const TYPE_COLORS: Record<string, string> = {
  feature: "success",
  fix: "error",
  decision: "warning",
  discovery: "accent",
  milestone: "warning",
  "session-end": "dim",
  spec: "muted",
}

function showRecentJournal(ctx: PiContext): void {
  const entries = readRecentEntries(projectRoot, 3)

  ctx.ui.setWidget("jfl-journal", (_tui: any, theme: PiTheme) => {
    if (!entries.length) {
      return {
        render: () => [theme.fg("dim", "No journal entries yet — /journal to write one")],
        invalidate() {},
      }
    }

    const lines: string[] = []
    lines.push(theme.fg("border", "─── ") + theme.fg("dim", "Journal") + theme.fg("border", " ───"))

    for (const e of entries) {
      const icon = TYPE_ICONS[e.type] ?? "·"
      const status = e.status === "incomplete" ? theme.fg("dim", " ◌") : ""
      lines.push(`  ${theme.fg("dim", icon)} ${theme.fg("muted", e.title)}${status}`)
    }

    return { render: () => lines, invalidate() {} }
  }, { placement: "belowEditor" })
}

export async function setupJournal(ctx: PiContext, _config: JflConfig): Promise<void> {
  projectRoot = ctx.session.projectRoot

  showRecentJournal(ctx)

  ctx.registerCommand({
    name: "journal",
    description: "Write a journal entry for the current session",
    async handler(_args, ctx) {
      if (ctx.ui.hasUI) {
        const types = [
          { value: "feature" as const, label: "✦ Feature", description: "Something built or completed" },
          { value: "fix" as const, label: "✧ Fix", description: "Bug found and fixed" },
          { value: "decision" as const, label: "◆ Decision", description: "Choice made between options" },
          { value: "discovery" as const, label: "◇ Discovery", description: "Insight or learning" },
          { value: "milestone" as const, label: "★ Milestone", description: "Major goal reached" },
        ]

        const type = await ctx.ui.select("Journal Entry Type", types)
        if (!type) return

        const title = await ctx.ui.input("Title", "What happened?")
        if (!title?.trim()) return

        const summary = await ctx.ui.input("Summary (2-3 sentences)", "Brief description")

        const entry: JournalEntry = {
          v: 1,
          ts: new Date().toISOString(),
          session: getCurrentBranch(projectRoot),
          type,
          status: "complete",
          title: title.trim(),
          summary: summary?.trim() ?? title.trim(),
        }

        appendJournalEntry(projectRoot, entry)
        await emitCustomEvent(ctx, "journal:entry", entry)
        ctx.emit("journal:written", entry)
        showRecentJournal(ctx)
        ctx.ui.notify(`${TYPE_ICONS[type] ?? "·"} Journal: ${title.trim()}`, { level: "success" })
        ctx.ui.setStatus("journal", undefined)
        return
      }

      // Fallback: raw JSON input for non-interactive mode
      const branch = getCurrentBranch(projectRoot)
      const template = JSON.stringify({
        v: 1,
        ts: new Date().toISOString(),
        session: branch,
        type: "feature",
        status: "complete",
        title: "",
        summary: "",
        detail: "",
        files: [],
      }, null, 2)

      const content = await ctx.ui.input("Journal Entry (paste JSON)", template)
      if (!content?.trim()) return

      try {
        const entry = JSON.parse(content) as JournalEntry
        appendJournalEntry(projectRoot, entry)
        await emitCustomEvent(ctx, "journal:entry", entry)
        ctx.emit("journal:written", entry)
        showRecentJournal(ctx)
        ctx.ui.notify("Journal entry saved", { level: "success" })
      } catch {
        ctx.ui.notify("Invalid JSON — entry not saved. Use /journal and paste valid JSON.", { level: "warn" })
      }
    },
  })

  ctx.on("map:journal:entry", () => showRecentJournal(ctx))
  ctx.on("journal:written", () => showRecentJournal(ctx))
}

export async function onToolExecutionEnd(
  ctx: PiContext,
  event: ToolExecutionEvent
): Promise<void> {
  const toolName = event.toolName ?? event.tool ?? ""
  if (toolName.toLowerCase() !== "bash") return

  const result = String(event.result ?? "")
  const isGitCommit = /\[[\w/.-]+\s+[0-9a-f]{7,}\]/.test(result)
  if (!isGitCommit) return

  let commitMsg = ""
  let commitFiles = ""
  try {
    commitMsg = execSync("git log -1 --pretty=%B", { cwd: projectRoot }).toString().trim()
    commitFiles = execSync("git diff-tree --no-commit-id --name-only -r HEAD", { cwd: projectRoot })
      .toString().trim()
  } catch {}

  ctx.emit("pi:git-commit-detected", { message: commitMsg, files: commitFiles })

  ctx.ui.notify([
    "Git commit detected — Ctrl+Shift+J for quick journal or /journal",
    commitMsg ? `Commit: ${commitMsg.split("\n")[0]}` : "",
    commitFiles ? `Files: ${commitFiles.split("\n").slice(0, 3).join(", ")}` : "",
  ].filter(Boolean).join("\n"), { level: "info" })
}

export async function onJournalAgentEnd(
  _ctx: PiContext,
  _event: AgentEndEvent
): Promise<void> {
  // Removed: "Journal entry recommended" nudge (noisy)
}

export async function checkJournalBeforeCompact(
  ctx: PiContext
): Promise<{ cancel: true } | void> {
  const branch = getCurrentBranch(projectRoot)
  if (!hasJournalEntryForSession(projectRoot, branch)) {
    if (ctx.ui.hasUI) {
      const ok = await ctx.ui.confirm(
        "No Journal Entry",
        "No journal entry for this session. Compacting without one loses context.\n\nContinue anyway?"
      )
      if (!ok) return ctx.cancel()
    } else {
      ctx.ui.notify(
        "No journal entry for this session. Write one with /journal before compacting.",
        { level: "warn" }
      )
      return ctx.cancel()
    }
  }
}
