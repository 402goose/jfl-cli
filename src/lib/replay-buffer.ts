/**
 * Shared Replay Buffer
 *
 * Cross-agent learning via append-only JSONL file.
 * Enables agents to learn from each other's experiences.
 * 80% from own agent, 20% from others by default.
 *
 * @purpose Shared replay buffer for cross-agent reinforcement learning
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { createHash } from "crypto"
import type { RLState, RLAction, RLReward } from "./training-buffer.js"

// ============================================================================
// Types
// ============================================================================

export interface ReplayEntry {
  id: string                    // Unique entry ID
  agent: string                 // Agent that generated this entry
  session_id: string            // Session ID
  state_hash: string            // Hash of state for deduplication
  state: RLState                // RL state
  action_diff: string           // Git diff of changes
  action: RLAction              // Action taken
  hypothesis: string            // What the agent expected
  reward: number                // Actual reward (metric delta)
  timestamp: string             // ISO timestamp
}

export interface ReplayStats {
  totalEntries: number
  perAgent: Record<string, number>
  avgReward: number
  positiveRate: number          // % of entries with positive reward
  oldestEntry?: string          // Timestamp
  newestEntry?: string          // Timestamp
}

export interface SampleOptions {
  batchSize: number             // How many entries to sample
  crossAgentRatio: number       // 0.0-1.0, portion from other agents
  minReward?: number            // Only sample entries with reward >= this
  maxAge?: number               // Max age in ms
}

// ============================================================================
// Implementation
// ============================================================================

function findProjectRoot(): string {
  let dir = process.cwd()
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, ".jfl", "config.json"))) return dir
    if (existsSync(join(dir, ".jfl"))) return dir
    dir = dirname(dir)
  }
  return process.cwd()
}

function generateEntryId(agent: string, stateHash: string, timestamp: string): string {
  const hash = createHash("sha256")
    .update(`${agent}-${stateHash}-${timestamp}`)
    .digest("hex")
    .slice(0, 12)
  return `rb_${hash}`
}

export class ReplayBuffer {
  private bufferPath: string
  private projectRoot: string

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot || findProjectRoot()
    this.bufferPath = join(this.projectRoot, ".jfl", "replay-buffer.jsonl")
  }

  /**
   * Append a new entry to the replay buffer
   */
  write(entry: Omit<ReplayEntry, "id">): ReplayEntry {
    const id = generateEntryId(entry.agent, entry.state_hash, entry.timestamp)
    const full: ReplayEntry = { id, ...entry }

    const dir = dirname(this.bufferPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    appendFileSync(this.bufferPath, JSON.stringify(full) + "\n")
    return full
  }

  /**
   * Read all entries from the replay buffer
   */
  readAll(): ReplayEntry[] {
    if (!existsSync(this.bufferPath)) return []

    const entries: ReplayEntry[] = []
    const lines = readFileSync(this.bufferPath, "utf-8").split("\n")

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        entries.push(JSON.parse(line) as ReplayEntry)
      } catch {}
    }

    return entries
  }

  /**
   * Sample entries for training
   * By default: 80% from target agent, 20% from others
   */
  sample(agent: string, options: SampleOptions): ReplayEntry[] {
    const { batchSize, crossAgentRatio, minReward, maxAge } = options
    const entries = this.readAll()
    const now = Date.now()

    // Filter entries
    let filtered = entries.filter(e => {
      if (minReward !== undefined && e.reward < minReward) return false
      if (maxAge !== undefined) {
        const entryTime = new Date(e.timestamp).getTime()
        if (now - entryTime > maxAge) return false
      }
      return true
    })

    // Split by agent
    const ownEntries = filtered.filter(e => e.agent === agent)
    const otherEntries = filtered.filter(e => e.agent !== agent)

    // Calculate how many from each pool
    const crossAgentCount = Math.floor(batchSize * crossAgentRatio)
    const ownCount = batchSize - crossAgentCount

    // Randomly sample from each pool
    const sampled: ReplayEntry[] = []

    // Sample from own agent
    const shuffledOwn = this.shuffle(ownEntries)
    sampled.push(...shuffledOwn.slice(0, ownCount))

    // Sample from other agents
    const shuffledOthers = this.shuffle(otherEntries)
    sampled.push(...shuffledOthers.slice(0, crossAgentCount))

    // Shuffle final result
    return this.shuffle(sampled)
  }

  /**
   * Sample with prioritized experience replay
   * Prioritizes entries with higher absolute reward (more informative)
   */
  samplePrioritized(agent: string, options: SampleOptions): ReplayEntry[] {
    const { batchSize, crossAgentRatio, minReward, maxAge } = options
    const entries = this.readAll()
    const now = Date.now()

    // Filter entries
    let filtered = entries.filter(e => {
      if (minReward !== undefined && e.reward < minReward) return false
      if (maxAge !== undefined) {
        const entryTime = new Date(e.timestamp).getTime()
        if (now - entryTime > maxAge) return false
      }
      return true
    })

    // Calculate priority based on |reward| (higher = more informative)
    const withPriority = filtered.map(e => ({
      entry: e,
      priority: Math.abs(e.reward) + 0.001, // Small epsilon to avoid zero
    }))

    // Split by agent
    const ownEntries = withPriority.filter(ep => ep.entry.agent === agent)
    const otherEntries = withPriority.filter(ep => ep.entry.agent !== agent)

    // Calculate how many from each pool
    const crossAgentCount = Math.floor(batchSize * crossAgentRatio)
    const ownCount = batchSize - crossAgentCount

    const sampled: ReplayEntry[] = []

    // Prioritized sampling from own agent
    sampled.push(...this.prioritizedSample(ownEntries, ownCount))

    // Prioritized sampling from other agents
    sampled.push(...this.prioritizedSample(otherEntries, crossAgentCount))

    return this.shuffle(sampled)
  }

  private prioritizedSample(
    entries: Array<{ entry: ReplayEntry; priority: number }>,
    count: number
  ): ReplayEntry[] {
    if (entries.length === 0) return []
    if (entries.length <= count) return entries.map(e => e.entry)

    // Compute sampling probabilities
    const totalPriority = entries.reduce((sum, e) => sum + e.priority, 0)
    const probs = entries.map(e => e.priority / totalPriority)

    // Sample without replacement using priority weights
    const sampled: ReplayEntry[] = []
    const remaining = [...entries]
    const remainingProbs = [...probs]

    for (let i = 0; i < count && remaining.length > 0; i++) {
      // Normalize remaining probs
      const total = remainingProbs.reduce((a, b) => a + b, 0)
      const normalized = remainingProbs.map(p => p / total)

      // Sample
      const r = Math.random()
      let cumulative = 0
      for (let j = 0; j < remaining.length; j++) {
        cumulative += normalized[j]
        if (r <= cumulative) {
          sampled.push(remaining[j].entry)
          remaining.splice(j, 1)
          remainingProbs.splice(j, 1)
          break
        }
      }
    }

    return sampled
  }

  /**
   * Get statistics about the replay buffer
   */
  stats(): ReplayStats {
    const entries = this.readAll()

    if (entries.length === 0) {
      return {
        totalEntries: 0,
        perAgent: {},
        avgReward: 0,
        positiveRate: 0,
      }
    }

    const perAgent: Record<string, number> = {}
    let rewardSum = 0
    let positiveCount = 0
    let oldestTs = entries[0].timestamp
    let newestTs = entries[0].timestamp

    for (const e of entries) {
      perAgent[e.agent] = (perAgent[e.agent] || 0) + 1
      rewardSum += e.reward
      if (e.reward > 0) positiveCount++
      if (e.timestamp < oldestTs) oldestTs = e.timestamp
      if (e.timestamp > newestTs) newestTs = e.timestamp
    }

    return {
      totalEntries: entries.length,
      perAgent,
      avgReward: rewardSum / entries.length,
      positiveRate: positiveCount / entries.length,
      oldestEntry: oldestTs,
      newestEntry: newestTs,
    }
  }

  /**
   * Get entries for a specific agent
   */
  getForAgent(agent: string): ReplayEntry[] {
    return this.readAll().filter(e => e.agent === agent)
  }

  /**
   * Get recent entries
   */
  getRecent(count: number = 20): ReplayEntry[] {
    const entries = this.readAll()
    return entries
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, count)
  }

  /**
   * Export for policy head training
   */
  exportForTraining(): Array<{
    state_text: string
    action_text: string
    reward: number
    agent: string
    ts: string
  }> {
    const entries = this.readAll()

    return entries.map(e => ({
      state_text: this.formatStateText(e.state),
      action_text: this.formatActionText(e.action, e.hypothesis),
      reward: e.reward,
      agent: e.agent,
      ts: e.timestamp,
    }))
  }

  private formatStateText(state: RLState): string {
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

  private formatActionText(action: RLAction, hypothesis: string): string {
    const files = action.files_affected.slice(0, 5).join(", ")
    return [
      `Type: ${action.type}`,
      `Description: ${action.description.slice(0, 150)}`,
      `Hypothesis: ${hypothesis.slice(0, 100)}`,
      `Scope: ${action.scope}`,
      `Files: ${files || "none"}`,
    ].join("\n")
  }

  private shuffle<T>(array: T[]): T[] {
    const result = [...array]
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }

  /**
   * Clear old entries (keep last N or by age)
   */
  prune(options: { maxEntries?: number; maxAge?: number }): number {
    const entries = this.readAll()
    const now = Date.now()

    let filtered = entries

    // Filter by age
    if (options.maxAge) {
      filtered = filtered.filter(e => {
        const entryTime = new Date(e.timestamp).getTime()
        return now - entryTime <= options.maxAge!
      })
    }

    // Keep only most recent N
    if (options.maxEntries && filtered.length > options.maxEntries) {
      filtered = filtered
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, options.maxEntries)
    }

    const pruned = entries.length - filtered.length

    if (pruned > 0) {
      // Rewrite buffer with filtered entries
      const content = filtered.map(e => JSON.stringify(e)).join("\n") + "\n"
      writeFileSync(this.bufferPath, content)
    }

    return pruned
  }
}
