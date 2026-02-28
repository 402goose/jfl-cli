import { analyzeEvents, generateSuggestions, formatDigest } from '../telemetry-digest'
import type { TelemetryEvent } from '../../types/telemetry'

function makeEvent(overrides: Partial<TelemetryEvent>): TelemetryEvent {
  return {
    event_id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    session_id: 'test-session',
    install_id: 'test-install',
    category: 'command',
    event: 'command:test',
    jfl_version: '0.2.3',
    node_version: '22.0.0',
    os: 'darwin',
    ...overrides,
  } as TelemetryEvent
}

describe('analyzeEvents', () => {
  it('returns empty digest for no events', () => {
    const digest = analyzeEvents([], 24)
    expect(digest.totalEvents).toBe(0)
    expect(digest.costs).toEqual([])
    expect(digest.commands).toEqual([])
    expect(digest.totalCostUsd).toBe(0)
  })

  it('aggregates stratus:api_call events by model', () => {
    const events = [
      makeEvent({
        category: 'performance',
        event: 'stratus:api_call',
        model_name: 'claude-sonnet-4-6',
        prompt_tokens: 500,
        completion_tokens: 200,
        total_tokens: 700,
        estimated_cost_usd: 0.0045,
        duration_ms: 1200,
      }),
      makeEvent({
        category: 'performance',
        event: 'stratus:api_call',
        model_name: 'claude-sonnet-4-6',
        prompt_tokens: 800,
        completion_tokens: 300,
        total_tokens: 1100,
        estimated_cost_usd: 0.0069,
        duration_ms: 1800,
      }),
      makeEvent({
        category: 'performance',
        event: 'stratus:api_call',
        model_name: 'claude-opus-4-6',
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500,
        estimated_cost_usd: 0.0525,
        duration_ms: 3000,
      }),
    ]

    const digest = analyzeEvents(events, 24)
    expect(digest.costs).toHaveLength(2)
    expect(digest.totalCostUsd).toBeCloseTo(0.0045 + 0.0069 + 0.0525, 4)

    const sonnet = digest.costs.find(c => c.model === 'claude-sonnet-4-6')!
    expect(sonnet.calls).toBe(2)
    expect(sonnet.promptTokens).toBe(1300)
    expect(sonnet.completionTokens).toBe(500)

    const opus = digest.costs.find(c => c.model === 'claude-opus-4-6')!
    expect(opus.calls).toBe(1)
    expect(opus.estimatedCostUsd).toBeCloseTo(0.0525, 4)
  })

  it('aggregates command stats with success rate', () => {
    const events = [
      makeEvent({ command: 'synopsis', duration_ms: 100, success: true }),
      makeEvent({ command: 'synopsis', duration_ms: 200, success: true }),
      makeEvent({ command: 'synopsis', duration_ms: 150, success: false }),
      makeEvent({ command: 'hud', duration_ms: 50, success: true }),
    ]

    const digest = analyzeEvents(events, 24)
    const synopsis = digest.commands.find(c => c.command === 'synopsis')!
    expect(synopsis.count).toBe(3)
    expect(synopsis.avgDurationMs).toBe(150)
    expect(synopsis.successRate).toBeCloseTo(2/3, 2)

    const hud = digest.commands.find(c => c.command === 'hud')!
    expect(hud.count).toBe(1)
    expect(hud.successRate).toBe(1)
  })

  it('tracks error counts by type', () => {
    const events = [
      makeEvent({ category: 'error', event: 'error:crash', error_type: 'ECONNREFUSED' }),
      makeEvent({ category: 'error', event: 'error:crash', error_type: 'ECONNREFUSED' }),
      makeEvent({ category: 'error', event: 'error:timeout', error_type: 'TIMEOUT' }),
    ]

    const digest = analyzeEvents(events, 24)
    expect(digest.errors.total).toBe(3)
    expect(digest.errors.byType['ECONNREFUSED']).toBe(2)
    expect(digest.errors.byType['TIMEOUT']).toBe(1)
  })

  it('tracks session health', () => {
    const events = [
      makeEvent({ category: 'session', event: 'session:start', session_event: 'start' }),
      makeEvent({ category: 'session', event: 'session:start', session_event: 'start' }),
      makeEvent({ category: 'session', event: 'session:end', session_event: 'end', session_duration_s: 600 }),
      makeEvent({ category: 'session', event: 'session:crash', session_event: 'crash' }),
    ]

    const digest = analyzeEvents(events, 24)
    expect(digest.sessions.started).toBe(2)
    expect(digest.sessions.ended).toBe(1)
    expect(digest.sessions.crashed).toBe(1)
    expect(digest.sessions.avgDurationS).toBe(600)
  })

  it('tracks hub and memory health', () => {
    const events = [
      makeEvent({ category: 'context_hub', event: 'context_hub:started' }),
      makeEvent({ category: 'context_hub', event: 'error:hub_crash' }),
      makeEvent({ category: 'context_hub', event: 'context_hub:mcp_call', mcp_duration_ms: 100 }),
      makeEvent({ category: 'context_hub', event: 'context_hub:mcp_call', mcp_duration_ms: 300 }),
      makeEvent({
        category: 'performance',
        event: 'performance:memory_index',
        memory_entries_indexed: 50,
        memory_index_duration_ms: 2000,
        entries_errors: 1,
      }),
    ]

    const digest = analyzeEvents(events, 24)
    expect(digest.hubHealth.starts).toBe(1)
    expect(digest.hubHealth.crashes).toBe(1)
    expect(digest.hubHealth.mcpCalls).toBe(2)
    expect(digest.hubHealth.avgMcpLatencyMs).toBe(200)
    expect(digest.memoryHealth.indexRuns).toBe(1)
    expect(digest.memoryHealth.entriesIndexed).toBe(50)
    expect(digest.memoryHealth.errors).toBe(1)
  })

  it('filters events outside the time window', () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const recent = new Date().toISOString()

    const events = [
      makeEvent({ ts: old, command: 'old-command', success: true }),
      makeEvent({ ts: recent, command: 'new-command', success: true }),
    ]

    const digest = analyzeEvents(events, 24)
    expect(digest.totalEvents).toBe(1)
    expect(digest.commands).toHaveLength(1)
    expect(digest.commands[0].command).toBe('new-command')
  })
})

describe('generateSuggestions', () => {
  it('returns empty for healthy digest', () => {
    const digest = analyzeEvents([], 24)
    const suggestions = generateSuggestions(digest)
    expect(suggestions).toEqual([])
  })

  it('flags high MCP latency', () => {
    const events = [
      makeEvent({ category: 'context_hub', event: 'context_hub:mcp_call', mcp_duration_ms: 800 }),
      makeEvent({ category: 'context_hub', event: 'context_hub:mcp_call', mcp_duration_ms: 600 }),
    ]
    const digest = analyzeEvents(events, 24)
    const suggestions = generateSuggestions(digest)
    expect(suggestions.some(s => s.title.includes('MCP latency'))).toBe(true)
  })

  it('flags high error rate', () => {
    const events: TelemetryEvent[] = []
    for (let i = 0; i < 8; i++) {
      events.push(makeEvent({ command: 'test', success: true }))
    }
    for (let i = 0; i < 4; i++) {
      events.push(makeEvent({ category: 'error', event: 'error:crash', error_type: 'ENOENT' }))
    }
    const digest = analyzeEvents(events, 24)
    const suggestions = generateSuggestions(digest)
    expect(suggestions.some(s => s.title.includes('Error rate'))).toBe(true)
    expect(suggestions.find(s => s.title.includes('Error rate'))?.severity).toBe('high')
  })

  it('flags cost concentration on single model', () => {
    const events = [
      makeEvent({
        event: 'stratus:api_call', category: 'performance',
        model_name: 'claude-opus-4-6', estimated_cost_usd: 0.10,
        prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500,
      }),
      makeEvent({
        event: 'stratus:api_call', category: 'performance',
        model_name: 'claude-opus-4-6', estimated_cost_usd: 0.10,
        prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500,
      }),
      makeEvent({
        event: 'stratus:api_call', category: 'performance',
        model_name: 'claude-haiku-3-5', estimated_cost_usd: 0.001,
        prompt_tokens: 500, completion_tokens: 200, total_tokens: 700,
      }),
    ]
    const digest = analyzeEvents(events, 24)
    const suggestions = generateSuggestions(digest)
    expect(suggestions.some(s => s.type === 'cost')).toBe(true)
  })

  it('flags session crash rate', () => {
    const events: TelemetryEvent[] = []
    for (let i = 0; i < 10; i++) {
      events.push(makeEvent({ category: 'session', event: 'session:start', session_event: 'start' }))
    }
    for (let i = 0; i < 3; i++) {
      events.push(makeEvent({ category: 'session', event: 'session:crash', session_event: 'crash' }))
    }
    const digest = analyzeEvents(events, 24)
    const suggestions = generateSuggestions(digest)
    expect(suggestions.some(s => s.title.includes('crash rate'))).toBe(true)
  })

  it('flags memory indexing errors', () => {
    const events = [
      makeEvent({
        category: 'performance', event: 'performance:memory_index',
        memory_entries_indexed: 10, memory_index_duration_ms: 500, entries_errors: 3,
      }),
    ]
    const digest = analyzeEvents(events, 24)
    const suggestions = generateSuggestions(digest)
    expect(suggestions.some(s => s.title.includes('Memory indexing'))).toBe(true)
  })

  it('flags frequent hub crashes', () => {
    const events = [
      makeEvent({ category: 'context_hub', event: 'error:hub_crash' }),
      makeEvent({ category: 'context_hub', event: 'error:hub_crash' }),
      makeEvent({ category: 'context_hub', event: 'error:hub_crash' }),
    ]
    const digest = analyzeEvents(events, 24)
    const suggestions = generateSuggestions(digest)
    expect(suggestions.some(s => s.title.includes('Hub crashing'))).toBe(true)
    expect(suggestions.find(s => s.title.includes('Hub crashing'))?.severity).toBe('high')
  })
})

describe('formatDigest', () => {
  it('outputs valid JSON in json format', () => {
    const digest = analyzeEvents([], 24)
    const json = formatDigest(digest, 'json')
    const parsed = JSON.parse(json)
    expect(parsed.periodHours).toBe(24)
    expect(parsed.totalEvents).toBe(0)
  })

  it('outputs readable text in text format', () => {
    const events = [
      makeEvent({
        category: 'performance', event: 'stratus:api_call',
        model_name: 'claude-sonnet-4-6', prompt_tokens: 500,
        completion_tokens: 200, total_tokens: 700, estimated_cost_usd: 0.0045,
        duration_ms: 1200,
      }),
      makeEvent({ command: 'synopsis', duration_ms: 500, success: true }),
    ]
    const digest = analyzeEvents(events, 24)
    const text = formatDigest(digest, 'text')
    expect(text).toContain('Telemetry Digest')
    expect(text).toContain('Model Costs')
    expect(text).toContain('claude-sonnet-4-6')
    expect(text).toContain('Top Commands')
    expect(text).toContain('synopsis')
    expect(text).toContain('Health')
  })
})
