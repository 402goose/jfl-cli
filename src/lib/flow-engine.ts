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
import type { FlowDefinition, FlowsConfig, FlowAction, FlowExecution } from "../types/flows.js"

export class FlowEngine {
  private flows: FlowDefinition[] = []
  private eventBus: MAPEventBus
  private projectRoot: string
  private subscriptionIds: string[] = []
  private executions: FlowExecution[] = []
  private maxExecutions = 200

  constructor(eventBus: MAPEventBus, projectRoot: string) {
    this.eventBus = eventBus
    this.projectRoot = projectRoot
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

    return enabled.length
  }

  stop(): void {
    for (const id of this.subscriptionIds) {
      this.eventBus.unsubscribe(id)
    }
    this.subscriptionIds = []
  }

  getFlows(): FlowDefinition[] {
    return [...this.flows]
  }

  getExecutions(): FlowExecution[] {
    return [...this.executions]
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

    if (!config?.flows || !Array.isArray(config.flows)) {
      return []
    }

    return config.flows.filter(f =>
      f.name && f.trigger?.pattern && Array.isArray(f.actions)
    )
  }

  private async handleEvent(flow: FlowDefinition, event: MAPEvent): Promise<void> {
    if (event.type.startsWith("flow:")) return

    if (flow.trigger.source && event.source !== flow.trigger.source) return

    if (flow.trigger.condition && !this.evaluateCondition(flow.trigger.condition, event)) return

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
    }
  }

  private interpolate(template: string, event: MAPEvent): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
      const parts = path.split(".")
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

  private evaluateCondition(condition: string, event: MAPEvent): boolean {
    try {
      const match = condition.match(/^(\w+(?:\.\w+)*)\s*(==|!=|contains)\s*"([^"]*)"$/)
      if (!match) return true

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
        default: return true
      }
    } catch {
      return true
    }
  }
}
