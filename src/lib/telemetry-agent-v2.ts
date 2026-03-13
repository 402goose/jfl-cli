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
      const timer = setTimeout(() => controller.abort(), 15000)

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

      return await response.json() as PlatformDigest
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
   * Analyze all local data sources for product improvement insights
   */
  async analyzeProduct(): Promise<{
    insights: ProductInsight[]
    claudeMdUpdates: string[]
    staleDocs: string[]
    trainingGaps: string[]
  }> {
    const insights: ProductInsight[] = []
    const claudeMdUpdates: string[] = []
    const staleDocs: string[] = []
    const trainingGaps: string[] = []

    // 1. Read MAP events — what's actually happening in the system
    const eventsPath = join(this.projectRoot, '.jfl', 'map-events.jsonl')
    let recentEvents: Array<{ type: string; source?: string; ts: string; data?: Record<string, unknown> }> = []
    if (existsSync(eventsPath)) {
      const lines = readFileSync(eventsPath, 'utf-8').trim().split('\n').slice(-200) // last 200 events
      for (const line of lines) {
        try { recentEvents.push(JSON.parse(line)) } catch {}
      }
    }

    // Event type distribution — what's the system doing?
    const eventTypes = new Map<string, number>()
    for (const e of recentEvents) {
      eventTypes.set(e.type, (eventTypes.get(e.type) || 0) + 1)
    }

    // 2. Read journals — what sessions are producing
    const journalDir = join(this.projectRoot, '.jfl', 'journal')
    let recentJournalEntries: Array<{ ts: string; type: string; title: string; summary: string; session?: string }> = []
    if (existsSync(journalDir)) {
      const files = readdirSync(journalDir).filter(f => f.endsWith('.jsonl')).sort().slice(-5) // last 5 journal files
      for (const f of files) {
        const lines = readFileSync(join(journalDir, f), 'utf-8').trim().split('\n')
        for (const line of lines) {
          try { recentJournalEntries.push(JSON.parse(line)) } catch {}
        }
      }
    }

    // 3. Training buffer analysis — how is RL learning?
    const bufferPath = join(this.projectRoot, '.jfl', 'training-buffer.jsonl')
    let tupleCount = 0
    let improvedCount = 0
    let agentDistribution = new Map<string, number>()
    if (existsSync(bufferPath)) {
      const lines = readFileSync(bufferPath, 'utf-8').trim().split('\n')
      tupleCount = lines.length
      for (const line of lines.slice(-100)) {
        try {
          const t = JSON.parse(line)
          agentDistribution.set(t.agent || 'unknown', (agentDistribution.get(t.agent || 'unknown') || 0) + 1)
          if (t.reward?.improved) improvedCount++
        } catch {}
      }
    }

    // 4. Agent configs — what agents exist and their health
    const agentDir = join(this.projectRoot, '.jfl', 'agents')
    const agentConfigs: string[] = []
    if (existsSync(agentDir)) {
      for (const f of readdirSync(agentDir).filter(f => f.endsWith('.toml'))) {
        agentConfigs.push(f.replace('.toml', ''))
      }
    }

    // 5. Product context — is it fresh?
    const contextPath = join(this.projectRoot, '.jfl', 'product-context.md')
    let contextAge = 999
    if (existsSync(contextPath)) {
      const stat = spawnSync('stat', ['-f', '%m', contextPath], { encoding: 'utf-8' })
      if (stat.stdout) {
        contextAge = Math.floor((Date.now() / 1000 - parseInt(stat.stdout.trim())) / 3600)
      }
    }

    // 6. CLAUDE.md analysis — is it accurate?
    const claudeMdPath = join(this.projectRoot, 'CLAUDE.md')
    let claudeMdContent = ''
    if (existsSync(claudeMdPath)) {
      claudeMdContent = readFileSync(claudeMdPath, 'utf-8')
    }

    // 7. Dashboard telemetry from events
    const dashboardEvents = recentEvents.filter(e => e.type.startsWith('dashboard:'))
    const pageViews = new Map<string, number>()
    for (const e of dashboardEvents) {
      if (e.type === 'dashboard:page-view' && e.data?.page) {
        const page = String(e.data.page)
        pageViews.set(page, (pageViews.get(page) || 0) + 1)
      }
    }

    // ── Generate insights ──

    // Insight: Training data health
    if (tupleCount < 100) {
      insights.push({ type: 'training', severity: 'warning', title: 'Low training data', detail: `Only ${tupleCount} tuples in buffer. Need 500+ for meaningful policy head training. Run: jfl eval mine --all` })
    }
    if (tupleCount > 100 && improvedCount === 0) {
      insights.push({ type: 'training', severity: 'critical', title: 'No improvements in recent tuples', detail: `Last 100 tuples have 0 improvements. Agents may be stuck or metrics are wrong.` })
    }
    trainingGaps.push(`Buffer: ${tupleCount} tuples, ${improvedCount}/100 recent improved`)
    trainingGaps.push(`Agent distribution: ${[...agentDistribution].map(([k,v]) => `${k}=${v}`).join(', ')}`)

    // Insight: Product context freshness
    if (contextAge > 24) {
      insights.push({ type: 'product', severity: 'warning', title: 'Product context stale', detail: `Product context is ${contextAge}h old. Run: jfl peter synthesize` })
    }

    // Insight: Event flow health
    if (recentEvents.length < 10) {
      insights.push({ type: 'system', severity: 'warning', title: 'Low event flow', detail: `Only ${recentEvents.length} recent events. Context hub may not be running.` })
    }

    // Insight: Journal activity
    const recentJournals = recentJournalEntries.filter(j => {
      const age = Date.now() - new Date(j.ts).getTime()
      return age < 24 * 60 * 60 * 1000 // last 24h
    })
    if (recentJournals.length === 0) {
      insights.push({ type: 'product', severity: 'info', title: 'No journal entries in 24h', detail: 'No sessions have produced journal entries recently. System may be idle.' })
    }

    // Insight: Agent coverage
    const agentsWithTuples = new Set([...agentDistribution.keys()])
    const agentsWithoutData = agentConfigs.filter(a => !agentsWithTuples.has(a))
    if (agentsWithoutData.length > 0) {
      insights.push({ type: 'training', severity: 'info', title: 'Agents with no training data', detail: `${agentsWithoutData.join(', ')} have never produced tuples. Run autoresearch for them.` })
    }

    // Insight: Dashboard usage patterns
    if (pageViews.size > 0) {
      const sorted = [...pageViews].sort((a, b) => b[1] - a[1])
      const mostUsed = sorted[0][0]
      const leastUsed = sorted[sorted.length - 1][0]
      insights.push({ type: 'product', severity: 'info', title: 'Dashboard usage', detail: `Most visited: ${mostUsed} (${sorted[0][1]}x). Least visited: ${leastUsed} (${sorted[sorted.length - 1][1]}x).` })
    }

    // CLAUDE.md accuracy checks
    // Check if registered services match what CLAUDE.md says
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
    // Check if agent configs match CLAUDE.md
    for (const agent of agentConfigs) {
      if (!claudeMdContent.includes(agent)) {
        claudeMdUpdates.push(`Agent "${agent}" exists in .jfl/agents/ but not mentioned in CLAUDE.md`)
      }
    }

    // Stale docs check
    const knowledgeDir = join(this.projectRoot, 'knowledge')
    if (existsSync(knowledgeDir)) {
      const mdFiles = readdirSync(knowledgeDir).filter(f => f.endsWith('.md'))
      for (const f of mdFiles) {
        const stat = spawnSync('stat', ['-f', '%m', join(knowledgeDir, f)], { encoding: 'utf-8' })
        if (stat.stdout) {
          const age = Math.floor((Date.now() / 1000 - parseInt(stat.stdout.trim())) / (3600 * 24))
          if (age > 14) {
            staleDocs.push(`${f} (${age} days old)`)
          }
        }
      }
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
            title: `Product analysis: ${insights.length} insights`,
            summary: insights.map(i => `[${i.severity}] ${i.title}`).join('; '),
            detail: JSON.stringify({ insights, claudeMdUpdates, staleDocs, trainingGaps }),
          }
          appendFileSync(join(journalPath2, latest), '\n' + JSON.stringify(entry))
        }
      }
    }

    // Emit event
    this.emitEvent('telemetry:product-analysis', {
      insightCount: insights.length,
      claudeMdUpdates: claudeMdUpdates.length,
      staleDocs: staleDocs.length,
      trainingGaps: trainingGaps.length,
      tupleCount,
      improvedRate: tupleCount > 0 ? (improvedCount / Math.min(100, tupleCount)) : 0,
      contextAgeH: contextAge,
    }, 'telemetry-agent-v2')

    return { insights, claudeMdUpdates, staleDocs, trainingGaps }
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
      try { localAnalysis = await this.analyzeProduct() } catch {}
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

    // Run product analysis (local data)
    let productAnalysis: Awaited<ReturnType<typeof this.analyzeProduct>> | null = null
    try {
      productAnalysis = await this.analyzeProduct()
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
