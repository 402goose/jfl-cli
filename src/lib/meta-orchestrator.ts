/**
 * Meta Orchestrator
 *
 * Simple scheduler for running multiple scoped agents.
 * NOT RL itself — just decides which agent to run next based on:
 * - Round-robin baseline
 * - Prioritize recently improving agents
 * - 30% exploration (random selection)
 *
 * @purpose Schedule and coordinate multiple scoped RL agents
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { loadAllAgentConfigs, type AgentConfig } from "./agent-config.js"
import { ReplayBuffer } from "./replay-buffer.js"

// ============================================================================
// Types
// ============================================================================

export interface AgentPerformance {
  agentName: string
  emaReward: number           // Exponential moving average of rewards
  totalRounds: number
  positiveRounds: number
  lastRunAt?: string
  recentRewards: number[]     // Last N rewards for analysis
}

export interface OrchestratorState {
  performances: Record<string, AgentPerformance>
  lastScheduledAgent?: string
  roundRobinIndex: number
  totalRounds: number
  updatedAt: string
}

export interface ScheduleDecision {
  agent: AgentConfig
  reason: "round_robin" | "prioritized" | "exploration" | "scope_impact"
  emaReward?: number
  impactPattern?: string      // Which upstream pattern triggered this
}

/**
 * Simple scope pattern matching.
 * Supports wildcards: "search:*" matches "search:quality-improved"
 * "data:index-*" matches "data:index-updated"
 */
function scopePatternMatches(event: string, pattern: string): boolean {
  if (pattern === "*" || pattern === event) return true
  if (pattern.endsWith(":*")) {
    return event.startsWith(pattern.slice(0, -1))
  }
  if (pattern.endsWith("*")) {
    return event.startsWith(pattern.slice(0, -1))
  }
  // Colon-prefix matching: "search" matches "search:anything"
  const colonIdx = event.indexOf(":")
  if (colonIdx > 0 && pattern === event.slice(0, colonIdx)) return true
  return false
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  explorationRate: 0.3,       // 30% random exploration
  emaAlpha: 0.3,              // EMA decay factor
  recentWindowSize: 10,       // Track last N rewards
  minRunsBetweenSameAgent: 2, // Avoid running same agent twice in a row
}

// ============================================================================
// Implementation
// ============================================================================

export class MetaOrchestrator {
  private projectRoot: string
  private statePath: string
  private state: OrchestratorState
  private replayBuffer: ReplayBuffer

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
    this.statePath = join(projectRoot, ".jfl", "meta-orchestrator-state.json")
    this.replayBuffer = new ReplayBuffer(projectRoot)
    this.state = this.loadState()
  }

  private loadState(): OrchestratorState {
    if (existsSync(this.statePath)) {
      try {
        return JSON.parse(readFileSync(this.statePath, "utf-8"))
      } catch {}
    }

    return {
      performances: {},
      roundRobinIndex: 0,
      totalRounds: 0,
      updatedAt: new Date().toISOString(),
    }
  }

  private saveState(): void {
    const dir = join(this.projectRoot, ".jfl")
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    this.state.updatedAt = new Date().toISOString()
    writeFileSync(this.statePath, JSON.stringify(this.state, null, 2))
  }

  /**
   * Get all configured agents
   */
  getAgents(): AgentConfig[] {
    return loadAllAgentConfigs(this.projectRoot)
  }

  /**
   * Schedule which agent to run next
   */
  /**
   * Check for scope:impact events and return agents that should react to them.
   * An agent reacts if any of its consumes patterns match the impact's pattern.
   */
  getImpactTriggeredAgents(): Array<{ agent: AgentConfig; impactPattern: string }> {
    const agents = this.getAgents()
    const eventsPath = join(this.projectRoot, ".jfl", "service-events.jsonl")
    if (!existsSync(eventsPath)) return []

    try {
      const lines = readFileSync(eventsPath, "utf-8").trim().split("\n").filter(Boolean)
      const recentImpacts = lines
        .map(l => { try { return JSON.parse(l) } catch { return null } })
        .filter(e => e?.type === "scope:impact")
        .filter(e => {
          // Only react to impacts from the last hour
          const ts = new Date(e.ts).getTime()
          return Date.now() - ts < 3600_000
        })

      const triggered: Array<{ agent: AgentConfig; impactPattern: string }> = []

      for (const impact of recentImpacts) {
        const pattern = impact.data?.pattern || ""
        for (const agent of agents) {
          // Skip the agent that produced this impact
          if (impact.data?.agent === agent.name) continue

          // Check if this agent consumes a pattern that matches the impact
          const consumes = agent.context_scope?.consumes || []
          for (const consumePattern of consumes) {
            if (scopePatternMatches(pattern, consumePattern)) {
              triggered.push({ agent, impactPattern: pattern })
            }
          }
        }
      }

      return triggered
    } catch {
      return []
    }
  }

  scheduleNext(): ScheduleDecision | null {
    const agents = this.getAgents()
    if (agents.length === 0) {
      return null
    }

    // HIGHEST PRIORITY: React to scope:impact events from upstream agents
    const impactTriggered = this.getImpactTriggeredAgents()
    if (impactTriggered.length > 0) {
      // Pick the first triggered agent (could be smarter — weighted by impact delta)
      const { agent, impactPattern } = impactTriggered[0]
      return {
        agent,
        reason: "scope_impact",
        impactPattern,
      }
    }

    // Single agent: always run it
    if (agents.length === 1) {
      return {
        agent: agents[0],
        reason: "round_robin",
      }
    }

    // 30% exploration: random selection
    if (Math.random() < DEFAULT_CONFIG.explorationRate) {
      const randomIndex = Math.floor(Math.random() * agents.length)
      return {
        agent: agents[randomIndex],
        reason: "exploration",
      }
    }

    // Check if we have performance data
    const hasPerformanceData = agents.some(
      a => this.state.performances[a.name]?.totalRounds > 0
    )

    if (hasPerformanceData) {
      // Prioritize agents with positive EMA reward
      const ranked = agents
        .map(a => ({
          agent: a,
          perf: this.state.performances[a.name],
        }))
        .filter(ap => {
          // Avoid running same agent twice in a row (if we have alternatives)
          if (this.state.lastScheduledAgent === ap.agent.name &&
              agents.length > DEFAULT_CONFIG.minRunsBetweenSameAgent) {
            return false
          }
          return true
        })
        .sort((a, b) => {
          const aEma = a.perf?.emaReward ?? 0
          const bEma = b.perf?.emaReward ?? 0
          return bEma - aEma
        })

      if (ranked.length > 0 && ranked[0].perf?.emaReward > 0) {
        return {
          agent: ranked[0].agent,
          reason: "prioritized",
          emaReward: ranked[0].perf.emaReward,
        }
      }
    }

    // Round-robin fallback
    const nextIndex = this.state.roundRobinIndex % agents.length
    this.state.roundRobinIndex = (this.state.roundRobinIndex + 1) % agents.length
    this.saveState()

    return {
      agent: agents[nextIndex],
      reason: "round_robin",
    }
  }

  /**
   * Record result after an agent finishes a round
   */
  recordResult(agentName: string, reward: number): void {
    if (!this.state.performances[agentName]) {
      this.state.performances[agentName] = {
        agentName,
        emaReward: 0,
        totalRounds: 0,
        positiveRounds: 0,
        recentRewards: [],
      }
    }

    const perf = this.state.performances[agentName]

    // Update EMA
    perf.emaReward = DEFAULT_CONFIG.emaAlpha * reward +
                     (1 - DEFAULT_CONFIG.emaAlpha) * perf.emaReward

    // Update counts
    perf.totalRounds++
    if (reward > 0) perf.positiveRounds++

    // Track recent rewards
    perf.recentRewards.push(reward)
    if (perf.recentRewards.length > DEFAULT_CONFIG.recentWindowSize) {
      perf.recentRewards.shift()
    }

    perf.lastRunAt = new Date().toISOString()
    this.state.lastScheduledAgent = agentName
    this.state.totalRounds++

    this.saveState()
  }

  /**
   * Get performance summary for all agents
   */
  getPerformanceSummary(): Array<{
    agentName: string
    emaReward: number
    totalRounds: number
    winRate: number
    trend: "up" | "down" | "stable"
  }> {
    return Object.values(this.state.performances).map(perf => {
      const winRate = perf.totalRounds > 0
        ? perf.positiveRounds / perf.totalRounds
        : 0

      // Calculate trend from recent rewards
      let trend: "up" | "down" | "stable" = "stable"
      if (perf.recentRewards.length >= 3) {
        const recent = perf.recentRewards.slice(-3)
        const first = recent[0]
        const last = recent[recent.length - 1]
        if (last > first + 0.001) trend = "up"
        else if (last < first - 0.001) trend = "down"
      }

      return {
        agentName: perf.agentName,
        emaReward: perf.emaReward,
        totalRounds: perf.totalRounds,
        winRate,
        trend,
      }
    }).sort((a, b) => b.emaReward - a.emaReward)
  }

  /**
   * Reset orchestrator state (useful for fresh starts)
   */
  reset(): void {
    this.state = {
      performances: {},
      roundRobinIndex: 0,
      totalRounds: 0,
      updatedAt: new Date().toISOString(),
    }
    this.saveState()
  }

  /**
   * Get overall statistics
   */
  getStats(): {
    totalRounds: number
    agentCount: number
    avgEmaReward: number
    overallWinRate: number
    bestAgent?: { name: string; emaReward: number }
    worstAgent?: { name: string; emaReward: number }
  } {
    const perfs = Object.values(this.state.performances)

    if (perfs.length === 0) {
      return {
        totalRounds: 0,
        agentCount: this.getAgents().length,
        avgEmaReward: 0,
        overallWinRate: 0,
      }
    }

    const avgEma = perfs.reduce((sum, p) => sum + p.emaReward, 0) / perfs.length
    const totalPositive = perfs.reduce((sum, p) => sum + p.positiveRounds, 0)
    const totalRoundsAll = perfs.reduce((sum, p) => sum + p.totalRounds, 0)
    const overallWinRate = totalRoundsAll > 0 ? totalPositive / totalRoundsAll : 0

    const sorted = perfs.sort((a, b) => b.emaReward - a.emaReward)

    return {
      totalRounds: this.state.totalRounds,
      agentCount: this.getAgents().length,
      avgEmaReward: avgEma,
      overallWinRate,
      bestAgent: sorted.length > 0 ? {
        name: sorted[0].agentName,
        emaReward: sorted[0].emaReward,
      } : undefined,
      worstAgent: sorted.length > 0 ? {
        name: sorted[sorted.length - 1].agentName,
        emaReward: sorted[sorted.length - 1].emaReward,
      } : undefined,
    }
  }

  /**
   * Run the swarm: schedule and execute agents for N rounds total
   */
  async runSwarm(
    totalRounds: number,
    onRoundComplete?: (
      agent: string,
      round: number,
      reward: number,
      reason: string
    ) => void
  ): Promise<{
    roundsCompleted: number
    perAgent: Record<string, { rounds: number; totalReward: number }>
  }> {
    const perAgent: Record<string, { rounds: number; totalReward: number }> = {}

    for (let i = 0; i < totalRounds; i++) {
      const decision = this.scheduleNext()
      if (!decision) {
        console.log("No agents available to schedule")
        break
      }

      // Import and run session
      const { startSession, runBaseline, runRound, endSession } = await import("./agent-session.js")
      const { StratusClient } = await import("./stratus-client.js")

      const session = startSession(decision.agent, this.projectRoot)
      await runBaseline(session)

      // Generate task using Stratus
      let task = `Improve ${decision.agent.metric} for ${decision.agent.scope}`
      const stratusKey = process.env.STRATUS_API_KEY
      if (stratusKey) {
        try {
          const stratus = new StratusClient({ apiKey: stratusKey })
          const prompt = `Suggest ONE specific code change to improve the ${decision.agent.metric} metric for the ${decision.agent.scope} scope. Be concrete and actionable. Files in scope: ${decision.agent.constraints.files_in_scope.join(", ")}`
          const response = await stratus.reason(prompt, { maxTokens: 200 })
          task = response.choices[0]?.message?.content || task
        } catch {}
      }

      const hypothesis = `Implementing "${task}" will improve ${decision.agent.metric}`

      const { result, transition } = await runRound(session, 1, task, hypothesis)

      // Record result
      this.recordResult(decision.agent.name, result.delta)

      // Write to replay buffer
      this.replayBuffer.write({
        agent: decision.agent.name,
        session_id: session.id,
        state_hash: transition.state_hash,
        state: transition.state,
        action_diff: transition.action_diff,
        action: transition.action,
        hypothesis,
        reward: result.delta,
        timestamp: new Date().toISOString(),
      })

      // Track per-agent stats
      if (!perAgent[decision.agent.name]) {
        perAgent[decision.agent.name] = { rounds: 0, totalReward: 0 }
      }
      perAgent[decision.agent.name].rounds++
      perAgent[decision.agent.name].totalReward += result.delta

      // End session
      await endSession(session, [transition])

      // Callback
      if (onRoundComplete) {
        onRoundComplete(decision.agent.name, i + 1, result.delta, decision.reason)
      }
    }

    return {
      roundsCompleted: totalRounds,
      perAgent,
    }
  }
}
