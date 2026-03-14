import { EventEmitter } from "events"
import type { PiRpcBridge } from "./bridge.js"
import type { MapEvent } from "./types.js"

interface EventRoute {
  pattern: string
  action: "steer" | "follow_up" | "abort"
  messageTemplate: string
  condition?: (event: MapEvent) => boolean
}

interface EventRouterOptions {
  hubUrl: string
  routes?: EventRoute[]
  pollIntervalMs?: number
}

export class EventRouter extends EventEmitter {
  private routes: EventRoute[] = []
  private bridges = new Map<string, PiRpcBridge>()
  private hubUrl: string
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private lastEventTs: string | null = null
  private sseAbort: AbortController | null = null

  constructor(options: EventRouterOptions) {
    super()
    this.hubUrl = options.hubUrl.replace(/\/$/, "")
    this.routes = options.routes ?? defaultRoutes()
  }

  registerBridge(name: string, bridge: PiRpcBridge): void {
    this.bridges.set(name, bridge)
  }

  unregisterBridge(name: string): void {
    this.bridges.delete(name)
  }

  addRoute(route: EventRoute): void {
    this.routes.push(route)
  }

  async startSse(): Promise<void> {
    this.sseAbort = new AbortController()
    const url = `${this.hubUrl}/api/events/stream`

    const connect = async () => {
      try {
        const resp = await fetch(url, {
          headers: { Accept: "text/event-stream" },
          signal: this.sseAbort!.signal,
        })

        if (!resp.ok || !resp.body) {
          this.emit("error", new Error(`SSE connect failed: ${resp.status}`))
          setTimeout(connect, 5000)
          return
        }

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
              const event = JSON.parse(line.slice(6)) as MapEvent
              await this.routeEvent(event)
            } catch {
              // skip malformed events
            }
          }
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return
        this.emit("error", err)
        setTimeout(connect, 5000)
      }
    }

    connect()
  }

  async startPolling(intervalMs = 3000): Promise<void> {
    const poll = async () => {
      try {
        const url = new URL(`${this.hubUrl}/api/events/recent`)
        url.searchParams.set("limit", "20")
        if (this.lastEventTs) url.searchParams.set("after", this.lastEventTs)

        const resp = await fetch(url.toString())
        if (!resp.ok) return

        const data = await resp.json() as { events?: MapEvent[] }
        const events = data.events ?? []

        for (const event of events) {
          await this.routeEvent(event)
          this.lastEventTs = event.ts
        }
      } catch {
        // silent retry
      }
    }

    await poll()
    this.pollInterval = setInterval(poll, intervalMs)
  }

  stop(): void {
    this.sseAbort?.abort()
    this.sseAbort = null
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }

  private async routeEvent(event: MapEvent): Promise<void> {
    for (const route of this.routes) {
      if (!matchPattern(route.pattern, event.type)) continue
      if (route.condition && !route.condition(event)) continue

      const message = interpolate(route.messageTemplate, event)

      this.emit("route", { event, route, message })

      for (const [name, bridge] of this.bridges) {
        if (!bridge.started || bridge.exited) continue
        try {
          switch (route.action) {
            case "steer":
              await bridge.steer(message)
              break
            case "follow_up":
              await bridge.followUp(message)
              break
            case "abort":
              await bridge.abort()
              break
          }
          this.emit("routed", { agentName: name, event, route, message })
        } catch (err) {
          this.emit("route_error", { agentName: name, error: err })
        }
      }
    }
  }
}

function matchPattern(pattern: string, eventType: string): boolean {
  if (pattern === eventType) return true
  if (pattern.endsWith("*")) {
    return eventType.startsWith(pattern.slice(0, -1))
  }
  return false
}

function interpolate(template: string, event: MapEvent): string {
  return template
    .replace(/\{\{type\}\}/g, event.type)
    .replace(/\{\{ts\}\}/g, event.ts)
    .replace(/\{\{source\}\}/g, event.source ?? "unknown")
    .replace(/\{\{data\.(\w+)\}\}/g, (_match, key) => {
      return String(event.data?.[key] ?? "")
    })
}

function defaultRoutes(): EventRoute[] {
  return [
    {
      pattern: "eval:scored",
      action: "steer",
      messageTemplate: "SYSTEM EVENT: Eval scored. Agent={{data.agent}}, composite={{data.composite}}, delta={{data.delta}}. If delta is negative, investigate the regression before continuing.",
      condition: (e) => {
        const delta = Number(e.data?.delta ?? 0)
        return delta < 0
      },
    },
    {
      pattern: "telemetry:insight",
      action: "follow_up",
      messageTemplate: "SYSTEM EVENT: Telemetry insight detected — type={{data.insightType}}, severity={{data.severity}}. Details: {{data.message}}. Assess whether this affects your current task.",
      condition: (e) => e.data?.severity === "high",
    },
    {
      pattern: "review:findings",
      action: "steer",
      messageTemplate: "SYSTEM EVENT: AI review found blockers. Severity: {{data.maxSeverity}}. Findings: {{data.summary}}. Address red findings before continuing.",
      condition: (e) => e.data?.maxSeverity === "red",
    },
  ]
}
