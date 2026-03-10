/**
 * @purpose Autonomous telemetry agent — periodically analyzes telemetry, detects anomalies, emits insight events
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { loadLocalEvents, analyzeEvents, generateSuggestions } from './telemetry-digest.js'
import type { ImprovementSuggestion } from '../types/telemetry-digest.js'

export interface TelemetryInsight {
  id: string
  ts: string
  type: 'anomaly' | 'regression' | 'cost_spike' | 'pattern'
  severity: 'high' | 'medium' | 'low'
  title: string
  description: string
  suggested_fix?: string
  source_pattern: string
  is_new: boolean
}

interface AgentState {
  last_run: string
  last_insights: string[]
  baseline_cost: number
  baseline_errors: number
  baseline_crash_rate: number
  run_count: number
}

type EventEmitter = (type: string, data: Record<string, unknown>, source?: string) => void

export class TelemetryAgent {
  private projectRoot: string
  private intervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  private emitEvent: EventEmitter
  private statePath: string
  private state: AgentState

  constructor(opts: {
    projectRoot: string
    intervalMs?: number
    emitEvent: EventEmitter
  }) {
    this.projectRoot = opts.projectRoot
    this.intervalMs = opts.intervalMs || 30 * 60 * 1000
    this.emitEvent = opts.emitEvent
    this.statePath = join(this.projectRoot, '.jfl', 'telemetry-agent-state.json')
    this.state = this.loadState()
  }

  private loadState(): AgentState {
    if (existsSync(this.statePath)) {
      try {
        return JSON.parse(readFileSync(this.statePath, 'utf-8'))
      } catch {}
    }
    return {
      last_run: '',
      last_insights: [],
      baseline_cost: 0,
      baseline_errors: 0,
      baseline_crash_rate: 0,
      run_count: 0,
    }
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

    for (const insight of insights) {
      this.emitEvent('telemetry:insight', {
        insight_id: insight.id,
        severity: insight.severity,
        type: insight.type,
        title: insight.title,
        description: insight.description,
        suggested_fix: insight.suggested_fix,
        is_new: insight.is_new,
      }, 'telemetry-agent')
    }

    this.state.last_run = now
    this.state.last_insights = suggestions.map(s => `${s.type}:${s.title}`)
    this.state.baseline_cost = digest.totalCostUsd || this.state.baseline_cost
    this.state.baseline_errors = digest.errors.total || this.state.baseline_errors
    this.state.run_count++
    this.saveState()

    if (insights.length > 0) {
      this.emitEvent('telemetry:agent-report', {
        run_number: this.state.run_count,
        insights_count: insights.length,
        new_insights: insights.filter(i => i.is_new).length,
        high_severity: insights.filter(i => i.severity === 'high').length,
        total_suggestions: suggestions.length,
        digest_summary: {
          events: digest.totalEvents,
          cost: digest.totalCostUsd,
          errors: digest.errors.total,
          sessions: digest.sessions.started,
        },
      }, 'telemetry-agent')
    }

    return insights
  }

  private classifyInsight(s: ImprovementSuggestion): TelemetryInsight['type'] {
    if (s.type === 'cost') return 'cost_spike'
    if (s.type === 'reliability') return 'anomaly'
    if (s.type === 'perf') return 'regression'
    return 'pattern'
  }

  getStatus(): { running: boolean; lastRun: string; runCount: number; lastInsights: string[] } {
    return {
      running: this.timer !== null,
      lastRun: this.state.last_run,
      runCount: this.state.run_count,
      lastInsights: this.state.last_insights,
    }
  }
}
