/**
 * @purpose Telemetry event type definitions for JFL usage analytics
 */

export interface TelemetryEvent {
  event_id: string
  ts: string
  session_id: string
  install_id: string

  category: 'command' | 'error' | 'context_hub' | 'session' | 'performance' | 'hooks'
  event: string

  jfl_version: string
  node_version: string
  os: string

  command?: string
  subcommand?: string
  duration_ms?: number
  success?: boolean
  error_type?: string
  error_code?: string

  hub_port?: number
  hub_uptime_s?: number
  mcp_tool?: string
  mcp_duration_ms?: number

  session_event?: 'start' | 'end' | 'crash'
  session_duration_s?: number
  ai_cli?: string

  memory_entries_indexed?: number
  memory_index_duration_ms?: number

  endpoint?: string
  method?: string
  status_code?: number
  item_count?: number
  journal_count?: number
  knowledge_count?: number
  code_count?: number
  query_length?: number
  result_count?: number
  has_query?: boolean

  entries_added?: number
  entries_skipped?: number
  entries_errors?: number
  total_entries?: number
  embedding_model?: string

  model_name?: string
  stratus_model?: string
  execution_llm?: string
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  estimated_cost_usd?: number
  stratus_confidence?: number
  planning_time_ms?: number
  execution_time_ms?: number
  feature_context?: string
  agent_role?: string
  cost_profile?: string

  hook_event_name?: string
  tool_name?: string
  has_file_paths?: boolean
  flow_name?: string
  actions_failed?: number
}

export interface TelemetryConfig {
  enabled?: boolean
  install_id?: string
  consent_shown?: boolean
}
