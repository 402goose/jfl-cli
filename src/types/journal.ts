/**
 * Journal Entry Types
 *
 * Canonical type definitions for JFL journal entries.
 * Journals serve as the replay buffer for in-context RL —
 * agents read past experiment journals to decide what to try next.
 *
 * @purpose Type definitions for journal entries with RL-specific fields
 */

/**
 * Journal entry types
 */
export type JournalEntryType =
  | "experiment"
  | "decision"
  | "discovery"
  | "feature"
  | "milestone"
  | "submission"
  | "fix"
  | "session-end"

/**
 * Entry completion status
 */
export type JournalEntryStatus = "complete" | "incomplete" | "rolled_back"

/**
 * Scientific method outcome for experiments
 */
export type ExperimentOutcome = "confirmed" | "rejected" | "inconclusive"

/**
 * Canonical JournalEntry interface
 *
 * Consolidates journal entry structure used across the codebase.
 * Includes new RL-specific fields for in-context learning.
 */
export interface JournalEntry {
  /** Schema version */
  v: 1

  /** ISO timestamp */
  ts: string

  /** Session identifier (branch name or session ID) */
  session: string

  /** Entry type */
  type: JournalEntryType

  /** Completion status */
  status: JournalEntryStatus

  /** Short title */
  title: string

  /** 2-3 sentence summary */
  summary: string

  /** Full description - what was built, what's stubbed, what's next */
  detail?: string

  /** Files changed */
  files?: string[]

  /** Key learnings from this work */
  learned?: string[]

  /** What should happen next */
  next?: string

  /** Incomplete/stubbed items */
  incomplete?: string[]

  /** Decision slug for linking (e.g., "pricing-model") */
  decision?: string

  // ============================================================================
  // RL-Specific Fields (for in-context learning)
  // ============================================================================

  /**
   * Parent entry ID - what experiment prompted this one.
   * Forms an exploration tree where agents can see which experiments
   * led to which follow-up experiments.
   */
  parent_entry_id?: string

  /**
   * Hypothesis - what you expected to happen.
   * Enables scientific method tracking: hypothesis → experiment → outcome.
   */
  hypothesis?: string

  /**
   * Experiment outcome - did the hypothesis hold?
   */
  outcome?: ExperimentOutcome

  /**
   * Composite score change from this entry.
   * Indexed for fast queries (e.g., "show me all improvements > 0.05").
   */
  score_delta?: number

  /**
   * Inline evaluation metrics snapshot.
   * No join needed - metrics are embedded directly in the entry.
   * Example: { ndcg: 0.72, mrr: 0.65, precision: 0.58 }
   */
  eval_snapshot?: Record<string, number>

  /**
   * Git diff hash for deduplication.
   * Prevents processing the same change multiple times.
   */
  diff_hash?: string

  /**
   * Agent identifier - which agent ran this experiment.
   * Useful for multi-agent setups (shadow, lobsters, phds, etc.)
   */
  agent_id?: string

  /**
   * Entry IDs that were in context when this entry was created.
   * Enables tracking of what past experiments influenced this one.
   */
  context_entries?: string[]
}

/**
 * Partial journal entry for creation (only required fields)
 */
export type JournalEntryCreate = Pick<
  JournalEntry,
  "v" | "ts" | "session" | "type" | "title" | "summary"
> &
  Partial<Omit<JournalEntry, "v" | "ts" | "session" | "type" | "title" | "summary">>

/**
 * Journal entry for legacy compatibility (loose typing)
 *
 * Used when parsing existing journal files that may not conform
 * to the full JournalEntry schema.
 */
export interface JournalEntryLegacy {
  v?: number
  ts?: string
  session?: string
  type?: string
  status?: string
  title?: string
  summary?: string
  detail?: string
  files?: string[]
  learned?: string[]
  incomplete?: string[]
  next?: string
  decision?: string
  [key: string]: unknown
}

/**
 * Type guard to check if an object is a valid JournalEntry
 */
export function isJournalEntry(obj: unknown): obj is JournalEntry {
  if (typeof obj !== "object" || obj === null) return false

  const entry = obj as Record<string, unknown>

  return (
    entry.v === 1 &&
    typeof entry.ts === "string" &&
    typeof entry.session === "string" &&
    typeof entry.type === "string" &&
    typeof entry.title === "string" &&
    typeof entry.summary === "string"
  )
}

/**
 * Normalize a legacy entry to the canonical JournalEntry format
 *
 * Fills in defaults for missing required fields.
 */
export function normalizeJournalEntry(
  legacy: JournalEntryLegacy
): JournalEntry | null {
  // Minimum required fields
  if (!legacy.ts || !legacy.title) {
    return null
  }

  return {
    v: 1,
    ts: legacy.ts,
    session: legacy.session || "unknown",
    type: (legacy.type as JournalEntryType) || "feature",
    status: (legacy.status as JournalEntryStatus) || "complete",
    title: legacy.title,
    summary: legacy.summary || legacy.title,
    detail: legacy.detail,
    files: legacy.files,
    learned: legacy.learned,
    incomplete: legacy.incomplete,
    next: legacy.next,
    decision: legacy.decision,
    // RL fields - extract if present
    parent_entry_id: legacy.parent_entry_id as string | undefined,
    hypothesis: legacy.hypothesis as string | undefined,
    outcome: legacy.outcome as ExperimentOutcome | undefined,
    score_delta: legacy.score_delta as number | undefined,
    eval_snapshot: legacy.eval_snapshot as Record<string, number> | undefined,
    diff_hash: legacy.diff_hash as string | undefined,
    agent_id: legacy.agent_id as string | undefined,
    context_entries: legacy.context_entries as string[] | undefined,
  }
}
