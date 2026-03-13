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

export interface EvalEntry {
  v: 1
  ts: string
  agent: string
  run_id: string
  dataset?: string
  model_version?: string
  metrics: Record<string, number>
  composite?: number
  predictions?: Record<string, number>
  delta?: Record<string, number>
  session?: string
  notes?: string
  improved?: boolean
  pr_number?: number
  branch?: string
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
  description?: string
  enabled: boolean
  trigger: { pattern: string; source?: string } | string
  actions: { type: string; message?: string; [key: string]: unknown }[]
  gate?: { requires_approval?: boolean }
}

export interface FlowExecution {
  flow: string
  trigger_event_id: string
  trigger_event_type?: string
  started_at: string
  completed_at?: string
  actions_executed?: number
  actions_failed?: number
  error?: string
  gated?: "time" | "approval"
}

export interface MemoryStatus {
  total_memories: number
  by_type: Record<string, number>
  date_range: { earliest: string; latest: string }
  embeddings: { available: boolean; count: number }
  last_index: string
}

export interface PredictionRecord {
  prediction_id: string
  ts: string
  proposal: { description: string; change_type: string; scope: string }
  input_score: number
  prediction: {
    delta: number
    score: number
    confidence: number
    recommendation: string
    method: string
    brain_goal_proximity: number
  }
  actual: { delta: number; score: number; eval_run_id: string; resolved_at: string } | null
  accuracy: { delta_error: number; direction_correct: boolean; calibration: number } | null
}

export interface PredictionAccuracyStats {
  total: number
  resolved: number
  direction_accuracy: number
  mean_delta_error: number
  calibration: number
}

export interface SynopsisData {
  hours: number
  author?: string
  journalEntries: JournalEntry[]
  commits: { hash: string; author: string; date: string; message: string }[]
  fileHeaders: { file: string; purpose: string; spec?: string; decision?: string }[]
  summary: {
    features: number
    fixes: number
    decisions: number
    discoveries: number
    filesModified: number
    incompleteItems: string[]
  }
}

export interface TelemetryDigest {
  periodHours: number
  generatedAt: string
  totalEvents: number
  totalCostUsd: number
  costs: { model: string; calls: number; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd: number }[]
  commands: { command: string; count: number; avgDurationMs: number; successRate: number }[]
  errors: { total: number; byType: Record<string, number> }
  hubHealth: { starts: number; crashes: number; mcpCalls: number; avgMcpLatencyMs: number }
  memoryHealth: { indexRuns: number; entriesIndexed: number; errors: number; avgDurationMs: number }
  sessions: { started: number; ended: number; crashed: number; avgDurationS: number }
  hooks: { received: number; byEvent: Record<string, number>; byTool: Record<string, number>; fileHotspots: string[] }
  flows: { triggered: number; completed: number; failed: number; byFlow: Record<string, { triggered: number; completed: number; failed: number }> }
  suggestions?: { severity: string; message: string; fix?: string }[]
}

export interface TopoNode {
  id: string
  label: string
  type: "agent" | "orchestrator" | "eval" | "service" | "gtm" | "portfolio"
  status: "running" | "idle" | "stopped"
  eventCount?: number
  produces?: string[]
  consumes?: string[]
  children?: string[] // For portfolio/GTM nodes
  parent?: string // For services under a GTM
}

export interface TopoEdge {
  id: string
  source: string
  target: string
  eventType: string
  category: "data" | "success" | "rl"
  recentEvents?: number // Count of recent events on this edge
}

export interface TopologyHierarchy {
  portfolio?: string
  gtms: Array<{ name: string; port: number; services: string[] }>
}

export interface TopologyData {
  nodes: TopoNode[]
  edges: TopoEdge[]
  hierarchy?: TopologyHierarchy
  workspaceType?: string
  workspaceName?: string
}

export interface AutoresearchStatus {
  running: boolean
  currentRound: number
  totalRounds: number
  baselineComposite: number | null
  proposals: Array<{ rank: number; predicted: number; description: string }>
  dimensions: Record<string, number>
  history: Array<{ round: number; composite: number; delta: number; tests: string }>
  lastUpdate: string | null
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

  approveFlow: (flowName: string, triggerEventId: string) =>
    apiFetch<{ ok: boolean }>(`/api/flows/${encodeURIComponent(flowName)}/approve`, {
      method: "POST",
      body: JSON.stringify({ trigger_event_id: triggerEventId }),
    }),

  memoryStatus: () => apiFetch<MemoryStatus>("/api/memory/status"),

  memorySearch: (query: string, type?: string) => {
    const body: Record<string, unknown> = { query }
    if (type && type !== "all") body.type = type
    return apiFetch<{ results: unknown[] }>("/api/memory/search", {
      method: "POST",
      body: JSON.stringify(body),
    })
  },

  publishEvent: (type: string, data: Record<string, unknown>, source = "dashboard") =>
    apiFetch<{ id: string }>("/api/events", {
      method: "POST",
      body: JSON.stringify({ type, source, data }),
    }),

  toggleFlow: (flowName: string, enabled: boolean) =>
    apiFetch<{ ok: boolean; enabled: boolean }>(`/api/flows/${encodeURIComponent(flowName)}/toggle`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),

  spawnAction: (command: string, args: string[], eventType?: string) =>
    apiFetch<{ ok: boolean; pid: number }>("/api/actions/spawn", {
      method: "POST",
      body: JSON.stringify({ command, args, event_type: eventType }),
    }),

  predictions: () =>
    apiFetch<{ accuracy: PredictionAccuracyStats; recent: PredictionRecord[] }>("/api/eval/predictions"),

  synopsis: (hours = 24) =>
    apiFetch<SynopsisData>(`/api/synopsis?hours=${hours}`),

  telemetryDigest: (hours = 168) =>
    apiFetch<TelemetryDigest>(`/api/telemetry/digest?hours=${hours}`),

  telemetryAgentStatus: () =>
    apiFetch<{ running: boolean; lastRun: string; runCount: number; lastInsights: string[] }>("/api/telemetry/agent"),

  telemetryAgentRun: () =>
    apiFetch<{ ok: boolean; insights: unknown[] }>("/api/telemetry/agent/run", { method: "POST" }),

  childSynopsis: async (port: number, hours = 24): Promise<SynopsisData | null> => {
    try {
      const res = await fetch(`http://localhost:${port}/api/synopsis?hours=${hours}`)
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
  },

  topology: () => apiFetch<TopologyData>("/api/v1/topology"),

  autoresearchStatus: () => apiFetch<AutoresearchStatus>("/api/v1/autoresearch/status"),

  evalEntries: (limit = 100) => apiFetch<{ entries: EvalEntry[] }>(`/api/eval/entries?limit=${limit}`),

  // Autoresearch / RL Agent APIs
  rlAgents: () => apiFetch<{ agents: RLAgentConfig[] }>("/api/v1/agents"),
  rlExperiments: (agent?: string) => apiFetch<{ experiments: RLExperiment[]; total: number }>(agent ? `/api/v1/experiments?agent=${agent}` : "/api/v1/experiments"),
  rlSessions: () => apiFetch<{ sessions: RLSession[] }>("/api/v1/sessions"),
  productContext: () => apiFetch<{ context: string | null; updatedAt: string | null }>("/api/v1/product-context"),

  // Findings API
  findings: (refresh = false, includeDismissed = false) => {
    const params = new URLSearchParams()
    if (refresh) params.set("refresh", "true")
    if (includeDismissed) params.set("include_dismissed", "true")
    const query = params.toString()
    return apiFetch<{ findings: Finding[]; total: number }>(`/api/v1/findings${query ? `?${query}` : ""}`)
  },
  dismissFinding: (id: string) =>
    apiFetch<{ ok: boolean; dismissed: string }>(`/api/v1/findings/${encodeURIComponent(id)}/dismiss`, { method: "POST" }),
  spawnFindingAgent: (id: string) =>
    apiFetch<{ ok: boolean; pid: number; finding_id: string }>(`/api/v1/findings/${encodeURIComponent(id)}/spawn`, { method: "POST" }),
  analyzeFindings: () =>
    apiFetch<{ findings: Finding[]; total: number }>("/api/v1/findings/analyze", { method: "POST" }),
}

// Finding types
export type FindingType =
  | "performance_regression"
  | "test_failure"
  | "error_spike"
  | "coverage_gap"
  | "stale_code"
  | "eval_plateau"

export type FindingSeverity = "critical" | "warning" | "info"
export type SuggestedAction = "spawn_agent" | "alert" | "investigate"

export interface AgentConfig {
  metric: string
  target: number
  scope_files: string[]
  rounds: number
  eval_script: string
}

export interface Finding {
  id: string
  type: FindingType
  severity: FindingSeverity
  title: string
  description: string
  metric?: string
  scope_files: string[]
  suggested_action: SuggestedAction
  agent_config?: AgentConfig
  created_at: number
  dismissed: boolean
}

// RL Agent types
export interface RLAgentConfig {
  name: string
  scope: string
  metric: string
  direction: "maximize" | "minimize"
  time_budget_seconds: number
  target_repo?: string
  eval: { script: string; data: string }
  constraints: { files_in_scope: string[]; files_readonly: string[]; max_file_changes: number }
  context_scope: { produces: string[]; consumes: string[] }
}

export interface RLExperiment {
  agent: string
  session_id?: string
  state?: Record<string, unknown>
  action?: { type: string; description: string; scope?: string }
  reward?: number | Record<string, unknown>
  metadata?: Record<string, unknown>
  ts?: string
}

export interface RLSession {
  id: string
  agent: string
  rounds: Array<{
    round: number
    task: string
    baseline: number
    metric: number
    delta: number
    kept: boolean
    duration_ms: number
    error?: string
    timestamp: string
  }>
}
