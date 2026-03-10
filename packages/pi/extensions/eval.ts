/**
 * Eval Extension
 *
 * Captures agent turn metrics and writes eval entries via eval-store.ts.
 * Emits eval:submitted to MAP bus after each captured turn.
 *
 * @purpose Capture per-turn eval data and emit to MAP bus
 */

import { randomUUID } from "crypto"
import type { PiContext, JflConfig, AgentEndEvent } from "./types.js"
import { emitCustomEvent } from "./map-bridge.js"

interface EvalEntry {
  id: string
  session_id: string
  ts: string
  model?: string
  turn_count: number
  tools_used?: string[]
  files_changed?: string[]
  duration_ms?: number
  exit_reason?: string
  project_root: string
}

let projectRoot = ""

export async function setupEval(ctx: PiContext, _config: JflConfig): Promise<void> {
  projectRoot = ctx.session.projectRoot
}

export async function onAgentEnd(ctx: PiContext, event: AgentEndEvent): Promise<void> {
  if (!event.turnCount || event.turnCount < 1) return

  const entry: EvalEntry = {
    id: randomUUID(),
    session_id: ctx.session.id,
    ts: new Date().toISOString(),
    model: event.model,
    turn_count: event.turnCount,
    tools_used: event.toolsUsed,
    files_changed: event.filesChanged,
    duration_ms: event.duration,
    exit_reason: event.exitReason,
    project_root: projectRoot,
  }

  try {
    // @ts-ignore — resolved from jfl package at runtime
    const { appendEval } = await import("../../src/lib/eval-store.js")
    appendEval(entry as Parameters<typeof appendEval>[0], projectRoot)
  } catch {
    // eval-store may not be available in all contexts — non-fatal
  }

  await emitCustomEvent(ctx, "eval:submitted", entry)
}
