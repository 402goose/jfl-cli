/**
 * MAP (Memory Access Protocol) Types
 *
 * Event schema, subscription, and model routing types for the MAP event bus.
 * Everything else imports from here.
 *
 * @purpose Core type definitions for MAP event bus and Peter Parker orchestrator
 */

export type MAPEventType =
  | "session:started" | "session:ended"
  | "task:started" | "task:completed" | "task:failed"
  | "service:healthy" | "service:unhealthy"
  | "peter:started" | "peter:task-selected" | "peter:task-completed" | "peter:all-complete"
  | "openclaw:tag"
  | "journal:entry" | "decision:made"
  | "build:completed" | "deploy:completed"
  | "custom"

export interface MAPEvent {
  id: string
  ts: string
  type: MAPEventType
  source: string
  target?: string
  session?: string
  data: Record<string, unknown>
  ttl?: number
}

export interface MAPSubscription {
  id: string
  clientId: string
  patterns: string[]
  transport: "sse" | "websocket" | "poll"
  createdAt: string
  lastEventId?: string
}

export type ModelTier = "haiku" | "sonnet" | "opus"

export type AgentRole = "scout" | "planner" | "builder" | "reviewer" | "tester"

export type CostProfile = "cost-optimized" | "balanced" | "quality-first"

export const MODEL_ROUTING_TABLE: Record<CostProfile, Record<AgentRole, ModelTier>> = {
  "cost-optimized": {
    scout: "haiku",
    planner: "sonnet",
    builder: "sonnet",
    reviewer: "sonnet",
    tester: "haiku",
  },
  "balanced": {
    scout: "haiku",
    planner: "sonnet",
    builder: "sonnet",
    reviewer: "opus",
    tester: "sonnet",
  },
  "quality-first": {
    scout: "sonnet",
    planner: "opus",
    builder: "sonnet",
    reviewer: "opus",
    tester: "sonnet",
  },
}

export const FALLBACK_ROUTING: Record<AgentRole, ModelTier> = {
  scout: "sonnet",
  planner: "opus",
  builder: "opus",
  reviewer: "opus",
  tester: "sonnet",
}
