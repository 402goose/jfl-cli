/**
 * Fuzz Tests for Training Buffer
 *
 * Tests the training buffer with edge cases: NaN rewards, huge buffers,
 * malformed JSONL, concurrent access, hash collisions.
 *
 * @purpose Fuzz testing for TrainingBuffer reliability and data integrity
 */

import { TrainingBuffer, hashEntry } from "../training-buffer"
import type { RLState, RLAction, RLReward, TrainingBufferEntry } from "../training-buffer"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

describe("Training Buffer Fuzzing", () => {
  let tempDir: string
  let buffer: TrainingBuffer

  const createTestState = (overrides: Partial<RLState> = {}): RLState => ({
    composite_score: 0.75,
    dimension_scores: { quality: 0.8, coverage: 0.7 },
    tests_passing: 45,
    tests_total: 50,
    trajectory_length: 10,
    recent_deltas: [0.01, 0.02, -0.005],
    agent: "test-agent",
    ...overrides,
  })

  const createTestAction = (overrides: Partial<RLAction> = {}): RLAction => ({
    type: "fix",
    description: "Test action",
    files_affected: ["file1.ts", "file2.ts"],
    scope: "small",
    branch: "main",
    ...overrides,
  })

  const createTestReward = (overrides: Partial<RLReward> = {}): RLReward => ({
    composite_delta: 0.05,
    dimension_deltas: { quality: 0.03, coverage: 0.02 },
    tests_added: 2,
    quality_score: 0.85,
    improved: true,
    ...overrides,
  })

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fuzz-training-"))
    fs.mkdirSync(path.join(tempDir, ".jfl"), { recursive: true })
    buffer = new TrainingBuffer(tempDir)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe("NaN and Infinity handling", () => {
    it("handles NaN in composite_score", () => {
      const entry = buffer.append({
        agent: "test",
        state: createTestState({ composite_score: NaN }),
        action: createTestAction(),
        reward: createTestReward(),
        metadata: { branch: "main", source: "manual" },
      })

      expect(entry.id).toBeDefined()
      expect(Number.isNaN(entry.state.composite_score)).toBe(true)
    })

    it("handles Infinity in rewards", () => {
      const entry = buffer.append({
        agent: "test",
        state: createTestState(),
        action: createTestAction(),
        reward: createTestReward({ composite_delta: Infinity }),
        metadata: { branch: "main", source: "manual" },
      })

      expect(entry.reward.composite_delta).toBe(Infinity)
    })

    it("handles negative Infinity", () => {
      const entry = buffer.append({
        agent: "test",
        state: createTestState(),
        action: createTestAction(),
        reward: createTestReward({ composite_delta: -Infinity }),
        metadata: { branch: "main", source: "manual" },
      })

      expect(entry.reward.composite_delta).toBe(-Infinity)
    })

    it("handles NaN in dimension_deltas", () => {
      const entry = buffer.append({
        agent: "test",
        state: createTestState(),
        action: createTestAction(),
        reward: createTestReward({ dimension_deltas: { quality: NaN, coverage: 0.1 } }),
        metadata: { branch: "main", source: "manual" },
      })

      expect(Number.isNaN(entry.reward.dimension_deltas.quality)).toBe(true)
    })

    it("handles very large numbers", () => {
      const entry = buffer.append({
        agent: "test",
        state: createTestState({ composite_score: Number.MAX_VALUE }),
        action: createTestAction(),
        reward: createTestReward({ composite_delta: Number.MAX_SAFE_INTEGER }),
        metadata: { branch: "main", source: "manual" },
      })

      expect(entry.state.composite_score).toBe(Number.MAX_VALUE)
    })

    it("handles very small numbers", () => {
      const entry = buffer.append({
        agent: "test",
        state: createTestState({ composite_score: Number.MIN_VALUE }),
        action: createTestAction(),
        reward: createTestReward({ composite_delta: Number.MIN_SAFE_INTEGER }),
        metadata: { branch: "main", source: "manual" },
      })

      expect(entry.state.composite_score).toBe(Number.MIN_VALUE)
    })
  })

  describe("large buffer stress", () => {
    it("handles appending 1000 entries", () => {
      const startTime = Date.now()

      for (let i = 0; i < 1000; i++) {
        buffer.append({
          agent: `agent-${i % 10}`,
          state: createTestState({ composite_score: i / 1000 }),
          action: createTestAction({ description: `Action ${i}` }),
          reward: createTestReward({ composite_delta: (i % 100) / 100 }),
          metadata: { branch: "main", source: "manual" },
        })
      }

      const elapsed = Date.now() - startTime
      const entries = buffer.read()

      expect(entries.length).toBe(1000)
      expect(elapsed).toBeLessThan(10000)
    })

    it("handles reading large buffer efficiently", () => {
      // First append many entries
      for (let i = 0; i < 500; i++) {
        buffer.append({
          agent: "test",
          state: createTestState(),
          action: createTestAction(),
          reward: createTestReward(),
          metadata: { branch: "main", source: "manual" },
        })
      }

      const startTime = Date.now()
      const entries = buffer.read()
      const elapsed = Date.now() - startTime

      expect(entries.length).toBe(500)
      expect(elapsed).toBeLessThan(1000)
    })

    it("handles stats calculation on large buffer", () => {
      for (let i = 0; i < 200; i++) {
        buffer.append({
          agent: `agent-${i % 5}`,
          state: createTestState(),
          action: createTestAction(),
          reward: createTestReward({ improved: i % 2 === 0 }),
          metadata: { branch: "main", source: i % 3 === 0 ? "ci" : "manual" },
        })
      }

      const stats = buffer.stats()

      expect(stats.total).toBe(200)
      expect(Object.keys(stats.byAgent).length).toBe(5)
      expect(stats.improvedRate).toBeCloseTo(0.5, 1)
    })
  })

  describe("malformed JSONL handling", () => {
    it("handles corrupted lines in buffer file", () => {
      const bufferPath = path.join(tempDir, ".jfl", "training-buffer.jsonl")

      // Write some valid entries mixed with invalid ones
      const validEntry = JSON.stringify({
        id: "tb_test1",
        v: 1,
        ts: new Date().toISOString(),
        agent: "test",
        state: createTestState(),
        action: createTestAction(),
        reward: createTestReward(),
        metadata: { branch: "main", source: "manual" },
      })

      fs.writeFileSync(bufferPath, [
        validEntry,
        "{invalid json",
        "completely not json",
        validEntry.replace("tb_test1", "tb_test2"),
        "",
        "   ",
        validEntry.replace("tb_test1", "tb_test3"),
      ].join("\n"))

      const entries = buffer.read()

      // Should skip invalid lines
      expect(entries.length).toBe(3)
    })

    it("handles empty buffer file", () => {
      const bufferPath = path.join(tempDir, ".jfl", "training-buffer.jsonl")
      fs.writeFileSync(bufferPath, "")

      const entries = buffer.read()
      expect(entries.length).toBe(0)
    })

    it("handles buffer file with only whitespace", () => {
      const bufferPath = path.join(tempDir, ".jfl", "training-buffer.jsonl")
      fs.writeFileSync(bufferPath, "   \n\n   \n\t\t\n")

      const entries = buffer.read()
      expect(entries.length).toBe(0)
    })

    it("handles buffer file with missing required fields", () => {
      const bufferPath = path.join(tempDir, ".jfl", "training-buffer.jsonl")

      // Entry missing 'state'
      const incomplete = JSON.stringify({
        id: "tb_incomplete",
        v: 1,
        ts: new Date().toISOString(),
        agent: "test",
        // state is missing
        action: createTestAction(),
        reward: createTestReward(),
        metadata: { branch: "main", source: "manual" },
      })

      fs.writeFileSync(bufferPath, incomplete + "\n")

      // Should not throw, but entry may be incomplete
      const entries = buffer.read()
      expect(entries.length).toBe(1)
    })
  })

  describe("hash function edge cases", () => {
    it("produces consistent hashes for same input", () => {
      const state = createTestState()
      const action = createTestAction()

      const hash1 = hashEntry(state, action)
      const hash2 = hashEntry(state, action)

      expect(hash1).toBe(hash2)
    })

    it("produces different hashes for different inputs", () => {
      const state = createTestState()
      const action1 = createTestAction({ description: "Action 1" })
      const action2 = createTestAction({ description: "Action 2" })

      const hash1 = hashEntry(state, action1)
      const hash2 = hashEntry(state, action2)

      expect(hash1).not.toBe(hash2)
    })

    it("handles unicode in descriptions", () => {
      const state = createTestState()
      const action = createTestAction({ description: "修复日本語 🚀" })

      const hash = hashEntry(state, action)
      expect(hash).toBeDefined()
      expect(hash.length).toBe(12)
    })

    it("handles very long descriptions", () => {
      const state = createTestState()
      const action = createTestAction({ description: "x".repeat(10000) })

      const hash = hashEntry(state, action)
      expect(hash).toBeDefined()
      expect(hash.length).toBe(12)
    })

    it("handles empty descriptions", () => {
      const state = createTestState()
      const action = createTestAction({ description: "" })

      const hash = hashEntry(state, action)
      expect(hash).toBeDefined()
    })
  })

  describe("edge case metadata", () => {
    it("handles all source types", () => {
      const sources: Array<"ci" | "autoresearch" | "experiment" | "manual" | "mined"> = [
        "ci",
        "autoresearch",
        "experiment",
        "manual",
        "mined",
      ]

      for (const source of sources) {
        const entry = buffer.append({
          agent: "test",
          state: createTestState(),
          action: createTestAction(),
          reward: createTestReward(),
          metadata: { branch: "main", source },
        })

        expect(entry.metadata.source).toBe(source)
      }

      const stats = buffer.stats()
      expect(Object.keys(stats.bySource).length).toBe(5)
    })

    it("handles empty files_affected array", () => {
      const entry = buffer.append({
        agent: "test",
        state: createTestState(),
        action: createTestAction({ files_affected: [] }),
        reward: createTestReward(),
        metadata: { branch: "main", source: "manual" },
      })

      expect(entry.action.files_affected).toEqual([])
    })

    it("handles many files_affected", () => {
      const manyFiles = Array.from({ length: 100 }, (_, i) => `file${i}.ts`)

      const entry = buffer.append({
        agent: "test",
        state: createTestState(),
        action: createTestAction({ files_affected: manyFiles }),
        reward: createTestReward(),
        metadata: { branch: "main", source: "manual" },
      })

      expect(entry.action.files_affected.length).toBe(100)
    })

    it("handles special characters in branch names", () => {
      const entry = buffer.append({
        agent: "test",
        state: createTestState(),
        action: createTestAction({ branch: "feature/test-123_fix" }),
        reward: createTestReward(),
        metadata: { branch: "feature/test-123_fix", source: "manual" },
      })

      expect(entry.metadata.branch).toBe("feature/test-123_fix")
    })
  })

  describe("exportForTraining edge cases", () => {
    it("exports empty buffer", () => {
      const exported = buffer.exportForTraining()
      expect(exported).toEqual([])
    })

    it("handles entries in buffer after export", () => {
      // Test that export works with regular entries
      buffer.append({
        agent: "test",
        state: createTestState({ composite_score: 0.5 }),
        action: createTestAction(),
        reward: createTestReward(),
        metadata: { branch: "main", source: "manual" },
      })

      const exported = buffer.exportForTraining()
      expect(exported.length).toBe(1)
      expect(exported[0].state_text).toContain("0.5")
    })

    it("exports with unicode content", () => {
      buffer.append({
        agent: "日本語エージェント",
        state: createTestState(),
        action: createTestAction({ description: "修复问题 🔧" }),
        reward: createTestReward(),
        metadata: { branch: "main", source: "manual" },
      })

      const exported = buffer.exportForTraining()
      expect(exported.length).toBe(1)
      expect(exported[0].action_text).toContain("修复问题")
    })

    it("handles many recent_deltas", () => {
      const manyDeltas = Array.from({ length: 50 }, () => Math.random() - 0.5)

      buffer.append({
        agent: "test",
        state: createTestState({ recent_deltas: manyDeltas }),
        action: createTestAction(),
        reward: createTestReward(),
        metadata: { branch: "main", source: "manual" },
      })

      const exported = buffer.exportForTraining()
      expect(exported.length).toBe(1)
      expect(exported[0].state_text).toContain("Recent deltas:")
    })
  })

  describe("concurrent access simulation", () => {
    it("handles rapid sequential writes", () => {
      const entries: TrainingBufferEntry[] = []

      for (let i = 0; i < 100; i++) {
        const entry = buffer.append({
          agent: `agent-${i}`,
          state: createTestState({ composite_score: i / 100 }),
          action: createTestAction({ description: `Concurrent ${i}` }),
          reward: createTestReward(),
          metadata: { branch: "main", source: "manual" },
        })
        entries.push(entry)
      }

      const read = buffer.read()
      expect(read.length).toBe(100)

      // Verify all entries are present
      const ids = new Set(read.map(e => e.id))
      for (const entry of entries) {
        expect(ids.has(entry.id)).toBe(true)
      }
    })

    it("handles interleaved reads and writes", () => {
      for (let i = 0; i < 50; i++) {
        buffer.append({
          agent: "test",
          state: createTestState(),
          action: createTestAction(),
          reward: createTestReward(),
          metadata: { branch: "main", source: "manual" },
        })

        if (i % 10 === 0) {
          const entries = buffer.read()
          expect(entries.length).toBe(i + 1)
        }
      }
    })
  })

  describe("zero and boundary values", () => {
    it("handles all zero scores", () => {
      const entry = buffer.append({
        agent: "test",
        state: createTestState({
          composite_score: 0,
          dimension_scores: {},
          tests_passing: 0,
          tests_total: 0,
          trajectory_length: 0,
          recent_deltas: [],
        }),
        action: createTestAction(),
        reward: createTestReward({
          composite_delta: 0,
          dimension_deltas: {},
          tests_added: 0,
          quality_score: 0,
          improved: false,
        }),
        metadata: { branch: "main", source: "manual" },
      })

      expect(entry.state.composite_score).toBe(0)
    })

    it("handles negative values where valid", () => {
      const entry = buffer.append({
        agent: "test",
        state: createTestState({
          composite_score: -0.5,
          recent_deltas: [-0.1, -0.2, -0.3],
        }),
        action: createTestAction(),
        reward: createTestReward({
          composite_delta: -0.5,
          tests_added: -1, // edge case - might not be valid but shouldn't crash
          quality_score: -1,
        }),
        metadata: { branch: "main", source: "manual" },
      })

      expect(entry.state.composite_score).toBe(-0.5)
      expect(entry.reward.composite_delta).toBe(-0.5)
    })
  })
})
