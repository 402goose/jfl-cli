/**
 * @purpose Autonomous telemetry agent — periodically analyzes telemetry, detects anomalies, uses Stratus rollout for health trajectory prediction, emits insight events that trigger the self-driving loop
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { loadLocalEvents, analyzeEvents, generateSuggestions } from './telemetry-digest.js'
import type { ImprovementSuggestion } from '../types/telemetry-digest.js'

export interface TelemetryInsight {
  id: string
  ts: string
  type: 'anomaly' | 'regression' | 'cost_spike' | 'pattern' | 'stratus_prediction'
  severity: 'high' | 'medium' | 'low'
  title: string
  description: string
  suggested_fix?: string
  source_pattern: string
  is_new: boolean
  stratus?: {
    brain_goal_proximity: number
    brain_confidence: number
    predicted_trajectory: 'improving' | 'degrading' | 'stable'
  }
}

interface AgentState {
  last_run: string
  last_insights: string[]
  baseline_cost: number
  baseline_errors: number
  baseline_crash_rate: number
  run_count: number
  health_trajectory: number[]
  last_stratus_run: string
  stratus_failures: number
}

interface StratusRolloutPrediction {
  brain_goal_proximity: number
  brain_confidence: number
  state_change: number
}

type EventEmitter = (type: string, data: Record<string, unknown>, source?: string) => void

export class TelemetryAgent {
  private projectRoot: string
  private intervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  private emitEvent: EventEmitter
  private statePath: string
  private state: AgentState
  private stratusUrl: string
  private stratusKey: string
  private stratusModel: string

  constructor(opts: {
    projectRoot: string
    intervalMs?: number
    emitEvent: EventEmitter
    stratusUrl?: string
    stratusKey?: string
    stratusModel?: string
  }) {
    this.projectRoot = opts.projectRoot
    this.intervalMs = opts.intervalMs || 30 * 60 * 1000
    this.emitEvent = opts.emitEvent
    this.statePath = join(this.projectRoot, '.jfl', 'telemetry-agent-state.json')
    this.stratusUrl = opts.stratusUrl || process.env.STRATUS_API_URL || 'https://api.stratus.run'
    this.stratusKey = opts.stratusKey || process.env.STRATUS_API_KEY || ''
    this.stratusModel = opts.stratusModel || 'stratus-x1ac-base-claude-sonnet-4-6'
    this.state = this.loadState()
  }

  private loadState(): AgentState {
    const defaults: AgentState = {
      last_run: '',
      last_insights: [],
      baseline_cost: 0,
      baseline_errors: 0,
      baseline_crash_rate: 0,
      run_count: 0,
      health_trajectory: [],
      last_stratus_run: '',
      stratus_failures: 0,
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
      writeFileSync(this.statePath, JSON.stringify(this.state, null, 2))
    } catch {}
  }

  start(): void {
    if (this.timer) return
    this.run()
    this.timer = setInterval(() => this.run(), this.intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async run(): Promise<TelemetryInsight[]> {
    const events = loadLocalEvents()
    const digest = analyzeEvents(events, 24)
    const suggestions = generateSuggestions(digest)

    const insights: TelemetryInsight[] = []
    const now = new Date().toISOString()

    for (const s of suggestions) {
      const id = `${s.type}:${s.title}`
      const isNew = !this.state.last_insights.includes(id)

      if (s.severity === 'high' || isNew) {
        insights.push({
          id,
          ts: now,
          type: this.classifyInsight(s),
          severity: s.severity as 'high' | 'medium' | 'low',
          title: s.title,
          description: s.description,
          suggested_fix: s.suggestedFix,
          source_pattern: s.type,
          is_new: isNew,
        })
      }
    }

    if (this.state.baseline_cost > 0 && digest.totalCostUsd > this.state.baseline_cost * 2) {
      insights.push({
        id: 'cost:spike',
        ts: now,
        type: 'cost_spike',
        severity: 'high',
        title: 'Cost spike detected',
        description: `Cost $${digest.totalCostUsd.toFixed(4)} is ${(digest.totalCostUsd / this.state.baseline_cost).toFixed(1)}x the baseline $${this.state.baseline_cost.toFixed(4)}`,
        source_pattern: 'cost',
        is_new: true,
      })
    }

    if (this.state.baseline_errors > 0 && digest.errors.total > this.state.baseline_errors * 3) {
      insights.push({
        id: 'errors:spike',
        ts: now,
        type: 'anomaly',
        severity: 'high',
        title: 'Error spike detected',
        description: `${digest.errors.total} errors vs baseline ${this.state.baseline_errors}`,
        source_pattern: 'reliability',
        is_new: true,
      })
    }

    // Stratus rollout: predict health trajectory using JEPA world model
    const stratusInsight = await this.runStratusRollout(digest, now)
    if (stratusInsight) {
      insights.push(stratusInsight)
    }

    for (const insight of insights) {
      this.emitEvent('telemetry:insight', {
        insight_id: insight.id,
        severity: insight.severity,
        type: insight.type,
        title: insight.title,
        description: insight.description,
        suggested_fix: insight.suggested_fix,
        is_new: insight.is_new,
        stratus: insight.stratus || null,
      }, 'telemetry-agent')
    }

    this.state.last_run = now
    this.state.last_insights = suggestions.map(s => `${s.type}:${s.title}`)

    // Update baselines using EMA, but only if current value is not a spike
    // A "spike" is defined as 3x the current baseline (or 2x for errors)
    const EMA_ALPHA = 0.15 // Weight for new value (lower = smoother, less reactive to spikes)

    if (digest.totalCostUsd > 0) {
      const costSpike = this.state.baseline_cost > 0 && digest.totalCostUsd > this.state.baseline_cost * 3
      if (!costSpike) {
        // Update baseline using EMA: new_baseline = alpha * current + (1-alpha) * old_baseline
        this.state.baseline_cost = this.state.baseline_cost === 0
          ? digest.totalCostUsd
          : EMA_ALPHA * digest.totalCostUsd + (1 - EMA_ALPHA) * this.state.baseline_cost
      }
      // If it's a spike, we don't update the baseline - let it remain stable
    }

    if (digest.errors.total > 0) {
      const errorSpike = this.state.baseline_errors > 0 && digest.errors.total > this.state.baseline_errors * 3
      if (!errorSpike) {
        this.state.baseline_errors = this.state.baseline_errors === 0
          ? digest.errors.total
          : EMA_ALPHA * digest.errors.total + (1 - EMA_ALPHA) * this.state.baseline_errors
      }
    }

    this.state.run_count++
    this.saveState()

    this.emitEvent('telemetry:agent-report', {
      run_number: this.state.run_count,
      insights_count: insights.length,
      new_insights: insights.filter(i => i.is_new).length,
      high_severity: insights.filter(i => i.severity === 'high').length,
      total_suggestions: suggestions.length,
      stratus_enabled: !!this.stratusKey,
      health_trajectory: this.state.health_trajectory.slice(-10),
      digest_summary: {
        events: digest.totalEvents,
        cost: digest.totalCostUsd,
        errors: digest.errors.total,
        sessions: digest.sessions.started,
        flows_triggered: digest.flows.triggered,
        flows_failed: digest.flows.failed,
      },
    }, 'telemetry-agent')

    return insights
  }

  private async runStratusRollout(
    digest: ReturnType<typeof analyzeEvents>,
    now: string,
  ): Promise<TelemetryInsight | null> {
    if (!this.stratusKey) return null

    try {
      const state = {
        events: digest.totalEvents,
        errors: digest.errors.total,
        cost: digest.totalCostUsd,
        sessions_started: digest.sessions.started,
        sessions_crashed: digest.sessions.crashed,
        flows_triggered: digest.flows.triggered,
        flows_failed: digest.flows.failed,
        error_rate: digest.totalEvents > 0 ? digest.errors.total / digest.totalEvents : 0,
        crash_rate: digest.sessions.started > 0 ? digest.sessions.crashed / digest.sessions.started : 0,
        health_trajectory: this.state.health_trajectory.slice(-5),
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)

      const response = await fetch(`${this.stratusUrl}/v1/rollout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.stratusKey}`,
        },
        body: JSON.stringify({
          model: this.stratusModel,
          state,
          goal: 'Maintain healthy system: zero crashes, low error rate, stable costs, all flows succeeding',
          horizon: 5,
          return_confidence: true,
        }),
        signal: controller.signal,
      })

      clearTimeout(timer)

      if (!response.ok) return null

      const result = await response.json() as {
        rollout: { predictions: StratusRolloutPrediction[] }
      }

      const predictions = result.rollout?.predictions || []
      if (predictions.length === 0) return null

      const avgProximity = predictions.reduce((s, p) => s + p.brain_goal_proximity, 0) / predictions.length
      const avgConfidence = predictions.reduce((s, p) => s + p.brain_confidence, 0) / predictions.length
      const avgStateChange = predictions.reduce((s, p) => s + p.state_change, 0) / predictions.length

      // Track health over time
      this.state.health_trajectory.push(avgProximity)
      if (this.state.health_trajectory.length > 50) {
        this.state.health_trajectory = this.state.health_trajectory.slice(-50)
      }
      this.state.last_stratus_run = now
      this.state.stratus_failures = 0

      // Detect trajectory direction
      const recent = this.state.health_trajectory.slice(-5)
      let trajectory: 'improving' | 'degrading' | 'stable' = 'stable'
      if (recent.length >= 3) {
        const trend = recent[recent.length - 1] - recent[0]
        if (trend > 0.05) trajectory = 'improving'
        else if (trend < -0.05) trajectory = 'degrading'
      }

      // Only emit insight if health is degrading or critically low
      if (trajectory === 'degrading' || avgProximity < 0.4) {
        return {
          id: `stratus:health-${trajectory}`,
          ts: now,
          type: 'stratus_prediction',
          severity: avgProximity < 0.3 ? 'high' : 'medium',
          title: `Stratus predicts ${trajectory} health trajectory`,
          description: `Brain goal proximity: ${avgProximity.toFixed(3)} (conf: ${avgConfidence.toFixed(3)}). ` +
            `State change: ${avgStateChange.toFixed(4)}. ` +
            `Trajectory over ${recent.length} runs: ${recent.map(v => v.toFixed(2)).join(' → ')}`,
          suggested_fix: trajectory === 'degrading'
            ? 'Investigate recent changes that may be causing degradation. Check error rate and flow failures.'
            : 'System health is critically low. Review crashes, errors, and failed flows.',
          source_pattern: 'stratus-rollout',
          is_new: true,
          stratus: {
            brain_goal_proximity: avgProximity,
            brain_confidence: avgConfidence,
            predicted_trajectory: trajectory,
          },
        }
      }

      return null
    } catch (err: any) {
      this.state.stratus_failures++
      if (this.state.stratus_failures <= 3) {
        // Silently fail first few times (API might be down)
      }
      return null
    }
  }

  private classifyInsight(s: ImprovementSuggestion): TelemetryInsight['type'] {
    if (s.type === 'cost') return 'cost_spike'
    if (s.type === 'reliability') return 'anomaly'
    if (s.type === 'perf') return 'regression'
    return 'pattern'
  }

  getStatus(): {
    running: boolean
    lastRun: string
    runCount: number
    lastInsights: string[]
    stratusEnabled: boolean
    healthTrajectory: number[]
    lastStratusRun: string
  } {
    return {
      running: this.timer !== null,
      lastRun: this.state.last_run,
      runCount: this.state.run_count,
      lastInsights: this.state.last_insights,
      stratusEnabled: !!this.stratusKey,
      healthTrajectory: this.state.health_trajectory,
      lastStratusRun: this.state.last_stratus_run,
    }
  }
}
