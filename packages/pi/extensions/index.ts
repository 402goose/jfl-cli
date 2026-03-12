/**
 * JFL Pi Extension — Master Entry (Factory Function)
 *
 * Pi loads this as a factory: export default async function(pi: ExtensionAPI).
 * We construct a PiContext shim exposing full Pi TUI capabilities to all
 * JFL sub-extensions: overlays, custom footer, shortcuts, tool rendering,
 * interactive dialogs, notifications, state persistence, and more.
 *
 * @purpose Master entry point for @jfl/pi — full TUI-powered extension
 */

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import type { PiContext, JflConfig, JflToolDef, JflCommandDef, PiTheme } from "./types.js"
import { setupSession, onShutdown } from "./session.js"
import { setupContext, injectContext } from "./context.js"
import { setupJournal, checkJournalBeforeCompact, onJournalAgentEnd, onToolExecutionEnd } from "./journal.js"
import { setupMapBridge, onMapBridgeShutdown, onMapToolEnd } from "./map-bridge.js"
import { setupEval, onAgentEnd as onEvalEnd } from "./eval.js"
import { setupHudTool, updateHudWidget } from "./hud-tool.js"
import { setupCrmTool } from "./crm-tool.js"
import { setupMemoryTool } from "./memory-tool.js"
import { setupSynopsisTool } from "./synopsis-tool.js"
import { initStratusBridge, onAgentStart as onStratusStart, onAgentEnd as onStratusEnd } from "./stratus-bridge.js"
import { setupPeterParker } from "./peter-parker.js"
import { setupPortfolioBridge, onPortfolioShutdown } from "./portfolio-bridge.js"
import { setupAgentGrid } from "./agent-grid.js"
import { setupFooter } from "./footer.js"
import { setupShortcuts } from "./shortcuts.js"
import { setupNotifications } from "./notifications.js"
import { setupBookmarks } from "./bookmarks.js"

function readJflConfig(projectRoot: string): JflConfig {
  const configPath = join(projectRoot, ".jfl", "config.json")
  if (!existsSync(configPath)) return {}
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as JflConfig
  } catch {
    return {}
  }
}

function getProjectName(projectRoot: string, config: JflConfig): string {
  if (config.name) return config.name
  const visionPath = join(projectRoot, "knowledge", "VISION.md")
  if (existsSync(visionPath)) {
    const content = readFileSync(visionPath, "utf-8")
    const match = content.match(/^#\s+(.+)/m)
    if (match) return match[1].trim()
  }
  return projectRoot.split("/").pop() ?? "JFL Project"
}

function getCurrentBranch(root: string): string {
  try {
    return execSync("git branch --show-current", { cwd: root, stdio: ["pipe", "pipe", "ignore"] })
      .toString().trim() || "main"
  } catch {
    return "main"
  }
}

// ─── Pi extension factory function ───────────────────────────────────────────

export default async function jflExtension(pi: any): Promise<void> {
  let projectCwd = process.cwd()
  let latestPiCtx: any = null

  const internalHandlers = new Map<string, Array<(data: unknown) => void | Promise<void>>>()

  function jflOn(event: string, handler: (data: unknown) => void | Promise<void>): void {
    const list = internalHandlers.get(event) ?? []
    list.push(handler)
    internalHandlers.set(event, list)
  }

  function jflEmit(event: string, data?: unknown): void {
    const list = internalHandlers.get(event) ?? []
    list.forEach(h => Promise.resolve(h(data)).catch(() => {}))
  }

  // ─── Theme helper ───────────────────────────────────────────────────────────

  function getTheme(): PiTheme {
    if (latestPiCtx?.ui?.theme) return latestPiCtx.ui.theme
    return {
      fg: (_color: string, text: string) => text,
      bg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    }
  }

  // ─── PiContext shim — full TUI capabilities ─────────────────────────────────

  const ctx: PiContext = {
    get session() {
      return {
        projectRoot: projectCwd,
        id: pi.getSessionName?.() ?? "jfl",
        branch: getCurrentBranch(projectCwd),
      }
    },

    log: (msg: string, level?: string) => {
      const prefix = level === "debug" ? "[JFL debug]" : "[JFL]"
      console.log(`${prefix} ${msg}`)
    },

    emit: jflEmit,
    on: jflOn,

    registerTool: (tool: JflToolDef) => {
      pi.registerTool({
        name: tool.name,
        label: tool.label ?? tool.name,
        description: tool.description,
        promptSnippet: tool.promptSnippet,
        promptGuidelines: tool.promptGuidelines,
        parameters: tool.inputSchema,
        async execute(_id: string, params: Record<string, unknown>) {
          try {
            const result = await tool.handler(params)
            return {
              content: [{ type: "text", text: result }],
              details: { raw: result, toolName: tool.name },
            }
          } catch (err) {
            throw new Error(`${err}`)
          }
        },
        renderCall: tool.renderCall
          ? (args: Record<string, any>, theme: PiTheme) => tool.renderCall!(args, theme)
          : undefined,
        renderResult: tool.renderResult
          ? (result: any, options: any, theme: PiTheme) => tool.renderResult!(result, options, theme)
          : undefined,
      })
    },

    registerCommand: (cmd: JflCommandDef) => {
      pi.registerCommand(cmd.name, {
        description: cmd.description,
        handler: async (args: string, piCtx: any) => {
          latestPiCtx = piCtx
          await cmd.handler(args, ctx)
        },
      })
    },

    registerShortcut: (key: string, opts: { description: string; handler: () => Promise<void> | void }) => {
      pi.registerShortcut(key, {
        description: opts.description,
        handler: async (piCtx: any) => {
          latestPiCtx = piCtx
          await opts.handler()
        },
      })
    },

    ui: {
      notify: (msg: string, opts?: { level?: string }) => {
        const type = opts?.level ?? "info"
        if (latestPiCtx?.ui?.notify) {
          latestPiCtx.ui.notify(msg, type)
        } else {
          console.log(`[JFL ${type}] ${msg}`)
        }
      },

      input: async (title: string, placeholder?: string) => {
        if (latestPiCtx?.ui?.input) return latestPiCtx.ui.input(title, placeholder)
        return undefined
      },

      confirm: async (title: string, message: string) => {
        if (latestPiCtx?.ui?.confirm) return latestPiCtx.ui.confirm(title, message)
        return false
      },

      select: async <T extends string>(title: string, items: Array<{ value: T; label: string; description?: string }>) => {
        if (latestPiCtx?.ui?.select) return latestPiCtx.ui.select(title, items)
        return null
      },

      editor: async (title: string, content: string) => {
        if (latestPiCtx?.ui?.editor) return latestPiCtx.ui.editor(title, content)
        return undefined
      },

      custom: async <T>(factory: any, opts?: any) => {
        if (latestPiCtx?.ui?.custom) return latestPiCtx.ui.custom(factory, opts)
        return undefined as T
      },

      setWidget: (id: string, content: any, opts?: { placement?: string }) => {
        if (!latestPiCtx?.ui?.setWidget) return
        if (content === undefined) {
          latestPiCtx.ui.setWidget(id, undefined)
        } else if (typeof content === "function") {
          latestPiCtx.ui.setWidget(id, content, opts)
        } else {
          latestPiCtx.ui.setWidget(id, content, opts)
        }
      },

      setStatus: (key: string, text: string | undefined) => {
        if (latestPiCtx?.ui?.setStatus) latestPiCtx.ui.setStatus(key, text)
      },

      setFooter: (factory: any) => {
        if (latestPiCtx?.ui?.setFooter) latestPiCtx.ui.setFooter(factory)
      },

      setEditorText: (text: string) => {
        if (latestPiCtx?.ui?.setEditorText) latestPiCtx.ui.setEditorText(text)
      },

      get theme(): PiTheme {
        return getTheme()
      },

      get hasUI(): boolean {
        return latestPiCtx?.hasUI ?? false
      },
    },

    pi: {
      setSessionName: (name: string) => pi.setSessionName(name),

      appendEntry: (type: string, data?: unknown) => {
        if (pi.appendEntry) pi.appendEntry(type, data)
      },

      setLabel: (entryId: string, label: string | undefined) => {
        if (pi.setLabel) pi.setLabel(entryId, label)
      },

      sendMessage: (msg: any, opts?: any) => {
        if (pi.sendMessage) pi.sendMessage(msg, opts)
      },

      events: {
        on: (event: string, handler: (data: unknown) => void) => {
          if (pi.events?.on) pi.events.on(event, handler)
        },
        emit: (event: string, data?: unknown) => {
          if (pi.events?.emit) pi.events.emit(event, data)
        },
      },

      getActiveTools: () => pi.getActiveTools?.() ?? [],
      getAllTools: () => pi.getAllTools?.() ?? [],

      exec: async (command: string, args: string[], opts?: any) => {
        if (pi.exec) return pi.exec(command, args, opts)
        return { stdout: "", stderr: "exec unavailable", code: 1 }
      },

      get sessionManager() { return latestPiCtx?.sessionManager },
      get model() { return latestPiCtx?.model },
    },

    cancel: () => ({ cancel: true as const }),
  }

  // ─── Session tracking state ────────────────────────────────────────────────

  let turnCount = 0
  let sessionStartTime = Date.now()
  let currentModel = ""

  // ─── Lifecycle handlers ────────────────────────────────────────────────────

  pi.on("session_start", async (_event: unknown, piCtx: any) => {
    latestPiCtx = piCtx
    projectCwd = piCtx.cwd
    turnCount = 0
    sessionStartTime = Date.now()
    currentModel = piCtx.model?.id ?? ""

    const config = readJflConfig(projectCwd)
    const projectName = getProjectName(projectCwd, config)

    pi.setSessionName(`JFL: ${projectName}`)

    await setupMapBridge(ctx, config)
    await setupSession(ctx, config)
    await setupContext(ctx, config)
    await setupJournal(ctx, config)
    await setupEval(ctx, config)

    setupHudTool(ctx)
    setupCrmTool(ctx)
    setupMemoryTool(ctx)
    setupSynopsisTool(ctx)

    initStratusBridge(projectCwd)
    await setupPeterParker(ctx, config)
    await setupPortfolioBridge(ctx, config)
    setupAgentGrid(ctx)

    setupFooter(ctx, config, { turnCount: () => turnCount, sessionStart: () => sessionStartTime, model: () => currentModel })
    if (!config.pi?.disable_shortcuts) setupShortcuts(ctx, config)
    if (!config.pi?.disable_notifications) setupNotifications(ctx, config)
    setupBookmarks(ctx)

    ctx.log(`JFL: ${projectName} — session ready`)

    if (config.pi?.auto_start !== false && pi.sendUserMessage) {
      setTimeout(() => {
        pi.sendUserMessage(
          `JFL session started in "${projectName}". Use the jfl_context tool to read recent project context, then show a brief status update with current focus and any blocking issues.`
        )
      }, 500)
    }
  })

  pi.on("session_shutdown", async (_event: unknown, piCtx: any) => {
    latestPiCtx = piCtx
    await onPortfolioShutdown(ctx)
    await onShutdown(ctx)
    await onMapBridgeShutdown(ctx)
  })

  pi.on("session_before_compact", async (_event: unknown, piCtx: any) => {
    latestPiCtx = piCtx
    return checkJournalBeforeCompact(ctx)
  })

  pi.on("before_agent_start", async (event: any, piCtx: any) => {
    latestPiCtx = piCtx
    const result = await injectContext(ctx, event)
    if (result?.systemPromptAddition) {
      const current = piCtx.getSystemPrompt?.() ?? ""
      return {
        systemPrompt: current
          ? `${current}\n\n${result.systemPromptAddition}`
          : result.systemPromptAddition,
      }
    }
  })

  pi.on("agent_start", async (event: any, piCtx: any) => {
    latestPiCtx = piCtx
    await onStratusStart(ctx, event)
    jflEmit("agent:start", event)
  })

  pi.on("agent_end", async (event: any, piCtx: any) => {
    latestPiCtx = piCtx
    await onStratusEnd(ctx, event)
    await onEvalEnd(ctx, event)
    await updateHudWidget(ctx)
    await onJournalAgentEnd(ctx, event)
    jflEmit("agent:end", event)
  })

  pi.on("turn_start", async (event: any, piCtx: any) => {
    latestPiCtx = piCtx
    turnCount++
    jflEmit("turn:start", { ...event, turnCount })
  })

  pi.on("turn_end", async (event: any, piCtx: any) => {
    latestPiCtx = piCtx
    jflEmit("turn:end", { ...event, turnCount })
  })

  pi.on("tool_execution_end", async (event: any, piCtx: any) => {
    latestPiCtx = piCtx
    await onToolExecutionEnd(ctx, event)
    await onMapToolEnd(ctx, event)
  })

  pi.on("model_select", async (event: any, piCtx: any) => {
    latestPiCtx = piCtx
    currentModel = event.model?.id ?? ""
    jflEmit("model:changed", event)
  })
}
