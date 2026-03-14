import { EventEmitter } from "events"
import type { PiRpcBridge } from "./bridge.js"
import type { CostBudgetConfig, SessionStats } from "./types.js"

const DEFAULT_CONFIG: CostBudgetConfig = {
  maxCost: 5.0,
  downgradeModel: { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" },
  downgradeThinkingLevel: "low",
  upgradeModel: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
  upgradeThinkingLevel: "medium",
  criticalKeywords: ["security", "auth", "payment", "migration", "deploy", "production"],
}

export class CostMonitor extends EventEmitter {
  private config: CostBudgetConfig
  private bridges = new Map<string, PiRpcBridge>()
  private costs = new Map<string, number>()
  private downgraded = new Set<string>()

  constructor(config?: Partial<CostBudgetConfig>) {
    super()
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  get totalCost(): number {
    let sum = 0
    for (const c of this.costs.values()) sum += c
    return sum
  }

  get budget(): number { return this.config.maxCost }
  get remaining(): number { return Math.max(0, this.config.maxCost - this.totalCost) }

  registerBridge(name: string, bridge: PiRpcBridge): void {
    this.bridges.set(name, bridge)
    this.costs.set(name, 0)

    bridge.on("agent_end", async () => {
      await this.checkCost(name)
    })
  }

  unregisterBridge(name: string): void {
    this.bridges.delete(name)
    this.costs.delete(name)
    this.downgraded.delete(name)
  }

  async checkCost(agentName: string): Promise<void> {
    const bridge = this.bridges.get(agentName)
    if (!bridge || bridge.exited) return

    try {
      const resp = await bridge.getSessionStats()
      if (!resp.success) return
      const stats = resp.data as SessionStats
      this.costs.set(agentName, stats.cost)

      this.emit("cost_update", {
        agent: agentName,
        cost: stats.cost,
        totalCost: this.totalCost,
        remaining: this.remaining,
      })

      if (this.totalCost >= this.config.maxCost && !this.downgraded.has(agentName)) {
        await this.downgrade(agentName, bridge)
      }
    } catch {
      // agent may have exited
    }
  }

  async checkCriticalPath(agentName: string, promptText: string): Promise<boolean> {
    if (!this.config.criticalKeywords?.length) return false

    const lower = promptText.toLowerCase()
    const isCritical = this.config.criticalKeywords.some(kw => lower.includes(kw))

    if (isCritical && this.downgraded.has(agentName)) {
      const bridge = this.bridges.get(agentName)
      if (bridge && !bridge.exited) {
        await this.upgrade(agentName, bridge)
        return true
      }
    }

    return isCritical
  }

  async checkAll(): Promise<void> {
    for (const name of this.bridges.keys()) {
      await this.checkCost(name)
    }
  }

  private async downgrade(name: string, bridge: PiRpcBridge): Promise<void> {
    const { downgradeModel, downgradeThinkingLevel } = this.config
    if (!downgradeModel) return

    try {
      await bridge.setModel(downgradeModel.provider, downgradeModel.modelId)
      if (downgradeThinkingLevel) {
        await bridge.setThinkingLevel(downgradeThinkingLevel)
      }
      this.downgraded.add(name)

      this.emit("downgrade", {
        agent: name,
        model: downgradeModel.modelId,
        thinking: downgradeThinkingLevel,
        totalCost: this.totalCost,
        budget: this.config.maxCost,
      })
    } catch {
      // model may not be available
    }
  }

  private async upgrade(name: string, bridge: PiRpcBridge): Promise<void> {
    const { upgradeModel, upgradeThinkingLevel } = this.config
    if (!upgradeModel) return

    try {
      await bridge.setModel(upgradeModel.provider, upgradeModel.modelId)
      if (upgradeThinkingLevel) {
        await bridge.setThinkingLevel(upgradeThinkingLevel)
      }
      this.downgraded.delete(name)

      this.emit("upgrade", {
        agent: name,
        model: upgradeModel.modelId,
        thinking: upgradeThinkingLevel,
        reason: "critical_path",
      })
    } catch {
      // model may not be available
    }
  }
}
