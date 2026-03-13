/**
 * @purpose Type definitions for jfl-platform digest API response — full telemetry aggregation
 */

/**
 * Command usage statistics from platform telemetry
 */
export interface PlatformCommandStats {
  command: string
  count: number
  avgDurationMs: number
  p90DurationMs: number
  p99DurationMs: number
  successRate: number
  errorCount: number
}

/**
 * Error cluster - grouped similar errors
 */
export interface PlatformErrorCluster {
  clusterId: string
  errorType: string
  message: string
  count: number
  affectedInstalls: number
  firstSeen: string
  lastSeen: string
  stackSample?: string
}

/**
 * Session health metrics
 */
export interface PlatformSessionHealth {
  started: number
  ended: number
  crashed: number
  avgDurationS: number
  crashRate: number
}

/**
 * Context Hub health metrics
 */
export interface PlatformHubHealth {
  starts: number
  stops: number
  crashes: number
  mcpCalls: number
  avgMcpLatencyMs: number
  p90McpLatencyMs: number
  p99McpLatencyMs: number
}

/**
 * Hook usage statistics
 */
export interface PlatformHookStats {
  totalReceived: number
  byEvent: Record<string, number>
  byTool: Record<string, number>
  fileHotspots: Array<{ file: string; edits: number }>
}

/**
 * MCP tool frequency statistics
 */
export interface PlatformToolStats {
  toolName: string
  callCount: number
  avgLatencyMs: number
  p90LatencyMs: number
  errorRate: number
}

/**
 * Flow execution statistics
 */
export interface PlatformFlowStats {
  triggered: number
  completed: number
  failed: number
  byFlow: Record<string, { triggered: number; completed: number; failed: number }>
  completionRate: number
}

/**
 * Latency percentiles by event type
 */
export interface PlatformLatencyPercentiles {
  eventType: string
  p50Ms: number
  p90Ms: number
  p99Ms: number
  sampleCount: number
}

/**
 * Model cost breakdown
 */
export interface PlatformModelCost {
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCostUsd: number
  callCount: number
}

/**
 * Session cost breakdown
 */
export interface PlatformSessionCost {
  sessionId: string
  installId: string
  totalTokens: number
  estimatedCostUsd: number
  durationS: number
  modelBreakdown: PlatformModelCost[]
}

/**
 * Full platform digest from POST /api/v1/telemetry/digest
 */
export interface PlatformDigest {
  periodHours: number
  generatedAt: string

  // Aggregate metrics
  activeInstalls: number
  totalEvents: number
  totalSessions: number

  // Command metrics
  commands: PlatformCommandStats[]
  commandSuccessRate: number
  worstP90Command?: { command: string; p90Ms: number }

  // Error metrics
  errorClusters: PlatformErrorCluster[]
  totalErrors: number

  // Health metrics
  sessionHealth: PlatformSessionHealth
  hubHealth: PlatformHubHealth

  // Usage metrics
  hookStats: PlatformHookStats
  toolStats: PlatformToolStats[]
  flowStats: PlatformFlowStats

  // Performance metrics
  latencyPercentiles: PlatformLatencyPercentiles[]

  // Cost metrics
  modelCosts: PlatformModelCost[]
  sessionCosts: PlatformSessionCost[]
  totalCostUsd: number
  costPerSessionUsd: number
}

/**
 * Metric comparison result
 */
export interface MetricComparison {
  name: string
  current: number
  previous: number
  delta: number
  percentChange: number
  trend: 'improving' | 'declining' | 'stable'
  isAlert: boolean  // Declined by >10%
  isWin: boolean    // Improved by >20%
}

/**
 * Proposed scoped agent based on telemetry analysis
 */
export interface ProposedAgent {
  name: string
  reason: string
  triggeredBy: string  // Which metric triggered this
  priority: 'high' | 'medium' | 'low'
  config: {
    metric: string
    direction: 'maximize' | 'minimize'
    scope: string
    filesInScope: string[]
    timeBudgetSeconds: number
  }
}

/**
 * Telemetry agent state persisted between runs
 */
export interface TelemetryAgentV2State {
  lastRun: string
  runCount: number

  // Previous digest snapshot for comparison
  previousDigest?: {
    timestamp: string
    metrics: Record<string, number>
  }

  // Training data generation
  recentTrainingTuples: number
  totalTrainingTuples: number

  // Proposed agents history
  proposedAgents: Array<{
    timestamp: string
    agent: string
    status: 'proposed' | 'accepted' | 'rejected' | 'completed'
  }>

  // Stratus integration
  lastStratusRun: string
  stratusFailures: number
  healthTrajectory: number[]
}

/**
 * Sentinel RL scores
 */
export interface SentinelScores {
  productHealth: number      // User success rate
  developmentVelocity: number // PRs merged, eval improvements
  agentEffectiveness: number  // Agent merge rate, cost efficiency
  dataQuality: number         // Training tuple quality
  composite: number           // Weighted average
}

/**
 * Sentinel recommendation
 */
export interface SentinelRecommendation {
  type: 'agent-run' | 'code-review' | 'focus-area'
  priority: 'high' | 'medium' | 'low'
  description: string
  reason: string
  targetMetric?: string
  confidence: number
}

/**
 * Sentinel state
 */
export interface SentinelState {
  lastRun: string
  runCount: number
  scores: SentinelScores[]
  recommendations: SentinelRecommendation[]
  policyUpdates: number
}
