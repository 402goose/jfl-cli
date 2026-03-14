import { EventEmitter } from "events"
import { PiRpcBridge } from "./bridge.js"
import type { BridgeOptions, ExperimentConfig, ExperimentResult, SessionStats } from "./types.js"

export class ExperimentRunner extends EventEmitter {
  private bridgeOptions: BridgeOptions

  constructor(bridgeOptions: BridgeOptions) {
    super()
    this.bridgeOptions = { ...bridgeOptions, noSession: true }
  }

  async run(config: ExperimentConfig): Promise<ExperimentResult[]> {
    const results: ExperimentResult[] = []

    for (const variant of config.variants) {
      this.emit("variant_start", { variant, total: config.variants.length, current: results.length + 1 })

      const bridge = new PiRpcBridge(this.bridgeOptions)
      await bridge.start()

      let fullResponse = ""

      bridge.on("message_update", (event: any) => {
        const delta = event.assistantMessageEvent
        if (delta?.type === "text_delta" && delta.delta) {
          fullResponse += delta.delta
        }
      })

      const agentEndPromise = new Promise<void>((resolve) => {
        bridge.on("agent_end", () => resolve())
      })

      const prompt = `${config.basePrompt}\n\nApproach: ${variant}`
      await bridge.prompt(prompt)
      await agentEndPromise

      if (!fullResponse) {
        fullResponse = await bridge.getLastAssistantText() ?? ""
      }

      let stats: SessionStats | undefined
      try {
        const statsResp = await bridge.getSessionStats()
        if (statsResp.success) stats = statsResp.data as SessionStats
      } catch {}

      const result: ExperimentResult = {
        variant,
        response: fullResponse,
        stats,
      }

      if (config.evalPrompt) {
        result.score = await this.scoreVariant(bridge, config.evalPrompt, variant, fullResponse)
      }

      results.push(result)
      this.emit("variant_end", { variant, result })

      await bridge.shutdown()
    }

    results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))

    this.emit("complete", { results, winner: results[0] })

    return results
  }

  private async scoreVariant(bridge: PiRpcBridge, evalPrompt: string, variant: string, response: string): Promise<number> {
    const scoringPrompt = [
      evalPrompt,
      `\nVariant: ${variant}`,
      `\nResponse:\n${response.slice(0, 4000)}`,
      "\nRespond with ONLY a JSON object: {\"score\": <number 0-100>, \"reasoning\": \"<brief>\"}",
    ].join("")

    await bridge.newSession()

    let scoreResponse = ""
    bridge.on("message_update", (event: any) => {
      const delta = event.assistantMessageEvent
      if (delta?.type === "text_delta" && delta.delta) {
        scoreResponse += delta.delta
      }
    })

    const endPromise = new Promise<void>((resolve) => {
      bridge.on("agent_end", () => resolve())
    })

    await bridge.prompt(scoringPrompt)
    await endPromise

    try {
      const jsonMatch = scoreResponse.match(/\{[^}]*"score"\s*:\s*(\d+(?:\.\d+)?)[^}]*\}/)
      if (jsonMatch?.[1]) return parseFloat(jsonMatch[1])
    } catch {}

    return 0
  }
}
