/**
 * Pi Extension Type Definitions
 *
 * Type contracts for the Pi AI agent runtime extension API.
 *
 * @purpose Type definitions for @jfl/pi extension hooks and context objects
 */

export interface PiTool {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, {
      type: string
      description: string
      enum?: string[]
    }>
    required?: string[]
  }
  handler: (input: Record<string, unknown>) => Promise<unknown>
}

export interface PiCommand {
  name: string
  description: string
  handler: (args: string, ctx: PiContext) => Promise<void>
}

export interface PiWidget {
  placement: "aboveEditor" | "belowEditor" | "sidebar" | "footer"
  content: string[]
  color?: string
}

export interface PiUI {
  setWidget: (id: string, lines: string[], options?: { placement?: PiWidget["placement"]; color?: string }) => void
  setFooter: (lines: string[]) => void
  custom: (render: (screen: unknown) => void) => void
  editor: (options?: { title?: string; initial?: string }) => Promise<string>
  notify: (message: string, options?: { level?: "info" | "warn" | "error" }) => void
}

export interface PiSession {
  id: string
  branch: string
  projectRoot: string
  startTime: Date
  custom: Record<string, unknown>
}

export interface PiContext {
  pi: {
    setSessionName: (name: string) => void
    applyTheme: (theme: string | Record<string, unknown>) => void
    session: PiSession
    mode: "interactive" | "rpc" | "headless"
    version: string
  }
  ui: PiUI
  session: PiSession
  registerTool: (tool: PiTool) => void
  registerCommand: (command: PiCommand) => void
  emit: (event: string, data?: unknown) => void
  on: (event: string, handler: (data: unknown) => void) => void
  log: (message: string, level?: "debug" | "info" | "warn" | "error") => void
  cancel: () => { cancel: true }
}

export interface AgentStartEvent {
  taskId?: string
  prompt?: string
  model?: string
  tools?: string[]
}

export interface AgentEndEvent {
  taskId?: string
  turnCount?: number
  model?: string
  duration?: number
  filesChanged?: string[]
  toolsUsed?: string[]
  exitReason?: "success" | "error" | "cancelled" | "max_turns"
}

export interface ToolExecutionEvent {
  tool: string
  input?: Record<string, unknown>
  output?: unknown
  duration?: number
  error?: string
}

export interface PiLifecycleHooks {
  session_start?: (ctx: PiContext) => Promise<void>
  session_shutdown?: (ctx: PiContext) => Promise<void>
  session_before_compact?: (ctx: PiContext) => Promise<{ cancel: true } | void>
  before_agent_start?: (ctx: PiContext, event: AgentStartEvent) => Promise<{ systemPromptAddition?: string } | void>
  agent_start?: (ctx: PiContext, event: AgentStartEvent) => Promise<void>
  agent_end?: (ctx: PiContext, event: AgentEndEvent) => Promise<void>
  tool_execution_start?: (ctx: PiContext, event: ToolExecutionEvent) => Promise<void>
  tool_execution_end?: (ctx: PiContext, event: ToolExecutionEvent) => Promise<void>
}

export interface JflConfig {
  name?: string
  type?: "gtm" | "service" | "portfolio"
  setup?: "building-product" | "gtm-only" | "contributor"
  working_branch?: string
  portfolio_parent?: string
  gtm_parent?: string
  context_scope?: {
    produces?: string[]
    consumes?: string[]
    denied?: string[]
  }
  pi?: {
    max_peter_iterations?: number
    enable_stratus?: boolean
    enable_portfolio_sync?: boolean
  }
}
