/**
 * @purpose Agent manifest types and scaffold generator for narrowly-scoped agents
 */

import { stringify as stringifyYaml } from "yaml"

export interface AgentManifest {
  name: string
  version: string
  description: string
  type: "reactive" | "scheduled" | "hybrid"
  triggers: AgentTrigger[]
  capabilities: string[]
  runtime: AgentRuntime
}

export interface AgentTrigger {
  pattern?: string
  schedule?: string
}

export interface AgentRuntime {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
}

export interface AgentPolicy {
  cost_limit_usd: number
  approval_gate: "auto" | "manual"
  allowed_actions: string[]
  blocked_actions: string[]
  max_concurrent: number
  cooldown_seconds: number
}

export function generateManifest(name: string, description?: string): string {
  const manifest: AgentManifest = {
    name,
    version: "0.1.0",
    description: description || `${name} agent`,
    type: "reactive",
    triggers: [
      { pattern: "session:ended" },
    ],
    capabilities: [
      "read_telemetry",
      "write_journal",
    ],
    runtime: {
      command: "claude",
      args: ["-p", `Run ${name} agent tasks`],
      cwd: "{{project_root}}",
    },
  }
  return stringifyYaml(manifest, { lineWidth: 120 })
}

export function generatePolicy(): string {
  const policy: AgentPolicy = {
    cost_limit_usd: 0.50,
    approval_gate: "auto",
    allowed_actions: ["log", "emit", "journal", "command"],
    blocked_actions: ["spawn"],
    max_concurrent: 1,
    cooldown_seconds: 300,
  }
  return JSON.stringify(policy, null, 2)
}

export function generateLifecycle(name: string, triggerPattern: string): string {
  const lifecycle = {
    flows: [
      {
        name: `${name}-trigger`,
        description: `Trigger ${name} agent on matching events`,
        enabled: true,
        trigger: {
          pattern: triggerPattern,
        },
        actions: [
          {
            type: "log",
            message: `[${name}] Triggered by {{type}} from {{source}}`,
          },
          {
            type: "emit",
            event_type: "agent:started",
            data: {
              agent: name,
              trigger_event: "{{id}}",
            },
          },
        ],
      },
    ],
  }
  return stringifyYaml(lifecycle, { lineWidth: 120 })
}

export function parseManifest(content: string): AgentManifest | null {
  try {
    const { parse } = require("yaml")
    return parse(content) as AgentManifest
  } catch {
    return null
  }
}
