/**
 * JFL Pi Extension Types
 *
 * Defines PiContext — the shim that wraps Pi's real ExtensionAPI for all
 * JFL sub-extensions. The factory in index.ts constructs this shim from the
 * real pi (ExtensionAPI) object and a shared mutable state object.
 *
 * Pi's actual API (from @mariozechner/pi-coding-agent):
 *   - Factory: export default async function(pi: ExtensionAPI)
 *   - Handlers: pi.on(event, (event, ctx: ExtensionContext) => void)
 *   - ctx.cwd = project root
 *   - Commands: handler(args: string, ctx: ExtensionCommandContext)
 *   - Tools: { name, label, description, parameters: TSchema, execute(...) }
 *   - BeforeAgentStartEventResult: { systemPrompt?: string }
 *
 * @purpose Type definitions for JFL Pi extension shim + config
 */

// ─── Tool / Command formats for JFL sub-extensions ───────────────────────────

export interface JflToolDef {
  name: string
  label?: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, { type: string; description?: string; enum?: string[] }>
    required?: string[]
  }
  handler(input: Record<string, unknown>): Promise<string>
}

export interface JflCommandDef {
  name: string
  description?: string
  handler(args: string, ctx: PiContext): Promise<void> | void
}

// ─── PiContext shim — passed to all JFL sub-extensions ───────────────────────

export interface PiContext {
  session: {
    readonly projectRoot: string
    readonly id: string
    readonly branch: string
  }
  /** Log to console. In Pi sessions shown as debug output. */
  log(msg: string, level?: "debug" | "info" | "warn" | "error"): void
  /** Emit on JFL's internal event bus (not directly to MAP hub). */
  emit(event: string, data?: unknown): void
  /** Subscribe to JFL internal events. */
  on(event: string, handler: (data: unknown) => void | Promise<void>): void
  registerTool(tool: JflToolDef): void
  registerCommand(cmd: JflCommandDef): void
  ui: {
    notify(msg: string, opts?: { level?: "info" | "warn" | "error" }): void
    input(title: string, placeholder?: string): Promise<string | undefined>
    setWidget(placement: "aboveEditor" | "belowEditor", lines: string[], opts?: unknown): void
    setStatus(key: string, text: string | undefined): void
  }
  pi: {
    setSessionName(name: string): void
    applyTheme(name: string): void
  }
  /** Used by journal.ts to cancel context compaction if no journal entry exists. */
  cancel(): { cancel: true }
}

// ─── Pi event shapes ──────────────────────────────────────────────────────────

export interface AgentStartEvent {
  prompt?: string
  model?: string
}

export interface AgentEndEvent {
  /** Pi provides the full messages array */
  messages?: unknown[]
  /** Legacy fields (may not be present in Pi) */
  turnCount?: number
  model?: string
  duration?: number
  filesChanged?: string[]
  toolsUsed?: string[]
  exitReason?: "success" | "error" | "cancelled" | "max_turns"
}

export interface ToolExecutionEvent {
  /** Pi uses toolName */
  toolName?: string
  /** Legacy compat */
  tool?: string
  result?: unknown
  isError?: boolean
  duration?: number
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
  }
}
