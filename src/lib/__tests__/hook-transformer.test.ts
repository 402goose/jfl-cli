/**
 * @purpose Tests for hook payload transformer
 */

import { transformHookPayload } from "../hook-transformer.js"
import type { HookPayload } from "../../types/map.js"

jest.mock("../telemetry.js", () => ({
  telemetry: { track: jest.fn() },
}))

describe("transformHookPayload", () => {
  describe("event type mapping", () => {
    it("maps SessionStart to hook:session-start", () => {
      const payload: HookPayload = { hook_event_name: "SessionStart" }
      const result = transformHookPayload(payload)
      expect(result.type).toBe("hook:session-start")
    })

    it("maps Stop to hook:stop", () => {
      const payload: HookPayload = { hook_event_name: "Stop" }
      const result = transformHookPayload(payload)
      expect(result.type).toBe("hook:stop")
    })

    it("maps PreCompact to hook:pre-compact", () => {
      const payload: HookPayload = { hook_event_name: "PreCompact" }
      const result = transformHookPayload(payload)
      expect(result.type).toBe("hook:pre-compact")
    })

    it("maps PostToolUse to hook:tool-use", () => {
      const payload: HookPayload = { hook_event_name: "PostToolUse" }
      const result = transformHookPayload(payload)
      expect(result.type).toBe("hook:tool-use")
    })

    it("maps PreToolUse to hook:tool-use with phase=pre", () => {
      const payload: HookPayload = { hook_event_name: "PreToolUse" }
      const result = transformHookPayload(payload)
      expect(result.type).toBe("hook:tool-use")
      expect(result.data?.phase).toBe("pre")
    })

    it("maps TaskCompleted to hook:task-completed", () => {
      const payload: HookPayload = { hook_event_name: "TaskCompleted" }
      const result = transformHookPayload(payload)
      expect(result.type).toBe("hook:task-completed")
    })

    it("maps SubagentStart to hook:subagent-start", () => {
      const payload: HookPayload = { hook_event_name: "SubagentStart" }
      const result = transformHookPayload(payload)
      expect(result.type).toBe("hook:subagent-start")
    })

    it("maps SubagentStop to hook:subagent-stop", () => {
      const payload: HookPayload = { hook_event_name: "SubagentStop" }
      const result = transformHookPayload(payload)
      expect(result.type).toBe("hook:subagent-stop")
    })

    it("maps unknown hooks to custom type", () => {
      const payload: HookPayload = { hook_event_name: "UnknownHook" }
      const result = transformHookPayload(payload)
      expect(result.type).toBe("custom")
    })

    it("handles missing hook_event_name", () => {
      // Cast to allow empty object for edge case testing
      const payload = {} as HookPayload
      const result = transformHookPayload(payload)
      expect(result.type).toBe("custom")
      expect(result.data?.hook_event_name).toBe("unknown")
    })
  })

  describe("data extraction", () => {
    it("includes session_id when provided", () => {
      const payload: HookPayload = {
        hook_event_name: "SessionStart",
        session_id: "session-123",
      }
      const result = transformHookPayload(payload)
      expect(result.session).toBe("session-123")
      expect(result.data?.session_id).toBe("session-123")
    })

    it("includes tool_name when provided", () => {
      const payload: HookPayload = {
        hook_event_name: "PostToolUse",
        tool_name: "Read",
      }
      const result = transformHookPayload(payload)
      expect(result.data?.tool_name).toBe("Read")
    })

    it("includes file_paths when provided as array", () => {
      const payload: HookPayload = {
        hook_event_name: "PostToolUse",
        file_paths: ["/a/b.ts", "/c/d.ts"],
      }
      const result = transformHookPayload(payload)
      expect(result.data?.file_paths).toEqual(["/a/b.ts", "/c/d.ts"])
    })
  })

  describe("tool_input sanitization", () => {
    it("redacts content field to char count", () => {
      const payload: HookPayload = {
        hook_event_name: "PostToolUse",
        tool_input: {
          content: "This is some file content that should be redacted",
        },
      }
      const result = transformHookPayload(payload)
      expect((result.data?.tool_input as any)?.content).toBe("[49 chars]")
    })

    it("redacts new_source field to char count", () => {
      const payload: HookPayload = {
        hook_event_name: "PostToolUse",
        tool_input: {
          new_source: "updated source code here",
        },
      }
      const result = transformHookPayload(payload)
      expect((result.data?.tool_input as any)?.new_source).toBe("[24 chars]")
    })

    it("redacts old_string and new_string fields", () => {
      const payload: HookPayload = {
        hook_event_name: "PostToolUse",
        tool_input: {
          old_string: "old text",
          new_string: "new replacement text",
        },
      }
      const result = transformHookPayload(payload)
      expect((result.data?.tool_input as any)?.old_string).toBe("[8 chars]")
      expect((result.data?.tool_input as any)?.new_string).toBe("[20 chars]")
    })

    it("truncates long string values over 500 chars", () => {
      const longValue = "x".repeat(600)
      const payload: HookPayload = {
        hook_event_name: "PostToolUse",
        tool_input: {
          description: longValue,
        },
      }
      const result = transformHookPayload(payload)
      expect((result.data?.tool_input as any)?.description).toMatch(/^x{200}\.\.\. \[600 chars\]$/)
    })

    it("preserves short string values unchanged", () => {
      const payload: HookPayload = {
        hook_event_name: "PostToolUse",
        tool_input: {
          file_path: "/path/to/file.ts",
        },
      }
      const result = transformHookPayload(payload)
      expect((result.data?.tool_input as any)?.file_path).toBe("/path/to/file.ts")
    })

    it("preserves non-string values unchanged", () => {
      const payload: HookPayload = {
        hook_event_name: "PostToolUse",
        tool_input: {
          limit: 100,
          enabled: true,
        },
      }
      const result = transformHookPayload(payload)
      expect((result.data?.tool_input as any)?.limit).toBe(100)
      expect((result.data?.tool_input as any)?.enabled).toBe(true)
    })
  })

  describe("tool_output handling", () => {
    it("records output length instead of full content", () => {
      const payload: HookPayload = {
        hook_event_name: "PostToolUse",
        tool_output: "This is the tool output that should not be stored",
      }
      const result = transformHookPayload(payload)
      expect(result.data?.tool_output_length).toBe(49)
      expect(result.data?.tool_output).toBeUndefined()
    })
  })

  describe("source attribution", () => {
    it("sets source to claude-code", () => {
      const payload: HookPayload = { hook_event_name: "SessionStart" }
      const result = transformHookPayload(payload)
      expect(result.source).toBe("claude-code")
    })
  })
})
