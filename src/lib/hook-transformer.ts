/**
 * Hook Payload Transformer
 *
 * Transforms Claude Code HTTP hook payloads into MAPEvents.
 * Strips sensitive content (file bodies, tool output) — keeps only identifiers.
 *
 * @purpose Transform Claude Code hook POST payloads into MAP event bus events
 */

import type { MAPEvent, MAPEventType, HookPayload } from "../types/map.js"
import { telemetry } from "./telemetry.js"

const HOOK_EVENT_MAP: Record<string, MAPEventType> = {
  SessionStart: "hook:session-start",
  Stop: "hook:stop",
  PreCompact: "hook:pre-compact",
  PostToolUse: "hook:tool-use",
  PreToolUse: "hook:tool-use",
  TaskCompleted: "hook:task-completed",
  SubagentStart: "hook:subagent-start",
  SubagentStop: "hook:subagent-stop",
}

export function transformHookPayload(payload: HookPayload): Omit<MAPEvent, "id" | "ts"> {
  const hookName = payload.hook_event_name || "unknown"
  const eventType: MAPEventType = HOOK_EVENT_MAP[hookName] || "custom"

  const data: Record<string, unknown> = {
    hook_event_name: hookName,
  }

  if (payload.session_id) {
    data.session_id = payload.session_id
  }

  if (payload.tool_name) {
    data.tool_name = payload.tool_name
  }

  if (payload.file_paths && Array.isArray(payload.file_paths)) {
    data.file_paths = payload.file_paths
  }

  if (hookName === "PreToolUse") {
    data.phase = "pre"
  }

  if (payload.tool_input) {
    const safe: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(payload.tool_input)) {
      if (key === "content" || key === "new_source") {
        safe[key] = `[${typeof value === "string" ? value.length : 0} chars]`
      } else if (key === "old_string" || key === "new_string") {
        safe[key] = `[${typeof value === "string" ? value.length : 0} chars]`
      } else if (typeof value === "string" && value.length > 500) {
        safe[key] = value.slice(0, 200) + `... [${value.length} chars]`
      } else {
        safe[key] = value
      }
    }
    data.tool_input = safe
  }

  if (payload.tool_output) {
    data.tool_output_length = payload.tool_output.length
  }

  telemetry.track({
    category: 'hooks',
    event: 'hook:received',
    hook_event_name: hookName,
    tool_name: payload.tool_name || undefined,
    has_file_paths: !!(payload.file_paths?.length),
  })

  return {
    type: eventType,
    source: "claude-code",
    session: payload.session_id,
    data,
  }
}
