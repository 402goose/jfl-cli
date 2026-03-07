import type {
  JournalEntry,
  JournalEntryType,
  JournalEntryStatus,
  ExperimentOutcome,
  JournalEntryLegacy,
} from "../journal"
import { isJournalEntry, normalizeJournalEntry } from "../journal"

describe("JournalEntry type definitions", () => {
  it("accepts valid entry types", () => {
    const types: JournalEntryType[] = [
      "experiment",
      "decision",
      "discovery",
      "feature",
      "milestone",
      "submission",
      "fix",
      "session-end",
    ]
    expect(types).toHaveLength(8)
  })

  it("accepts valid status values", () => {
    const statuses: JournalEntryStatus[] = [
      "complete",
      "incomplete",
      "rolled_back",
    ]
    expect(statuses).toHaveLength(3)
  })

  it("accepts valid experiment outcomes", () => {
    const outcomes: ExperimentOutcome[] = [
      "confirmed",
      "rejected",
      "inconclusive",
    ]
    expect(outcomes).toHaveLength(3)
  })

  it("creates valid JournalEntry with minimum fields", () => {
    const entry: JournalEntry = {
      v: 1,
      ts: new Date().toISOString(),
      session: "session-test-20260305",
      type: "feature",
      status: "complete",
      title: "Test entry",
      summary: "A test journal entry",
    }
    expect(entry.v).toBe(1)
    expect(entry.type).toBe("feature")
    expect(entry.status).toBe("complete")
  })

  it("creates valid JournalEntry with all RL fields", () => {
    const entry: JournalEntry = {
      v: 1,
      ts: new Date().toISOString(),
      session: "session-shadow-20260305",
      type: "experiment",
      status: "complete",
      title: "Test hypothesis validation",
      summary: "Testing whether approach X improves score",
      detail: "Full experiment details here...",
      files: ["src/lib/ranker.ts", "src/lib/features.ts"],
      learned: ["Approach X works when combined with Y"],
      next: "Try combining with approach Z",
      // RL-specific fields
      parent_entry_id: "abc123",
      hypothesis: "Adding feature X will improve NDCG by 5%",
      outcome: "confirmed",
      score_delta: 0.047,
      eval_snapshot: {
        ndcg: 0.72,
        mrr: 0.65,
        precision: 0.58,
      },
      diff_hash: "a1b2c3d4e5f6",
      agent_id: "shadow",
      context_entries: ["entry-1", "entry-2", "entry-3"],
    }

    expect(entry.type).toBe("experiment")
    expect(entry.outcome).toBe("confirmed")
    expect(entry.score_delta).toBe(0.047)
    expect(entry.eval_snapshot?.ndcg).toBe(0.72)
    expect(entry.agent_id).toBe("shadow")
    expect(entry.context_entries).toHaveLength(3)
  })
})

describe("isJournalEntry type guard", () => {
  it("returns true for valid entries", () => {
    const entry = {
      v: 1,
      ts: "2026-03-05T10:00:00Z",
      session: "session-test",
      type: "feature",
      status: "complete",
      title: "Test",
      summary: "Test summary",
    }
    expect(isJournalEntry(entry)).toBe(true)
  })

  it("returns false for null", () => {
    expect(isJournalEntry(null)).toBe(false)
  })

  it("returns false for undefined", () => {
    expect(isJournalEntry(undefined)).toBe(false)
  })

  it("returns false for non-objects", () => {
    expect(isJournalEntry("string")).toBe(false)
    expect(isJournalEntry(123)).toBe(false)
    expect(isJournalEntry([])).toBe(false)
  })

  it("returns false for wrong version", () => {
    const entry = {
      v: 2,
      ts: "2026-03-05T10:00:00Z",
      session: "session-test",
      type: "feature",
      title: "Test",
      summary: "Test summary",
    }
    expect(isJournalEntry(entry)).toBe(false)
  })

  it("returns false for missing required fields", () => {
    expect(isJournalEntry({ v: 1, ts: "2026-03-05" })).toBe(false)
    expect(isJournalEntry({ v: 1, ts: "2026-03-05", session: "test" })).toBe(false)
    expect(
      isJournalEntry({ v: 1, ts: "2026-03-05", session: "test", type: "feature" })
    ).toBe(false)
  })

  it("returns false for wrong field types", () => {
    expect(
      isJournalEntry({
        v: 1,
        ts: 12345, // should be string
        session: "test",
        type: "feature",
        title: "Test",
        summary: "Test",
      })
    ).toBe(false)
  })
})

describe("normalizeJournalEntry", () => {
  it("normalizes legacy entry with all fields", () => {
    const legacy: JournalEntryLegacy = {
      v: 1,
      ts: "2026-03-05T10:00:00Z",
      session: "session-test",
      type: "feature",
      status: "complete",
      title: "Test feature",
      summary: "Test summary",
      detail: "Test detail",
      files: ["file.ts"],
      learned: ["Something learned"],
    }

    const normalized = normalizeJournalEntry(legacy)

    expect(normalized).not.toBeNull()
    expect(normalized!.v).toBe(1)
    expect(normalized!.type).toBe("feature")
    expect(normalized!.files).toEqual(["file.ts"])
  })

  it("returns null for entry missing ts", () => {
    const legacy: JournalEntryLegacy = {
      title: "Test",
      summary: "Test",
    }

    expect(normalizeJournalEntry(legacy)).toBeNull()
  })

  it("returns null for entry missing title", () => {
    const legacy: JournalEntryLegacy = {
      ts: "2026-03-05T10:00:00Z",
      summary: "Test",
    }

    expect(normalizeJournalEntry(legacy)).toBeNull()
  })

  it("fills in defaults for missing optional fields", () => {
    const legacy: JournalEntryLegacy = {
      ts: "2026-03-05T10:00:00Z",
      title: "Minimal entry",
    }

    const normalized = normalizeJournalEntry(legacy)

    expect(normalized).not.toBeNull()
    expect(normalized!.v).toBe(1)
    expect(normalized!.session).toBe("unknown")
    expect(normalized!.type).toBe("feature")
    expect(normalized!.status).toBe("complete")
    expect(normalized!.summary).toBe("Minimal entry") // defaults to title
  })

  it("preserves RL fields from legacy entry", () => {
    const legacy: JournalEntryLegacy = {
      ts: "2026-03-05T10:00:00Z",
      title: "Experiment",
      summary: "Test experiment",
      type: "experiment",
      hypothesis: "X will improve Y",
      outcome: "confirmed",
      score_delta: 0.05,
      eval_snapshot: { ndcg: 0.7 },
      agent_id: "shadow",
      context_entries: ["e1", "e2"],
    }

    const normalized = normalizeJournalEntry(legacy)

    expect(normalized).not.toBeNull()
    expect(normalized!.hypothesis).toBe("X will improve Y")
    expect(normalized!.outcome).toBe("confirmed")
    expect(normalized!.score_delta).toBe(0.05)
    expect(normalized!.eval_snapshot).toEqual({ ndcg: 0.7 })
    expect(normalized!.agent_id).toBe("shadow")
    expect(normalized!.context_entries).toEqual(["e1", "e2"])
  })
})
