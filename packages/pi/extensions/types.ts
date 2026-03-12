/**
 * JFL Pi Extension Types
 *
 * Full type definitions for the JFL Pi extension layer.
 * PiContext wraps Pi's real ExtensionAPI and exposes full TUI capabilities
 * to all JFL sub-extensions.
 *
 * @purpose Type definitions for JFL Pi extension — full TUI + lifecycle access
 */

// ─── Tool / Command formats for JFL sub-extensions ───────────────────────────

export interface JflToolDef {
  name: string
  label?: string
  description: string
  promptSnippet?: string
  promptGuidelines?: string[]
  inputSchema: {
    type: "object"
    properties: Record<string, { type: string; description?: string; enum?: string[] }>
    required?: string[]
  }
  handler(input: Record<string, unknown>): Promise<string>
  renderCall?(args: Record<string, any>, theme: PiTheme): any
  renderResult?(result: any, options: { expanded: boolean; isPartial: boolean }, theme: PiTheme): any
}

export interface JflCommandDef {
  name: string
  description?: string
  handler(args: string, ctx: PiContext): Promise<void> | void
}

// ─── Pi Theme interface (subset we use) ──────────────────────────────────────

export interface PiTheme {
  fg(color: string, text: string): string
  bg(color: string, text: string): string
  bold(text: string): string
}

// ─── Widget factory signature ────────────────────────────────────────────────

export type WidgetFactory = (tui: any, theme: PiTheme) => {
  render: (width: number) => string[]
  invalidate: () => void
}

// ─── PiContext shim — passed to all JFL sub-extensions ───────────────────────

export interface PiContext {
  session: {
    readonly projectRoot: string
    readonly id: string
    readonly branch: string
  }

  log(msg: string, level?: "debug" | "info" | "warn" | "error"): void
  emit(event: string, data?: unknown): void
  on(event: string, handler: (data: unknown) => void | Promise<void>): void

  registerTool(tool: JflToolDef): void
  registerCommand(cmd: JflCommandDef): void
  registerShortcut(key: string, opts: { description: string; handler: () => Promise<void> | void }): void

  ui: {
    notify(msg: string, opts?: { level?: "info" | "warn" | "error" | "success" }): void
    input(title: string, placeholder?: string): Promise<string | undefined>
    confirm(title: string, message: string): Promise<boolean>
    select<T extends string>(title: string, items: Array<{ value: T; label: string; description?: string }>): Promise<T | null>
    editor(title: string, content: string): Promise<string | undefined>
    custom<T>(factory: (tui: any, theme: PiTheme, keybindings: any, done: (result: T) => void) => any, opts?: { overlay?: boolean; overlayOptions?: any; onHandle?: (handle: any) => void }): Promise<T>
    setWidget(id: string, content: string[] | WidgetFactory | undefined, opts?: { placement?: "aboveEditor" | "belowEditor" }): void
    setStatus(key: string, text: string | undefined): void
    setFooter(factory: ((tui: any, theme: PiTheme, footerData: any) => any) | undefined): void
    setEditorText(text: string): void
    theme: PiTheme
    hasUI: boolean
  }

  pi: {
    setSessionName(name: string): void
    appendEntry(type: string, data?: unknown): void
    setLabel(entryId: string, label: string | undefined): void
    sendMessage(msg: { customType: string; content: string; display?: boolean; details?: any }, opts?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }): void
    events: { on(event: string, handler: (data: unknown) => void): void; emit(event: string, data?: unknown): void }
    getActiveTools(): string[]
    getAllTools(): Array<{ name: string; description: string }>
    exec(command: string, args: string[], opts?: { signal?: AbortSignal; timeout?: number }): Promise<{ stdout: string; stderr: string; code: number }>
    sessionManager: any
    model: any
  }

  cancel(): { cancel: true }
}

// ─── Pi event shapes ──────────────────────────────────────────────────────────

export interface AgentStartEvent {
  prompt?: string
  model?: string
}

export interface AgentEndEvent {
  messages?: unknown[]
  turnCount?: number
  model?: string
  duration?: number
  filesChanged?: string[]
  toolsUsed?: string[]
  exitReason?: "success" | "error" | "cancelled" | "max_turns"
}

export interface ToolExecutionEvent {
  toolName?: string
  tool?: string
  result?: unknown
  isError?: boolean
  duration?: number
}

export interface TurnStartEvent {
  turnIndex: number
  timestamp: number
}

export interface TurnEndEvent {
  turnIndex: number
  message?: any
  toolResults?: any[]
}

export interface ModelSelectEvent {
  model: { provider: string; id: string }
  previousModel?: { provider: string; id: string }
  source: "set" | "cycle" | "restore"
}

// ─── JFL config ──────────────────────────────────────────────────────────────

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
    disable_footer?: boolean
    disable_shortcuts?: boolean
    disable_notifications?: boolean
    auto_start?: boolean
  }
}
