/**
 * Trajectory Loader
 *
 * Loads, filters, and renders journal trajectories for agent context windows.
 * Journals are the replay buffer for in-context RL — this module makes them
 * queryable and context-window-optimized.
 *
 * @purpose Load and render journal trajectories for in-context RL
 */

import { readFileSync, readdirSync, existsSync } from "fs"
import { join, basename } from "path"
import { createHash } from "crypto"

import type {
  JournalEntry,
  JournalEntryLegacy,
  ExperimentOutcome,
} from "../types/journal.js"
import { normalizeJournalEntry } from "../types/journal.js"

/**
 * Query parameters for filtering trajectories
 */
export interface TrajectoryQuery {
  /** Filter by agent ID */
  agent?: string

  /** Filter by experiments touching these files */
  files?: string[]

  /** Only include improvements above this threshold */
  minDelta?: number

  /** Maximum age (e.g., "7d", "30d", "24h") */
  maxAge?: string

  /** Filter by entry type (e.g., "experiment") */
  type?: string

  /** Maximum entries to return */
  limit?: number

  /** Filter by experiment outcome */
  outcome?: ExperimentOutcome
}

/**
 * Parsed journal entry with source metadata
 */
interface ParsedEntry {
  entry: JournalEntry
  file: string
  lineIndex: number
}

/**
 * Parse a duration string like "7d", "24h", "30m" into milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)\s*([dhms])$/i)
  if (!match) {
    // Default to days if no unit
    const days = parseInt(duration, 10)
    if (!isNaN(days)) {
      return days * 24 * 60 * 60 * 1000
    }
    return 7 * 24 * 60 * 60 * 1000 // Default: 7 days
  }

  const value = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()

  switch (unit) {
    case "d":
      return value * 24 * 60 * 60 * 1000
    case "h":
      return value * 60 * 60 * 1000
    case "m":
      return value * 60 * 1000
    case "s":
      return value * 1000
    default:
      return value * 24 * 60 * 60 * 1000
  }
}

/**
 * Parse a JSONL journal file
 */
function parseJournalFile(filePath: string): ParsedEntry[] {
  const results: ParsedEntry[] = []

  if (!existsSync(filePath)) return results

  let content: string
  try {
    content = readFileSync(filePath, "utf-8")
  } catch {
    return results
  }

  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    try {
      const parsed = JSON.parse(line) as JournalEntryLegacy
      const normalized = normalizeJournalEntry(parsed)
      if (normalized) {
        results.push({
          entry: normalized,
          file: filePath,
          lineIndex: i,
        })
      }
    } catch {
      // Skip malformed lines silently in production
    }
  }

  return results
}

/**
 * Compute a hash for an entry's diff (for deduplication)
 */
function computeEntryHash(entry: JournalEntry): string {
  // If diff_hash already exists, use it
  if (entry.diff_hash) {
    return entry.diff_hash
  }

  // Otherwise compute from content
  const content = JSON.stringify({
    title: entry.title,
    files: entry.files,
    detail: entry.detail,
  })

  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

/**
 * Check if any query files overlap with entry files
 */
function filesOverlap(queryFiles: string[], entryFiles: string[]): boolean {
  if (!queryFiles.length || !entryFiles.length) return false

  for (const qf of queryFiles) {
    for (const ef of entryFiles) {
      // Check if either path contains the other (handles partial paths)
      if (ef.includes(qf) || qf.includes(ef)) {
        return true
      }
      // Check basename match
      if (basename(ef) === basename(qf)) {
        return true
      }
    }
  }

  return false
}

/**
 * TrajectoryLoader class
 *
 * Loads journal entries from .jfl/journal/*.jsonl files,
 * applies filters, and renders for LLM context windows.
 */
export class TrajectoryLoader {
  private projectRoot: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
  }

  /**
   * Get the journal directory path
   */
  private get journalDir(): string {
    return join(this.projectRoot, ".jfl", "journal")
  }

  /**
   * Load and filter journal entries
   */
  load(query: TrajectoryQuery = {}): JournalEntry[] {
    if (!existsSync(this.journalDir)) {
      return []
    }

    // Read all JSONL files
    const files = readdirSync(this.journalDir).filter((f) =>
      f.endsWith(".jsonl")
    )
    if (files.length === 0) {
      return []
    }

    // Parse all entries
    const allEntries: ParsedEntry[] = []
    for (const file of files) {
      const filePath = join(this.journalDir, file)
      const parsed = parseJournalFile(filePath)
      allEntries.push(...parsed)
    }

    // Apply filters
    let filtered = allEntries

    // Filter by agent
    if (query.agent) {
      filtered = filtered.filter((e) => e.entry.agent_id === query.agent)
    }

    // Filter by type
    if (query.type) {
      filtered = filtered.filter((e) => e.entry.type === query.type)
    }

    // Filter by outcome
    if (query.outcome) {
      filtered = filtered.filter((e) => e.entry.outcome === query.outcome)
    }

    // Filter by files
    if (query.files && query.files.length > 0) {
      filtered = filtered.filter(
        (e) => e.entry.files && filesOverlap(query.files!, e.entry.files)
      )
    }

    // Filter by minimum score delta
    if (query.minDelta !== undefined) {
      filtered = filtered.filter(
        (e) =>
          e.entry.score_delta !== undefined &&
          e.entry.score_delta >= query.minDelta!
      )
    }

    // Filter by max age
    if (query.maxAge) {
      const maxAgeMs = parseDuration(query.maxAge)
      const cutoff = Date.now() - maxAgeMs
      filtered = filtered.filter((e) => {
        const entryTime = new Date(e.entry.ts).getTime()
        return entryTime >= cutoff
      })
    }

    // Sort by timestamp descending, weighted by score_delta
    filtered.sort((a, b) => {
      const timeA = new Date(a.entry.ts).getTime()
      const timeB = new Date(b.entry.ts).getTime()

      // Primary sort: recency
      const timeDiff = timeB - timeA

      // Secondary sort: absolute score delta (more significant changes first)
      const deltaA = Math.abs(a.entry.score_delta || 0)
      const deltaB = Math.abs(b.entry.score_delta || 0)

      // Combine: time difference + delta weighting (delta worth up to 1 hour)
      const weightedA = timeA + deltaA * 3600000
      const weightedB = timeB + deltaB * 3600000

      return weightedB - weightedA
    })

    // Apply limit
    const limit = query.limit || 100
    const limited = filtered.slice(0, limit)

    return limited.map((e) => e.entry)
  }

  /**
   * Render entries as markdown optimized for LLM context
   *
   * - Recent entries: full detail
   * - Older entries: summary + learned only
   * - Score deltas highlighted
   * - Hypothesis → outcome pairs prominent
   */
  renderForContext(entries: JournalEntry[]): string {
    if (entries.length === 0) {
      return "No experiment history found."
    }

    const lines: string[] = []
    lines.push("# Experiment History")
    lines.push("")
    lines.push(
      `Found ${entries.length} experiment${entries.length === 1 ? "" : "s"}.`
    )
    lines.push("")

    // Split into recent (last 7 days) and older
    const now = Date.now()
    const recentCutoff = now - 7 * 24 * 60 * 60 * 1000

    const recent: JournalEntry[] = []
    const older: JournalEntry[] = []

    for (const entry of entries) {
      const entryTime = new Date(entry.ts).getTime()
      if (entryTime >= recentCutoff) {
        recent.push(entry)
      } else {
        older.push(entry)
      }
    }

    // Render recent entries with full detail
    if (recent.length > 0) {
      lines.push("## Recent (Last 7 Days)")
      lines.push("")

      for (const entry of recent) {
        lines.push(this.renderEntryFull(entry))
        lines.push("")
      }
    }

    // Render older entries with summary only
    if (older.length > 0) {
      lines.push("## Earlier Experiments")
      lines.push("")

      for (const entry of older) {
        lines.push(this.renderEntrySummary(entry))
        lines.push("")
      }
    }

    return lines.join("\n")
  }

  /**
   * Render a single entry with full detail
   */
  private renderEntryFull(entry: JournalEntry): string {
    const lines: string[] = []

    // Header with type and date
    const date = new Date(entry.ts).toISOString().split("T")[0]
    const typeTag = `[${entry.type}]`
    const statusTag =
      entry.status !== "complete" ? ` (${entry.status})` : ""

    lines.push(`### ${typeTag} ${entry.title}${statusTag}`)
    lines.push(`*${date}*`)

    // Score delta (highlighted)
    if (entry.score_delta !== undefined) {
      const sign = entry.score_delta >= 0 ? "+" : ""
      const emoji = entry.score_delta > 0 ? "📈" : entry.score_delta < 0 ? "📉" : "➡️"
      lines.push(`${emoji} **Score Delta: ${sign}${entry.score_delta.toFixed(4)}**`)
    }

    // Hypothesis → Outcome (prominent)
    if (entry.hypothesis) {
      lines.push("")
      lines.push(`**Hypothesis:** ${entry.hypothesis}`)
      if (entry.outcome) {
        const outcomeEmoji =
          entry.outcome === "confirmed"
            ? "✅"
            : entry.outcome === "rejected"
              ? "❌"
              : "❓"
        lines.push(`**Outcome:** ${outcomeEmoji} ${entry.outcome}`)
      }
    }

    // Summary
    lines.push("")
    lines.push(entry.summary)

    // Detail (if present)
    if (entry.detail) {
      lines.push("")
      lines.push(entry.detail)
    }

    // Eval snapshot (if present)
    if (entry.eval_snapshot && Object.keys(entry.eval_snapshot).length > 0) {
      lines.push("")
      lines.push("**Metrics:**")
      for (const [metric, value] of Object.entries(entry.eval_snapshot)) {
        lines.push(`- ${metric}: ${value}`)
      }
    }

    // Files changed
    if (entry.files && entry.files.length > 0) {
      lines.push("")
      lines.push("**Files:**")
      for (const file of entry.files.slice(0, 5)) {
        lines.push(`- ${file}`)
      }
      if (entry.files.length > 5) {
        lines.push(`- ... and ${entry.files.length - 5} more`)
      }
    }

    // Learnings
    if (entry.learned && entry.learned.length > 0) {
      lines.push("")
      lines.push("**Learned:**")
      for (const learning of entry.learned) {
        lines.push(`- ${learning}`)
      }
    }

    // Agent ID
    if (entry.agent_id) {
      lines.push("")
      lines.push(`*Agent: ${entry.agent_id}*`)
    }

    return lines.join("\n")
  }

  /**
   * Render a single entry with summary only (for older entries)
   */
  private renderEntrySummary(entry: JournalEntry): string {
    const lines: string[] = []

    const date = new Date(entry.ts).toISOString().split("T")[0]

    // One-line summary with score delta
    let summary = `- **${entry.title}** (${date})`

    if (entry.score_delta !== undefined) {
      const sign = entry.score_delta >= 0 ? "+" : ""
      summary += ` | Δ ${sign}${entry.score_delta.toFixed(3)}`
    }

    if (entry.outcome) {
      const outcomeEmoji =
        entry.outcome === "confirmed"
          ? "✅"
          : entry.outcome === "rejected"
            ? "❌"
            : "❓"
      summary += ` ${outcomeEmoji}`
    }

    lines.push(summary)

    // Brief learned (first item only)
    if (entry.learned && entry.learned.length > 0) {
      lines.push(`  *Learned: ${entry.learned[0]}*`)
    }

    return lines.join("\n")
  }

  /**
   * Remove duplicate entries based on diff_hash
   */
  deduplicate(entries: JournalEntry[]): JournalEntry[] {
    const seen = new Set<string>()
    const unique: JournalEntry[] = []

    for (const entry of entries) {
      const hash = computeEntryHash(entry)

      if (!seen.has(hash)) {
        seen.add(hash)
        unique.push(entry)
      }
    }

    return unique
  }

  /**
   * Get statistics about the trajectory history
   */
  getStats(): {
    totalEntries: number
    byType: Record<string, number>
    byOutcome: Record<string, number>
    avgScoreDelta: number | null
    dateRange: { earliest: string | null; latest: string | null }
  } {
    const entries = this.load({ limit: 10000 })

    const byType: Record<string, number> = {}
    const byOutcome: Record<string, number> = {}
    let scoreDeltaSum = 0
    let scoreDeltaCount = 0
    let earliest: string | null = null
    let latest: string | null = null

    for (const entry of entries) {
      // Count by type
      byType[entry.type] = (byType[entry.type] || 0) + 1

      // Count by outcome
      if (entry.outcome) {
        byOutcome[entry.outcome] = (byOutcome[entry.outcome] || 0) + 1
      }

      // Accumulate score deltas
      if (entry.score_delta !== undefined) {
        scoreDeltaSum += entry.score_delta
        scoreDeltaCount++
      }

      // Track date range
      if (!earliest || entry.ts < earliest) {
        earliest = entry.ts
      }
      if (!latest || entry.ts > latest) {
        latest = entry.ts
      }
    }

    return {
      totalEntries: entries.length,
      byType,
      byOutcome,
      avgScoreDelta: scoreDeltaCount > 0 ? scoreDeltaSum / scoreDeltaCount : null,
      dateRange: { earliest, latest },
    }
  }
}
