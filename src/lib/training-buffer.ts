/**
 * @purpose Write (state, action, reward) training tuples for policy head training — generalized for any RL agent
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { createHash } from "crypto"

export interface RLState {
  composite_score: number
  dimension_scores: Record<string, number>
  tests_passing: number
  tests_total: number
  trajectory_length: number
  recent_deltas: number[]
  agent: string
}

export interface RLAction {
  type: "fix" | "refactor" | "feature" | "test" | "config" | "experiment"
  description: string
  files_affected: string[]
  scope: "small" | "medium" | "large"
  branch: string
}

export interface RLReward {
  composite_delta: number
  dimension_deltas: Record<string, number>
  tests_added: number
  quality_score: number
  improved: boolean
  prediction_error?: number
}

export interface TrainingBufferEntry {
  id: string
  v: 1
  ts: string
  agent: string
  wave?: string
  state: RLState
  action: RLAction
  reward: RLReward
  metadata: {
    pr_number?: number
    branch: string
    eval_run_id?: string
    prediction_id?: string
    autoresearch_round?: number
    source: "ci" | "autoresearch" | "experiment" | "manual" | "mined"
    mine_source?: string
    scopes?: string[]
    changed_files?: string[]
  }
}

export function hashEntry(state: RLState, action: RLAction): string {
  const content = JSON.stringify({ s: state.composite_score, a: action.description, t: action.type })
  return createHash("sha256").update(content).digest("hex").slice(0, 12)
}

function findProjectRoot(): string {
  let dir = process.cwd()
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".jfl", "config.json"))) return dir
    if (existsSync(join(dir, ".jfl"))) return dir
    dir = dirname(dir)
  }
  return process.cwd()
}

export class TrainingBuffer {
  private bufferPath: string
  private projectRoot: string

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot || findProjectRoot()
    this.bufferPath = join(this.projectRoot, ".jfl", "training-buffer.jsonl")
  }

  append(entry: Omit<TrainingBufferEntry, "id" | "v" | "ts">): TrainingBufferEntry {
    const full: TrainingBufferEntry = {
      id: `tb_${hashEntry(entry.state, entry.action)}`,
      v: 1,
      ts: new Date().toISOString(),
      ...entry,
    }

    const dir = dirname(this.bufferPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    appendFileSync(this.bufferPath, JSON.stringify(full) + "\n")
    return full
  }

  read(): TrainingBufferEntry[] {
    return TrainingBuffer.readFromPath(this.bufferPath)
  }

  /**
   * Read training buffer entries from all registered services.
   * Use this from GTM hub to get cross-project training data.
   */
  readAll(): TrainingBufferEntry[] {
    const entries = this.read()

    // Check if this project is a GTM or portfolio — aggregate from services
    const configPath = join(this.projectRoot, ".jfl", "config.json")
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, "utf-8"))
        if ((config.type === "gtm" || config.type === "portfolio") && config.registered_services) {
          const seen = new Set(entries.map(e => e.id))
          for (const svc of config.registered_services) {
            if (!svc.path) continue
            const svcBufferPath = join(svc.path, ".jfl", "training-buffer.jsonl")
            const svcEntries = TrainingBuffer.readFromPath(svcBufferPath)
            for (const entry of svcEntries) {
              if (!seen.has(entry.id)) {
                entries.push(entry)
                seen.add(entry.id)
              }
            }
          }
        }
      } catch {}
    }

    return entries
  }

  private static readFromPath(bufferPath: string): TrainingBufferEntry[] {
    if (!existsSync(bufferPath)) return []
    const entries: TrainingBufferEntry[] = []
    const lines = readFileSync(bufferPath, "utf-8").split("\n")
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        entries.push(JSON.parse(line) as TrainingBufferEntry)
      } catch {}
    }
    return entries
  }

  stats(): {
    total: number
    byAgent: Record<string, number>
    bySource: Record<string, number>
    avgReward: number
    improvedRate: number
  } {
    const entries = this.read()
    const byAgent: Record<string, number> = {}
    const bySource: Record<string, number> = {}
    let rewardSum = 0
    let improvedCount = 0

    for (const e of entries) {
      byAgent[e.agent] = (byAgent[e.agent] || 0) + 1
      bySource[e.metadata.source] = (bySource[e.metadata.source] || 0) + 1
      rewardSum += e.reward.composite_delta
      if (e.reward.improved) improvedCount++
    }

    return {
      total: entries.length,
      byAgent,
      bySource,
      avgReward: entries.length > 0 ? rewardSum / entries.length : 0,
      improvedRate: entries.length > 0 ? improvedCount / entries.length : 0,
    }
  }

  /**
   * Export in format ready for policy head training:
   * Each entry becomes a (state_text, action_text, reward) triple
   * that can be embedded via Stratus for the policy head
   */
  exportForTraining(): Array<{
    state_text: string
    action_text: string
    reward: number
    agent: string
    ts: string
  }> {
    const entries = this.read()

    return entries.map(e => ({
      state_text: [
        `Composite: ${e.state.composite_score.toFixed(4)}`,
        `Tests: ${e.state.tests_passing}/${e.state.tests_total}`,
        `Dimensions: ${Object.entries(e.state.dimension_scores).map(([k, v]) => `${k}=${v.toFixed(4)}`).join(", ")}`,
        `Trajectory length: ${e.state.trajectory_length}`,
        `Recent deltas: ${e.state.recent_deltas.map(d => (d >= 0 ? "+" : "") + d.toFixed(4)).join(", ")}`,
      ].join("\n"),
      action_text: [
        `Type: ${e.action.type}`,
        `Description: ${e.action.description}`,
        `Scope: ${e.action.scope}`,
        `Files: ${e.action.files_affected.join(", ")}`,
      ].join("\n"),
      reward: e.reward.composite_delta,
      agent: e.agent,
      ts: e.ts,
    }))
  }
}
