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

function showRecentJournal(ctx: PiContext): void {
  const entries = readRecentEntries(projectRoot, 3)
  if (!entries.length) return
  const lines = ["Recent journal:", ...entries.map(e => `  [${e.type}] ${e.title}`)]
  ctx.ui.setWidget("belowEditor", lines)
}

export async function setupJournal(ctx: PiContext, _config: JflConfig): Promise<void> {
  projectRoot = ctx.session.projectRoot

  showRecentJournal(ctx)

  ctx.registerCommand({
    name: "journal",
    description: "Write a journal entry for the current session",
    async handler(_args, ctx) {
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
        showRecentJournal(ctx)
        ctx.ui.notify("Journal entry saved", { level: "info" })
      } catch {
        ctx.ui.notify("Invalid JSON — entry not saved. Use /journal and paste valid JSON.", { level: "warn" })
      }
    },
  })

  ctx.on("map:journal:entry", () => showRecentJournal(ctx))
}

export async function onToolExecutionEnd(
  ctx: PiContext,
  event: ToolExecutionEvent
): Promise<void> {
  // Pi uses toolName; check for bash tool
  const toolName = event.toolName ?? event.tool ?? ""
  if (toolName.toLowerCase() !== "bash") return

  // Detect git commit from tool output (git commit output contains "[branch hash] message")
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

  const notifyLines = [
    "Git commit detected — write a journal entry with /journal",
    commitMsg ? `Commit: ${commitMsg.split("\n")[0]}` : "",
    commitFiles ? `Files: ${commitFiles.split("\n").slice(0, 3).join(", ")}` : "",
  ].filter(Boolean).join("\n")

  ctx.ui.notify(notifyLines, { level: "info" })
}

export async function onJournalAgentEnd(
  ctx: PiContext,
  event: AgentEndEvent
): Promise<void> {
  // Pi's AgentEndEvent has messages array; count them as turns
  const turnCount = (event.messages?.length ?? event.turnCount ?? 0)
  if (turnCount > 3) {
    ctx.ui.setWidget("aboveEditor", [
      "Journal entry recommended — use /journal to capture what was built.",
    ])
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
