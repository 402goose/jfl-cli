/**
 * Hub API Client
 * @purpose HTTP client for Context Hub API — headless agent access to dashboard data
 * @perf Caches hub config for 5 seconds to avoid repeated filesystem reads
 */

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import * as path from "path"

export interface HubConfig {
  port: number
  token: string
  baseUrl: string
}

// Cache for hub config to avoid repeated filesystem reads
let _hubConfigCache: { config: HubConfig | null; cwd: string; ts: number } | undefined
const HUB_CONFIG_CACHE_TTL_MS = 5000

// Cache for project root lookup
let _projectRootCache: { root: string; cwd: string } | undefined

function findProjectRoot(cwd?: string): string {
  const startDir = cwd || process.cwd()

  // Return cached result if same cwd
  if (_projectRootCache && _projectRootCache.cwd === startDir) {
    return _projectRootCache.root
  }

  let dir = startDir
  while (dir !== path.dirname(dir)) {
    if (existsSync(join(dir, ".jfl", "config.json")) || existsSync(join(dir, ".jfl"))) {
      _projectRootCache = { root: dir, cwd: startDir }
      return dir
    }
    dir = path.dirname(dir)
  }

  _projectRootCache = { root: startDir, cwd: startDir }
  return startDir
}

export function getHubConfig(cwd?: string): HubConfig | null {
  const effectiveCwd = cwd || process.cwd()
  const now = Date.now()

  // Return cached config if still valid
  if (_hubConfigCache &&
      _hubConfigCache.cwd === effectiveCwd &&
      (now - _hubConfigCache.ts) < HUB_CONFIG_CACHE_TTL_MS) {
    return _hubConfigCache.config
  }

  const root = findProjectRoot(effectiveCwd)
  const portFile = join(root, ".jfl", "context-hub.port")
  const tokenFile = join(root, ".jfl", "context-hub.token")

  if (!existsSync(portFile)) {
    _hubConfigCache = { config: null, cwd: effectiveCwd, ts: now }
    return null
  }

  const port = parseInt(readFileSync(portFile, "utf-8").trim(), 10)
  if (isNaN(port)) {
    _hubConfigCache = { config: null, cwd: effectiveCwd, ts: now }
    return null
  }

  const token = existsSync(tokenFile) ? readFileSync(tokenFile, "utf-8").trim() : ""

  const config = { port, token, baseUrl: `http://localhost:${port}` }
  _hubConfigCache = { config, cwd: effectiveCwd, ts: now }
  return config
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
