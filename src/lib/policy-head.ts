/**
 * @purpose Policy head inference — loads trained weights, scores candidate actions for autoresearch
 */

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import type { RLState, RLAction } from "./training-buffer.js"

interface PolicyWeights {
  version: number
  architecture: string
  embed_dim: number
  mode: "embedding" | "numeric"
  trained_at: string
  trained_on: number
  direction_accuracy: number
  rank_correlation: number
  target_mean: number
  target_std: number
  layers: {
    W1: number[][]
    b1: number[]
    W2: number[][]
    b2: number[]
    W3: number[][]
    b3: number[]
  }
}

function relu(x: number): number {
  return Math.max(0, x)
}

function matVecMul(mat: number[][], vec: number[]): number[] {
  return mat.map(row => row.reduce((sum, w, j) => sum + w * vec[j], 0))
}

function vecAdd(a: number[], b: number[]): number[] {
  return a.map((v, i) => v + b[i])
}

function forward(weights: PolicyWeights, input: number[]): number {
  const { W1, b1, W2, b2, W3, b3 } = weights.layers

  // Transpose W1 for (input_dim, hidden_dim) → need input @ W1
  // W1 stored as [input_dim][hidden_dim], so W1[i][j] = weight from input i to hidden j
  const z1 = vecAdd(matVecMulTransposed(W1, input), b1)
  const a1 = z1.map(relu)

  const z2 = vecAdd(matVecMulTransposed(W2, a1), b2)
  const a2 = z2.map(relu)

  const z3 = vecAdd(matVecMulTransposed(W3, a2), b3)
  return z3[0]
}

function matVecMulTransposed(mat: number[][], vec: number[]): number[] {
  // mat is [rows][cols], we want vec @ mat = result[cols]
  // result[j] = sum_i(vec[i] * mat[i][j])
  const cols = mat[0].length
  const result = new Array(cols).fill(0)
  for (let i = 0; i < vec.length; i++) {
    for (let j = 0; j < cols; j++) {
      result[j] += vec[i] * mat[i][j]
    }
  }
  return result
}

export class PolicyHeadInference {
  private weights: PolicyWeights | null = null
  private embedCache = new Map<string, number[]>()

  constructor(projectRoot?: string) {
    const root = projectRoot || process.cwd()
    const weightsPath = join(root, ".jfl", "policy-weights.json")
    if (existsSync(weightsPath)) {
      this.weights = JSON.parse(readFileSync(weightsPath, "utf-8"))
    }
  }

  get isLoaded(): boolean {
    return this.weights !== null
  }

  get stats(): { trained_on: number; direction_accuracy: number; rank_correlation: number } | null {
    if (!this.weights) return null
    return {
      trained_on: this.weights.trained_on,
      direction_accuracy: this.weights.direction_accuracy,
      rank_correlation: this.weights.rank_correlation,
    }
  }

  async embedText(text: string): Promise<number[]> {
    if (this.embedCache.has(text)) return this.embedCache.get(text)!

    const apiKey = process.env.STRATUS_API_KEY
    if (!apiKey) throw new Error("STRATUS_API_KEY not set")

    const url = `${process.env.STRATUS_API_URL || "https://api.stratus.run"}/v1/embeddings`
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "stratus-x1ac-base",
        input: text,
      }),
    })

    if (!response.ok) throw new Error(`Embedding failed: ${response.status}`)
    const data = await response.json() as any
    const embedding = data.data[0].embedding as number[]
    this.embedCache.set(text, embedding)
    return embedding
  }

  formatStateText(state: RLState): string {
    const dims = Object.entries(state.dimension_scores)
      .map(([k, v]) => `${k}=${(v as number).toFixed(4)}`).join(", ")
    const deltas = state.recent_deltas
      .map(d => `${d >= 0 ? "+" : ""}${d.toFixed(4)}`).join(", ")
    return [
      `Agent: ${state.agent}`,
      `Composite: ${state.composite_score.toFixed(4)}`,
      `Tests: ${state.tests_passing}/${state.tests_total}`,
      `Trajectory: ${state.trajectory_length}`,
      `Dimensions: ${dims || "none"}`,
      `Recent deltas: ${deltas || "none"}`,
    ].join("\n")
  }

  formatActionText(action: RLAction): string {
    const files = action.files_affected.slice(0, 5).join(", ")
    return [
      `Type: ${action.type}`,
      `Description: ${action.description.slice(0, 150)}`,
      `Scope: ${action.scope}`,
      `Files: ${files || "none"}`,
    ].join("\n")
  }

  async predictReward(state: RLState, action: RLAction): Promise<number> {
    if (!this.weights) throw new Error("No policy weights loaded")

    const stateEmb = await this.embedText(this.formatStateText(state))
    const actionEmb = await this.embedText(this.formatActionText(action))

    const input = [...stateEmb, ...actionEmb]
    const rawPred = forward(this.weights, input)

    // Denormalize
    return rawPred * this.weights.target_std + this.weights.target_mean
  }

  async rankActions(
    state: RLState,
    actions: RLAction[]
  ): Promise<Array<{ action: RLAction; predictedReward: number; rank: number }>> {
    if (!this.weights) throw new Error("No policy weights loaded")

    const stateText = this.formatStateText(state)
    const stateEmb = await this.embedText(stateText)

    const results: Array<{ action: RLAction; predictedReward: number; rank: number }> = []

    for (const action of actions) {
      const actionEmb = await this.embedText(this.formatActionText(action))
      const input = [...stateEmb, ...actionEmb]
      const rawPred = forward(this.weights, input)
      const reward = rawPred * this.weights.target_std + this.weights.target_mean

      results.push({ action, predictedReward: reward, rank: 0 })
    }

    results.sort((a, b) => b.predictedReward - a.predictedReward)
    results.forEach((r, i) => { r.rank = i + 1 })

    return results
  }
}
