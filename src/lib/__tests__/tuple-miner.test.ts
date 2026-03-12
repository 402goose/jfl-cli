/**
 * @purpose Tests for tuple miner helper functions
 */

describe("tuple-miner helpers", () => {
  // Replicate the inferScope function
  function inferScope(files?: string[]): "small" | "medium" | "large" {
    if (!files || files.length === 0) return "small"
    if (files.length <= 3) return "small"
    if (files.length <= 7) return "medium"
    return "large"
  }

  describe("inferScope", () => {
    it("returns small for undefined files", () => {
      expect(inferScope(undefined)).toBe("small")
    })

    it("returns small for empty array", () => {
      expect(inferScope([])).toBe("small")
    })

    it("returns small for 1-3 files", () => {
      expect(inferScope(["a.ts"])).toBe("small")
      expect(inferScope(["a.ts", "b.ts"])).toBe("small")
      expect(inferScope(["a.ts", "b.ts", "c.ts"])).toBe("small")
    })

    it("returns medium for 4-7 files", () => {
      expect(inferScope(["a", "b", "c", "d"])).toBe("medium")
      expect(inferScope(["a", "b", "c", "d", "e"])).toBe("medium")
      expect(inferScope(["a", "b", "c", "d", "e", "f"])).toBe("medium")
      expect(inferScope(["a", "b", "c", "d", "e", "f", "g"])).toBe("medium")
    })

    it("returns large for 8+ files", () => {
      expect(inferScope(["a", "b", "c", "d", "e", "f", "g", "h"])).toBe("large")
      expect(inferScope(new Array(20).fill("file.ts"))).toBe("large")
    })
  })

  // Replicate the inferReward function
  interface JournalEntry {
    type?: string
    status?: string
    score_delta?: number
  }

  function inferReward(entry: JournalEntry): {
    delta: number
    quality: number
    improved: boolean
  } {
    if (entry.score_delta !== undefined) {
      const d = Number(entry.score_delta) || 0
      return {
        delta: d,
        quality: d > 0 ? 1.0 : 0.5,
        improved: d > 0,
      }
    }

    const isBlocked = entry.status === "blocked"
    if (isBlocked) return { delta: -0.01, quality: 0.0, improved: false }
    if (entry.status === "incomplete")
      return { delta: -0.005, quality: 0.3, improved: false }

    switch (entry.type) {
      case "milestone":
        return { delta: 0.05, quality: 1.0, improved: true }
      case "feature":
        return { delta: 0.02, quality: 0.9, improved: true }
      case "fix":
        return { delta: 0.015, quality: 0.85, improved: true }
      case "discovery":
        return { delta: 0.005, quality: 0.7, improved: true }
      case "decision":
        return { delta: 0.0, quality: 0.6, improved: false }
      case "spec":
        return { delta: 0.005, quality: 0.65, improved: true }
      default:
        return { delta: 0.01, quality: 0.5, improved: entry.status === "complete" }
    }
  }

  describe("inferReward", () => {
    describe("with explicit score_delta", () => {
      it("uses positive score_delta directly", () => {
        const result = inferReward({ score_delta: 0.15 })
        expect(result.delta).toBe(0.15)
        expect(result.quality).toBe(1.0)
        expect(result.improved).toBe(true)
      })

      it("uses negative score_delta directly", () => {
        const result = inferReward({ score_delta: -0.05 })
        expect(result.delta).toBe(-0.05)
        expect(result.quality).toBe(0.5)
        expect(result.improved).toBe(false)
      })

      it("handles zero score_delta", () => {
        const result = inferReward({ score_delta: 0 })
        expect(result.delta).toBe(0)
        expect(result.quality).toBe(0.5)
        expect(result.improved).toBe(false)
      })

      it("handles NaN score_delta as 0", () => {
        const result = inferReward({ score_delta: NaN })
        expect(result.delta).toBe(0)
      })
    })

    describe("status-based inference", () => {
      it("returns negative reward for blocked status", () => {
        const result = inferReward({ status: "blocked" })
        expect(result.delta).toBe(-0.01)
        expect(result.quality).toBe(0.0)
        expect(result.improved).toBe(false)
      })

      it("returns slightly negative reward for incomplete status", () => {
        const result = inferReward({ status: "incomplete" })
        expect(result.delta).toBe(-0.005)
        expect(result.quality).toBe(0.3)
        expect(result.improved).toBe(false)
      })
    })

    describe("type-based inference", () => {
      it("returns high reward for milestone", () => {
        const result = inferReward({ type: "milestone" })
        expect(result.delta).toBe(0.05)
        expect(result.quality).toBe(1.0)
        expect(result.improved).toBe(true)
      })

      it("returns good reward for feature", () => {
        const result = inferReward({ type: "feature" })
        expect(result.delta).toBe(0.02)
        expect(result.quality).toBe(0.9)
        expect(result.improved).toBe(true)
      })

      it("returns moderate reward for fix", () => {
        const result = inferReward({ type: "fix" })
        expect(result.delta).toBe(0.015)
        expect(result.quality).toBe(0.85)
        expect(result.improved).toBe(true)
      })

      it("returns small reward for discovery", () => {
        const result = inferReward({ type: "discovery" })
        expect(result.delta).toBe(0.005)
        expect(result.quality).toBe(0.7)
        expect(result.improved).toBe(true)
      })

      it("returns neutral reward for decision", () => {
        const result = inferReward({ type: "decision" })
        expect(result.delta).toBe(0.0)
        expect(result.quality).toBe(0.6)
        expect(result.improved).toBe(false)
      })

      it("returns small reward for spec", () => {
        const result = inferReward({ type: "spec" })
        expect(result.delta).toBe(0.005)
        expect(result.quality).toBe(0.65)
        expect(result.improved).toBe(true)
      })
    })

    describe("default behavior", () => {
      it("returns default reward for unknown type", () => {
        const result = inferReward({ type: "unknown" })
        expect(result.delta).toBe(0.01)
        expect(result.quality).toBe(0.5)
      })

      it("marks as improved if status is complete", () => {
        const result = inferReward({ type: "unknown", status: "complete" })
        expect(result.improved).toBe(true)
      })

      it("marks as not improved if status is not complete", () => {
        const result = inferReward({ type: "unknown", status: "pending" })
        expect(result.improved).toBe(false)
      })
    })
  })

  // Test ACTION_TYPE_MAP logic
  describe("action type mapping", () => {
    const ACTION_TYPE_MAP: Record<string, string> = {
      feature: "feature",
      fix: "fix",
      decision: "config",
      discovery: "experiment",
      milestone: "feature",
      spec: "config",
      experiment: "experiment",
      progress: "feature",
    }

    it("maps journal types to action types", () => {
      expect(ACTION_TYPE_MAP["feature"]).toBe("feature")
      expect(ACTION_TYPE_MAP["fix"]).toBe("fix")
      expect(ACTION_TYPE_MAP["decision"]).toBe("config")
      expect(ACTION_TYPE_MAP["discovery"]).toBe("experiment")
      expect(ACTION_TYPE_MAP["milestone"]).toBe("feature")
      expect(ACTION_TYPE_MAP["spec"]).toBe("config")
      expect(ACTION_TYPE_MAP["experiment"]).toBe("experiment")
      expect(ACTION_TYPE_MAP["progress"]).toBe("feature")
    })

    it("returns undefined for unmapped types", () => {
      expect(ACTION_TYPE_MAP["unknown"]).toBeUndefined()
      expect(ACTION_TYPE_MAP["session"]).toBeUndefined()
    })
  })

  // Test SKIP_TYPES logic
  describe("skip types", () => {
    const SKIP_TYPES = new Set(["session", "session-end"])

    it("skips session types", () => {
      expect(SKIP_TYPES.has("session")).toBe(true)
      expect(SKIP_TYPES.has("session-end")).toBe(true)
    })

    it("does not skip other types", () => {
      expect(SKIP_TYPES.has("feature")).toBe(false)
      expect(SKIP_TYPES.has("fix")).toBe(false)
      expect(SKIP_TYPES.has("milestone")).toBe(false)
    })
  })
})
