/**
 * Telemetry Agent V2 - Real Platform Digest Consumer
 *
 * Fetches production telemetry from jfl-platform digest API,
 * extracts real metrics, compares to previous runs, generates
 * training tuples, and proposes scoped RL agents.
 *
 * @purpose Real telemetry agent consuming platform digest API for metrics-driven RL
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import type {
  PlatformDigest,
  MetricComparison,
  ProposedAgent,
  TelemetryAgentV2State,
} from '../types/platform-digest.js'
import type { RLState, RLAction, RLReward } from './training-buffer.js'
import { TrainingBuffer } from './training-buffer.js'

// ============================================================================
// Types
// ============================================================================

type EventEmitter = (type: string, data: Record<string, unknown>, source?: string) => void

interface ProductInsight {
  type: 'training' | 'product' | 'system' | 'performance'
  severity: 'info' | 'warning' | 'critical'
  title: string
  detail: string
}

interface TelemetryAgentV2Options {
  projectRoot: string
  platformUrl?: string
  installId?: string
  stratusUrl?: string
  stratusKey?: string
  emitEvent?: EventEmitter
}

interface ExtractedMetrics {
  command_success_rate: number
  command_p90_latency_ms: number
  hub_crash_rate: number
  session_crash_rate: number
  hook_hit_rate: number
  mcp_avg_latency_ms: number
  error_cluster_count: number
  flow_completion_rate: number
  cost_per_session_usd: number
  active_installs: number
}

// ============================================================================
// Implementation
// ============================================================================

export class TelemetryAgentV2 {
  private projectRoot: string
  private platformUrl: string
  private installId: string
  private stratusUrl: string
  private stratusKey: string
  private emitEvent: EventEmitter
  private statePath: string
  private state: TelemetryAgentV2State

  constructor(opts: TelemetryAgentV2Options) {
    this.projectRoot = opts.projectRoot
    this.platformUrl = opts.platformUrl || process.env.JFL_PLATFORM_URL || this.loadPlatformUrl()
    this.installId = opts.installId || this.loadInstallId()
    this.stratusUrl = opts.stratusUrl || process.env.STRATUS_API_URL || 'https://api.stratus.run'
    this.stratusKey = opts.stratusKey || process.env.STRATUS_API_KEY || ''
    this.emitEvent = opts.emitEvent || (() => {})
    this.statePath = join(this.projectRoot, '.jfl', 'telemetry-agent-v2-state.json')
    this.state = this.loadState()
  }

  private loadPlatformUrl(): string {
    // Try project config first
    const configPath = join(this.projectRoot, '.jfl', 'config.json')
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'))
        if (config.platformUrl) return config.platformUrl
      } catch {}
    }
    return 'https://jfl-platform.fly.dev'
  }

  private loadInstallId(): string {
    // Try to get from telemetry config
    const telemetryConfigPath = join(this.projectRoot, '.jfl', 'telemetry-config.json')
    if (existsSync(telemetryConfigPath)) {
      try {
        const config = JSON.parse(readFileSync(telemetryConfigPath, 'utf-8'))
        if (config.installId) return config.installId
      } catch {}
    }
    // Generate new one
    return `jfl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  private loadState(): TelemetryAgentV2State {
    const defaults: TelemetryAgentV2State = {
      lastRun: '',
      runCount: 0,
      recentTrainingTuples: 0,
      totalTrainingTuples: 0,
      proposedAgents: [],
      lastStratusRun: '',
      stratusFailures: 0,
      healthTrajectory: [],
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
   * Fetch digest from platform API
   */
  async fetchDigest(hours: number = 24): Promise<PlatformDigest | null> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 45000) // Fly.io cold starts can be slow

      const response = await fetch(`${this.platformUrl}/api/v1/telemetry/digest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-install-id': this.installId,
        },
        body: JSON.stringify({ hours }),
        signal: controller.signal,
      })

      clearTimeout(timer)

      if (!response.ok) {
        console.error(`Digest API returned ${response.status}`)
        return null
      }

      const raw = await response.json() as any

      // Normalize API field names to our PlatformDigest interface
      // API returns: commandUsage, toolFrequency, flowActivity, hookUsage
      // Our types expect: commands, toolStats, flowStats, hookStats
      const normalized: PlatformDigest = {
        periodHours: raw.periodHours,
        generatedAt: raw.generatedAt,
        activeInstalls: raw.activeInstalls || 0,
        totalEvents: raw.totalEvents || 0,
        totalSessions: raw.sessionCosts?.length || raw.totalSessions || 0,

        // Commands: normalize commandUsage → commands
        commands: (raw.commandUsage || raw.commands || []).map((c: any) => ({
          command: c.command,
          count: c.count,
          avgDurationMs: c.avgDurationMs || 0,
          p90DurationMs: c.p90DurationMs || 0,
          p99DurationMs: c.p99DurationMs || 0,
          successRate: c.successRate ?? 1,
          errorCount: c.errorCount || 0,
        })),
        commandSuccessRate: raw.commandSuccessRate ?? 1,
        worstP90Command: raw.worstP90Command,

        // Errors
        errorClusters: raw.errorClusters || [],
        totalErrors: raw.totalErrors || 0,

        // Session health
        sessionHealth: raw.sessionHealth || { started: 0, ended: 0, crashed: 0, avgDurationS: 0, crashRate: 0 },

        // Hub health
        hubHealth: raw.hubHealth || { starts: 0, stops: 0, crashes: 0, mcpCalls: 0, avgMcpLatencyMs: 0, p90McpLatencyMs: 0, p99McpLatencyMs: 0 },

        // Hooks: normalize hookUsage → hookStats
        hookStats: raw.hookStats || {
          totalReceived: (raw.hookUsage || []).reduce((s: number, h: any) => s + (h.count || 0), 0),
          byEvent: Object.fromEntries((raw.hookUsage || []).map((h: any) => [h.hookEventName, h.count])),
          byTool: {},
          fileHotspots: (raw.fileHotspots || []).map((f: any) => ({ file: f.file || f.path, edits: f.edits || f.count || 0 })),
        },

        // Tools: normalize toolFrequency → toolStats
        toolStats: (raw.toolFrequency || raw.toolStats || []).map((t: any) => ({
          toolName: t.toolName,
          callCount: t.callCount || t.count || 0,
          avgLatencyMs: t.avgLatencyMs || t.avgDurationMs || 0,
          p90LatencyMs: t.p90LatencyMs || 0,
          errorRate: t.errorRate || 0,
        })),

        // Flows: normalize flowActivity → flowStats
        flowStats: raw.flowStats || {
          triggered: (raw.flowActivity || []).reduce((s: number, f: any) => s + (f.triggerCount || 0), 0),
          completed: (raw.flowActivity || []).reduce((s: number, f: any) => s + (f.completedCount || 0), 0),
          failed: (raw.flowActivity || []).reduce((s: number, f: any) => s + (f.failedActions || 0), 0),
          byFlow: Object.fromEntries((raw.flowActivity || []).map((f: any) => [f.flowName, {
            triggered: f.triggerCount || 0,
            completed: f.completedCount || 0,
            failed: f.failedActions || 0,
          }])),
          completionRate: (() => {
            const t = (raw.flowActivity || []).reduce((s: number, f: any) => s + (f.triggerCount || 0), 0)
            const c = (raw.flowActivity || []).reduce((s: number, f: any) => s + (f.completedCount || 0), 0)
            return t > 0 ? c / t : 1
          })(),
        },

        // Latency
        latencyPercentiles: raw.latencyPercentiles || [],

        // Costs
        modelCosts: raw.modelCosts || [],
        sessionCosts: (raw.sessionCosts || []).map((s: any) => ({
          sessionId: s.sessionId,
          installId: s.installId,
          totalTokens: s.totalTokens || 0,
          estimatedCostUsd: s.estimatedCostUsd || 0,
          durationS: s.durationS || 0,
          modelBreakdown: s.modelBreakdown || [],
        })),
        totalCostUsd: raw.totalCostUsd || 0,
        costPerSessionUsd: raw.costPerSessionUsd || 0,
      }

      return normalized
    } catch (err: any) {
      console.error(`Failed to fetch digest: ${err.message}`)
      return null
    }
  }

  /**
   * Extract real metrics from platform digest
   */
  extractMetrics(digest: PlatformDigest): ExtractedMetrics {
    // Command success rate: weighted average across all commands
    let totalCommands = 0
    let successfulCommands = 0
    let worstP90 = 0
    for (const cmd of digest.commands) {
      totalCommands += cmd.count
      successfulCommands += cmd.count * cmd.successRate
      if (cmd.p90DurationMs > worstP90) worstP90 = cmd.p90DurationMs
    }
    const commandSuccessRate = totalCommands > 0 ? successfulCommands / totalCommands : 1

    // Hub crash rate
    const hubTotal = digest.hubHealth.starts + digest.hubHealth.stops + digest.hubHealth.crashes
    const hubCrashRate = hubTotal > 0 ? digest.hubHealth.crashes / hubTotal : 0

    // Session crash rate
    const sessionCrashRate = digest.sessionHealth.started > 0
      ? digest.sessionHealth.crashed / digest.sessionHealth.started
      : 0

    // Hook hit rate: total hooks received vs expected (approx)
    // We use total received as a signal - more hits = better coverage
    const hookHitRate = Math.min(1, digest.hookStats.totalReceived / Math.max(100, digest.totalSessions * 10))

    // Flow completion rate
    const flowCompletionRate = digest.flowStats.triggered > 0
      ? digest.flowStats.completed / digest.flowStats.triggered
      : 1

    // Cost per session
    const costPerSession = digest.totalSessions > 0
      ? digest.totalCostUsd / digest.totalSessions
      : 0

    return {
      command_success_rate: commandSuccessRate,
      command_p90_latency_ms: worstP90,
      hub_crash_rate: hubCrashRate,
      session_crash_rate: sessionCrashRate,
      hook_hit_rate: hookHitRate,
      mcp_avg_latency_ms: digest.hubHealth.avgMcpLatencyMs,
      error_cluster_count: digest.errorClusters.length,
      flow_completion_rate: flowCompletionRate,
      cost_per_session_usd: costPerSession,
      active_installs: digest.activeInstalls,
    }
  }

  /**
   * Compare metrics to previous run
   */
  compareMetrics(current: ExtractedMetrics): MetricComparison[] {
    const comparisons: MetricComparison[] = []
    const previous = this.state.previousDigest?.metrics || {}

    // Define which direction is "better" for each metric
    const metricDirections: Record<string, 'higher' | 'lower'> = {
      command_success_rate: 'higher',
      command_p90_latency_ms: 'lower',
      hub_crash_rate: 'lower',
      session_crash_rate: 'lower',
      hook_hit_rate: 'higher',
      mcp_avg_latency_ms: 'lower',
      error_cluster_count: 'lower',
      flow_completion_rate: 'higher',
      cost_per_session_usd: 'lower',
      active_installs: 'higher',
    }

    for (const [name, currentValue] of Object.entries(current)) {
      const previousValue = previous[name] ?? currentValue
      const delta = currentValue - previousValue
      const percentChange = previousValue !== 0
        ? (delta / Math.abs(previousValue)) * 100
        : (currentValue !== 0 ? 100 : 0)

      const direction = metricDirections[name] || 'higher'
      const isImproving = direction === 'higher' ? delta > 0 : delta < 0
      const isDeclining = direction === 'higher' ? delta < 0 : delta > 0

      // Threshold: >10% decline = alert, >20% improvement = win
      const significantChange = Math.abs(percentChange) > 10
      const bigWin = isImproving && Math.abs(percentChange) > 20

      comparisons.push({
        name,
        current: currentValue,
        previous: previousValue,
        delta,
        percentChange,
        trend: isImproving ? 'improving' : (isDeclining && significantChange ? 'declining' : 'stable'),
        isAlert: isDeclining && significantChange,
        isWin: bigWin,
      })
    }

    return comparisons
  }

  /**
   * Generate training tuple from digest comparison
   */
  generateTrainingTuple(
    digest: PlatformDigest,
    metrics: ExtractedMetrics,
    comparisons: MetricComparison[],
  ): void {
    // Get recent commits as the "action"
    const recentCommits = this.getRecentCommits()
    if (!recentCommits || recentCommits.length === 0) return

    // Build state
    const state: RLState = {
      composite_score: metrics.command_success_rate * (1 - metrics.session_crash_rate),
      dimension_scores: {
        command_success: metrics.command_success_rate,
        hub_stability: 1 - metrics.hub_crash_rate,
        session_stability: 1 - metrics.session_crash_rate,
        flow_completion: metrics.flow_completion_rate,
        cost_efficiency: 1 / (1 + metrics.cost_per_session_usd),
      },
      tests_passing: 0, // Not tracked here
      tests_total: 0,
      trajectory_length: this.state.runCount,
      recent_deltas: this.state.healthTrajectory.slice(-5),
      agent: 'telemetry-agent-v2',
    }

    // Build action from recent commits
    const action: RLAction = {
      type: 'feature', // Could be 'fix' based on commit messages
      description: recentCommits.slice(0, 3).join('; '),
      files_affected: this.getRecentChangedFiles(),
      scope: 'medium',
      branch: this.getCurrentBranch(),
    }

    // Calculate composite reward from metric changes
    const improvingMetrics = comparisons.filter(c => c.trend === 'improving')
    const decliningMetrics = comparisons.filter(c => c.trend === 'declining')

    const reward: RLReward = {
      composite_delta: improvingMetrics.length * 0.1 - decliningMetrics.length * 0.2,
      dimension_deltas: Object.fromEntries(
        comparisons.map(c => [c.name, c.delta])
      ),
      tests_added: 0,
      quality_score: metrics.command_success_rate,
      improved: improvingMetrics.length > decliningMetrics.length,
    }

    // Write to training buffer
    const buffer = new TrainingBuffer(this.projectRoot)
    buffer.append({
      agent: 'telemetry-agent-v2',
      state,
      action,
      reward,
      metadata: {
        branch: this.getCurrentBranch(),
        source: 'autoresearch',
      },
    })

    this.state.recentTrainingTuples++
    this.state.totalTrainingTuples++
  }

  /**
   * Propose scoped agents based on metric analysis
   */
  proposeAgents(metrics: ExtractedMetrics, comparisons: MetricComparison[]): ProposedAgent[] {
    const proposed: ProposedAgent[] = []

    // CLI speed agent if p90 latency is high
    if (metrics.command_p90_latency_ms > 1000) {
      proposed.push({
        name: 'cli-speed',
        reason: `Command p90 latency is ${metrics.command_p90_latency_ms}ms (>1000ms threshold)`,
        triggeredBy: 'command_p90_latency_ms',
        priority: metrics.command_p90_latency_ms > 2000 ? 'high' : 'medium',
        config: {
          metric: 'avg_ms',
          direction: 'minimize',
          scope: 'performance',
          filesInScope: ['src/commands/**', 'src/lib/**'],
          timeBudgetSeconds: 300,
        },
      })
    }

    // Bug-fix agent if error clusters are growing
    const errorComparison = comparisons.find(c => c.name === 'error_cluster_count')
    if (errorComparison && errorComparison.trend === 'declining' && metrics.error_cluster_count > 3) {
      proposed.push({
        name: 'bug-fix',
        reason: `Error clusters increased to ${metrics.error_cluster_count} (was ${errorComparison.previous})`,
        triggeredBy: 'error_cluster_count',
        priority: 'high',
        config: {
          metric: 'error_count_inverse',
          direction: 'maximize',
          scope: 'reliability',
          filesInScope: ['src/**'],
          timeBudgetSeconds: 300,
        },
      })
    }

    // Hook optimization agent if hit rate is low
    if (metrics.hook_hit_rate < 0.3) {
      proposed.push({
        name: 'hook-optimization',
        reason: `Hook hit rate is ${(metrics.hook_hit_rate * 100).toFixed(1)}% (<30% threshold)`,
        triggeredBy: 'hook_hit_rate',
        priority: 'low',
        config: {
          metric: 'hook_hit_rate',
          direction: 'maximize',
          scope: 'hooks',
          filesInScope: ['src/lib/**/hooks*', 'src/commands/hooks.ts'],
          timeBudgetSeconds: 300,
        },
      })
    }

    // Flow reliability agent if completion rate is dropping
    const flowComparison = comparisons.find(c => c.name === 'flow_completion_rate')
    if (flowComparison && flowComparison.trend === 'declining' && metrics.flow_completion_rate < 0.9) {
      proposed.push({
        name: 'flow-reliability',
        reason: `Flow completion rate dropped to ${(metrics.flow_completion_rate * 100).toFixed(1)}%`,
        triggeredBy: 'flow_completion_rate',
        priority: 'medium',
        config: {
          metric: 'flow_completion_rate',
          direction: 'maximize',
          scope: 'flows',
          filesInScope: ['src/lib/flows*', 'src/commands/flows.ts'],
          timeBudgetSeconds: 300,
        },
      })
    }

    // Cost efficiency agent if cost per session is high
    if (metrics.cost_per_session_usd > 0.50) {
      proposed.push({
        name: 'cost-efficiency',
        reason: `Cost per session is $${metrics.cost_per_session_usd.toFixed(4)} (>$0.50 threshold)`,
        triggeredBy: 'cost_per_session_usd',
        priority: 'medium',
        config: {
          metric: 'cost_inverse',
          direction: 'maximize',
          scope: 'cost',
          filesInScope: ['src/lib/**'],
          timeBudgetSeconds: 300,
        },
      })
    }

    return proposed
  }

  /**
   * Write proposed agents to .jfl/agents/proposed/
   */
  writeProposedAgents(agents: ProposedAgent[]): void {
    const proposedDir = join(this.projectRoot, '.jfl', 'agents', 'proposed')
    if (!existsSync(proposedDir)) {
      mkdirSync(proposedDir, { recursive: true })
    }

    for (const agent of agents) {
      const toml = this.generateAgentToml(agent)
      const path = join(proposedDir, `${agent.name}.toml`)
      writeFileSync(path, toml)

      this.state.proposedAgents.push({
        timestamp: new Date().toISOString(),
        agent: agent.name,
        status: 'proposed',
      })
    }
  }

  private generateAgentToml(agent: ProposedAgent): string {
    return `# ${agent.name} - Auto-proposed by telemetry-agent-v2
# Reason: ${agent.reason}
# Triggered by: ${agent.triggeredBy}
# Priority: ${agent.priority}

[agent]
name = "${agent.name}"
scope = "${agent.config.scope}"
metric = "${agent.config.metric}"
direction = "${agent.config.direction}"
time_budget_seconds = ${agent.config.timeBudgetSeconds}

[eval]
script = "eval/${agent.name}.sh"
data = "eval/fixtures/${agent.name}.jsonl"

[constraints]
files_in_scope = [${agent.config.filesInScope.map(f => `"${f}"`).join(', ')}]
files_readonly = ["eval/**", "node_modules/**"]
max_file_changes = 10

[policy]
embedding_model = "stratus-x1ac-base-claude-sonnet-4-6"
exploration_rate = 0.2
decay_per_round = 0.01
min_exploration = 0.05

[context_scope]
produces = ["${agent.config.scope}:improved"]
consumes = []
`
  }

  /**
   * Analyze ALL data sources — platform telemetry + local data — for product improvement insights
   */
  async analyzeProduct(platformDigest?: PlatformDigest | null): Promise<{
    insights: ProductInsight[]
    claudeMdUpdates: string[]
    staleDocs: string[]
    trainingGaps: string[]
    platformMetrics: Record<string, unknown> | null
  }> {
    const insights: ProductInsight[] = []
    const claudeMdUpdates: string[] = []
    const staleDocs: string[] = []
    const trainingGaps: string[] = []

    // ══════════════════════════════════════════════════════════════════
    // PLATFORM TELEMETRY — the real shit from the database
    // ══════════════════════════════════════════════════════════════════

    // Fetch digests if not provided
    const digest24h = platformDigest || await this.fetchDigest(24)
    const digest7d = await this.fetchDigest(168)

    let platformMetrics: Record<string, unknown> | null = null

    if (digest24h) {
      platformMetrics = {}

      // ── Command performance analysis ──
      const slowCommands = digest24h.commands.filter(c => c.p90DurationMs > 1000)
      if (slowCommands.length > 0) {
        insights.push({
          type: 'performance', severity: 'warning',
          title: `${slowCommands.length} slow commands (p90 > 1s)`,
          detail: slowCommands.map(c => `${c.command}: p90=${c.p90DurationMs}ms, avg=${c.avgDurationMs}ms (${c.count} calls)`).join('; ')
        })
      }

      const failingCommands = digest24h.commands.filter(c => c.successRate < 0.9 && c.count >= 3)
      if (failingCommands.length > 0) {
        insights.push({
          type: 'performance', severity: 'critical',
          title: `${failingCommands.length} unreliable commands (<90% success)`,
          detail: failingCommands.map(c => `${c.command}: ${(c.successRate * 100).toFixed(0)}% success, ${c.errorCount} errors out of ${c.count}`).join('; ')
        })
      }

      // ── Which command is used most? That's what to optimize first ──
      const sorted = [...digest24h.commands].sort((a, b) => b.count - a.count)
      if (sorted.length > 0) {
        platformMetrics.mostUsedCommand = sorted[0].command
        platformMetrics.mostUsedCount = sorted[0].count
        platformMetrics.leastUsedCommand = sorted[sorted.length - 1].command
        platformMetrics.leastUsedCount = sorted[sorted.length - 1].count
      }

      // ── Error cluster analysis ──
      if (digest24h.errorClusters.length > 0) {
        const growingErrors = digest24h.errorClusters.filter(e => e.count >= 3)
        if (growingErrors.length > 0) {
          insights.push({
            type: 'system', severity: 'critical',
            title: `${growingErrors.length} recurring error clusters`,
            detail: growingErrors.map(e => `[${e.errorType}] "${e.message}" — ${e.count}x across ${e.affectedInstalls} install(s), last seen ${e.lastSeen}`).join('\n')
          })
        }
        platformMetrics.errorClusters = digest24h.errorClusters.length
        platformMetrics.totalErrors = digest24h.totalErrors
      }

      // ── Cost analysis ──
      if (digest24h.modelCosts.length > 0) {
        const totalCost = digest24h.totalCostUsd
        const costPerSession = digest24h.costPerSessionUsd
        platformMetrics.totalCost24h = totalCost
        platformMetrics.costPerSession = costPerSession

        // Which model burns the most?
        const sortedCosts = [...digest24h.modelCosts].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)
        const topCostModel = sortedCosts[0]
        if (topCostModel && topCostModel.estimatedCostUsd > 0.10) {
          insights.push({
            type: 'performance', severity: 'info',
            title: `Top cost: ${topCostModel.model} ($${topCostModel.estimatedCostUsd.toFixed(4)})`,
            detail: `${topCostModel.callCount} calls, ${topCostModel.totalTokens} tokens. Total 24h cost: $${totalCost.toFixed(4)} across ${digest24h.totalSessions} sessions ($${costPerSession.toFixed(4)}/session).`
          })
        }

        // Cost trend: compare 24h vs 7d average
        if (digest7d && digest7d.totalCostUsd > 0) {
          const dailyAvg7d = digest7d.totalCostUsd / 7
          const costTrend = totalCost / dailyAvg7d
          if (costTrend > 1.5) {
            insights.push({
              type: 'performance', severity: 'warning',
              title: `Cost spike: ${(costTrend * 100).toFixed(0)}% of 7-day daily average`,
              detail: `24h cost: $${totalCost.toFixed(4)} vs 7d daily avg: $${dailyAvg7d.toFixed(4)}. Check for runaway sessions or expensive model upgrades.`
            })
          }
          platformMetrics.costTrend = costTrend
        }
      }

      // ── Session health ──
      if (digest24h.sessionHealth.crashRate > 0.05) {
        insights.push({
          type: 'system', severity: 'critical',
          title: `Session crash rate: ${(digest24h.sessionHealth.crashRate * 100).toFixed(1)}%`,
          detail: `${digest24h.sessionHealth.crashed} crashed out of ${digest24h.sessionHealth.started} started. Avg session duration: ${digest24h.sessionHealth.avgDurationS.toFixed(0)}s.`
        })
      }
      platformMetrics.sessionCrashRate = digest24h.sessionHealth.crashRate
      platformMetrics.avgSessionDuration = digest24h.sessionHealth.avgDurationS

      // ── Hub health ──
      if (digest24h.hubHealth.crashes > 0) {
        insights.push({
          type: 'system', severity: 'warning',
          title: `Hub crashed ${digest24h.hubHealth.crashes}x in 24h`,
          detail: `${digest24h.hubHealth.starts} starts, ${digest24h.hubHealth.stops} stops, ${digest24h.hubHealth.crashes} crashes. MCP latency: avg=${digest24h.hubHealth.avgMcpLatencyMs}ms p90=${digest24h.hubHealth.p90McpLatencyMs}ms.`
        })
      }
      if (digest24h.hubHealth.p90McpLatencyMs > 500) {
        insights.push({
          type: 'performance', severity: 'warning',
          title: `MCP p90 latency: ${digest24h.hubHealth.p90McpLatencyMs}ms`,
          detail: `Context hub MCP calls are slow. Avg: ${digest24h.hubHealth.avgMcpLatencyMs}ms, p90: ${digest24h.hubHealth.p90McpLatencyMs}ms, p99: ${digest24h.hubHealth.p99McpLatencyMs}ms.`
        })
      }

      // ── Hook coverage ──
      if (digest24h.hookStats.totalReceived > 0 && digest24h.hookStats.fileHotspots.length > 0) {
        const hotFiles = digest24h.hookStats.fileHotspots.slice(0, 5)
        platformMetrics.fileHotspots = hotFiles
        insights.push({
          type: 'product', severity: 'info',
          title: `File hotspots (most edited)`,
          detail: hotFiles.map(f => `${f.file}: ${f.edits} edits`).join(', ')
        })
      }

      // ── Tool usage patterns ──
      if (digest24h.toolStats.length > 0) {
        const unusedTools = digest24h.toolStats.filter(t => t.callCount === 0)
        const errorProneTools = digest24h.toolStats.filter(t => t.errorRate > 0.1 && t.callCount >= 5)
        if (errorProneTools.length > 0) {
          insights.push({
            type: 'system', severity: 'warning',
            title: `${errorProneTools.length} MCP tools with >10% error rate`,
            detail: errorProneTools.map(t => `${t.toolName}: ${(t.errorRate * 100).toFixed(0)}% errors, ${t.callCount} calls`).join('; ')
          })
        }
        platformMetrics.totalToolCalls = digest24h.toolStats.reduce((sum, t) => sum + t.callCount, 0)
      }

      // ── Flow health ──
      if (digest24h.flowStats.completionRate < 0.8 && digest24h.flowStats.triggered >= 5) {
        insights.push({
          type: 'system', severity: 'warning',
          title: `Flow completion rate: ${(digest24h.flowStats.completionRate * 100).toFixed(0)}%`,
          detail: `${digest24h.flowStats.completed}/${digest24h.flowStats.triggered} flows completed. ${digest24h.flowStats.failed} failed.`
        })
      }

      // ── Session cost outliers ──
      if (digest24h.sessionCosts.length > 0) {
        const avgCost = digest24h.totalCostUsd / digest24h.sessionCosts.length
        const expensive = digest24h.sessionCosts.filter(s => s.estimatedCostUsd > avgCost * 3)
        if (expensive.length > 0) {
          insights.push({
            type: 'performance', severity: 'info',
            title: `${expensive.length} expensive sessions (>3x avg cost)`,
            detail: expensive.map(s => `Session ${s.sessionId.slice(0, 8)}: $${s.estimatedCostUsd.toFixed(4)}, ${s.durationS}s, ${s.totalTokens} tokens`).join('; ')
          })
        }
      }

      platformMetrics.totalEvents24h = digest24h.totalEvents
      platformMetrics.totalSessions24h = digest24h.totalSessions
      platformMetrics.activeInstalls = digest24h.activeInstalls
      platformMetrics.commandSuccessRate = digest24h.commandSuccessRate
    }

    // ══════════════════════════════════════════════════════════════════
    // LOCAL DATA — journals, MAP events, training buffer, agent configs
    // ══════════════════════════════════════════════════════════════════

    // 1. Read MAP events
    const eventsPath = join(this.projectRoot, '.jfl', 'map-events.jsonl')
    let recentEvents: Array<{ type: string; source?: string; ts: string; data?: Record<string, unknown> }> = []
    if (existsSync(eventsPath)) {
      const lines = readFileSync(eventsPath, 'utf-8').trim().split('\n').slice(-200)
      for (const line of lines) {
        try { recentEvents.push(JSON.parse(line)) } catch {}
      }
    }

    const eventTypes = new Map<string, number>()
    for (const e of recentEvents) {
      eventTypes.set(e.type, (eventTypes.get(e.type) || 0) + 1)
    }

    // 2. Read journals
    const journalDir = join(this.projectRoot, '.jfl', 'journal')
    let recentJournalEntries: Array<{ ts: string; type: string; title: string; summary: string; session?: string }> = []
    if (existsSync(journalDir)) {
      const files = readdirSync(journalDir).filter(f => f.endsWith('.jsonl')).sort().slice(-5)
      for (const f of files) {
        const lines = readFileSync(join(journalDir, f), 'utf-8').trim().split('\n')
        for (const line of lines) {
          try { recentJournalEntries.push(JSON.parse(line)) } catch {}
        }
      }
    }

    // 3. Training buffer analysis
    const bufferPath = join(this.projectRoot, '.jfl', 'training-buffer.jsonl')
    let tupleCount = 0
    let improvedCount = 0
    let tuplesWithDiffs = 0
    let agentDistribution = new Map<string, number>()
    if (existsSync(bufferPath)) {
      const lines = readFileSync(bufferPath, 'utf-8').trim().split('\n')
      tupleCount = lines.length
      for (const line of lines.slice(-100)) {
        try {
          const t = JSON.parse(line)
          agentDistribution.set(t.agent || 'unknown', (agentDistribution.get(t.agent || 'unknown') || 0) + 1)
          if (t.reward?.improved) improvedCount++
          if (t.action?.code_diff) tuplesWithDiffs++
        } catch {}
      }
    }

    // 4. Agent configs
    const agentDir = join(this.projectRoot, '.jfl', 'agents')
    const agentConfigs: string[] = []
    if (existsSync(agentDir)) {
      for (const f of readdirSync(agentDir).filter(f => f.endsWith('.toml'))) {
        agentConfigs.push(f.replace('.toml', ''))
      }
    }

    // 5. Product context freshness
    const contextPath = join(this.projectRoot, '.jfl', 'product-context.md')
    let contextAge = 999
    if (existsSync(contextPath)) {
      const stat = spawnSync('stat', ['-f', '%m', contextPath], { encoding: 'utf-8' })
      if (stat.stdout) {
        contextAge = Math.floor((Date.now() / 1000 - parseInt(stat.stdout.trim())) / 3600)
      }
    }

    // 6. CLAUDE.md drift detection
    const claudeMdPath = join(this.projectRoot, 'CLAUDE.md')
    let claudeMdContent = ''
    if (existsSync(claudeMdPath)) {
      claudeMdContent = readFileSync(claudeMdPath, 'utf-8')
    }

    // 7. Dashboard telemetry from local events
    const dashboardEvents = recentEvents.filter(e => e.type.startsWith('dashboard:'))
    const pageViews = new Map<string, number>()
    for (const e of dashboardEvents) {
      if (e.type === 'dashboard:page-view' && e.data?.page) {
        const page = String(e.data.page)
        pageViews.set(page, (pageViews.get(page) || 0) + 1)
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // LOCAL INSIGHTS
    // ══════════════════════════════════════════════════════════════════

    // Training data health
    if (tupleCount < 100) {
      insights.push({ type: 'training', severity: 'warning', title: 'Low training data', detail: `Only ${tupleCount} tuples in buffer. Need 500+ for meaningful policy head training. Run: jfl eval mine --all` })
    }
    if (tupleCount > 100 && improvedCount === 0) {
      insights.push({ type: 'training', severity: 'critical', title: 'No improvements in recent tuples', detail: `Last 100 tuples have 0 improvements. Agents may be stuck or metrics are wrong.` })
    }
    if (tupleCount > 0 && tuplesWithDiffs === 0) {
      insights.push({ type: 'training', severity: 'info', title: 'No code diffs in training data', detail: `${tupleCount} tuples but none have code_diff attached. Run autoresearch to generate diff-enriched tuples for code-policy training.` })
    }
    trainingGaps.push(`Buffer: ${tupleCount} tuples, ${improvedCount}/100 recent improved, ${tuplesWithDiffs} with code diffs`)
    trainingGaps.push(`Agent distribution: ${[...agentDistribution].map(([k,v]) => `${k}=${v}`).join(', ')}`)

    if (contextAge > 24) {
      insights.push({ type: 'product', severity: 'warning', title: 'Product context stale', detail: `Product context is ${contextAge}h old. Run: jfl peter synthesize` })
    }

    if (recentEvents.length < 10) {
      insights.push({ type: 'system', severity: 'warning', title: 'Low event flow', detail: `Only ${recentEvents.length} recent events. Context hub may not be running.` })
    }

    const recentJournals = recentJournalEntries.filter(j => {
      const age = Date.now() - new Date(j.ts).getTime()
      return age < 24 * 60 * 60 * 1000
    })
    if (recentJournals.length === 0) {
      insights.push({ type: 'product', severity: 'info', title: 'No journal entries in 24h', detail: 'No sessions have produced journal entries recently. System may be idle.' })
    }

    const agentsWithTuples = new Set([...agentDistribution.keys()])
    const agentsWithoutData = agentConfigs.filter(a => !agentsWithTuples.has(a))
    if (agentsWithoutData.length > 0) {
      insights.push({ type: 'training', severity: 'info', title: 'Agents with no training data', detail: `${agentsWithoutData.join(', ')} have never produced tuples. Run autoresearch for them.` })
    }

    if (pageViews.size > 0) {
      const sorted = [...pageViews].sort((a, b) => b[1] - a[1])
      insights.push({ type: 'product', severity: 'info', title: 'Dashboard usage', detail: `Most visited: ${sorted[0][0]} (${sorted[0][1]}x). Least visited: ${sorted[sorted.length - 1][0]} (${sorted[sorted.length - 1][1]}x).` })
    }

    // CLAUDE.md drift
    const servicesPath = join(this.projectRoot, '.jfl', 'services.json')
    if (existsSync(servicesPath)) {
      try {
        const services = JSON.parse(readFileSync(servicesPath, 'utf-8'))
        const serviceNames = (services.services || services || []).map((s: any) => s.name || s).filter(Boolean)
        for (const svc of serviceNames) {
          if (!claudeMdContent.includes(svc)) {
            claudeMdUpdates.push(`Service "${svc}" is registered but not mentioned in CLAUDE.md`)
          }
        }
      } catch {}
    }
    for (const agent of agentConfigs) {
      if (!claudeMdContent.includes(agent)) {
        claudeMdUpdates.push(`Agent "${agent}" exists in .jfl/agents/ but not mentioned in CLAUDE.md`)
      }
    }

    // Stale docs
    const knowledgeDir = join(this.projectRoot, 'knowledge')
    if (existsSync(knowledgeDir)) {
      const checkDir = (dir: string, prefix: string) => {
        if (!existsSync(dir)) return
        for (const f of readdirSync(dir)) {
          const full = join(dir, f)
          const stat2 = spawnSync('stat', ['-f', '%m', full], { encoding: 'utf-8' })
          if (f.endsWith('.md') && stat2.stdout) {
            const age = Math.floor((Date.now() / 1000 - parseInt(stat2.stdout.trim())) / (3600 * 24))
            if (age > 14) staleDocs.push(`${prefix}${f} (${age} days old)`)
          }
        }
      }
      checkDir(knowledgeDir, '')
      checkDir(join(knowledgeDir, 'research'), 'research/')
    }

    // Write insights to journal
    if (insights.length > 0) {
      const journalPath2 = join(this.projectRoot, '.jfl', 'journal')
      if (existsSync(journalPath2)) {
        const files = readdirSync(journalPath2).filter(f => f.endsWith('.jsonl')).sort()
        const latest = files[files.length - 1]
        if (latest) {
          const entry = {
            v: 2, ts: new Date().toISOString(), session: 'telemetry-agent',
            type: 'discovery', status: 'complete',
            title: `Product analysis: ${insights.length} insights (${insights.filter(i => i.severity === 'critical').length} critical)`,
            summary: insights.map(i => `[${i.severity}] ${i.title}`).join('; '),
            detail: JSON.stringify({ insights, claudeMdUpdates, staleDocs, trainingGaps, platformMetrics }),
          }
          appendFileSync(join(journalPath2, latest), '\n' + JSON.stringify(entry))
        }
      }
    }

    // Emit event
    this.emitEvent('telemetry:product-analysis', {
      insightCount: insights.length,
      criticalCount: insights.filter(i => i.severity === 'critical').length,
      warningCount: insights.filter(i => i.severity === 'warning').length,
      claudeMdUpdates: claudeMdUpdates.length,
      staleDocs: staleDocs.length,
      trainingGaps: trainingGaps.length,
      tupleCount,
      tuplesWithDiffs,
      improvedRate: tupleCount > 0 ? (improvedCount / Math.min(100, tupleCount)) : 0,
      contextAgeH: contextAge,
      hasPlatformData: !!digest24h,
    }, 'telemetry-agent-v2')

    return { insights, claudeMdUpdates, staleDocs, trainingGaps, platformMetrics }
  }

  /**
   * Run the telemetry agent
   */
  async run(): Promise<{
    digest24h: PlatformDigest | null
    digest7d: PlatformDigest | null
    metrics: ExtractedMetrics | null
    comparisons: MetricComparison[]
    proposedAgents: ProposedAgent[]
    alerts: MetricComparison[]
    wins: MetricComparison[]
    productAnalysis: { insights: ProductInsight[]; claudeMdUpdates: string[]; staleDocs: string[]; trainingGaps: string[] } | null
  }> {
    const now = new Date().toISOString()

    // Fetch 24h and 7d digests
    const [digest24h, digest7d] = await Promise.all([
      this.fetchDigest(24),
      this.fetchDigest(168), // 7 days
    ])

    if (!digest24h) {
      // Even without platform digest, run local product analysis
      let localAnalysis = null
      try { localAnalysis = await this.analyzeProduct(null) } catch {}
      return {
        digest24h: null,
        digest7d: null,
        metrics: null,
        comparisons: [],
        proposedAgents: [],
        alerts: [],
        wins: [],
        productAnalysis: localAnalysis,
      }
    }

    // Extract metrics
    const metrics = this.extractMetrics(digest24h)

    // Compare to previous run
    const comparisons = this.compareMetrics(metrics)

    // Identify alerts and wins
    const alerts = comparisons.filter(c => c.isAlert)
    const wins = comparisons.filter(c => c.isWin)

    // Generate training tuple
    this.generateTrainingTuple(digest24h, metrics, comparisons)

    // Propose agents based on metrics
    const proposedAgents = this.proposeAgents(metrics, comparisons)
    if (proposedAgents.length > 0) {
      this.writeProposedAgents(proposedAgents)
    }

    // Update health trajectory
    const healthScore = metrics.command_success_rate * (1 - metrics.session_crash_rate)
    this.state.healthTrajectory.push(healthScore)
    if (this.state.healthTrajectory.length > 50) {
      this.state.healthTrajectory = this.state.healthTrajectory.slice(-50)
    }

    // Emit events
    this.emitEvent('telemetry:digest-analyzed', {
      timestamp: now,
      metrics,
      alerts: alerts.length,
      wins: wins.length,
      proposed_agents: proposedAgents.length,
    }, 'telemetry-agent-v2')

    for (const alert of alerts) {
      this.emitEvent('telemetry:metric-alert', {
        metric: alert.name,
        current: alert.current,
        previous: alert.previous,
        delta: alert.delta,
        percentChange: alert.percentChange,
      }, 'telemetry-agent-v2')
    }

    for (const agent of proposedAgents) {
      this.emitEvent('telemetry:agent-proposed', {
        agent: agent.name,
        reason: agent.reason,
        triggeredBy: agent.triggeredBy,
        priority: agent.priority,
      }, 'telemetry-agent-v2')
    }

    // Run product analysis (platform telemetry + local data)
    let productAnalysis: Awaited<ReturnType<typeof this.analyzeProduct>> | null = null
    try {
      productAnalysis = await this.analyzeProduct(digest24h)
      if (productAnalysis.insights.length > 0) {
        console.log(`  Product analysis: ${productAnalysis.insights.length} insights`)
        for (const insight of productAnalysis.insights) {
          console.log(`    [${insight.severity}] ${insight.title}`)
        }
      }
      if (productAnalysis.claudeMdUpdates.length > 0) {
        console.log(`  CLAUDE.md drift: ${productAnalysis.claudeMdUpdates.length} items need updating`)
      }
      if (productAnalysis.staleDocs.length > 0) {
        console.log(`  Stale docs: ${productAnalysis.staleDocs.join(', ')}`)
      }
    } catch (err: any) {
      console.error(`  Product analysis failed: ${err.message}`)
    }

    // Save state
    this.state.lastRun = now
    this.state.runCount++
    this.state.previousDigest = {
      timestamp: now,
      metrics: metrics as unknown as Record<string, number>,
    }
    this.saveState()

    return {
      digest24h,
      digest7d,
      metrics,
      comparisons,
      proposedAgents,
      alerts,
      wins,
      productAnalysis,
    }
  }

  /**
   * Get current metrics (cached from last run or fetch fresh)
   */
  async getMetrics(): Promise<ExtractedMetrics | null> {
    const digest = await this.fetchDigest(24)
    if (!digest) return null
    return this.extractMetrics(digest)
  }

  /**
   * Helper to get recent commits
   */
  private getRecentCommits(): string[] {
    try {
      const result = spawnSync('git', ['log', '--oneline', '-10', '--pretty=format:%s'], {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      if (result.status !== 0) return []
      return (result.stdout || '').split('\n').filter(Boolean)
    } catch {
      return []
    }
  }

  /**
   * Helper to get recent changed files
   */
  private getRecentChangedFiles(): string[] {
    try {
      const result = spawnSync('git', ['diff', '--name-only', 'HEAD~5..HEAD'], {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      if (result.status !== 0) return []
      return (result.stdout || '').split('\n').filter(Boolean).slice(0, 20)
    } catch {
      return []
    }
  }

  /**
   * Helper to get current branch
   */
  private getCurrentBranch(): string {
    try {
      const result = spawnSync('git', ['branch', '--show-current'], {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      return (result.stdout || '').trim() || 'main'
    } catch {
      return 'main'
    }
  }

  /**
   * Get agent status
   */
  getStatus(): TelemetryAgentV2State {
    return this.state
  }
}
