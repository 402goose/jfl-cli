/**
 * Sentinel RL - Nightly System Review Agent
 *
 * Takes telemetry data, journal entries, eval history, and PR reviews
 * to score the system and train a policy for what to recommend.
 *
 * @purpose Sentinel as RL agent for nightly system review and recommendations
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import type {
  PlatformDigest,
  SentinelScores,
  SentinelRecommendation,
  SentinelState,
} from '../types/platform-digest.js'
import type { EvalEntry } from '../types/eval.js'
import { TelemetryAgentV2 } from './telemetry-agent-v2.js'
import { readEvals } from './eval-store.js'
import { TrainingBuffer, type RLState, type RLAction, type RLReward } from './training-buffer.js'
import { ReplayBuffer } from './replay-buffer.js'

// ============================================================================
// Types
// ============================================================================

interface SentinelOptions {
  projectRoot: string
  emitEvent?: (type: string, data: Record<string, unknown>, source?: string) => void
}

interface JournalEntry {
  v: number
  ts: string
  session: string
  type: string
  status: string
  title: string
  summary: string
  detail?: string
  files?: string[]
  outcome?: string
  score_delta?: number
}

interface PRReview {
  prNumber: number
  merged: boolean
  reviewed: boolean
  comments: number
  createdAt: string
  mergedAt?: string
}

// ============================================================================
// Implementation
// ============================================================================

export class SentinelRL {
  private projectRoot: string
  private emitEvent: (type: string, data: Record<string, unknown>, source?: string) => void
  private statePath: string
  private state: SentinelState

  constructor(opts: SentinelOptions) {
    this.projectRoot = opts.projectRoot
    this.emitEvent = opts.emitEvent || (() => {})
    this.statePath = join(this.projectRoot, '.jfl', 'sentinel-state.json')
    this.state = this.loadState()
  }

  private loadState(): SentinelState {
    const defaults: SentinelState = {
      lastRun: '',
      runCount: 0,
      scores: [],
      recommendations: [],
      policyUpdates: 0,
    }
    if (existsSync(this.statePath)) {
      try {
        return { ...defaults, ...JSON.parse(readFileSync(this.statePath, 'utf-8')) }
      } catch {}
    }
    return defaults
  }

  private saveState(): void {
    try {
      const dir = join(this.projectRoot, '.jfl')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(this.statePath, JSON.stringify(this.state, null, 2))
    } catch {}
  }

  /**
   * Collect all inputs for the nightly review
   */
  async collectInputs(): Promise<{
    telemetryResult: Awaited<ReturnType<TelemetryAgentV2['run']>>
    journalEntries: JournalEntry[]
    evalHistory: EvalEntry[]
    prReviews: PRReview[]
    replayStats: ReturnType<ReplayBuffer['stats']>
    trainingStats: ReturnType<TrainingBuffer['stats']>
  }> {
    // 1. Telemetry digest
    const telemetryAgent = new TelemetryAgentV2({
      projectRoot: this.projectRoot,
      emitEvent: this.emitEvent,
    })
    const telemetryResult = await telemetryAgent.run()

    // 2. Journal entries from last 24h
    const journalEntries = this.loadJournalEntries(24)

    // 3. Eval history
    const evalHistory = readEvals(this.projectRoot)

    // 4. PR reviews from last 24h
    const prReviews = await this.loadPRReviews(24)

    // 5. Replay buffer stats
    const replayBuffer = new ReplayBuffer(this.projectRoot)
    const replayStats = replayBuffer.stats()

    // 6. Training buffer stats
    const trainingBuffer = new TrainingBuffer(this.projectRoot)
    const trainingStats = trainingBuffer.stats()

    return {
      telemetryResult,
      journalEntries,
      evalHistory,
      prReviews,
      replayStats,
      trainingStats,
    }
  }

  /**
   * Score the system across dimensions
   */
  scoreSystem(inputs: Awaited<ReturnType<SentinelRL['collectInputs']>>): SentinelScores {
    const { telemetryResult, journalEntries, evalHistory, prReviews, replayStats, trainingStats } = inputs

    // 1. Product Health: Are users succeeding?
    // command_success_rate * (1 - session_crash_rate) * (1 - hub_crash_rate)
    let productHealth = 0.5 // Default
    if (telemetryResult.metrics) {
      productHealth = telemetryResult.metrics.command_success_rate
        * (1 - telemetryResult.metrics.session_crash_rate)
        * (1 - telemetryResult.metrics.hub_crash_rate)
    }

    // 2. Development Velocity: Are we shipping?
    // PRs merged in 24h + eval improvements
    const prsMerged = prReviews.filter(pr => pr.merged).length
    const recentEvals = evalHistory
      .filter(e => new Date(e.ts).getTime() > Date.now() - 24 * 60 * 60 * 1000)
    const evalImprovements = recentEvals.filter(e => (e.delta?.composite ?? 0) > 0).length

    // Normalize: 3+ PRs = 1.0, 0 PRs = 0
    const developmentVelocity = Math.min(1, (prsMerged * 0.25 + evalImprovements * 0.15))

    // 3. Agent Effectiveness: Are agents helping?
    // Merge rate of PP-generated PRs, cost efficiency
    const ppPRs = prReviews.filter(pr => true) // In reality, filter by pp-generated label
    const mergeRate = ppPRs.length > 0
      ? ppPRs.filter(pr => pr.merged).length / ppPRs.length
      : 0.5
    const agentEffectiveness = mergeRate

    // 4. Data Quality: Is training data good?
    // Reward variance (lower = more consistent), positive_reward_ratio
    const positiveRate = trainingStats.improvedRate
    const tupleCount = trainingStats.total
    const dataQuality = positiveRate > 0.3 ? 0.5 + positiveRate * 0.5 : positiveRate * 1.5

    // Composite: weighted average
    const composite =
      productHealth * 0.35 +
      developmentVelocity * 0.25 +
      agentEffectiveness * 0.25 +
      dataQuality * 0.15

    return {
      productHealth,
      developmentVelocity,
      agentEffectiveness,
      dataQuality,
      composite,
    }
  }

  /**
   * Generate recommendations based on scores and analysis
   */
  generateRecommendations(
    scores: SentinelScores,
    inputs: Awaited<ReturnType<SentinelRL['collectInputs']>>,
  ): SentinelRecommendation[] {
    const recommendations: SentinelRecommendation[] = []
    const { telemetryResult, evalHistory } = inputs

    // 1. Which agents to run tomorrow
    if (telemetryResult.proposedAgents.length > 0) {
      for (const agent of telemetryResult.proposedAgents) {
        recommendations.push({
          type: 'agent-run',
          priority: agent.priority,
          description: `Run ${agent.name} agent`,
          reason: agent.reason,
          targetMetric: agent.triggeredBy,
          confidence: 0.7,
        })
      }
    }

    // 2. Which code areas need review
    if (telemetryResult.alerts.length > 0) {
      for (const alert of telemetryResult.alerts) {
        recommendations.push({
          type: 'code-review',
          priority: 'high',
          description: `Review code affecting ${alert.name}`,
          reason: `${alert.name} declined by ${alert.percentChange.toFixed(1)}%`,
          targetMetric: alert.name,
          confidence: 0.8,
        })
      }
    }

    // 3. Focus areas based on lowest scores
    if (scores.productHealth < 0.7) {
      recommendations.push({
        type: 'focus-area',
        priority: 'high',
        description: 'Focus on product stability',
        reason: `Product health at ${(scores.productHealth * 100).toFixed(0)}%`,
        confidence: 0.85,
      })
    }

    if (scores.developmentVelocity < 0.3) {
      recommendations.push({
        type: 'focus-area',
        priority: 'medium',
        description: 'Increase shipping velocity',
        reason: `Velocity at ${(scores.developmentVelocity * 100).toFixed(0)}%`,
        confidence: 0.75,
      })
    }

    if (scores.dataQuality < 0.5) {
      recommendations.push({
        type: 'focus-area',
        priority: 'medium',
        description: 'Improve training data quality',
        reason: `Data quality at ${(scores.dataQuality * 100).toFixed(0)}%`,
        confidence: 0.7,
      })
    }

    return recommendations
  }

  /**
   * Train policy based on yesterday's recommendations vs today's scores
   */
  trainPolicy(todayScores: SentinelScores): void {
    if (this.state.scores.length < 2) return

    const yesterdayScores = this.state.scores[this.state.scores.length - 1]
    const yesterdayRecommendations = this.state.recommendations

    // Build training tuple
    const state: RLState = {
      composite_score: yesterdayScores.composite,
      dimension_scores: {
        product_health: yesterdayScores.productHealth,
        development_velocity: yesterdayScores.developmentVelocity,
        agent_effectiveness: yesterdayScores.agentEffectiveness,
        data_quality: yesterdayScores.dataQuality,
      },
      tests_passing: 0,
      tests_total: 0,
      trajectory_length: this.state.runCount,
      recent_deltas: this.state.scores.slice(-5).map(s => s.composite),
      agent: 'sentinel',
    }

    const action: RLAction = {
      type: 'experiment',
      description: yesterdayRecommendations.slice(0, 3).map(r => r.description).join('; '),
      files_affected: [],
      scope: 'large',
      branch: 'main',
    }

    const scoreDelta = todayScores.composite - yesterdayScores.composite
    const reward: RLReward = {
      composite_delta: scoreDelta,
      dimension_deltas: {
        product_health: todayScores.productHealth - yesterdayScores.productHealth,
        development_velocity: todayScores.developmentVelocity - yesterdayScores.developmentVelocity,
        agent_effectiveness: todayScores.agentEffectiveness - yesterdayScores.agentEffectiveness,
        data_quality: todayScores.dataQuality - yesterdayScores.dataQuality,
      },
      tests_added: 0,
      quality_score: todayScores.composite,
      improved: scoreDelta > 0,
    }

    // Write to training buffer
    const buffer = new TrainingBuffer(this.projectRoot)
    buffer.append({
      agent: 'sentinel',
      state,
      action,
      reward,
      metadata: {
        branch: 'main',
        source: 'autoresearch',
      },
    })

    this.state.policyUpdates++
  }

  /**
   * Run the nightly review
   */
  async run(): Promise<{
    scores: SentinelScores
    recommendations: SentinelRecommendation[]
    inputs: Awaited<ReturnType<SentinelRL['collectInputs']>>
  }> {
    const now = new Date().toISOString()

    // Collect all inputs
    const inputs = await this.collectInputs()

    // Score the system
    const scores = this.scoreSystem(inputs)

    // Train policy if we have history
    this.trainPolicy(scores)

    // Generate recommendations
    const recommendations = this.generateRecommendations(scores, inputs)

    // Emit events
    this.emitEvent('sentinel:review-complete', {
      timestamp: now,
      scores,
      recommendations_count: recommendations.length,
      high_priority: recommendations.filter(r => r.priority === 'high').length,
    }, 'sentinel')

    for (const rec of recommendations.filter(r => r.priority === 'high')) {
      this.emitEvent('sentinel:recommendation', {
        type: rec.type,
        description: rec.description,
        reason: rec.reason,
        confidence: rec.confidence,
      }, 'sentinel')
    }

    // Update state
    this.state.lastRun = now
    this.state.runCount++
    this.state.scores.push(scores)
    if (this.state.scores.length > 30) {
      this.state.scores = this.state.scores.slice(-30)
    }
    this.state.recommendations = recommendations
    this.saveState()

    // Write report to VERIFICATION.md
    this.writeReport(scores, recommendations, inputs)

    return { scores, recommendations, inputs }
  }

  /**
   * Write VERIFICATION.md report
   */
  private writeReport(
    scores: SentinelScores,
    recommendations: SentinelRecommendation[],
    inputs: Awaited<ReturnType<SentinelRL['collectInputs']>>,
  ): void {
    const reportPath = join(this.projectRoot, '.jfl', 'SENTINEL-REPORT.md')

    const lines: string[] = [
      '# Sentinel Nightly Report',
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## System Scores',
      '',
      '| Dimension | Score | Status |',
      '|-----------|-------|--------|',
      `| Product Health | ${(scores.productHealth * 100).toFixed(0)}% | ${this.scoreEmoji(scores.productHealth)} |`,
      `| Development Velocity | ${(scores.developmentVelocity * 100).toFixed(0)}% | ${this.scoreEmoji(scores.developmentVelocity)} |`,
      `| Agent Effectiveness | ${(scores.agentEffectiveness * 100).toFixed(0)}% | ${this.scoreEmoji(scores.agentEffectiveness)} |`,
      `| Data Quality | ${(scores.dataQuality * 100).toFixed(0)}% | ${this.scoreEmoji(scores.dataQuality)} |`,
      `| **Composite** | **${(scores.composite * 100).toFixed(0)}%** | ${this.scoreEmoji(scores.composite)} |`,
      '',
      '## Recommendations',
      '',
    ]

    if (recommendations.length === 0) {
      lines.push('No recommendations at this time.')
    } else {
      lines.push('| Priority | Type | Description | Reason |')
      lines.push('|----------|------|-------------|--------|')
      for (const rec of recommendations) {
        lines.push(`| ${rec.priority} | ${rec.type} | ${rec.description} | ${rec.reason} |`)
      }
    }

    lines.push('')
    lines.push('## Metrics Summary')
    lines.push('')

    if (inputs.telemetryResult.metrics) {
      const m = inputs.telemetryResult.metrics
      lines.push('| Metric | Value |')
      lines.push('|--------|-------|')
      lines.push(`| Command Success Rate | ${(m.command_success_rate * 100).toFixed(1)}% |`)
      lines.push(`| Command P90 Latency | ${m.command_p90_latency_ms}ms |`)
      lines.push(`| Session Crash Rate | ${(m.session_crash_rate * 100).toFixed(2)}% |`)
      lines.push(`| Hub Crash Rate | ${(m.hub_crash_rate * 100).toFixed(2)}% |`)
      lines.push(`| Flow Completion Rate | ${(m.flow_completion_rate * 100).toFixed(1)}% |`)
      lines.push(`| Cost Per Session | $${m.cost_per_session_usd.toFixed(4)} |`)
      lines.push(`| Active Installs | ${m.active_installs} |`)
    } else {
      lines.push('No metrics available (platform unreachable)')
    }

    lines.push('')
    lines.push('## Training Data')
    lines.push('')
    lines.push(`- Total tuples: ${inputs.trainingStats.total}`)
    lines.push(`- Average reward: ${inputs.trainingStats.avgReward.toFixed(4)}`)
    lines.push(`- Improvement rate: ${(inputs.trainingStats.improvedRate * 100).toFixed(1)}%`)
    lines.push(`- Replay buffer: ${inputs.replayStats.totalEntries} entries`)
    lines.push('')

    writeFileSync(reportPath, lines.join('\n'))
  }

  private scoreEmoji(score: number): string {
    if (score >= 0.8) return '🟢'
    if (score >= 0.5) return '🟡'
    return '🔴'
  }

  /**
   * Load journal entries from the last N hours
   */
  private loadJournalEntries(hours: number): JournalEntry[] {
    const journalDir = join(this.projectRoot, '.jfl', 'journal')
    if (!existsSync(journalDir)) return []

    const cutoff = Date.now() - hours * 60 * 60 * 1000
    const entries: JournalEntry[] = []

    try {
      const files = readdirSync(journalDir).filter(f => f.endsWith('.jsonl'))
      for (const file of files) {
        const content = readFileSync(join(journalDir, file), 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const entry = JSON.parse(line) as JournalEntry
            if (new Date(entry.ts).getTime() >= cutoff) {
              entries.push(entry)
            }
          } catch {}
        }
      }
    } catch {}

    return entries.sort((a, b) => b.ts.localeCompare(a.ts))
  }

  /**
   * Load PR reviews from GitHub
   */
  private async loadPRReviews(hours: number): Promise<PRReview[]> {
    try {
      const result = spawnSync('gh', [
        'pr', 'list',
        '--state', 'all',
        '--json', 'number,mergedAt,createdAt,reviewDecision,comments',
        '--limit', '50',
      ], {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      })

      if (result.status !== 0) return []

      const prs = JSON.parse(result.stdout || '[]') as Array<{
        number: number
        mergedAt: string | null
        createdAt: string
        reviewDecision: string | null
        comments: Array<any>
      }>

      const cutoff = Date.now() - hours * 60 * 60 * 1000

      return prs
        .filter(pr => new Date(pr.createdAt).getTime() >= cutoff)
        .map(pr => ({
          prNumber: pr.number,
          merged: pr.mergedAt !== null,
          reviewed: pr.reviewDecision !== null,
          comments: pr.comments?.length || 0,
          createdAt: pr.createdAt,
          mergedAt: pr.mergedAt || undefined,
        }))
    } catch {
      return []
    }
  }

  /**
   * Get current state
   */
  getStatus(): SentinelState {
    return this.state
  }
}
