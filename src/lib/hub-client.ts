/**
 * Hub API Client
 * @purpose HTTP client for Context Hub API — headless agent access to dashboard data
 */

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import * as path from "path"

export interface HubConfig {
  port: number
  token: string
  baseUrl: string
}

function findProjectRoot(cwd?: string): string {
  let dir = cwd || process.cwd()
  while (dir !== path.dirname(dir)) {
    if (existsSync(join(dir, ".jfl", "config.json")) || existsSync(join(dir, ".jfl"))) {
      return dir
    }
    dir = path.dirname(dir)
  }
  return cwd || process.cwd()
}

export function getHubConfig(cwd?: string): HubConfig | null {
  const root = findProjectRoot(cwd)
  const portFile = join(root, ".jfl", "context-hub.port")
  const tokenFile = join(root, ".jfl", "context-hub.token")

  if (!existsSync(portFile)) return null

  const port = parseInt(readFileSync(portFile, "utf-8").trim(), 10)
  if (isNaN(port)) return null

  const token = existsSync(tokenFile) ? readFileSync(tokenFile, "utf-8").trim() : ""

  return { port, token, baseUrl: `http://localhost:${port}` }
}

export async function hubFetch<T>(path: string, config?: HubConfig): Promise<T> {
  const hub = config || getHubConfig()
  if (!hub) throw new Error("Hub not running — start with: jfl hub start")

  const url = `${hub.baseUrl}${path}`
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (hub.token) headers["Authorization"] = `Bearer ${hub.token}`

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`Hub API error: ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export interface EvalAgent {
  agent: string
  latest_composite: number
  eval_count: number
  model_version?: string
  improvement_rate?: number
  last_eval_ts?: string
  trend?: number[]
}

export interface TrajectoryPoint {
  ts: string
  value: number
  model_version?: string
  run_id?: string
}

export interface TrajectoryResponse {
  agent: string
  metric: string
  points: TrajectoryPoint[]
}

export interface HubFlowDef {
  name: string
  description?: string
  enabled: boolean
  trigger: { pattern: string; source?: string; condition?: string }
  actions: Array<{ type: string; [key: string]: unknown }>
  gate?: { after?: string; before?: string; requires_approval?: boolean }
}

export interface HubFlowExecution {
  flow: string
  trigger_event_id: string
  trigger_event_type: string
  started_at: string
  completed_at?: string
  actions_executed: number
  actions_failed: number
  error?: string
  gated?: "time" | "approval"
}

export interface HubEvent {
  id: string
  type: string
  source: string
  ts: string
  data?: Record<string, unknown>
}

export interface WorkspaceStatus {
  name: string
  port: number
  uptime_ms?: number
  children?: string[]
  sources?: string[]
  item_count?: number
  memory_count?: number
  flow_count?: number
  event_count?: number
}
