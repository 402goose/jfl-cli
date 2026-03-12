/**
 * MAP Event Bridge Extension
 *
 * Translates Pi lifecycle events → MAP event bus (Context Hub HTTP).
 * Also subscribes to hub SSE stream and re-emits as Pi custom events.
 * Enforces scope filtering from .jfl/config.json context_scope.
 *
 * @purpose Pi lifecycle → MAP bus bridge with scope enforcement
 */

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import type { PiContext, JflConfig, AgentEndEvent, ToolExecutionEvent } from "./types.js"

interface MAPEvent {
  type: string
  source: string
  data?: unknown
  ts?: string
}

interface ContextScope {
  produces?: string[]
  consumes?: string[]
  denied?: string[]
}

let hubUrl = "http://localhost:4242"
let authToken: string | null = null
let scope: ContextScope = {}
let sseAbort: AbortController | null = null

const PI_TO_MAP: Record<string, string> = {
  "hook:session-start": "hook:session-start",
  "hook:session-end": "hook:session-end",
  "task:started": "task:started",
  "task:completed": "task:completed",
  "hook:tool-use": "hook:tool-use",
  "hook:tool-result": "hook:tool-result",
}

function readToken(root: string): string | null {
  const tokenPath = join(root, ".jfl", "context-hub.token")
  if (existsSync(tokenPath)) {
    return readFileSync(tokenPath, "utf-8").trim()
  }
  return null
}

function matchPattern(pattern: string, value: string): boolean {
  if (pattern === "*") return true
  if (pattern === value) return true
  if (pattern.includes("*")) {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$")
    return regex.test(value)
  }
  return false
}

function isEventAllowedToEmit(eventType: string, src: ContextScope): boolean {
  if (!src.produces || src.produces.length === 0) return true
  return src.produces.some(p => matchPattern(p, eventType))
}

function isEventDenied(eventType: string, src: ContextScope): boolean {
  if (!src.denied || src.denied.length === 0) return false
  return src.denied.some(d => matchPattern(d, eventType))
}

async function postToHub(event: MAPEvent): Promise<void> {
  if (isEventDenied(event.type, scope)) return
  if (!isEventAllowedToEmit(event.type, scope)) return

  try {
    const response = await fetch(`${hubUrl}/api/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify(event),
    })
    if (!response.ok) {
      // Silently ignore hub connectivity issues — it may not be running
    }
  } catch {
    // Hub not available — non-fatal
  }
}

async function subscribeToHubSSE(ctx: PiContext): Promise<void> {
  sseAbort = new AbortController()

  const consumesPatterns = scope.consumes ?? ["*"]

  try {
    const patternsParam = consumesPatterns.join(",")
    const url = `${hubUrl}/api/events/stream?pattern=${encodeURIComponent(patternsParam)}`

    const resp = await fetch(url, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      signal: sseAbort.signal,
    })

    if (!resp.ok || !resp.body) return

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        try {
          const event = JSON.parse(line.slice(6)) as MAPEvent
          if (isEventDenied(event.type, scope)) continue
          ctx.emit(`map:${event.type}`, event)
        } catch {}
      }
    }
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "AbortError") return
    // Silently ignore — Context Hub may not be running
  }
}

export async function setupMapBridge(ctx: PiContext, config: JflConfig): Promise<void> {
  const root = ctx.session.projectRoot

  authToken = readToken(root)
  scope = config.context_scope ?? {}

  const portFile = join(root, ".jfl", "context-hub.port")
  if (existsSync(portFile)) {
    const port = readFileSync(portFile, "utf-8").trim()
    if (port) hubUrl = `http://localhost:${port}`
  }

  ctx.on("hook:session-start", (data) => postToHub({ type: "hook:session-start", source: "pi-session", data, ts: new Date().toISOString() }))
  ctx.on("hook:session-end", (data) => postToHub({ type: "hook:session-end", source: "pi-session", data, ts: new Date().toISOString() }))

  subscribeToHubSSE(ctx).catch(() => {})
}

export async function onMapBridgeShutdown(_ctx: PiContext): Promise<void> {
  sseAbort?.abort()
  sseAbort = null
}

export async function emitAgentStart(ctx: PiContext, event: unknown): Promise<void> {
  await postToHub({ type: "task:started", source: `pi-agent:${ctx.session.id}`, data: event, ts: new Date().toISOString() })
}

export async function emitAgentEnd(ctx: PiContext, event: AgentEndEvent): Promise<void> {
  await postToHub({ type: "task:completed", source: `pi-agent:${ctx.session.id}`, data: event, ts: new Date().toISOString() })
}

export async function onMapToolEnd(ctx: PiContext, event: ToolExecutionEvent): Promise<void> {
  await postToHub({
    type: "hook:tool-result",
    source: `pi-agent:${ctx.session.id}`,
    data: { tool: event.toolName ?? event.tool, duration: event.duration },
    ts: new Date().toISOString(),
  })
}

export async function emitCustomEvent(ctx: PiContext, type: string, data: unknown): Promise<void> {
  await postToHub({ type, source: `pi:${ctx.session.id}`, data, ts: new Date().toISOString() })
}

export { hubUrl, authToken }
