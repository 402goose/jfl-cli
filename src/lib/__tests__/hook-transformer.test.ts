/**
 * @purpose Unit tests for hook payload transformer
 */

import { transformHookPayload } from '../hook-transformer'
import type { HookPayload } from '../../types/map'

// Mock telemetry to avoid side effects
jest.mock('../telemetry', () => ({
  telemetry: {
    track: jest.fn(),
  },
}))

describe('transformHookPayload', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('event type mapping', () => {
    it('maps SessionStart to hook:session-start', () => {
      const payload: HookPayload = {
        hook_event_name: 'SessionStart',
      }
      const result = transformHookPayload(payload)
      expect(result.type).toBe('hook:session-start')
    })

    it('maps Stop to hook:stop', () => {
      const payload: HookPayload = {
        hook_event_name: 'Stop',
      }
      const result = transformHookPayload(payload)
      expect(result.type).toBe('hook:stop')
    })

    it('maps PreCompact to hook:pre-compact', () => {
      const payload: HookPayload = {
        hook_event_name: 'PreCompact',
      }
      const result = transformHookPayload(payload)
      expect(result.type).toBe('hook:pre-compact')
    })

    it('maps PostToolUse to hook:tool-use', () => {
      const payload: HookPayload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
      }
      const result = transformHookPayload(payload)
      expect(result.type).toBe('hook:tool-use')
    })

    it('maps PreToolUse to hook:tool-use with phase=pre', () => {
      const payload: HookPayload = {
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
      }
      const result = transformHookPayload(payload)
      expect(result.type).toBe('hook:tool-use')
      expect(result.data.phase).toBe('pre')
    })

    it('maps TaskCompleted to hook:task-completed', () => {
      const payload: HookPayload = {
        hook_event_name: 'TaskCompleted',
      }
      const result = transformHookPayload(payload)
      expect(result.type).toBe('hook:task-completed')
    })

    it('maps SubagentStart to hook:subagent-start', () => {
      const payload: HookPayload = {
        hook_event_name: 'SubagentStart',
      }
      const result = transformHookPayload(payload)
      expect(result.type).toBe('hook:subagent-start')
    })

    it('maps SubagentStop to hook:subagent-stop', () => {
      const payload: HookPayload = {
        hook_event_name: 'SubagentStop',
      }
      const result = transformHookPayload(payload)
      expect(result.type).toBe('hook:subagent-stop')
    })

    it('maps unknown events to custom type', () => {
      const payload: HookPayload = {
        hook_event_name: 'UnknownEvent',
      }
      const result = transformHookPayload(payload)
      expect(result.type).toBe('custom')
    })

    it('handles missing hook_event_name gracefully', () => {
      // Cast to bypass TypeScript - testing runtime resilience
      const payload = {} as HookPayload
      const result = transformHookPayload(payload)
      expect(result.type).toBe('custom')
      expect(result.data.hook_event_name).toBe('unknown')
    })
  })

  describe('session handling', () => {
    it('includes session_id in output', () => {
      const payload: HookPayload = {
        hook_event_name: 'SessionStart',
        session_id: 'test-session-123',
      }
      const result = transformHookPayload(payload)
      expect(result.session).toBe('test-session-123')
      expect(result.data.session_id).toBe('test-session-123')
    })

    it('handles missing session_id', () => {
      const payload: HookPayload = {
        hook_event_name: 'SessionStart',
      }
      const result = transformHookPayload(payload)
      expect(result.session).toBeUndefined()
      expect(result.data.session_id).toBeUndefined()
    })
  })

  describe('tool information', () => {
    it('includes tool_name in data', () => {
      const payload: HookPayload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
      }
      const result = transformHookPayload(payload)
      expect(result.data.tool_name).toBe('Bash')
    })

    it('includes file_paths array', () => {
      const payload: HookPayload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        file_paths: ['/path/to/file1.ts', '/path/to/file2.ts'],
      }
      const result = transformHookPayload(payload)
      expect(result.data.file_paths).toEqual(['/path/to/file1.ts', '/path/to/file2.ts'])
    })

    it('ignores non-array file_paths', () => {
      const payload: HookPayload = {
        hook_event_name: 'PostToolUse',
        file_paths: 'not-an-array' as any,
      }
      const result = transformHookPayload(payload)
      expect(result.data.file_paths).toBeUndefined()
    })
  })

  describe('tool_input sanitization', () => {
    it('redacts content field with length indicator', () => {
      const payload: HookPayload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: {
          file_path: '/path/to/file.ts',
          content: 'const x = 1;\nconst y = 2;',
        },
      }
      const result = transformHookPayload(payload)
      expect(result.data.tool_input).toBeDefined()
      const toolInput = result.data.tool_input as Record<string, unknown>
      expect(toolInput.file_path).toBe('/path/to/file.ts')
      expect(toolInput.content).toBe('[25 chars]')
    })

    it('redacts new_source field', () => {
      const newSource = 'import pandas as pd\ndf = pd.DataFrame()'
      const payload: HookPayload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'NotebookEdit',
        tool_input: {
          notebook_path: '/path/to/notebook.ipynb',
          new_source: newSource,
        },
      }
      const result = transformHookPayload(payload)
      const toolInput = result.data.tool_input as Record<string, unknown>
      expect(toolInput.notebook_path).toBe('/path/to/notebook.ipynb')
      expect(toolInput.new_source).toBe(`[${newSource.length} chars]`)
    })

    it('redacts old_string and new_string fields', () => {
      const payload: HookPayload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: {
          file_path: '/path/to/file.ts',
          old_string: 'const x = 1;',
          new_string: 'const x = 2;',
        },
      }
      const result = transformHookPayload(payload)
      const toolInput = result.data.tool_input as Record<string, unknown>
      expect(toolInput.file_path).toBe('/path/to/file.ts')
      expect(toolInput.old_string).toBe('[12 chars]')
      expect(toolInput.new_string).toBe('[12 chars]')
    })

    it('truncates long string values over 500 chars', () => {
      const longString = 'x'.repeat(600)
      const payload: HookPayload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: {
          command: longString,
        },
      }
      const result = transformHookPayload(payload)
      const toolInput = result.data.tool_input as Record<string, unknown>
      expect(toolInput.command).toBe('x'.repeat(200) + '... [600 chars]')
    })

    it('preserves short string values unchanged', () => {
      const payload: HookPayload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: {
          command: 'ls -la',
          description: 'List files',
        },
      }
      const result = transformHookPayload(payload)
      const toolInput = result.data.tool_input as Record<string, unknown>
      expect(toolInput.command).toBe('ls -la')
      expect(toolInput.description).toBe('List files')
    })

    it('preserves non-string values unchanged', () => {
      const payload: HookPayload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'Custom',
        tool_input: {
          count: 42,
          enabled: true,
          nested: { key: 'value' },
          items: [1, 2, 3],
        },
      }
      const result = transformHookPayload(payload)
      const toolInput = result.data.tool_input as Record<string, unknown>
      expect(toolInput.count).toBe(42)
      expect(toolInput.enabled).toBe(true)
      expect(toolInput.nested).toEqual({ key: 'value' })
      expect(toolInput.items).toEqual([1, 2, 3])
    })

    it('handles non-string content field gracefully', () => {
      const payload: HookPayload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: {
          content: null as any,
        },
      }
      const result = transformHookPayload(payload)
      const toolInput = result.data.tool_input as Record<string, unknown>
      expect(toolInput.content).toBe('[0 chars]')
    })
  })

  describe('tool_output handling', () => {
    it('records output length but not content', () => {
      const toolOutput = 'total 1024\ndrwxr-xr-x  5 user  staff  160 Mar 11 10:00 .\n...'
      const payload: HookPayload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_output: toolOutput,
      }
      const result = transformHookPayload(payload)
      expect(result.data.tool_output_length).toBe(toolOutput.length)
      expect(result.data.tool_output).toBeUndefined()
    })

    it('handles empty tool_output by not setting length', () => {
      const payload: HookPayload = {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_output: '',
      }
      const result = transformHookPayload(payload)
      // Empty string is falsy, so tool_output_length isn't set
      expect(result.data.tool_output_length).toBeUndefined()
    })
  })

  describe('source field', () => {
    it('always sets source to claude-code', () => {
      const payload: HookPayload = {
        hook_event_name: 'SessionStart',
      }
      const result = transformHookPayload(payload)
      expect(result.source).toBe('claude-code')
    })
  })

  describe('return shape', () => {
    it('returns object without id and ts fields', () => {
      const payload: HookPayload = {
        hook_event_name: 'Stop',
      }
      const result = transformHookPayload(payload)
      expect(result).not.toHaveProperty('id')
      expect(result).not.toHaveProperty('ts')
      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('source')
      expect(result).toHaveProperty('data')
    })
  })
})
