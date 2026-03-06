import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { TrajectoryLoader } from "../trajectory-loader"
import type { JournalEntry } from "../../types/journal"

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "trajectory-loader-test-"))
}

function createJournalDir(projectRoot: string): string {
  const journalDir = path.join(projectRoot, ".jfl", "journal")
  fs.mkdirSync(journalDir, { recursive: true })
  return journalDir
}

function writeJournalFile(
  journalDir: string,
  filename: string,
  entries: Partial<JournalEntry>[]
): void {
  const lines = entries.map((e) => JSON.stringify(e)).join("\n")
  fs.writeFileSync(path.join(journalDir, filename), lines)
}

describe("TrajectoryLoader", () => {
  let projectRoot: string
  let journalDir: string

  beforeEach(() => {
    projectRoot = tmpDir()
    journalDir = createJournalDir(projectRoot)
  })

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true })
  })

  describe("load", () => {
    it("returns empty array when journal directory does not exist", () => {
      const emptyRoot = tmpDir()
      const loader = new TrajectoryLoader(emptyRoot)
      const entries = loader.load()
      expect(entries).toEqual([])
      fs.rmSync(emptyRoot, { recursive: true, force: true })
    })

    it("returns empty array when no JSONL files exist", () => {
      const loader = new TrajectoryLoader(projectRoot)
      const entries = loader.load()
      expect(entries).toEqual([])
    })

    it("loads entries from single JSONL file", () => {
      writeJournalFile(journalDir, "session-test.jsonl", [
        {
          v: 1,
          ts: "2026-03-05T10:00:00Z",
          session: "session-test",
          type: "feature",
          title: "Test feature",
          summary: "A test feature",
        },
      ])

      const loader = new TrajectoryLoader(projectRoot)
      const entries = loader.load()

      expect(entries).toHaveLength(1)
      expect(entries[0].title).toBe("Test feature")
    })

    it("loads entries from multiple JSONL files", () => {
      writeJournalFile(journalDir, "session-a.jsonl", [
        {
          ts: "2026-03-05T10:00:00Z",
          title: "Entry A",
          summary: "From session A",
        },
      ])
      writeJournalFile(journalDir, "session-b.jsonl", [
        {
          ts: "2026-03-05T11:00:00Z",
          title: "Entry B",
          summary: "From session B",
        },
      ])

      const loader = new TrajectoryLoader(projectRoot)
      const entries = loader.load()

      expect(entries).toHaveLength(2)
    })

    it("filters by agent", () => {
      writeJournalFile(journalDir, "test.jsonl", [
        {
          ts: "2026-03-05T10:00:00Z",
          title: "Shadow entry",
          summary: "Test",
          agent_id: "shadow",
        },
        {
          ts: "2026-03-05T11:00:00Z",
          title: "Lobsters entry",
          summary: "Test",
          agent_id: "lobsters",
        },
      ])

      const loader = new TrajectoryLoader(projectRoot)
      const entries = loader.load({ agent: "shadow" })

      expect(entries).toHaveLength(1)
      expect(entries[0].title).toBe("Shadow entry")
    })

    it("filters by type", () => {
      writeJournalFile(journalDir, "test.jsonl", [
        {
          ts: "2026-03-05T10:00:00Z",
          title: "Experiment",
          summary: "Test",
          type: "experiment",
        },
        {
          ts: "2026-03-05T11:00:00Z",
          title: "Feature",
          summary: "Test",
          type: "feature",
        },
      ])

      const loader = new TrajectoryLoader(projectRoot)
      const entries = loader.load({ type: "experiment" })

      expect(entries).toHaveLength(1)
      expect(entries[0].title).toBe("Experiment")
    })

    it("filters by outcome", () => {
      writeJournalFile(journalDir, "test.jsonl", [
        {
          ts: "2026-03-05T10:00:00Z",
          title: "Confirmed experiment",
          summary: "Test",
          outcome: "confirmed",
        },
        {
          ts: "2026-03-05T11:00:00Z",
          title: "Rejected experiment",
          summary: "Test",
          outcome: "rejected",
        },
      ])

      const loader = new TrajectoryLoader(projectRoot)
      const entries = loader.load({ outcome: "confirmed" })

      expect(entries).toHaveLength(1)
      expect(entries[0].title).toBe("Confirmed experiment")
    })

    it("filters by files", () => {
      writeJournalFile(journalDir, "test.jsonl", [
        {
          ts: "2026-03-05T10:00:00Z",
          title: "Changed ranker",
          summary: "Test",
          files: ["src/lib/ranker.ts"],
        },
        {
          ts: "2026-03-05T11:00:00Z",
          title: "Changed features",
          summary: "Test",
          files: ["src/lib/features.ts"],
        },
      ])

      const loader = new TrajectoryLoader(projectRoot)
      const entries = loader.load({ files: ["ranker.ts"] })

      expect(entries).toHaveLength(1)
      expect(entries[0].title).toBe("Changed ranker")
    })

    it("filters by minDelta", () => {
      writeJournalFile(journalDir, "test.jsonl", [
        {
          ts: "2026-03-05T10:00:00Z",
          title: "Big improvement",
          summary: "Test",
          score_delta: 0.1,
        },
        {
          ts: "2026-03-05T11:00:00Z",
          title: "Small improvement",
          summary: "Test",
          score_delta: 0.01,
        },
        {
          ts: "2026-03-05T12:00:00Z",
          title: "No delta",
          summary: "Test",
        },
      ])

      const loader = new TrajectoryLoader(projectRoot)
      const entries = loader.load({ minDelta: 0.05 })

      expect(entries).toHaveLength(1)
      expect(entries[0].title).toBe("Big improvement")
    })

    it("filters by maxAge", () => {
      const now = Date.now()
      const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString()
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString()

      writeJournalFile(journalDir, "test.jsonl", [
        {
          ts: oneHourAgo,
          title: "Recent entry",
          summary: "Test",
        },
        {
          ts: twoDaysAgo,
          title: "Old entry",
          summary: "Test",
        },
      ])

      const loader = new TrajectoryLoader(projectRoot)
      const entries = loader.load({ maxAge: "24h" })

      expect(entries).toHaveLength(1)
      expect(entries[0].title).toBe("Recent entry")
    })

    it("respects limit", () => {
      const entries: Partial<JournalEntry>[] = []
      for (let i = 0; i < 50; i++) {
        entries.push({
          ts: new Date(Date.now() - i * 1000).toISOString(),
          title: `Entry ${i}`,
          summary: "Test",
        })
      }
      writeJournalFile(journalDir, "test.jsonl", entries)

      const loader = new TrajectoryLoader(projectRoot)
      const loaded = loader.load({ limit: 10 })

      expect(loaded).toHaveLength(10)
    })

    it("sorts by recency with score_delta weighting", () => {
      const now = Date.now()

      writeJournalFile(journalDir, "test.jsonl", [
        {
          ts: new Date(now - 3600000).toISOString(), // 1 hour ago
          title: "Older big improvement",
          summary: "Test",
          score_delta: 0.5,
        },
        {
          ts: new Date(now).toISOString(), // now
          title: "Recent small change",
          summary: "Test",
          score_delta: 0.01,
        },
      ])

      const loader = new TrajectoryLoader(projectRoot)
      const entries = loader.load()

      // The older entry with big delta should rank higher due to weighting
      expect(entries).toHaveLength(2)
    })

    it("skips malformed JSON lines", () => {
      const content = [
        '{"ts":"2026-03-05T10:00:00Z","title":"Valid","summary":"Test"}',
        "not valid json",
        '{"ts":"2026-03-05T11:00:00Z","title":"Also valid","summary":"Test"}',
      ].join("\n")

      fs.writeFileSync(path.join(journalDir, "test.jsonl"), content)

      const loader = new TrajectoryLoader(projectRoot)
      const entries = loader.load()

      expect(entries).toHaveLength(2)
    })
  })

  describe("renderForContext", () => {
    it("returns message for empty entries", () => {
      const loader = new TrajectoryLoader(projectRoot)
      const output = loader.renderForContext([])
      expect(output).toBe("No experiment history found.")
    })

    it("renders recent entries with full detail", () => {
      const loader = new TrajectoryLoader(projectRoot)
      const entries: JournalEntry[] = [
        {
          v: 1,
          ts: new Date().toISOString(),
          session: "test",
          type: "experiment",
          status: "complete",
          title: "Recent experiment",
          summary: "Testing hypothesis X",
          hypothesis: "X will improve Y",
          outcome: "confirmed",
          score_delta: 0.05,
          eval_snapshot: { ndcg: 0.72 },
          files: ["src/test.ts"],
          learned: ["X works well"],
        },
      ]

      const output = loader.renderForContext(entries)

      expect(output).toContain("# Experiment History")
      expect(output).toContain("Recent experiment")
      expect(output).toContain("**Hypothesis:** X will improve Y")
      expect(output).toContain("**Outcome:** ✅ confirmed")
      expect(output).toContain("📈 **Score Delta: +0.0500**")
      expect(output).toContain("**Metrics:**")
      expect(output).toContain("ndcg: 0.72")
      expect(output).toContain("**Learned:**")
      expect(output).toContain("X works well")
    })

    it("renders older entries with summary only", () => {
      const loader = new TrajectoryLoader(projectRoot)
      const oldDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

      const entries: JournalEntry[] = [
        {
          v: 1,
          ts: oldDate,
          session: "test",
          type: "experiment",
          status: "complete",
          title: "Old experiment",
          summary: "An old test",
          outcome: "rejected",
          score_delta: -0.02,
          learned: ["This did not work"],
        },
      ]

      const output = loader.renderForContext(entries)

      expect(output).toContain("## Earlier Experiments")
      expect(output).toContain("**Old experiment**")
      expect(output).toContain("Δ -0.020")
      expect(output).toContain("❌")
      expect(output).toContain("*Learned: This did not work*")
    })

    it("shows negative score deltas correctly", () => {
      const loader = new TrajectoryLoader(projectRoot)
      const entries: JournalEntry[] = [
        {
          v: 1,
          ts: new Date().toISOString(),
          session: "test",
          type: "experiment",
          status: "complete",
          title: "Regression",
          summary: "This made things worse",
          score_delta: -0.03,
        },
      ]

      const output = loader.renderForContext(entries)

      expect(output).toContain("📉 **Score Delta: -0.0300**")
    })
  })

  describe("deduplicate", () => {
    it("removes entries with same content hash", () => {
      const loader = new TrajectoryLoader(projectRoot)
      const entries: JournalEntry[] = [
        {
          v: 1,
          ts: "2026-03-05T10:00:00Z",
          session: "test",
          type: "feature",
          status: "complete",
          title: "Same entry",
          summary: "Same summary",
          files: ["same.ts"],
          detail: "Same detail",
        },
        {
          v: 1,
          ts: "2026-03-05T11:00:00Z",
          session: "test2",
          type: "feature",
          status: "complete",
          title: "Same entry",
          summary: "Same summary",
          files: ["same.ts"],
          detail: "Same detail",
        },
      ]

      const deduped = loader.deduplicate(entries)

      expect(deduped).toHaveLength(1)
    })

    it("keeps entries with different content", () => {
      const loader = new TrajectoryLoader(projectRoot)
      const entries: JournalEntry[] = [
        {
          v: 1,
          ts: "2026-03-05T10:00:00Z",
          session: "test",
          type: "feature",
          status: "complete",
          title: "Entry A",
          summary: "Summary A",
          files: ["a.ts"],
        },
        {
          v: 1,
          ts: "2026-03-05T11:00:00Z",
          session: "test",
          type: "feature",
          status: "complete",
          title: "Entry B",
          summary: "Summary B",
          files: ["b.ts"],
        },
      ]

      const deduped = loader.deduplicate(entries)

      expect(deduped).toHaveLength(2)
    })

    it("uses existing diff_hash if present", () => {
      const loader = new TrajectoryLoader(projectRoot)
      const entries: JournalEntry[] = [
        {
          v: 1,
          ts: "2026-03-05T10:00:00Z",
          session: "test",
          type: "feature",
          status: "complete",
          title: "Entry with hash",
          summary: "Test",
          diff_hash: "abc123",
        },
        {
          v: 1,
          ts: "2026-03-05T11:00:00Z",
          session: "test2",
          type: "feature",
          status: "complete",
          title: "Different entry same hash",
          summary: "Different summary",
          diff_hash: "abc123",
        },
      ]

      const deduped = loader.deduplicate(entries)

      expect(deduped).toHaveLength(1)
    })
  })

  describe("getStats", () => {
    it("returns stats for empty journal", () => {
      const loader = new TrajectoryLoader(projectRoot)
      const stats = loader.getStats()

      expect(stats.totalEntries).toBe(0)
      expect(stats.byType).toEqual({})
      expect(stats.byOutcome).toEqual({})
      expect(stats.avgScoreDelta).toBeNull()
      expect(stats.dateRange.earliest).toBeNull()
      expect(stats.dateRange.latest).toBeNull()
    })

    it("computes stats correctly", () => {
      writeJournalFile(journalDir, "test.jsonl", [
        {
          ts: "2026-03-05T10:00:00Z",
          title: "Experiment 1",
          summary: "Test",
          type: "experiment",
          outcome: "confirmed",
          score_delta: 0.1,
        },
        {
          ts: "2026-03-06T10:00:00Z",
          title: "Experiment 2",
          summary: "Test",
          type: "experiment",
          outcome: "rejected",
          score_delta: -0.05,
        },
        {
          ts: "2026-03-07T10:00:00Z",
          title: "Feature",
          summary: "Test",
          type: "feature",
        },
      ])

      const loader = new TrajectoryLoader(projectRoot)
      const stats = loader.getStats()

      expect(stats.totalEntries).toBe(3)
      expect(stats.byType).toEqual({ experiment: 2, feature: 1 })
      expect(stats.byOutcome).toEqual({ confirmed: 1, rejected: 1 })
      expect(stats.avgScoreDelta).toBeCloseTo(0.025, 4)
      expect(stats.dateRange.earliest).toBe("2026-03-05T10:00:00Z")
      expect(stats.dateRange.latest).toBe("2026-03-07T10:00:00Z")
    })
  })
})

describe("duration parsing", () => {
  it("parses days correctly", () => {
    const now = Date.now()
    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString()
    const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()

    const projectRoot = tmpDir()
    const journalDir = createJournalDir(projectRoot)

    writeJournalFile(journalDir, "test.jsonl", [
      { ts: threeDaysAgo, title: "Three days ago", summary: "Test" },
      { ts: oneDayAgo, title: "One day ago", summary: "Test" },
    ])

    const loader = new TrajectoryLoader(projectRoot)
    const entries = loader.load({ maxAge: "2d" })

    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe("One day ago")

    fs.rmSync(projectRoot, { recursive: true, force: true })
  })

  it("parses hours correctly", () => {
    const now = Date.now()
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString()
    const fiveHoursAgo = new Date(now - 5 * 60 * 60 * 1000).toISOString()

    const projectRoot = tmpDir()
    const journalDir = createJournalDir(projectRoot)

    writeJournalFile(journalDir, "test.jsonl", [
      { ts: fiveHoursAgo, title: "Five hours ago", summary: "Test" },
      { ts: twoHoursAgo, title: "Two hours ago", summary: "Test" },
    ])

    const loader = new TrajectoryLoader(projectRoot)
    const entries = loader.load({ maxAge: "3h" })

    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe("Two hours ago")

    fs.rmSync(projectRoot, { recursive: true, force: true })
  })
})
