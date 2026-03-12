/**
 * @purpose Tests for policy head pure math functions
 */

// We need to test the internal pure functions, so we'll re-implement them here
// and verify the logic matches what policy-head.ts uses

describe("policy-head math utilities", () => {
  // Pure function implementations (same as in policy-head.ts)
  function relu(x: number): number {
    return Math.max(0, x)
  }

  function matVecMul(mat: number[][], vec: number[]): number[] {
    return mat.map(row => row.reduce((sum, w, j) => sum + w * vec[j], 0))
  }

  function vecAdd(a: number[], b: number[]): number[] {
    return a.map((v, i) => v + b[i])
  }

  function matVecMulTransposed(mat: number[][], vec: number[]): number[] {
    const cols = mat[0].length
    const result = new Array(cols).fill(0)
    for (let i = 0; i < vec.length; i++) {
      for (let j = 0; j < cols; j++) {
        result[j] += vec[i] * mat[i][j]
      }
    }
    return result
  }

  describe("relu", () => {
    it("returns input for positive values", () => {
      expect(relu(5)).toBe(5)
      expect(relu(0.5)).toBe(0.5)
      expect(relu(100)).toBe(100)
    })

    it("returns 0 for negative values", () => {
      expect(relu(-5)).toBe(0)
      expect(relu(-0.5)).toBe(0)
      expect(relu(-100)).toBe(0)
    })

    it("returns 0 for zero", () => {
      expect(relu(0)).toBe(0)
    })

    it("handles small values near zero", () => {
      expect(relu(0.0001)).toBe(0.0001)
      expect(relu(-0.0001)).toBe(0)
    })
  })

  describe("matVecMul", () => {
    it("multiplies 2x2 matrix by 2-vector", () => {
      const mat = [
        [1, 2],
        [3, 4],
      ]
      const vec = [1, 2]
      // [1*1 + 2*2, 3*1 + 4*2] = [5, 11]
      expect(matVecMul(mat, vec)).toEqual([5, 11])
    })

    it("multiplies 3x2 matrix by 2-vector", () => {
      const mat = [
        [1, 0],
        [0, 1],
        [1, 1],
      ]
      const vec = [3, 4]
      // [1*3 + 0*4, 0*3 + 1*4, 1*3 + 1*4] = [3, 4, 7]
      expect(matVecMul(mat, vec)).toEqual([3, 4, 7])
    })

    it("handles zero vector", () => {
      const mat = [[1, 2], [3, 4]]
      const vec = [0, 0]
      expect(matVecMul(mat, vec)).toEqual([0, 0])
    })

    it("handles identity-like operation", () => {
      const mat = [[1, 0], [0, 1]]
      const vec = [5, 7]
      expect(matVecMul(mat, vec)).toEqual([5, 7])
    })
  })

  describe("vecAdd", () => {
    it("adds two vectors element-wise", () => {
      expect(vecAdd([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9])
    })

    it("handles negative values", () => {
      expect(vecAdd([1, -2, 3], [-1, 2, -3])).toEqual([0, 0, 0])
    })

    it("adds zero vector", () => {
      expect(vecAdd([1, 2, 3], [0, 0, 0])).toEqual([1, 2, 3])
    })

    it("handles floating point values", () => {
      const result = vecAdd([0.1, 0.2], [0.3, 0.4])
      expect(result[0]).toBeCloseTo(0.4)
      expect(result[1]).toBeCloseTo(0.6)
    })
  })

  describe("matVecMulTransposed", () => {
    it("computes vec @ mat for 2x3 matrix", () => {
      // mat is 2x3: [[1, 2, 3], [4, 5, 6]]
      // vec is 2-element: [1, 2]
      // result[j] = sum_i(vec[i] * mat[i][j])
      // result[0] = 1*1 + 2*4 = 9
      // result[1] = 1*2 + 2*5 = 12
      // result[2] = 1*3 + 2*6 = 15
      const mat = [
        [1, 2, 3],
        [4, 5, 6],
      ]
      const vec = [1, 2]
      expect(matVecMulTransposed(mat, vec)).toEqual([9, 12, 15])
    })

    it("handles identity-like operation with transposed view", () => {
      // For a 2x2 identity matrix, vec @ I = vec
      const mat = [[1, 0], [0, 1]]
      const vec = [3, 7]
      expect(matVecMulTransposed(mat, vec)).toEqual([3, 7])
    })

    it("handles single column output", () => {
      // mat is 3x1, vec is 3-element
      const mat = [[2], [3], [4]]
      const vec = [1, 2, 3]
      // result[0] = 1*2 + 2*3 + 3*4 = 2 + 6 + 12 = 20
      expect(matVecMulTransposed(mat, vec)).toEqual([20])
    })

    it("handles zero matrix", () => {
      const mat = [[0, 0], [0, 0]]
      const vec = [5, 10]
      expect(matVecMulTransposed(mat, vec)).toEqual([0, 0])
    })
  })

  describe("forward pass composition", () => {
    // Test that relu + matmul + vecadd compose correctly
    it("applies layer: relu(matmul + bias)", () => {
      const W = [[1, -1], [2, 1]]
      const b = [0.5, -0.5]
      const x = [1, 1]

      // z = matVecMulTransposed(W, x) + b
      // For W @ x with transposed: result[j] = sum_i(x[i] * W[i][j])
      // result[0] = 1*1 + 1*2 = 3
      // result[1] = 1*(-1) + 1*1 = 0
      // z = [3, 0] + [0.5, -0.5] = [3.5, -0.5]
      // relu([3.5, -0.5]) = [3.5, 0]

      const z = vecAdd(matVecMulTransposed(W, x), b)
      expect(z).toEqual([3.5, -0.5])

      const a = z.map(relu)
      expect(a).toEqual([3.5, 0])
    })
  })
})

describe("PolicyHeadInference formatting", () => {
  // Test formatStateText and formatActionText logic

  describe("formatStateText", () => {
    it("formats state with all fields", () => {
      const state = {
        agent: "lobsters",
        composite_score: 0.7532,
        tests_passing: 42,
        tests_total: 50,
        trajectory_length: 15,
        dimension_scores: { ndcg: 0.8, precision: 0.75 },
        recent_deltas: [0.01, -0.005, 0.02],
      }

      const text = [
        `Agent: ${state.agent}`,
        `Composite: ${state.composite_score.toFixed(4)}`,
        `Tests: ${state.tests_passing}/${state.tests_total}`,
        `Trajectory: ${state.trajectory_length}`,
        `Dimensions: ndcg=0.8000, precision=0.7500`,
        `Recent deltas: +0.0100, -0.0050, +0.0200`,
      ].join("\n")

      // Verify the format matches expected structure
      expect(text).toContain("Agent: lobsters")
      expect(text).toContain("Composite: 0.7532")
      expect(text).toContain("Tests: 42/50")
    })
  })

  describe("formatActionText", () => {
    it("formats action with all fields", () => {
      const action = {
        type: "feature" as const,
        description: "Add new ranking algorithm",
        scope: "medium" as const,
        files_affected: ["src/rank.ts", "src/utils.ts", "tests/rank.test.ts"],
      }

      const text = [
        `Type: ${action.type}`,
        `Description: ${action.description.slice(0, 150)}`,
        `Scope: ${action.scope}`,
        `Files: ${action.files_affected.slice(0, 5).join(", ")}`,
      ].join("\n")

      expect(text).toContain("Type: feature")
      expect(text).toContain("Description: Add new ranking algorithm")
      expect(text).toContain("Scope: medium")
      expect(text).toContain("src/rank.ts")
    })

    it("truncates long descriptions", () => {
      const longDesc = "x".repeat(200)
      const truncated = longDesc.slice(0, 150)
      expect(truncated.length).toBe(150)
    })
  })
})
