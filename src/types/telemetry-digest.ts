/**
 * @purpose Type definitions for telemetry digest analysis and improvement suggestions
 */

export interface CostBreakdown {
  model: string
  calls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCostUsd: number
  avgLatencyMs: number
}

export interface CommandStats {
  command: string
  count: number
  avgDurationMs: number
  successRate: number
}

export interface TelemetryDigest {
  periodHours: number
  generatedAt: string
  totalEvents: number
  costs: CostBreakdown[]
  totalCostUsd: number
  commands: CommandStats[]
  errors: {
    total: number
    byType: Record<string, number>
  }
  hubHealth: {
    starts: number
    crashes: number
    mcpCalls: number
    avgMcpLatencyMs: number
  }
  memoryHealth: {
    indexRuns: number
    entriesIndexed: number
    errors: number
    avgDurationMs: number
  }
  sessions: {
    started: number
    ended: number
    crashed: number
    avgDurationS: number
  }
}

export type SuggestionSeverity = 'high' | 'medium' | 'low'
export type SuggestionType = 'perf' | 'cost' | 'reliability' | 'usage'

export interface ImprovementSuggestion {
  type: SuggestionType
  severity: SuggestionSeverity
  title: string
  description: string
  suggestedFix: string
}
