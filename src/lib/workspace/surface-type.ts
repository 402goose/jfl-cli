/**
 * @purpose Abstract base class for workspace surface types — defines command, sidebar, and notification contract
 */

import type { StatusEntry } from "./backend.js"

export interface SurfaceContext {
  projectRoot: string
  surfaceId: string
  serviceName?: string
  agentName?: string
}

export interface LiveData {
  hubEvents?: HubEventSnapshot
  evalData?: EvalSnapshot
  flowData?: FlowSnapshot
  serviceData?: ServiceSnapshot
  agentData?: AgentSnapshot
  telemetryData?: TelemetrySnapshot
}

export interface HubEventSnapshot {
  count24h: number
  topTypes: Array<{ type: string; count: number }>
  recentErrors: Array<{ ts: string; type: string; message?: string }>
}

export interface EvalSnapshot {
  latestComposite: number
  previousComposite: number
  delta: number
  trend: "up" | "down" | "flat"
  agentScores: Array<{ agent: string; composite: number }>
}

export interface FlowSnapshot {
  activeCount: number
  gatedCount: number
  recentFailures: number
  needsApproval: string[]
}

export interface ServiceSnapshot {
  health: "healthy" | "degraded" | "unhealthy" | "unknown"
  uptime?: string
  lastEvent?: string
  errorRate?: number
}

export interface AgentSnapshot {
  metric: string
  score: number
  round: number
  explorationRate: number
  status: "running" | "idle" | "error"
}

export interface TelemetrySnapshot {
  errorRate: number
  costToday: number
  commandCount: number
  anomalies: string[]
}

export interface NotificationRule {
  event: string
  condition?: (data: LiveData) => boolean
  title: string
  body?: (data: LiveData) => string
  urgency?: "low" | "normal" | "critical"
}

export abstract class SurfaceType {
  abstract readonly type: string
  abstract readonly title: string
  abstract readonly description: string

  abstract getCommand(ctx: SurfaceContext): string
  abstract getStatusEntries(ctx: SurfaceContext, data: LiveData): StatusEntry[]
  abstract getNotificationRules(): NotificationRule[]

  getUpdateInterval(): number {
    return 5000
  }
}
