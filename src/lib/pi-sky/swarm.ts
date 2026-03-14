import { EventEmitter } from "events"
import { PiRpcBridge } from "./bridge.js"
import { EventRouter } from "./event-router.js"
import { CostMonitor } from "./cost-monitor.js"
import type { SwarmOptions, SwarmAgentConfig, MapEvent } from "./types.js"

interface AgentState {
  name: string
  config: SwarmAgentConfig
  bridge: PiRpcBridge
  streaming: boolean
  turnCount: number
  lastActivity: number
}

export class PiSwarm extends EventEmitter {
  private agents = new Map<string, AgentState>()
  private options: SwarmOptions
  private router: EventRouter | null = null
  private costMonitor: CostMonitor | null = null
  private _started = false

  constructor(options: SwarmOptions) {
    super()
    this.options = options
  }

  get started(): boolean { return this._started }
  get agentNames(): string[] { return [...this.agents.keys()] }
  get agentCount(): number { return this.agents.size }

  getAgent(name: string): PiRpcBridge | undefined {
    return this.agents.get(name)?.bridge
  }

  async start(): Promise<void> {
    if (this._started) throw new Error("Swarm already started")

    if (this.options.hubUrl) {
      this.router = new EventRouter({ hubUrl: this.options.hubUrl })
      this.router.on("route", (data) => this.emit("event_routed", data))
      this.router.on("error", (err) => this.emit("router_error", err))
    }

    if (this.options.costBudget) {
      this.costMonitor = new CostMonitor({ maxCost: this.options.costBudget })
      this.costMonitor.on("downgrade", (data) => this.emit("cost_downgrade", data))
      this.costMonitor.on("upgrade", (data) => this.emit("cost_upgrade", data))
      this.costMonitor.on("cost_update", (data) => this.emit("cost_update", data))
    }

    for (const config of this.options.agents) {
      await this.spawnAgent(config)
    }

    if (this.router) {
      try {
        await this.router.startSse()
      } catch {
        await this.router.startPolling()
      }
    }

    this._started = true
    this.emit("started", { agents: this.agentNames })
  }

  async shutdown(): Promise<void> {
    this.router?.stop()

    const shutdowns = [...this.agents.values()].map(async (agent) => {
      try {
        await agent.bridge.shutdown()
      } catch {}
    })

    await Promise.all(shutdowns)
    this.agents.clear()
    this._started = false
    this.emit("shutdown")
  }

  async prompt(agentName: string, message: string): Promise<void> {
    const agent = this.agents.get(agentName)
    if (!agent) throw new Error(`Agent not found: ${agentName}`)
    if (agent.bridge.exited) throw new Error(`Agent exited: ${agentName}`)

    if (this.costMonitor) {
      await this.costMonitor.checkCriticalPath(agentName, message)
    }

    await agent.bridge.prompt(message)
  }

  async steer(agentName: string, message: string): Promise<void> {
    const agent = this.agents.get(agentName)
    if (!agent) throw new Error(`Agent not found: ${agentName}`)
    await agent.bridge.steer(message)
  }

  async steerAll(message: string): Promise<void> {
    const promises = [...this.agents.values()]
      .filter(a => !a.bridge.exited)
      .map(a => a.bridge.steer(message).catch(() => {}))
    await Promise.all(promises)
  }

  async followUp(agentName: string, message: string): Promise<void> {
    const agent = this.agents.get(agentName)
    if (!agent) throw new Error(`Agent not found: ${agentName}`)
    await agent.bridge.followUp(message)
  }

  async abortAll(): Promise<void> {
    const promises = [...this.agents.values()]
      .filter(a => !a.bridge.exited)
      .map(a => a.bridge.abort().catch(() => {}))
    await Promise.all(promises)
  }

  async getLastAssistantText(agentName: string): Promise<string | null> {
    const agent = this.agents.get(agentName)
    if (!agent) return null
    return agent.bridge.getLastAssistantText()
  }

  async relay(fromAgent: string, toAgent: string, prefix?: string): Promise<void> {
    const text = await this.getLastAssistantText(fromAgent)
    if (!text) throw new Error(`No response from ${fromAgent}`)

    const message = prefix ? `${prefix}\n\n${text}` : text
    await this.prompt(toAgent, message)
  }

  async getStats(): Promise<Record<string, unknown>> {
    const stats: Record<string, unknown> = {}
    for (const [name, agent] of this.agents) {
      try {
        const resp = await agent.bridge.getSessionStats()
        if (resp.success) stats[name] = resp.data
      } catch {
        stats[name] = { error: "unavailable" }
      }
    }
    return stats
  }

  onMapEvent(pattern: string, handler: (event: MapEvent) => Promise<void> | void): void {
    if (!this.router) throw new Error("No hub URL configured — cannot subscribe to MAP events")
    this.router.on("route", async (data: { event: MapEvent }) => {
      if (matchGlob(pattern, data.event.type)) {
        await handler(data.event)
      }
    })
  }

  private async spawnAgent(config: SwarmAgentConfig): Promise<void> {
    const bridge = new PiRpcBridge({
      extensionPath: this.options.extensionPath,
      skillsPath: this.options.skillsPath,
      themePath: this.options.themePath,
      yolo: this.options.yolo ?? true,
      provider: config.provider,
      model: config.model,
      env: {
        JFL_AGENT_NAME: config.name,
        JFL_AGENT_ROLE: config.role,
        JFL_PI_MODE: "1",
      },
    })

    const state: AgentState = {
      name: config.name,
      config,
      bridge,
      streaming: false,
      turnCount: 0,
      lastActivity: Date.now(),
    }

    bridge.on("agent_start", () => {
      state.streaming = true
      state.lastActivity = Date.now()
      this.emit("agent_streaming", { name: config.name, streaming: true })
    })

    bridge.on("agent_end", (event) => {
      state.streaming = false
      state.lastActivity = Date.now()
      this.emit("agent_done", { name: config.name, event })
    })

    bridge.on("turn_start", () => {
      state.turnCount++
      this.emit("agent_turn", { name: config.name, turn: state.turnCount })
    })

    bridge.on("message_update", (event) => {
      state.lastActivity = Date.now()
      this.emit("agent_message", { name: config.name, event })
    })

    bridge.on("tool_execution_start", (event) => {
      this.emit("agent_tool", { name: config.name, event, phase: "start" })
    })

    bridge.on("tool_execution_end", (event) => {
      this.emit("agent_tool", { name: config.name, event, phase: "end" })
    })

    bridge.on("exit", (info) => {
      this.emit("agent_exit", { name: config.name, ...info })
    })

    bridge.on("error", (err) => {
      this.emit("agent_error", { name: config.name, error: err })
    })

    await bridge.start()

    if (config.thinkingLevel) {
      await bridge.setThinkingLevel(config.thinkingLevel)
    }

    this.agents.set(config.name, state)

    if (this.router) {
      this.router.registerBridge(config.name, bridge)
    }

    if (this.costMonitor) {
      this.costMonitor.registerBridge(config.name, bridge)
    }

    this.emit("agent_spawned", { name: config.name, role: config.role, pid: bridge.pid })
  }
}

function matchGlob(pattern: string, value: string): boolean {
  if (pattern === value) return true
  if (pattern === "*") return true
  if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1))
  return false
}
