/**
 * Flow Engine
 *
 * Reactive automation for the MAP event bus. Loads declarative flow
 * definitions and executes actions when trigger patterns match.
 *
 * @purpose Execute declarative flows: event trigger → action sequence
 */

import * as fs from "fs"
import * as path from "path"
import { parse as parseYaml } from "yaml"
import type { MAPEvent, MAPEventType } from "../types/map.js"
import type { MAPEventBus } from "./map-event-bus.js"
import type { FlowDefinition, FlowsConfig, FlowAction, FlowExecution, FlowGate } from "../types/flows.js"
import { telemetry } from "./telemetry.js"

export interface ChildHubInfo {
  name: string
  path: string
  port: number
  token?: string
}

export class FlowEngine {
  private flows: FlowDefinition[] = []
  private eventBus: MAPEventBus
  private projectRoot: string
  private subscriptionIds: string[] = []
  private executions: FlowExecution[] = []
  private maxExecutions = 200
  private children: ChildHubInfo[] = []
  private childAbortControllers: AbortController[] = []
  private cronTimers: ReturnType<typeof setInterval>[] = []

  constructor(eventBus: MAPEventBus, projectRoot: string) {
    this.eventBus = eventBus
    this.projectRoot = projectRoot
  }

  setChildren(children: ChildHubInfo[]): void {
    this.children = children
  }

  async start(): Promise<number> {
    this.flows = this.loadFlows()
    const enabled = this.flows.filter(f => f.enabled)

    for (const flow of enabled) {
      const sub = this.eventBus.subscribe({
        clientId: `flow:${flow.name}`,
        patterns: [flow.trigger.pattern],
        transport: "poll",
        callback: (event) => this.handleEvent(flow, event),
      })
      this.subscriptionIds.push(sub.id)
    }

    if (this.children.length > 0) {
      this.connectToChildren()
    }

    this.startCronEmitters(enabled)

    return enabled.length
  }

  stop(): void {
    for (const id of this.subscriptionIds) {
      this.eventBus.unsubscribe(id)
    }
    this.subscriptionIds = []
    for (const ac of this.childAbortControllers) {
      ac.abort()
    }
    this.childAbortControllers = []
    for (const timer of this.cronTimers) {
      clearInterval(timer)
    }
    this.cronTimers = []
  }

  getFlows(): FlowDefinition[] {
    return [...this.flows]
  }

  getExecutions(): FlowExecution[] {
    return [...this.executions]
  }

  toggleFlow(name: string, enabled?: boolean): FlowDefinition | null {
    const flow = this.flows.find(f => f.name === name)
    if (!flow) return null
    flow.enabled = enabled ?? !flow.enabled

    if (flow.enabled) {
      const existing = this.subscriptionIds.find(id => id.includes(name))
      if (!existing) {
        const sub = this.eventBus.subscribe({
          clientId: `flow:${flow.name}`,
          patterns: [flow.trigger.pattern],
          transport: "poll",
          callback: (event) => this.handleEvent(flow, event),
        })
        this.subscriptionIds.push(sub.id)
      }
    } else {
      const subIdx = this.subscriptionIds.findIndex(id => id.includes(name))
      if (subIdx !== -1) {
        this.eventBus.unsubscribe(this.subscriptionIds[subIdx])
        this.subscriptionIds.splice(subIdx, 1)
      }
    }

    return flow
  }

  async approveGated(flowName: string, triggerEventId: string): Promise<FlowExecution | null> {
    const execIdx = this.executions.findIndex(
      e => e.flow === flowName && e.trigger_event_id === triggerEventId && e.gated
    )
    if (execIdx === -1) return null

    const exec = this.executions[execIdx]
    const flow = this.flows.find(f => f.name === flowName)
    if (!flow) return null

    const busEvents = this.eventBus.getEvents({ limit: 500 })
    const original = busEvents.find((e: any) => e.id === triggerEventId)
    const now = new Date().toISOString()
    const event: MAPEvent = original || {
      id: triggerEventId,
      ts: now,
      type: exec.trigger_event_type as MAPEventType,
      source: `approved:${flowName}`,
      data: {},
    }

    exec.gated = undefined
    exec.started_at = new Date().toISOString()
    exec.actions_executed = 0
    exec.actions_failed = 0
    delete exec.error

    for (const action of flow.actions) {
      try {
        await this.executeAction(action, event, flow)
        exec.actions_executed++
      } catch (err: any) {
        exec.actions_failed++
        exec.error = err.message
      }
    }

    exec.completed_at = new Date().toISOString()

    this.eventBus.emit({
      type: "flow:completed" as MAPEventType,
      source: `flow:${flow.name}`,
      data: {
        flow_name: flow.name,
        approved: true,
        trigger_event_id: triggerEventId,
        actions_executed: exec.actions_executed,
        actions_failed: exec.actions_failed,
      },
    })

    return exec
  }

  private startCronEmitters(enabledFlows: FlowDefinition[]): void {
    const cronPatterns = new Set<string>()
    for (const flow of enabledFlows) {
      if (flow.trigger.pattern.startsWith("cron:")) {
        cronPatterns.add(flow.trigger.pattern)
      }
    }

    if (cronPatterns.size === 0) return

    const cronIntervals: Record<string, number> = {
      "cron:daily": 24 * 60 * 60 * 1000,
      "cron:hourly": 60 * 60 * 1000,
      "cron:every-30-minutes": 30 * 60 * 1000,
    }

    for (const pattern of cronPatterns) {
      const intervalMs = cronIntervals[pattern]
      if (!intervalMs) {
        console.warn(`[FlowEngine] Unknown cron pattern: ${pattern}`)
        continue
      }

      console.log(`[FlowEngine] Cron emitter registered: ${pattern} (every ${intervalMs / 1000}s)`)

      const emitCron = () => {
        this.eventBus.emit({
          type: pattern as MAPEventType,
          source: "cron",
          data: { time: new Date().toISOString(), pattern },
        })
      }

      const timer = setInterval(emitCron, intervalMs)
      this.cronTimers.push(timer)

      // Emit once on startup after a short delay so flows are ready
      setTimeout(emitCron, 5000)
    }
  }

  private connectToChildren(): void {
    for (const child of this.children) {
      const ac = new AbortController()
      this.childAbortControllers.push(ac)
      this.subscribeToChild(child, ac.signal)
    }
  }

  private async subscribeToChild(child: ChildHubInfo, signal: AbortSignal): Promise<void> {
    const url = new URL(`http://localhost:${child.port}/api/events/stream?patterns=*`)
    if (child.token) url.searchParams.set("token", child.token)

    const connect = async () => {
      try {
        const response = await fetch(url.toString(), { signal })
        if (!response.ok || !response.body) return

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (!signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            try {
              const event = JSON.parse(line.slice(6))
              if (event.type?.startsWith("flow:")) continue
              this.eventBus.emit({
                type: event.type as MAPEventType,
                source: `child:${child.name}:${event.source || "unknown"}`,
                session: event.session,
                data: { ...event.data, _child: child.name, _child_port: child.port },
              })
            } catch {
              // skip malformed SSE data
            }
          }
        }
      } catch (err: any) {
        if (signal.aborted) return
        console.warn(`[FlowEngine] Child ${child.name} SSE disconnected: ${err.message}`)
      }

      if (!signal.aborted) {
        setTimeout(() => connect(), 5000)
      }
    }

    connect()
  }

  private loadFlows(): FlowDefinition[] {
    const yamlPath = path.join(this.projectRoot, ".jfl", "flows.yaml")
    const jsonPath = path.join(this.projectRoot, ".jfl", "flows.json")

    let config: FlowsConfig | null = null

    if (fs.existsSync(yamlPath)) {
      try {
        const content = fs.readFileSync(yamlPath, "utf-8")
        config = parseYaml(content) as FlowsConfig
      } catch (err: any) {
        console.error(`[FlowEngine] Failed to parse ${yamlPath}: ${err.message}`)
      }
    } else if (fs.existsSync(jsonPath)) {
      try {
        const content = fs.readFileSync(jsonPath, "utf-8")
        config = JSON.parse(content) as FlowsConfig
      } catch (err: any) {
        console.error(`[FlowEngine] Failed to parse ${jsonPath}: ${err.message}`)
      }
    }

    const allFlows: FlowDefinition[] = []

    if (config?.flows && Array.isArray(config.flows)) {
      const valid = config.flows.filter(f =>
        f.name && f.trigger?.pattern && Array.isArray(f.actions)
      )
      allFlows.push(...valid)
    }

    const flowsDir = path.join(this.projectRoot, ".jfl", "flows")
    if (fs.existsSync(flowsDir)) {
      const yamlFiles = fs.readdirSync(flowsDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"))
      for (const file of yamlFiles) {
        try {
          const content = fs.readFileSync(path.join(flowsDir, file), "utf-8")
          const extra = parseYaml(content) as FlowsConfig
          if (extra?.flows && Array.isArray(extra.flows)) {
            const valid = extra.flows.filter(f => f.name && f.trigger?.pattern && Array.isArray(f.actions))
            allFlows.push(...valid)
          }
        } catch (err: any) {
          console.error(`[FlowEngine] Failed to parse ${file}: ${err.message}`)
        }
      }
    }

    if (allFlows.length === 0) {
      return []
    }

    const valid = allFlows

    for (const flow of valid) {
      if (flow.trigger.condition) {
        const check = FlowEngine.validateCondition(flow.trigger.condition)
        if (!check.valid) {
          console.warn(`[FlowEngine] Flow "${flow.name}": ${check.error}`)
        }
      }
    }

    return valid
  }

  private async handleEvent(flow: FlowDefinition, event: MAPEvent): Promise<void> {
    if (event.type.startsWith("flow:")) return

    if (flow.trigger.source && event.source !== flow.trigger.source) return

    if (flow.trigger.condition && !this.evaluateCondition(flow.trigger.condition, event)) return

    const gateResult = this.evaluateGate(flow.gate)
    if (gateResult) {
      const gatedExecution: FlowExecution = {
        flow: flow.name,
        trigger_event_id: event.id,
        trigger_event_type: event.type,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        actions_executed: 0,
        actions_failed: 0,
        gated: gateResult,
      }
      this.executions.push(gatedExecution)
      if (this.executions.length > this.maxExecutions) {
        this.executions = this.executions.slice(-this.maxExecutions)
      }
      this.eventBus.emit({
        type: "flow:triggered" as MAPEventType,
        source: `flow:${flow.name}`,
        session: event.session,
        data: {
          flow_name: flow.name,
          trigger_event_id: event.id,
          gated: gateResult,
        },
      })
      telemetry.track({
        category: 'hooks',
        event: 'flow:triggered',
        flow_name: flow.name,
        hook_event_name: event.type,
        actions_failed: 0,
      })
      return
    }

    const execution: FlowExecution = {
      flow: flow.name,
      trigger_event_id: event.id,
      trigger_event_type: event.type,
      started_at: new Date().toISOString(),
      actions_executed: 0,
      actions_failed: 0,
    }

    this.eventBus.emit({
      type: "flow:triggered" as MAPEventType,
      source: `flow:${flow.name}`,
      session: event.session,
      data: {
        flow_name: flow.name,
        trigger_event_id: event.id,
        trigger_event_type: event.type,
      },
    })
    telemetry.track({
      category: 'hooks',
      event: 'flow:triggered',
      flow_name: flow.name,
      hook_event_name: event.type,
    })

    for (const action of flow.actions) {
      try {
        await this.executeAction(action, event, flow)
        execution.actions_executed++
      } catch (err: any) {
        execution.actions_failed++
        execution.error = err.message
        console.error(`[FlowEngine] Action failed in flow "${flow.name}": ${err.message}`)
      }
    }

    execution.completed_at = new Date().toISOString()

    this.executions.push(execution)
    if (this.executions.length > this.maxExecutions) {
      this.executions = this.executions.slice(-this.maxExecutions)
    }

    this.eventBus.emit({
      type: "flow:completed" as MAPEventType,
      source: `flow:${flow.name}`,
      session: event.session,
      data: {
        flow_name: flow.name,
        trigger_event_id: event.id,
        actions_executed: execution.actions_executed,
        actions_failed: execution.actions_failed,
        duration_ms: new Date(execution.completed_at).getTime() - new Date(execution.started_at).getTime(),
      },
    })
    telemetry.track({
      category: 'hooks',
      event: 'flow:completed',
      flow_name: flow.name,
      hook_event_name: event.type,
      actions_failed: execution.actions_failed,
      duration_ms: new Date(execution.completed_at!).getTime() - new Date(execution.started_at).getTime(),
    })
  }

  private async executeAction(action: FlowAction, event: MAPEvent, flow: FlowDefinition): Promise<void> {
    switch (action.type) {
      case "log": {
        const message = this.interpolate(action.message, event)
        const ts = new Date().toISOString()
        console.log(`[${ts}] [Flow:${flow.name}] ${message}`)
        break
      }

      case "emit": {
        const data: Record<string, unknown> = {}
        if (action.data) {
          for (const [key, value] of Object.entries(action.data)) {
            data[key] = typeof value === "string" ? this.interpolate(value, event) : value
          }
        }
        this.eventBus.emit({
          type: action.event_type as MAPEventType,
          source: `flow:${flow.name}`,
          session: event.session,
          data,
        })
        break
      }

      case "journal": {
        const journalDir = path.join(this.projectRoot, ".jfl", "journal")
        if (!fs.existsSync(journalDir)) {
          fs.mkdirSync(journalDir, { recursive: true })
        }
        const entry = {
          v: 1,
          ts: new Date().toISOString(),
          session: event.session || "flow-engine",
          type: this.interpolate(action.entry_type, event),
          title: this.interpolate(action.title, event),
          summary: this.interpolate(action.summary, event),
          status: "complete",
        }
        const journalFile = path.join(journalDir, "flow-engine.jsonl")
        fs.appendFileSync(journalFile, JSON.stringify(entry) + "\n")
        break
      }

      case "webhook": {
        const url = this.interpolate(action.url, event)
        const body = action.body ? JSON.stringify(action.body) : JSON.stringify(event.data)
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(10000),
        })
        break
      }

      case "command": {
        const { execSync } = await import("child_process")
        const cmd = this.interpolate(action.command, event)
        const args = (action.args || []).map(a => this.interpolate(a, event))
        execSync([cmd, ...args].join(" "), {
          cwd: this.projectRoot,
          timeout: 30000,
          stdio: "pipe",
        })
        break
      }

      case "spawn": {
        const { spawn: nodeSpawn } = await import("child_process")
        const cmd = this.interpolate(action.command, event)
        const args = (action.args || []).map(a => this.interpolate(a, event))
        const cwd = action.cwd ? this.interpolate(action.cwd, event) : this.projectRoot
        const env: Record<string, string> = { ...process.env as Record<string, string> }
        delete env.CLAUDECODE
        delete env.CLAUDE_CODE
        if (action.env) {
          for (const [k, v] of Object.entries(action.env)) {
            env[k] = this.interpolate(v, event)
          }
        }
        const child = nodeSpawn(cmd, args, {
          cwd,
          env,
          stdio: "ignore",
          detached: action.detach ?? true,
        })
        child.on('error', (err) => {
          console.error(`[FlowEngine] Spawn failed in flow "${flow.name}": ${err.message}`)
        })
        if (action.detach !== false) child.unref()
        break
      }
    }
  }

  private interpolate(template: string, event: MAPEvent): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, varPath: string) => {
      const parts = varPath.split(".")

      if (parts[0] === "child" && parts.length >= 3) {
        const childName = parts[1]
        const field = parts[2]
        const child = this.children.find(c => c.name === childName)
        if (!child) return ""
        if (field === "port") return String(child.port)
        if (field === "path") return child.path
        if (field === "token") return child.token || ""
        if (field === "name") return child.name
        return ""
      }

      let value: any = event
      for (const part of parts) {
        if (value == null) return ""
        value = value[part]
      }
      if (value == null) return ""
      if (typeof value === "object") return JSON.stringify(value)
      return String(value)
    })
  }

  private evaluateGate(gate?: FlowGate): "time" | "approval" | null {
    if (!gate) return null

    const now = new Date()

    if (gate.after) {
      const afterDate = new Date(gate.after)
      if (now < afterDate) return "time"
    }

    if (gate.before) {
      const beforeDate = new Date(gate.before)
      if (now > beforeDate) return "time"
    }

    if (gate.requires_approval) return "approval"

    return null
  }

  private evaluateCondition(condition: string, event: MAPEvent): boolean {
    try {
      const match = condition.match(/^(\w+(?:\.\w+)*)\s*(==|!=|contains)\s*"([^"]*)"$/)
      if (!match) return false

      const [, fieldPath, operator, expected] = match
      const parts = fieldPath.split(".")
      let value: any = event
      for (const part of parts) {
        if (value == null) return false
        value = value[part]
      }

      const strValue = value == null ? "" : String(value)

      switch (operator) {
        case "==": return strValue === expected
        case "!=": return strValue !== expected
        case "contains": return strValue.includes(expected)
        default: return false
      }
    } catch {
      return false
    }
  }

  static validateCondition(condition: string): { valid: boolean; error?: string } {
    const match = condition.match(/^(\w+(?:\.\w+)*)\s*(==|!=|contains)\s*"([^"]*)"$/)
    if (!match) {
      return { valid: false, error: `Invalid condition format: "${condition}". Expected: field operator "value" (operators: ==, !=, contains)` }
    }
    return { valid: true }
  }
}
