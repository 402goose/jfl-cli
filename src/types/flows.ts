/**
 * Flow Definition Types
 *
 * Declarative flow system — "Zapier for context". When an event matches
 * a trigger pattern, execute a sequence of actions.
 *
 * @purpose Type definitions for the declarative flow engine
 */

export interface FlowTrigger {
  pattern: string
  source?: string
  condition?: string
}

export type FlowAction =
  | { type: "log"; message: string }
  | { type: "emit"; event_type: string; data: Record<string, unknown> }
  | { type: "journal"; entry_type: string; title: string; summary: string }
  | { type: "webhook"; url: string; body?: Record<string, unknown> }
  | { type: "command"; command: string; args?: string[] }

export interface FlowDefinition {
  name: string
  description?: string
  enabled: boolean
  trigger: FlowTrigger
  actions: FlowAction[]
}

export interface FlowsConfig {
  flows: FlowDefinition[]
}

export interface FlowExecution {
  flow: string
  trigger_event_id: string
  trigger_event_type: string
  started_at: string
  completed_at?: string
  actions_executed: number
  actions_failed: number
  error?: string
}
