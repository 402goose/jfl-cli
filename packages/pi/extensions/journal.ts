/**
 * Journal Extension
 *
 * Detects git commits via tool_execution_end, prompts for journal entries,
 * registers the /journal command, and shows journal stream in footer.
 *
 * @purpose Auto-journal detection after git commits + /journal command
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import type { PiContext, JflConfig, AgentEndEvent, ToolExecutionEvent } from "./types.js"
import { getCurrentBranch } from "./session.js"
import { emitCustomEvent } from "./map-bridge.js"

let projectRoot = ""
const FOOTER_COLORS: Record<string, string> = {
  feature: "green",
  fix: "red",
  decision: "yellow",
  discovery: "blue",
  milestone: "magenta",
}

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

function readRecentEntries(root: string, count = 3): JournalEntry[] {
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

function updateFooter(ctx: PiContext): void {
  const entries = readRecentEntries(projectRoot, 3)
  if (!entries.length) return

  const lines = entries.map(e => {
    const color = FOOTER_COLORS[e.type] ?? "white"
    return `{${color}-fg}[${e.type}]{/${color}-fg} ${e.title}`
  })

  ctx.ui.setFooter(["Journal:", ...lines])
}

export async function setupJournal(ctx: PiContext, _config: JflConfig): Promise<void> {
  projectRoot = ctx.session.projectRoot

  updateFooter(ctx)

  ctx.registerCommand({
    name: "journal",
    description: "Write a journal entry for the current session",
    async handler(_args, ctx) {
      const branch = getCurrentBranch(projectRoot)
      const initial = JSON.stringify({
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

      const content = await ctx.ui.editor({ title: "Write Journal Entry", initial })
      if (!content?.trim()) return

      try {
        const entry = JSON.parse(content) as JournalEntry
        appendJournalEntry(projectRoot, entry)
        await emitCustomEvent(ctx, "journal:entry", entry)
        updateFooter(ctx)
        ctx.ui.notify("Journal entry saved", { level: "info" })
      } catch {
        ctx.ui.notify("Invalid JSON — entry not saved", { level: "error" })
      }
    },
  })

  ctx.on("map:journal:entry", () => updateFooter(ctx))
}

export async function onToolExecutionEnd(
  ctx: PiContext,
  event: ToolExecutionEvent
): Promise<void> {
  if (event.tool !== "Bash") return

  const input = (event.input as Record<string, string> | undefined)
  const command = input?.command ?? ""
  if (!command.includes("git commit")) return

  let commitMsg = ""
  let commitFiles = ""
  try {
    commitMsg = execSync("git log -1 --pretty=%B", { cwd: projectRoot }).toString().trim()
    commitFiles = execSync("git diff-tree --no-commit-id --name-only -r HEAD", { cwd: projectRoot })
      .toString().trim()
  } catch {}

  ctx.emit("pi:git-commit-detected", { message: commitMsg, files: commitFiles })

  ctx.ui.notify(
    [
      "Git commit detected — journal entry required.",
      `Commit: ${commitMsg}`,
      commitFiles ? `Files: ${commitFiles.split("\n").slice(0, 3).join(", ")}` : "",
      "Use /journal to write the entry now.",
    ].filter(Boolean).join("\n"),
    { level: "info" }
  )
}

export async function onJournalAgentEnd(
  ctx: PiContext,
  event: AgentEndEvent
): Promise<void> {
  if ((event.turnCount ?? 0) > 3) {
    ctx.ui.setWidget("journal-reminder", [
      "Journal entry recommended for this session.",
      "Use /journal to capture what was built.",
    ], { placement: "aboveEditor", color: "yellow" })
  }
}

export async function checkJournalBeforeCompact(
  ctx: PiContext
): Promise<{ cancel: true } | void> {
  const branch = getCurrentBranch(projectRoot)
  if (!hasJournalEntryForSession(projectRoot, branch)) {
    ctx.ui.notify(
      "No journal entry for this session. Write one with /journal before compacting.",
      { level: "warn" }
    )
    return ctx.cancel()
  }
}
