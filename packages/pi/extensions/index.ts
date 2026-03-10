/**
 * JFL Pi Extension — Master Entry
 *
 * Auto-discovered by Pi via the pi-package keyword in package.json.
 * Wires all JFL sub-extensions and registers the unified lifecycle.
 *
 * @purpose Master entry point for @jfl/pi — composes all sub-extensions
 */

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import type { PiContext, PiLifecycleHooks, JflConfig } from "./types.js"
import { setupSession } from "./session.js"
import { setupContext } from "./context.js"
import { setupJournal } from "./journal.js"
import { setupMapBridge } from "./map-bridge.js"
import { setupEval } from "./eval.js"
import { setupHudTool } from "./hud-tool.js"
import { setupCrmTool } from "./crm-tool.js"
import { setupMemoryTool } from "./memory-tool.js"
import { setupSynopsisTool } from "./synopsis-tool.js"
import { initStratusBridge } from "./stratus-bridge.js"
import { setupPeterParker } from "./peter-parker.js"
import { setupPortfolioBridge } from "./portfolio-bridge.js"
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

export const hooks: PiLifecycleHooks = {
  async session_start(ctx: PiContext) {
    const root = ctx.session.projectRoot
    const config = readJflConfig(root)
    const projectName = getProjectName(root, config)

    ctx.pi.setSessionName(`JFL: ${projectName}`)
    ctx.pi.applyTheme("jfl")

    await setupMapBridge(ctx, config)
    await setupSession(ctx, config)
    await setupContext(ctx, config)
    await setupJournal(ctx, config)
    await setupEval(ctx, config)

    setupHudTool(ctx)
    setupCrmTool(ctx)
    setupMemoryTool(ctx)
    setupSynopsisTool(ctx)

    initStratusBridge(root)
    await setupPeterParker(ctx, config)
    await setupPortfolioBridge(ctx, config)
    setupAgentGrid(ctx)

    ctx.log(`JFL: ${projectName} — session ready`, "info")
  },

  async session_shutdown(ctx: PiContext) {
    const { onPortfolioShutdown } = await import("./portfolio-bridge.js")
    await onPortfolioShutdown(ctx)
    const { onShutdown } = await import("./session.js")
    await onShutdown(ctx)
    const { onMapBridgeShutdown } = await import("./map-bridge.js")
    await onMapBridgeShutdown(ctx)
  },

  async session_before_compact(ctx: PiContext) {
    const { checkJournalBeforeCompact } = await import("./journal.js")
    return checkJournalBeforeCompact(ctx)
  },

  async before_agent_start(ctx: PiContext, event) {
    const { injectContext } = await import("./context.js")
    return injectContext(ctx, event)
  },

  async agent_start(ctx: PiContext, event) {
    const { onAgentStart } = await import("./stratus-bridge.js")
    await onAgentStart(ctx, event)
  },

  async agent_end(ctx: PiContext, event) {
    const { onAgentEnd: onStratusEnd } = await import("./stratus-bridge.js")
    await onStratusEnd(ctx, event)
    const { onAgentEnd: onEvalEnd } = await import("./eval.js")
    await onEvalEnd(ctx, event)
    const { updateHudWidget } = await import("./hud-tool.js")
    await updateHudWidget(ctx)
    const { onJournalAgentEnd } = await import("./journal.js")
    await onJournalAgentEnd(ctx, event)
  },

  async tool_execution_end(ctx: PiContext, event) {
    const { onToolExecutionEnd } = await import("./journal.js")
    await onToolExecutionEnd(ctx, event)
    const { onMapToolEnd } = await import("./map-bridge.js")
    await onMapToolEnd(ctx, event)
  },
}

export default hooks
