/**
 * @purpose Tests for tuple-miner module — mine training tuples from journals and events
 */

import { join } from "path"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import {
  mineJournalTuples,
  mineFlowTuples,
  mineSessionTuples,
  mineEvalTuples,
  mineAll,
} from "../tuple-miner.js"

const TEST_DIR = join(process.cwd(), ".test-fixtures-tuple-miner")

function setupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true })
  }
  mkdirSync(join(TEST_DIR, ".jfl", "journal"), { recursive: true })
}

function cleanupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true })
  }
}

function writeJournalEntry(filename: string, entries: object[]) {
  const content = entries.map(e => JSON.stringify(e)).join("\n")
  writeFileSync(join(TEST_DIR, ".jfl", "journal", filename), content)
}

function writeMapEvents(events: object[]) {
  const content = events.map(e => JSON.stringify(e)).join("\n")
  writeFileSync(join(TEST_DIR, ".jfl", "map-events.jsonl"), content)
}

describe("tuple-miner", () => {
  beforeEach(() => {
    setupTestDir()
  })

  afterAll(() => {
    cleanupTestDir()
  })

  describe("mineJournalTuples", () => {
    it("returns empty array when no journal exists", () => {
      const emptyDir = join(TEST_DIR, "empty-project")
      mkdirSync(emptyDir, { recursive: true })

      const tuples = mineJournalTuples(emptyDir)

      expect(tuples).toEqual([])
    })

    it("skips session-type entries", () => {
      writeJournalEntry("main.jsonl", [
        {
          ts: "2024-01-01T10:00:00Z",
          type: "session",
          title: "Session started",
          summary: "Starting work",
        },
        {
          ts: "2024-01-01T10:01:00Z",
          type: "session-end",
          title: "Session ended",
          summary: "Done for today",
        },
      ])

      const tuples = mineJournalTuples(TEST_DIR)

      expect(tuples).toHaveLength(0)
    })

    it("mines feature entries with correct action type", () => {
      writeJournalEntry("main.jsonl", [
        {
          ts: "2024-01-01T10:00:00Z",
          type: "feature",
          status: "complete",
          title: "Add login form",
          summary: "Built the login form component",
          files: ["src/components/LoginForm.tsx"],
        },
      ])

      const tuples = mineJournalTuples(TEST_DIR)

      expect(tuples).toHaveLength(1)
      expect(tuples[0].action.type).toBe("feature")
      expect(tuples[0].action.description).toContain("Add login form")
      expect(tuples[0].action.files_affected).toContain("src/components/LoginForm.tsx")
      expect(tuples[0].reward.improved).toBe(true)
    })

    it("mines fix entries with correct action type", () => {
      writeJournalEntry("bugfix.jsonl", [
        {
          ts: "2024-01-02T10:00:00Z",
          type: "fix",
          title: "Fix null pointer",
          summary: "Handle null case in parser",
          files: ["src/parser.ts"],
        },
      ])

      const tuples = mineJournalTuples(TEST_DIR)

      expect(tuples).toHaveLength(1)
      expect(tuples[0].action.type).toBe("fix")
    })

    it("mines decision entries as config type", () => {
      writeJournalEntry("decisions.jsonl", [
        {
          ts: "2024-01-03T10:00:00Z",
          type: "decision",
          title: "Use PostgreSQL",
          summary: "Decided on PostgreSQL over MySQL",
        },
      ])

      const tuples = mineJournalTuples(TEST_DIR)

      expect(tuples).toHaveLength(1)
      expect(tuples[0].action.type).toBe("config")
    })

    it("mines experiment/discovery entries", () => {
      writeJournalEntry("discovery.jsonl", [
        {
          ts: "2024-01-04T10:00:00Z",
          type: "discovery",
          title: "Found performance issue",
          summary: "N+1 queries in dashboard",
        },
      ])

      const tuples = mineJournalTuples(TEST_DIR)

      expect(tuples).toHaveLength(1)
      expect(tuples[0].action.type).toBe("experiment")
    })

    it("mines milestone entries as feature type", () => {
      writeJournalEntry("milestone.jsonl", [
        {
          ts: "2024-01-05T10:00:00Z",
          type: "milestone",
          title: "MVP complete",
          summary: "All core features working",
          files: [
            "src/app.ts",
            "src/api/routes.ts",
            "src/db/schema.ts",
            "src/ui/Dashboard.tsx",
            "src/ui/Settings.tsx",
          ],
        },
      ])

      const tuples = mineJournalTuples(TEST_DIR)

      expect(tuples).toHaveLength(1)
      expect(tuples[0].action.type).toBe("feature")
      expect(tuples[0].reward.composite_delta).toBe(0.05) // milestone has highest reward
    })

    it("infers scope based on file count", () => {
      writeJournalEntry("scope-test.jsonl", [
        {
          ts: "2024-01-06T10:00:00Z",
          type: "feature",
          title: "Small change",
          summary: "One file",
          files: ["src/a.ts"],
        },
        {
          ts: "2024-01-06T10:01:00Z",
          type: "feature",
          title: "Medium change",
          summary: "Five files",
          files: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"],
        },
        {
          ts: "2024-01-06T10:02:00Z",
          type: "feature",
          title: "Large change",
          summary: "Many files",
          files: [
            "src/a.ts",
            "src/b.ts",
            "src/c.ts",
            "src/d.ts",
            "src/e.ts",
            "src/f.ts",
            "src/g.ts",
            "src/h.ts",
          ],
        },
      ])

      const tuples = mineJournalTuples(TEST_DIR)

      expect(tuples[0].action.scope).toBe("small")
      expect(tuples[1].action.scope).toBe("medium")
      expect(tuples[2].action.scope).toBe("large")
    })

    it("uses score_delta when provided", () => {
      writeJournalEntry("with-score.jsonl", [
        {
          ts: "2024-01-07T10:00:00Z",
          type: "experiment",
          title: "Test improvement",
          summary: "Made tests faster",
          score_delta: 0.15,
        },
      ])

      const tuples = mineJournalTuples(TEST_DIR)

      expect(tuples[0].reward.composite_delta).toBe(0.15)
      expect(tuples[0].reward.improved).toBe(true)
    })

    it("handles blocked status with negative reward", () => {
      writeJournalEntry("blocked.jsonl", [
        {
          ts: "2024-01-08T10:00:00Z",
          type: "feature",
          status: "blocked",
          title: "Blocked feature",
          summary: "Waiting on API access",
        },
      ])

      const tuples = mineJournalTuples(TEST_DIR)

      expect(tuples[0].reward.composite_delta).toBe(-0.01)
      expect(tuples[0].reward.improved).toBe(false)
    })

    it("handles incomplete status", () => {
      writeJournalEntry("incomplete.jsonl", [
        {
          ts: "2024-01-09T10:00:00Z",
          type: "feature",
          status: "incomplete",
          title: "Incomplete work",
          summary: "Still in progress",
        },
      ])

      const tuples = mineJournalTuples(TEST_DIR)

      expect(tuples[0].reward.composite_delta).toBe(-0.005)
      expect(tuples[0].reward.quality_score).toBe(0.3)
    })

    it("extracts agent from session name", () => {
      writeJournalEntry("session-goose-20240101-test.jsonl", [
        {
          ts: "2024-01-10T10:00:00Z",
          type: "feature",
          title: "Test",
          summary: "Testing",
          session: "session-goose-20240101-test",
        },
      ])

      const tuples = mineJournalTuples(TEST_DIR)

      expect(tuples[0].agent).toBe("goose")
    })

    it("tracks recent deltas across entries", () => {
      const entries = Array.from({ length: 15 }, (_, i) => ({
        ts: `2024-01-01T${String(i).padStart(2, "0")}:00:00Z`,
        type: "feature",
        title: `Feature ${i}`,
        summary: `Feature number ${i}`,
      }))

      writeJournalEntry("many-entries.jsonl", entries)

      const tuples = mineJournalTuples(TEST_DIR)

      // After 15 entries, recent_deltas should have at most 10 items (capped at 10)
      const lastTuple = tuples[tuples.length - 1]
      expect(lastTuple.state.recent_deltas.length).toBeLessThanOrEqual(10)
    })

    it("aggregates entries from multiple journal files", () => {
      writeJournalEntry("file1.jsonl", [
        {
          ts: "2024-01-01T10:00:00Z",
          type: "feature",
          title: "Feature 1",
          summary: "First",
        },
      ])

      writeJournalEntry("file2.jsonl", [
        {
          ts: "2024-01-02T10:00:00Z",
          type: "fix",
          title: "Fix 1",
          summary: "Second",
        },
      ])

      const tuples = mineJournalTuples(TEST_DIR)

      expect(tuples).toHaveLength(2)
    })

    it("sorts entries by timestamp", () => {
      writeJournalEntry("unsorted.jsonl", [
        {
          ts: "2024-01-03T10:00:00Z",
          type: "feature",
          title: "Third",
          summary: "C",
        },
        {
          ts: "2024-01-01T10:00:00Z",
          type: "feature",
          title: "First",
          summary: "A",
        },
        {
          ts: "2024-01-02T10:00:00Z",
          type: "feature",
          title: "Second",
          summary: "B",
        },
      ])

      const tuples = mineJournalTuples(TEST_DIR)

      expect(tuples[0].action.description).toContain("First")
      expect(tuples[1].action.description).toContain("Second")
      expect(tuples[2].action.description).toContain("Third")
    })
  })

  describe("mineFlowTuples", () => {
    it("returns empty array when no map events exist", () => {
      const tuples = mineFlowTuples(TEST_DIR)

      expect(tuples).toEqual([])
    })

    it("mines flow trigger events", () => {
      writeMapEvents([
        {
          ts: "2024-01-01T10:00:00Z",
          type: "flow:triggered",
          data: {
            flow_name: "auto-commit",
            trigger_event_type: "session:started",
          },
        },
      ])

      const tuples = mineFlowTuples(TEST_DIR)

      expect(tuples).toHaveLength(1)
      expect(tuples[0].action.description).toContain("auto-commit")
      expect(tuples[0].action.description).toContain("session:started")
    })

    it("rewards completed flows", () => {
      writeMapEvents([
        {
          ts: "2024-01-01T10:00:00Z",
          type: "flow:triggered",
          data: { flow_name: "test-flow" },
        },
        {
          ts: "2024-01-01T10:00:30Z",
          type: "flow:completed",
          data: { flow_name: "test-flow" },
        },
      ])

      const tuples = mineFlowTuples(TEST_DIR)

      expect(tuples[0].reward.improved).toBe(true)
      expect(tuples[0].reward.quality_score).toBe(1.0)
    })

    it("penalizes flows that never completed", () => {
      writeMapEvents([
        {
          ts: "2024-01-01T10:00:00Z",
          type: "flow:triggered",
          data: { flow_name: "failed-flow" },
        },
        // No completion event
      ])

      const tuples = mineFlowTuples(TEST_DIR)

      expect(tuples[0].reward.improved).toBe(false)
      expect(tuples[0].reward.quality_score).toBe(0.0)
    })
  })

  describe("mineSessionTuples", () => {
    it("returns empty array without session events", () => {
      const tuples = mineSessionTuples(TEST_DIR)

      expect(tuples).toEqual([])
    })

    it("mines session with journal entries", () => {
      // Create session events
      writeMapEvents([
        {
          ts: "2024-01-01T09:00:00Z",
          type: "session:started",
          data: { session: "session-test-20240101" },
        },
        {
          ts: "2024-01-01T11:00:00Z",
          type: "session:ended",
          data: { session: "session-test-20240101" },
        },
      ])

      // Create journal entries within session time
      writeJournalEntry("session.jsonl", [
        {
          ts: "2024-01-01T09:30:00Z",
          type: "feature",
          status: "complete",
          title: "Feature 1",
          summary: "Built feature",
          files: ["src/a.ts"],
        },
        {
          ts: "2024-01-01T10:00:00Z",
          type: "fix",
          status: "complete",
          title: "Fix 1",
          summary: "Fixed bug",
          files: ["src/b.ts"],
        },
      ])

      const tuples = mineSessionTuples(TEST_DIR)

      expect(tuples).toHaveLength(1)
      expect(tuples[0].action.description).toContain("2 entries")
      expect(tuples[0].action.description).toContain("1F/1B") // 1 feature, 1 bugfix
    })

    it("skips sessions without journal entries", () => {
      writeMapEvents([
        {
          ts: "2024-01-01T09:00:00Z",
          type: "session:started",
          data: {},
        },
        {
          ts: "2024-01-01T11:00:00Z",
          type: "session:ended",
          data: {},
        },
      ])
      // No journal entries

      const tuples = mineSessionTuples(TEST_DIR)

      expect(tuples).toHaveLength(0)
    })
  })

  describe("mineEvalTuples", () => {
    it("returns empty array without eval events", () => {
      const tuples = mineEvalTuples(TEST_DIR)

      expect(tuples).toEqual([])
    })

    it("mines eval scored events", () => {
      writeMapEvents([
        {
          ts: "2024-01-01T10:00:00Z",
          type: "eval:scored",
          data: {
            agent: "peter-parker",
            branch: "pp/fix-tests",
            pr_number: "42",
            composite: 0.95,
            baseline: 0.90,
            delta: 0.05,
            tests_passed: 100,
            tests_total: 100,
            improved: true,
          },
        },
      ])

      const tuples = mineEvalTuples(TEST_DIR)

      expect(tuples).toHaveLength(1)
      expect(tuples[0].agent).toBe("peter-parker")
      expect(tuples[0].state.composite_score).toBe(0.90)
      expect(tuples[0].reward.composite_delta).toBe(0.05)
      expect(tuples[0].reward.improved).toBe(true)
      expect(tuples[0].metadata.pr_number).toBe(42)
    })

    it("calculates delta from composite - baseline when not provided", () => {
      writeMapEvents([
        {
          ts: "2024-01-01T10:00:00Z",
          type: "eval:scored",
          data: {
            composite: 0.85,
            baseline: 0.80,
            // no delta provided
          },
        },
      ])

      const tuples = mineEvalTuples(TEST_DIR)

      expect(tuples[0].reward.composite_delta).toBeCloseTo(0.05)
    })
  })

  describe("mineAll", () => {
    it("aggregates tuples from all sources", () => {
      // Journal entry
      writeJournalEntry("all.jsonl", [
        {
          ts: "2024-01-01T10:00:00Z",
          type: "feature",
          title: "Test",
          summary: "Testing",
        },
      ])

      // Flow event
      writeMapEvents([
        {
          ts: "2024-01-01T11:00:00Z",
          type: "flow:triggered",
          data: { flow_name: "test-flow" },
        },
        {
          ts: "2024-01-01T11:00:30Z",
          type: "flow:completed",
          data: { flow_name: "test-flow" },
        },
      ])

      const { tuples, stats } = mineAll({ dirs: [TEST_DIR] })

      expect(tuples.length).toBeGreaterThanOrEqual(2)
      expect(stats.journalTuples).toBe(1)
      expect(stats.flowTuples).toBe(1)
      expect(stats.totalMined).toBe(tuples.length)
    })

    it("includes directory in stats", () => {
      const { stats } = mineAll({ dirs: [TEST_DIR] })

      expect(stats.directories).toContain(TEST_DIR)
    })

    it("handles empty directories gracefully", () => {
      const emptyDir = join(TEST_DIR, "empty")
      mkdirSync(emptyDir, { recursive: true })

      const { tuples, stats } = mineAll({ dirs: [emptyDir] })

      expect(tuples).toEqual([])
      expect(stats.totalMined).toBe(0)
    })
  })
})
