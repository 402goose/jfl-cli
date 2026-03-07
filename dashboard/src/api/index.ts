import { apiFetch } from "./client"

export interface WorkspaceStatus {
  status: string
  port: number
  type: "portfolio" | "gtm" | "service" | "standalone"
  config: {
    name: string
    type: string
    description?: string
    registered_services?: ServiceRegistration[]
    openclaw_agents?: OpenclawAgent[]
    gtm_parent?: string | null
    portfolio_parent?: string | null
  }
  sources: Record<string, boolean>
  itemCount: number
  children?: ChildHub[]
}

export interface OpenclawAgent {
  id: string
  runtime: string
  registered_at?: string
}

export interface ChildHub {
  name: string
  port: number
  status: "ok" | "error" | "down"
}

export interface ServiceRegistration {
  name: string
  path?: string
  type?: string
  status?: string
  context_scope?: {
    produces?: string[]
    consumes?: string[]
    denied?: string[]
  }
}

export interface GlobalServiceAgent {
  name: string
  type: string
  description: string
  path?: string
  status: string
  port?: number
  mcp?: { enabled: boolean; transport?: string }
}

export interface EvalAgent {
  agent: string
  composite: number | null
  metrics: Record<string, number>
  delta: number | null
  model_version: string | null
  lastTs: string
  trajectory: number[]
}

export interface TrajectoryPoint {
  ts: string
  value: number
  model_version?: string
}

export interface HubEvent {
  id: string
  type: string
  source: string
  data: Record<string, unknown>
  ts: string
}

export interface JournalEntry {
  v?: number
  ts: string
  timestamp?: string
  session?: string
  type: string
  status?: string
  title: string
  summary?: string
  content?: string
  detail?: string
  files?: string[]
  decision?: string
  incomplete?: string[]
  next?: string
  learned?: string[]
  source?: string
  path?: string
}

export interface ContextItem {
  source: string
  type: string
  title: string
  content: string
  timestamp: string
  path?: string
}

export interface DiscoveredService {
  name: string
  type?: string
  description?: string
  path?: string
  status?: string
}

export interface ProjectHealth {
  name: string
  path: string
  port: number
  status: string
  pid?: number
}

export interface FlowDef {
  name: string
  trigger: string
  description?: string
}

export interface FlowExecution {
  flow: string
  trigger_event_id: string
  status: string
  started_at: string
  completed_at?: string
}

export interface MemoryStatus {
  total_memories: number
  by_type: Record<string, number>
  date_range: { earliest: string; latest: string }
  embeddings: { available: boolean; count: number }
  last_index: string
}

export const api = {
  status: () => apiFetch<WorkspaceStatus>("/api/context/status"),

  events: (limit = 50, pattern?: string) => {
    let url = `/api/events?limit=${limit}`
    if (pattern) url += `&pattern=${encodeURIComponent(pattern)}`
    return apiFetch<{ events: HubEvent[] }>(url)
  },

  leaderboard: () => apiFetch<EvalAgent[]>("/api/eval/leaderboard"),

  trajectory: (agent: string, metric = "composite") =>
    apiFetch<{ agent: string; metric: string; points: TrajectoryPoint[] }>(
      `/api/eval/trajectory?agent=${encodeURIComponent(agent)}&metric=${metric}`,
    ),

  journal: () =>
    apiFetch<{ items: ContextItem[] }>("/api/context", { method: "POST", body: JSON.stringify({}) })
      .then((data) => data.items || []),

  search: (query: string) =>
    apiFetch<{ results: unknown[] }>(`/api/context/search?q=${encodeURIComponent(query)}`),

  services: () => apiFetch<Record<string, DiscoveredService>>("/api/services"),

  projects: () => apiFetch<ProjectHealth[]>("/api/projects"),

  flows: () => apiFetch<FlowDef[]>("/api/flows"),

  flowExecutions: () => apiFetch<FlowExecution[]>("/api/flows/executions"),

  memoryStatus: () => apiFetch<MemoryStatus>("/api/memory/status"),

  memorySearch: (query: string, type?: string) => {
    const body: Record<string, unknown> = { query }
    if (type && type !== "all") body.type = type
    return apiFetch<{ results: unknown[] }>("/api/memory/search", {
      method: "POST",
      body: JSON.stringify(body),
    })
  },
}
