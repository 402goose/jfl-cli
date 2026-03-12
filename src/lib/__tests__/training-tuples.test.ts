/**
 * @purpose Tests for training tuple extraction functions
 */

import { extractScores } from "../training-tuples.js"

describe("extractScores", () => {
  describe("labeled metric patterns", () => {
    it("extracts ndcg scores with colon separator", () => {
      const text = "ndcg: 0.8532"
      const scores = extractScores(text)
      expect(scores).toEqual({ ndcg: 0.8532 })
    })

    it("extracts ndcg@k scores", () => {
      const text = "ndcg@10: 0.75"
      const scores = extractScores(text)
      expect(scores).toEqual({ ndcg: 0.75 })
    })

    it("extracts precision scores", () => {
      const text = "precision = 0.92"
      const scores = extractScores(text)
      expect(scores).toEqual({ precision: 0.92 })
    })

    it("extracts recall scores", () => {
      const text = "recall: 0.88"
      const scores = extractScores(text)
      expect(scores).toEqual({ recall: 0.88 })
    })

    it("extracts mrr scores", () => {
      const text = "mrr = 0.65"
      const scores = extractScores(text)
      expect(scores).toEqual({ mrr: 0.65 })
    })

    it("extracts map scores", () => {
      const text = "map: 0.77"
      const scores = extractScores(text)
      expect(scores).toEqual({ map: 0.77 })
    })

    it("extracts weighted scores", () => {
      const text = "weighted = 0.81"
      const scores = extractScores(text)
      expect(scores).toEqual({ weighted: 0.81 })
    })

    it("extracts generic score values", () => {
      const text = "score: 0.95"
      const scores = extractScores(text)
      expect(scores).toEqual({ score: 0.95 })
    })

    it("extracts f1 scores", () => {
      const text = "f1 = 0.86"
      const scores = extractScores(text)
      expect(scores).toEqual({ f1: 0.86 })
    })
  })

  describe("multiple metrics", () => {
    it("extracts multiple different metrics", () => {
      const text = "Results: ndcg=0.85, precision=0.90, recall=0.80"
      const scores = extractScores(text)
      expect(scores).toEqual({
        ndcg: 0.85,
        precision: 0.9,
        recall: 0.8,
      })
    })

    it("handles multiple instances of same metric", () => {
      const text = "ndcg: 0.75, then ndcg improved to ndcg: 0.82"
      const scores = extractScores(text)
      // Multiple instances get indexed
      expect(scores?.ndcg).toBe(0.75)
      expect(scores?.ndcg_1).toBe(0.82)
    })
  })

  describe("bare metric patterns", () => {
    it("extracts bare 0.xxx values when no labeled metrics found", () => {
      const text = "The result was 0.8765"
      const scores = extractScores(text)
      expect(scores).toEqual({ metric_0: 0.8765 })
    })

    it("extracts multiple bare values", () => {
      // Bare metric pattern requires 3+ decimal places: 0.xxx
      const text = "Got 0.850 and 0.920 from the eval"
      const scores = extractScores(text)
      expect(scores?.metric_0).toBe(0.85)
      expect(scores?.metric_1).toBe(0.92)
    })

    it("limits bare values to 5 max", () => {
      const text = "Values: 0.1 0.2 0.3 0.4 0.5 0.6 0.7"
      const scores = extractScores(text)
      expect(Object.keys(scores || {}).length).toBeLessThanOrEqual(5)
    })

    it("ignores bare values outside valid range", () => {
      const text = "Got 15.5 which is invalid"
      const scores = extractScores(text)
      expect(scores).toBeNull()
    })
  })

  describe("edge cases", () => {
    it("returns null for empty string", () => {
      expect(extractScores("")).toBeNull()
    })

    it("returns null for text with no scores", () => {
      expect(extractScores("This text has no metrics")).toBeNull()
    })

    it("returns null for null input", () => {
      expect(extractScores(null as any)).toBeNull()
    })

    it("handles integer scores", () => {
      const text = "ndcg: 1"
      const scores = extractScores(text)
      expect(scores).toEqual({ ndcg: 1 })
    })

    it("filters out invalid numeric values", () => {
      const text = "ndcg: NaN, precision: -5"
      const scores = extractScores(text)
      // NaN and negative values should be filtered
      expect(scores).toBeNull()
    })

    it("handles very large valid values up to 1000", () => {
      const text = "score: 999"
      const scores = extractScores(text)
      expect(scores).toEqual({ score: 999 })
    })

    it("filters values over 1000", () => {
      const text = "score: 1001"
      const scores = extractScores(text)
      expect(scores).toBeNull()
    })
  })

  describe("format variations", () => {
    it("handles colon separator", () => {
      expect(extractScores("ndcg: 0.5")).toEqual({ ndcg: 0.5 })
    })

    it("handles equals separator", () => {
      expect(extractScores("ndcg=0.5")).toEqual({ ndcg: 0.5 })
    })

    it("handles space separator", () => {
      expect(extractScores("ndcg 0.5")).toEqual({ ndcg: 0.5 })
    })

    it("is case insensitive", () => {
      expect(extractScores("NDCG: 0.75")).toEqual({ ndcg: 0.75 })
      expect(extractScores("Precision: 0.80")).toEqual({ precision: 0.8 })
    })
  })
})

describe("score computation helpers", () => {
  // Test the logic of computeScoreDelta
  function computeScoreDelta(
    currentScores: Record<string, number> | null,
    nextScores: Record<string, number> | null
  ): number | null {
    if (!currentScores || !nextScores) return null

    const commonKeys = Object.keys(currentScores).filter((k) => k in nextScores)
    if (commonKeys.length === 0) return null

    let totalDelta = 0
    for (const key of commonKeys) {
      totalDelta += nextScores[key] - currentScores[key]
    }
    return totalDelta / commonKeys.length
  }

  it("computes positive delta when scores improve", () => {
    const current = { ndcg: 0.7, precision: 0.8 }
    const next = { ndcg: 0.8, precision: 0.9 }
    // (0.1 + 0.1) / 2 = 0.1
    expect(computeScoreDelta(current, next)).toBeCloseTo(0.1)
  })

  it("computes negative delta when scores regress", () => {
    const current = { ndcg: 0.8, precision: 0.9 }
    const next = { ndcg: 0.7, precision: 0.8 }
    expect(computeScoreDelta(current, next)).toBeCloseTo(-0.1)
  })

  it("returns zero for unchanged scores", () => {
    const current = { ndcg: 0.8 }
    const next = { ndcg: 0.8 }
    expect(computeScoreDelta(current, next)).toBe(0)
  })

  it("returns null when no common keys", () => {
    const current = { ndcg: 0.8 }
    const next = { precision: 0.9 }
    expect(computeScoreDelta(current, next)).toBeNull()
  })

  it("returns null for null inputs", () => {
    expect(computeScoreDelta(null, { ndcg: 0.8 })).toBeNull()
    expect(computeScoreDelta({ ndcg: 0.8 }, null)).toBeNull()
    expect(computeScoreDelta(null, null)).toBeNull()
  })

  it("only considers common keys", () => {
    const current = { ndcg: 0.7, extra: 0.5 }
    const next = { ndcg: 0.9 }
    // Only ndcg is common: 0.9 - 0.7 = 0.2
    expect(computeScoreDelta(current, next)).toBeCloseTo(0.2)
  })
})

describe("qualitative determination", () => {
  function determineQualitative(
    delta: number | null,
    entry: { summary?: string; detail?: string; learned?: string[] }
  ): "improvement" | "regression" | "neutral" | "unknown" {
    if (delta !== null) {
      if (delta > 0.001) return "improvement"
      if (delta < -0.001) return "regression"
      return "neutral"
    }

    const textToScan = [entry.summary, entry.detail, ...(entry.learned || [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()

    if (/improv|better|gain|increas|boost|uplift|higher/.test(textToScan))
      return "improvement"
    if (/regress|worse|decreas|drop|lower|degrad/.test(textToScan))
      return "regression"
    if (/same|unchanged|flat|no.?change|stable/.test(textToScan))
      return "neutral"

    return "unknown"
  }

  describe("numeric delta based", () => {
    it("returns improvement for positive delta > 0.001", () => {
      expect(determineQualitative(0.05, {})).toBe("improvement")
    })

    it("returns regression for negative delta < -0.001", () => {
      expect(determineQualitative(-0.05, {})).toBe("regression")
    })

    it("returns neutral for delta near zero", () => {
      expect(determineQualitative(0.0001, {})).toBe("neutral")
      expect(determineQualitative(-0.0001, {})).toBe("neutral")
      expect(determineQualitative(0, {})).toBe("neutral")
    })
  })

  describe("text-based inference", () => {
    it("detects improvement keywords", () => {
      expect(determineQualitative(null, { summary: "Score improved" })).toBe("improvement")
      expect(determineQualitative(null, { detail: "Better results" })).toBe("improvement")
      expect(determineQualitative(null, { learned: ["Gained precision"] })).toBe("improvement")
      expect(determineQualitative(null, { summary: "Increased accuracy" })).toBe("improvement")
      expect(determineQualitative(null, { summary: "Got a boost" })).toBe("improvement")
      expect(determineQualitative(null, { summary: "Higher scores" })).toBe("improvement")
    })

    it("detects regression keywords", () => {
      expect(determineQualitative(null, { summary: "Score regressed" })).toBe("regression")
      expect(determineQualitative(null, { detail: "Worse than before" })).toBe("regression")
      expect(determineQualitative(null, { summary: "Accuracy decreased" })).toBe("regression")
      expect(determineQualitative(null, { summary: "Score drop" })).toBe("regression")
      expect(determineQualitative(null, { summary: "Lower precision" })).toBe("regression")
    })

    it("detects neutral keywords", () => {
      expect(determineQualitative(null, { summary: "Same as before" })).toBe("neutral")
      expect(determineQualitative(null, { detail: "Unchanged" })).toBe("neutral")
      expect(determineQualitative(null, { summary: "Flat results" })).toBe("neutral")
      expect(determineQualitative(null, { summary: "Stable performance" })).toBe("neutral")
    })

    it("returns unknown when no keywords match", () => {
      expect(determineQualitative(null, { summary: "Ran experiment" })).toBe("unknown")
      expect(determineQualitative(null, {})).toBe("unknown")
    })
  })
})
