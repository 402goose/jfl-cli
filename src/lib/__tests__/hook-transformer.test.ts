/**
 * @purpose Test hook payload transformer — event mapping, data sanitization, telemetry
 */

jest.mock('../telemetry.js', () => ({
  telemetry: { track: jest.fn() },
}))

import { transformHookPayload } from '../hook-transformer'
import { telemetry } from '../telemetry'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('transformHookPayload', () => {
  it('maps SessionStart to hook:session-start', () => {
    const result = transformHookPayload({
      hook_event_name: 'SessionStart',
      session_id: 'sess-123',
    })
    expect(result.type).toBe('hook:session-start')
    expect(result.source).toBe('claude-code')
    expect(result.session).toBe('sess-123')
    expect(result.data.hook_event_name).toBe('SessionStart')
  })

  it('maps Stop to hook:stop', () => {
    const result = transformHookPayload({ hook_event_name: 'Stop' })
    expect(result.type).toBe('hook:stop')
  })

  it('maps PreCompact to hook:pre-compact', () => {
    const result = transformHookPayload({ hook_event_name: 'PreCompact' })
    expect(result.type).toBe('hook:pre-compact')
  })

  it('maps PostToolUse to hook:tool-use', () => {
    const result = transformHookPayload({
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
    })
    expect(result.type).toBe('hook:tool-use')
    expect(result.data.tool_name).toBe('Write')
  })

  it('maps PreToolUse with phase=pre', () => {
    const result = transformHookPayload({
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
    })
    expect(result.type).toBe('hook:tool-use')
    expect(result.data.phase).toBe('pre')
  })

  it('maps TaskCompleted to hook:task-completed', () => {
    const result = transformHookPayload({ hook_event_name: 'TaskCompleted' })
    expect(result.type).toBe('hook:task-completed')
  })

  it('maps SubagentStart to hook:subagent-start', () => {
    const result = transformHookPayload({ hook_event_name: 'SubagentStart' })
    expect(result.type).toBe('hook:subagent-start')
  })

  it('maps SubagentStop to hook:subagent-stop', () => {
    const result = transformHookPayload({ hook_event_name: 'SubagentStop' })
    expect(result.type).toBe('hook:subagent-stop')
  })

  it('maps unknown hooks to "custom"', () => {
    const result = transformHookPayload({ hook_event_name: 'SomeFutureHook' })
    expect(result.type).toBe('custom')
  })

  it('handles missing hook_event_name', () => {
    const result = transformHookPayload({} as any)
    expect(result.type).toBe('custom')
    expect(result.data.hook_event_name).toBe('unknown')
  })

  it('includes file_paths when present', () => {
    const result = transformHookPayload({
      hook_event_name: 'PostToolUse',
      file_paths: ['/a/b.ts', '/c/d.ts'],
    })
    expect(result.data.file_paths).toEqual(['/a/b.ts', '/c/d.ts'])
  })

  it('omits file_paths when not present', () => {
    const result = transformHookPayload({ hook_event_name: 'Stop' })
    expect(result.data.file_paths).toBeUndefined()
  })

  describe('tool_input sanitization', () => {
    it('redacts content field to char count', () => {
      const result = transformHookPayload({
        hook_event_name: 'PostToolUse',
        tool_input: { content: 'hello world' },
      })
      const input = result.data.tool_input as Record<string, unknown>
      expect(input.content).toBe('[11 chars]')
    })

    it('redacts new_source field', () => {
      const result = transformHookPayload({
        hook_event_name: 'PostToolUse',
        tool_input: { new_source: 'const x = 1' },
      })
      const input = result.data.tool_input as Record<string, unknown>
      expect(input.new_source).toBe('[11 chars]')
    })

    it('redacts old_string and new_string', () => {
      const result = transformHookPayload({
        hook_event_name: 'PostToolUse',
        tool_input: { old_string: 'abc', new_string: 'xyz' },
      })
      const input = result.data.tool_input as Record<string, unknown>
      expect(input.old_string).toBe('[3 chars]')
      expect(input.new_string).toBe('[3 chars]')
    })

    it('truncates long strings to 200 chars + summary', () => {
      const longVal = 'x'.repeat(600)
      const result = transformHookPayload({
        hook_event_name: 'PostToolUse',
        tool_input: { command: longVal },
      })
      const input = result.data.tool_input as Record<string, unknown>
      const val = input.command as string
      expect(val).toContain('... [600 chars]')
      expect(val.length).toBeLessThan(longVal.length)
    })

    it('passes short strings through unchanged', () => {
      const result = transformHookPayload({
        hook_event_name: 'PostToolUse',
        tool_input: { file_path: '/short/path.ts' },
      })
      const input = result.data.tool_input as Record<string, unknown>
      expect(input.file_path).toBe('/short/path.ts')
    })

    it('passes non-string values through', () => {
      const result = transformHookPayload({
        hook_event_name: 'PostToolUse',
        tool_input: { limit: 100, recursive: true },
      })
      const input = result.data.tool_input as Record<string, unknown>
      expect(input.limit).toBe(100)
      expect(input.recursive).toBe(true)
    })
  })

  it('records tool_output_length', () => {
    const result = transformHookPayload({
      hook_event_name: 'PostToolUse',
      tool_output: 'output data here',
    })
    expect(result.data.tool_output_length).toBe(16)
  })

  it('tracks telemetry on every call', () => {
    transformHookPayload({
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      file_paths: ['/a.ts'],
    })

    expect(telemetry.track).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'hooks',
        event: 'hook:received',
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        has_file_paths: true,
      })
    )
  })

  it('handles content field with non-string value', () => {
    const result = transformHookPayload({
      hook_event_name: 'PostToolUse',
      tool_input: { content: 12345 as any },
    })
    const input = result.data.tool_input as Record<string, unknown>
    expect(input.content).toBe('[0 chars]')
  })
})
