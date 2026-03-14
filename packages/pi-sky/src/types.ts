import type { ChildProcess } from "child_process"

export interface PiRpcCommand {
  id?: string
  type: string
  [key: string]: unknown
}

export interface PiRpcResponse {
  id?: string
  type: "response"
  command: string
  success: boolean
  data?: unknown
  error?: string
}

export interface PiRpcEvent {
  type: string
  [key: string]: unknown
}

export interface AssistantMessageEvent {
  type: "start" | "text_start" | "text_delta" | "text_end" | "thinking_start" | "thinking_delta" | "thinking_end" | "toolcall_start" | "toolcall_delta" | "toolcall_end" | "done" | "error"
  contentIndex?: number
  delta?: string
  content?: string
  partial?: unknown
  toolCall?: unknown
  reason?: string
}

export interface MessageUpdateEvent extends PiRpcEvent {
  type: "message_update"
  message: unknown
  assistantMessageEvent: AssistantMessageEvent
}

export interface AgentEndEvent extends PiRpcEvent {
  type: "agent_end"
  messages: unknown[]
}

export interface ToolExecutionEvent extends PiRpcEvent {
  type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end"
  toolCallId: string
  toolName: string
  args?: Record<string, unknown>
  result?: unknown
  partialResult?: unknown
  isError?: boolean
}

export interface SessionStats {
  sessionFile: string
  sessionId: string
  userMessages: number
  assistantMessages: number
  toolCalls: number
  toolResults: number
  totalMessages: number
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  cost: number
}

export interface ModelInfo {
  id: string
  name: string
  api: string
  provider: string
  reasoning: boolean
  contextWindow: number
  maxTokens: number
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
}

export interface BridgeOptions {
  extensionPath?: string
  skillsPath?: string
  themePath?: string
  yolo?: boolean
  noSession?: boolean
  sessionDir?: string
  provider?: string
  model?: string
  cwd?: string
  env?: Record<string, string>
}

export interface SwarmAgentConfig {
  name: string
  role: string
  description?: string
  model?: string
  provider?: string
  skills?: string[]
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high"
}

export interface SwarmOptions {
  agents: SwarmAgentConfig[]
  extensionPath?: string
  skillsPath?: string
  themePath?: string
  costBudget?: number
  hubUrl?: string
  yolo?: boolean
}

export interface MapEvent {
  type: string
  ts: string
  data?: Record<string, unknown>
  source?: string
}

export interface CostBudgetConfig {
  maxCost: number
  downgradeModel?: { provider: string; modelId: string }
  downgradeThinkingLevel?: "off" | "minimal" | "low"
  upgradeModel?: { provider: string; modelId: string }
  upgradeThinkingLevel?: "medium" | "high"
  criticalKeywords?: string[]
}

export interface ExperimentConfig {
  basePrompt: string
  variants: string[]
  evalPrompt?: string
}

export interface ExperimentResult {
  variant: string
  response: string
  score?: number
  stats?: SessionStats
}

export type BridgeEventType =
  | "agent_start"
  | "agent_end"
  | "turn_start"
  | "turn_end"
  | "message_start"
  | "message_update"
  | "message_end"
  | "tool_execution_start"
  | "tool_execution_update"
  | "tool_execution_end"
  | "auto_compaction_start"
  | "auto_compaction_end"
  | "auto_retry_start"
  | "auto_retry_end"
  | "extension_error"
  | "extension_ui_request"
  | "raw"
  | "exit"
  | "error"
