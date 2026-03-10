/**
 * JFL Pi Extension — Master Entry (Factory Function)
 *
 * Pi loads this as a factory: export default async function(pi: ExtensionAPI).
 * We construct a PiContext shim from the real Pi API and pass it to all
 * JFL sub-extensions, which register their handlers + tools via the shim.
 *
 * Pi API facts (from @mariozechner/pi-coding-agent source):
 *   - pi.on(event, (event, ctx) => void) — lifecycle handlers
 *   - pi.registerTool({ name, label, description, parameters, execute })
 *   - pi.registerCommand(name, { description, handler(args, ctx) })
 *   - pi.setSessionName(name)
 *   - ctx.cwd = project root (in every handler)
 *   - ctx.ui.notify/input/setWidget/setStatus
 *   - BeforeAgentStartEventResult: { systemPrompt?: string }
 *
 * @purpose Master entry point for @jfl/pi — factory function + shim
 */

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import type { PiContext, JflConfig, JflToolDef, JflCommandDef } from "./types.js"
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
  // Mutable shared state — updated on each handler invocation
  let projectCwd = process.cwd()
  let latestPiCtx: any = null

  // JFL internal event bus (for ctx.on / ctx.emit between sub-extensions)
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

  // ─── PiContext shim ─────────────────────────────────────────────────────────

  const ctx: PiContext = {
    get session() {
      return {
        projectRoot: projectCwd,
        id: pi.getSessionName?.() ?? "jfl",
        branch: getCurrentBranch(projectCwd),
      }
    },

    log: (msg: string) => console.log(`[JFL] ${msg}`),

    emit: jflEmit,
    on: jflOn,

    registerTool: (tool: JflToolDef) => {
      // Adapt JflToolDef → Pi ToolDefinition
      // Pi uses `parameters` (TypeBox-compatible JSON Schema) + `execute`
      pi.registerTool({
        name: tool.name,
        label: tool.label ?? tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        execute: async (_id: string, params: Record<string, unknown>) => {
          try {
            const result = await tool.handler(params)
            return { type: "tool_result", content: String(result) }
          } catch (err) {
            return { type: "tool_result", content: `Error: ${err}`, isError: true }
          }
        },
      })
    },

    registerCommand: (cmd: JflCommandDef) => {
      // Pi commands: handler(args: string, ctx: ExtensionCommandContext)
      // Our JflCommandDef has the same shape — just pass through with shim ctx
      pi.registerCommand(cmd.name, {
        description: cmd.description,
        handler: async (args: string, piCtx: any) => {
          latestPiCtx = piCtx
          await cmd.handler(args, ctx)
        },
      })
    },

    ui: {
      notify: (msg: string, opts?: { level?: "info" | "warn" | "error" }) => {
        const type = opts?.level ?? "info"
        if (latestPiCtx?.ui?.notify) {
          latestPiCtx.ui.notify(msg, type)
        } else {
          console.log(`[JFL ${type}] ${msg}`)
        }
      },
      input: async (title: string, placeholder?: string) => {
        if (latestPiCtx?.ui?.input) {
          return latestPiCtx.ui.input(title, placeholder)
        }
        return undefined
      },
      setWidget: (placement: "aboveEditor" | "belowEditor", lines: string[], opts?: unknown) => {
        if (latestPiCtx?.ui?.setWidget) {
          latestPiCtx.ui.setWidget(placement, lines, opts)
        }
      },
      setStatus: (key: string, text: string | undefined) => {
        if (latestPiCtx?.ui?.setStatus) {
          latestPiCtx.ui.setStatus(key, text)
        }
      },
    },

    pi: {
      setSessionName: (name: string) => pi.setSessionName(name),
      applyTheme: (_name: string) => {
        // Pi themes are set via --theme CLI flag; no runtime API
      },
    },

    cancel: () => ({ cancel: true as const }),
  }

  // ─── Lifecycle handlers ────────────────────────────────────────────────────

  pi.on("session_start", async (_event: unknown, piCtx: any) => {
    latestPiCtx = piCtx
    projectCwd = piCtx.cwd

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

    ctx.log(`JFL: ${projectName} — session ready`)
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
      // BeforeAgentStartEventResult.systemPrompt replaces the system prompt;
      // prepend our additions to the current prompt
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
  })

  pi.on("agent_end", async (event: any, piCtx: any) => {
    latestPiCtx = piCtx
    await onStratusEnd(ctx, event)
    await onEvalEnd(ctx, event)
    await updateHudWidget(ctx)
    await onJournalAgentEnd(ctx, event)
  })

  pi.on("tool_execution_end", async (event: any, piCtx: any) => {
    latestPiCtx = piCtx
    await onToolExecutionEnd(ctx, event)
    await onMapToolEnd(ctx, event)
  })
}
