import { EventEmitter } from "events"
import type { PiRpcBridge } from "./bridge.js"

interface StratusGateOptions {
  apiKey?: string
  apiUrl?: string
  threshold?: number
  enabled?: boolean
}

interface RolloutResult {
  predicted_delta: number
  confidence: number
  recommendation: string
}

export class StratusGate extends EventEmitter {
  private apiKey: string
  private apiUrl: string
  private threshold: number
  private enabled: boolean

  constructor(options: StratusGateOptions = {}) {
    super()
    this.apiKey = options.apiKey ?? process.env.STRATUS_API_KEY ?? ""
    this.apiUrl = options.apiUrl ?? "https://api.stratus.run"
    this.threshold = options.threshold ?? -0.05
    this.enabled = options.enabled ?? !!this.apiKey
  }

  get isEnabled(): boolean { return this.enabled && !!this.apiKey }

  async evaluate(proposal: string, context?: string): Promise<{ allow: boolean; prediction?: RolloutResult }> {
    if (!this.isEnabled) return { allow: true }

    try {
      const resp = await fetch(`${this.apiUrl}/v1/rollout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          proposal,
          context: context ?? "",
          type: "prompt_filter",
        }),
        signal: AbortSignal.timeout(5000),
      })

      if (!resp.ok) {
        this.emit("error", new Error(`Stratus API: ${resp.status}`))
        return { allow: true }
      }

      const result = await resp.json() as RolloutResult

      this.emit("prediction", { proposal, result })

      if (result.predicted_delta < this.threshold && result.confidence > 0.6) {
        this.emit("blocked", { proposal, result })
        return { allow: false, prediction: result }
      }

      return { allow: true, prediction: result }
    } catch (err) {
      this.emit("error", err)
      return { allow: true }
    }
  }

  async gatedPrompt(bridge: PiRpcBridge, message: string, context?: string): Promise<void> {
    const { allow, prediction } = await this.evaluate(message, context)

    if (!allow && prediction) {
      await bridge.steer(
        `STRATUS GATE: Predicted eval delta ${prediction.predicted_delta.toFixed(3)} ` +
        `(confidence ${(prediction.confidence * 100).toFixed(0)}%). ` +
        `Recommendation: ${prediction.recommendation}. ` +
        `Reconsider your approach before proceeding.`
      )
      return
    }

    await bridge.prompt(message)
  }
}
