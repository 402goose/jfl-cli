/**
 * Peter Parker Event Bridge
 *
 * Connects ralph-tui's WebSocket (port 7890 via --listen) to the MAP event bus.
 * Maps ralph events into MAP's unified event stream via Context Hub HTTP API.
 *
 * @purpose Bridge ralph-tui WebSocket events to MAP event bus via Context Hub
 */

import WebSocket from "ws"
import type { MAPEventType } from "../types/map.js"

const RALPH_EVENT_MAP: Record<string, MAPEventType> = {
  "engine:started": "peter:started",
  "task:selected": "peter:task-selected",
  "task:completed": "peter:task-completed",
  "all:complete": "peter:all-complete",
  "task:failed": "task:failed",
}

interface BridgeOptions {
  ralphPort?: number
  contextHubUrl: string
  authToken: string
  onEvent?: (event: { type: string; data: Record<string, unknown> }) => void
}

export class PeterParkerBridge {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private stopped = false
  private options: BridgeOptions

  constructor(options: BridgeOptions) {
    this.options = options
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private connect(): void {
    if (this.stopped) return

    const port = this.options.ralphPort ?? 7890
    const url = `ws://localhost:${port}`

    try {
      this.ws = new WebSocket(url)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.on("open", () => {
      this.reconnectDelay = 1000
    })

    this.ws.on("message", (data: WebSocket.Data) => {
      try {
        const raw = JSON.parse(data.toString())
        const ralphType = raw.type || raw.event

        if (!ralphType) return

        const mapType = RALPH_EVENT_MAP[ralphType]
        if (!mapType) return

        const eventData = {
          ralphEvent: ralphType,
          ...raw,
        }

        this.publishToContextHub(mapType, eventData)
        this.trackAgentCost(raw)

        if (this.options.onEvent) {
          this.options.onEvent({ type: mapType, data: eventData })
        }
      } catch {
        // Skip malformed messages
      }
    })

    this.ws.on("close", () => {
      this.ws = null
      this.scheduleReconnect()
    })

    this.ws.on("error", () => {
      // Error triggers close event, reconnect handled there
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped) return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)

    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.maxReconnectDelay
    )
  }

  private trackAgentCost(raw: Record<string, any>): void {
    const usage = raw.usage || raw.token_usage
    if (!usage) return

    try {
      import('./telemetry.js').then(({ telemetry }) => {
        import('./model-pricing.js').then(({ estimateCost }) => {
          const model = raw.model || raw.execution_llm || 'unknown'
          const promptTokens = usage.prompt_tokens || usage.input_tokens || 0
          const completionTokens = usage.completion_tokens || usage.output_tokens || 0

          telemetry.track({
            category: 'performance',
            event: 'peter:agent_cost',
            model_name: model,
            agent_role: raw.agent_role || raw.role,
            cost_profile: raw.cost_profile,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
            estimated_cost_usd: estimateCost(model, promptTokens, completionTokens),
          })
        }).catch(() => {})
      }).catch(() => {})
    } catch {
      // fire-and-forget
    }
  }

  private async publishToContextHub(
    type: MAPEventType,
    data: Record<string, unknown>
  ): Promise<void> {
    try {
      await fetch(`${this.options.contextHubUrl}/api/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.authToken}`,
        },
        body: JSON.stringify({
          type,
          source: "peter-parker",
          data,
        }),
      })
    } catch {
      // Non-fatal — Context Hub might be down
    }
  }
}
