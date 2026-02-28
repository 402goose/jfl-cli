/**
 * @purpose Analyze telemetry events into cost breakdowns, stats, and improvement suggestions
 */

import { readFileSync, existsSync } from 'fs'
import type { TelemetryEvent } from '../types/telemetry.js'
import type {
  TelemetryDigest,
  CostBreakdown,
  CommandStats,
  ImprovementSuggestion,
} from '../types/telemetry-digest.js'
import { JFL_FILES } from '../utils/jfl-paths.js'

export function loadLocalEvents(): TelemetryEvent[] {
  const path = JFL_FILES.telemetryQueue
  if (!existsSync(path)) return []

  try {
    const content = readFileSync(path, 'utf-8').trim()
    if (!content) return []
    return content.split('\n').map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean) as TelemetryEvent[]
  } catch {
    return []
  }
}

export function analyzeEvents(events: TelemetryEvent[], periodHours: number): TelemetryDigest {
  const cutoff = new Date(Date.now() - periodHours * 60 * 60 * 1000).toISOString()
  const filtered = events.filter(e => e.ts >= cutoff)

  const costMap = new Map<string, CostBreakdown>()
  const cmdMap = new Map<string, { count: number; totalDuration: number; successes: number }>()
  const errorsByType: Record<string, number> = {}
  let totalErrors = 0

  const hub = { starts: 0, crashes: 0, mcpCalls: 0, totalMcpLatency: 0 }
  const memory = { indexRuns: 0, entriesIndexed: 0, errors: 0, totalDuration: 0 }
  const sessions = { started: 0, ended: 0, crashed: 0, totalDuration: 0, durationCount: 0 }

  for (const e of filtered) {
    if (e.event === 'stratus:api_call' || e.event === 'peter:agent_cost') {
      const model = e.model_name || e.stratus_model || 'unknown'
      const existing = costMap.get(model) || {
        model,
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        avgLatencyMs: 0,
      }
      existing.calls++
      existing.promptTokens += e.prompt_tokens || 0
      existing.completionTokens += e.completion_tokens || 0
      existing.totalTokens += e.total_tokens || 0
      existing.estimatedCostUsd += e.estimated_cost_usd || 0
      existing.avgLatencyMs = ((existing.avgLatencyMs * (existing.calls - 1)) + (e.duration_ms || 0)) / existing.calls
      costMap.set(model, existing)
    }

    if (e.category === 'command' && e.command) {
      const cmd = e.command
      const existing = cmdMap.get(cmd) || { count: 0, totalDuration: 0, successes: 0 }
      existing.count++
      existing.totalDuration += e.duration_ms || 0
      if (e.success !== false) existing.successes++
      cmdMap.set(cmd, existing)
    }

    if (e.category === 'error') {
      totalErrors++
      const t = e.error_type || 'unknown'
      errorsByType[t] = (errorsByType[t] || 0) + 1
    }

    if (e.event === 'context_hub:started') hub.starts++
    if (e.event === 'error:hub_crash') hub.crashes++
    if (e.event === 'context_hub:mcp_call') {
      hub.mcpCalls++
      hub.totalMcpLatency += e.mcp_duration_ms || 0
    }

    if (e.event === 'performance:memory_index') {
      memory.indexRuns++
      memory.entriesIndexed += e.memory_entries_indexed || 0
      memory.errors += e.entries_errors || 0
      memory.totalDuration += e.memory_index_duration_ms || 0
    }

    if (e.category === 'session') {
      if (e.session_event === 'start') sessions.started++
      if (e.session_event === 'end') {
        sessions.ended++
        if (e.session_duration_s) {
          sessions.totalDuration += e.session_duration_s
          sessions.durationCount++
        }
      }
      if (e.session_event === 'crash') sessions.crashed++
    }
  }

  const costs = Array.from(costMap.values()).sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)
  const totalCostUsd = costs.reduce((sum, c) => sum + c.estimatedCostUsd, 0)

  const commands: CommandStats[] = Array.from(cmdMap.entries())
    .map(([command, stats]) => ({
      command,
      count: stats.count,
      avgDurationMs: stats.count > 0 ? Math.round(stats.totalDuration / stats.count) : 0,
      successRate: stats.count > 0 ? stats.successes / stats.count : 1,
    }))
    .sort((a, b) => b.count - a.count)

  return {
    periodHours,
    generatedAt: new Date().toISOString(),
    totalEvents: filtered.length,
    costs,
    totalCostUsd,
    commands,
    errors: { total: totalErrors, byType: errorsByType },
    hubHealth: {
      starts: hub.starts,
      crashes: hub.crashes,
      mcpCalls: hub.mcpCalls,
      avgMcpLatencyMs: hub.mcpCalls > 0 ? Math.round(hub.totalMcpLatency / hub.mcpCalls) : 0,
    },
    memoryHealth: {
      indexRuns: memory.indexRuns,
      entriesIndexed: memory.entriesIndexed,
      errors: memory.errors,
      avgDurationMs: memory.indexRuns > 0 ? Math.round(memory.totalDuration / memory.indexRuns) : 0,
    },
    sessions: {
      started: sessions.started,
      ended: sessions.ended,
      crashed: sessions.crashed,
      avgDurationS: sessions.durationCount > 0 ? Math.round(sessions.totalDuration / sessions.durationCount) : 0,
    },
  }
}

export function generateSuggestions(digest: TelemetryDigest): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = []

  if (digest.hubHealth.avgMcpLatencyMs > 500) {
    suggestions.push({
      type: 'perf',
      severity: 'medium',
      title: 'High MCP latency detected',
      description: `Average MCP call latency is ${digest.hubHealth.avgMcpLatencyMs}ms (threshold: 500ms).`,
      suggestedFix: 'Restart Context Hub (`jfl hub restart`). Check for large journal files or slow disk I/O.',
    })
  }

  if (digest.totalEvents > 10) {
    const errorRate = digest.errors.total / digest.totalEvents
    if (errorRate > 0.1) {
      suggestions.push({
        type: 'reliability',
        severity: 'high',
        title: 'Error rate exceeds 10%',
        description: `${digest.errors.total} errors out of ${digest.totalEvents} events (${(errorRate * 100).toFixed(1)}%).`,
        suggestedFix: `Top error types: ${Object.entries(digest.errors.byType).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, c]) => `${t} (${c})`).join(', ')}. Investigate and fix the most common errors.`,
      })
    }
  }

  if (digest.totalCostUsd > 0 && digest.costs.length > 0) {
    const topModel = digest.costs[0]
    const topModelShare = topModel.estimatedCostUsd / digest.totalCostUsd
    if (topModelShare > 0.8 && digest.costs.length > 1) {
      suggestions.push({
        type: 'cost',
        severity: 'medium',
        title: `${topModel.model} accounts for ${(topModelShare * 100).toFixed(0)}% of cost`,
        description: `$${topModel.estimatedCostUsd.toFixed(4)} of $${digest.totalCostUsd.toFixed(4)} total from ${topModel.calls} calls.`,
        suggestedFix: 'Consider routing lower-stakes operations (scout, tester) to a cheaper model tier.',
      })
    }
  }

  const totalSessions = digest.sessions.started || 1
  const crashRate = digest.sessions.crashed / totalSessions
  if (crashRate > 0.05 && digest.sessions.started > 5) {
    suggestions.push({
      type: 'reliability',
      severity: 'high',
      title: 'Session crash rate exceeds 5%',
      description: `${digest.sessions.crashed} crashes out of ${digest.sessions.started} sessions (${(crashRate * 100).toFixed(1)}%).`,
      suggestedFix: 'Check session logs for common crash patterns. Ensure auto-commit is running.',
    })
  }

  if (digest.memoryHealth.errors > 0) {
    suggestions.push({
      type: 'reliability',
      severity: 'medium',
      title: 'Memory indexing errors detected',
      description: `${digest.memoryHealth.errors} indexing errors across ${digest.memoryHealth.indexRuns} runs.`,
      suggestedFix: 'Run `jfl memory status` and `jfl-doctor.sh --fix` to repair the index.',
    })
  }

  if (digest.hubHealth.crashes > 2) {
    suggestions.push({
      type: 'reliability',
      severity: 'high',
      title: 'Context Hub crashing frequently',
      description: `${digest.hubHealth.crashes} hub crashes in the last ${digest.periodHours}h.`,
      suggestedFix: 'Check hub logs, ensure port 7890 is not conflicting, and restart with `jfl hub start`.',
    })
  }

  return suggestions
}

export function formatDigest(digest: TelemetryDigest, format: 'text' | 'json'): string {
  if (format === 'json') return JSON.stringify(digest, null, 2)

  const lines: string[] = []

  lines.push(`\n  Telemetry Digest (last ${digest.periodHours}h)`)
  lines.push(`  Generated: ${digest.generatedAt.replace('T', ' ').slice(0, 19)}`)
  lines.push(`  Total events: ${digest.totalEvents}\n`)

  if (digest.costs.length > 0) {
    lines.push('  Model Costs')
    lines.push('  ' + '-'.repeat(72))
    lines.push('  ' + 'Model'.padEnd(35) + 'Calls'.padEnd(8) + 'Tokens'.padEnd(12) + 'Cost')
    lines.push('  ' + '-'.repeat(72))
    for (const c of digest.costs) {
      lines.push(
        '  ' +
        c.model.padEnd(35) +
        String(c.calls).padEnd(8) +
        String(c.totalTokens).padEnd(12) +
        `$${c.estimatedCostUsd.toFixed(4)}`
      )
    }
    lines.push('  ' + '-'.repeat(72))
    lines.push('  ' + 'Total'.padEnd(55) + `$${digest.totalCostUsd.toFixed(4)}`)
    lines.push('')
  }

  if (digest.commands.length > 0) {
    lines.push('  Top Commands')
    lines.push('  ' + '-'.repeat(56))
    lines.push('  ' + 'Command'.padEnd(20) + 'Count'.padEnd(8) + 'Avg ms'.padEnd(12) + 'Success')
    lines.push('  ' + '-'.repeat(56))
    for (const c of digest.commands.slice(0, 10)) {
      lines.push(
        '  ' +
        c.command.padEnd(20) +
        String(c.count).padEnd(8) +
        String(c.avgDurationMs).padEnd(12) +
        `${(c.successRate * 100).toFixed(0)}%`
      )
    }
    lines.push('')
  }

  lines.push('  Health')
  lines.push(`    Sessions:  ${digest.sessions.started} started, ${digest.sessions.ended} ended, ${digest.sessions.crashed} crashed`)
  lines.push(`    Hub:       ${digest.hubHealth.starts} starts, ${digest.hubHealth.crashes} crashes, ${digest.hubHealth.mcpCalls} MCP calls (avg ${digest.hubHealth.avgMcpLatencyMs}ms)`)
  lines.push(`    Memory:    ${digest.memoryHealth.indexRuns} index runs, ${digest.memoryHealth.entriesIndexed} indexed, ${digest.memoryHealth.errors} errors`)
  lines.push(`    Errors:    ${digest.errors.total} total`)
  lines.push('')

  return lines.join('\n')
}
