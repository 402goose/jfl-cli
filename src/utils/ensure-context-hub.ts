import Conf from "conf"
import { contextHubCommand } from "../commands/context-hub.js"

const config = new Conf({ projectName: "jfl" })

interface ContextHubConfig {
  mode?: "global" | "per-project"
  port?: number
  autoStart?: boolean
}

/**
 * Ensure Context Hub is running
 * Silently starts it if not running, respecting user preferences
 */
export async function ensureContextHub(): Promise<void> {
  const contextHubConfig = config.get("contextHub") as ContextHubConfig | undefined

  // Default: auto-start enabled
  const autoStart = contextHubConfig?.autoStart ?? true
  if (!autoStart) return

  // Default: global mode
  const mode = contextHubConfig?.mode ?? "global"
  const port = contextHubConfig?.port ?? 4242

  try {
    // Silently ensure it's running
    await contextHubCommand("ensure", { port, global: mode === "global" })
  } catch (err) {
    // Silently fail - context-hub is optional infrastructure
    // Don't block the main command if context-hub fails
  }
}

/**
 * Get context-hub configuration
 */
export function getContextHubConfig(): ContextHubConfig {
  return (config.get("contextHub") as ContextHubConfig) || {
    mode: "global",
    port: 4242,
    autoStart: true
  }
}

/**
 * Set context-hub configuration
 */
export function setContextHubConfig(cfg: ContextHubConfig): void {
  config.set("contextHub", cfg)
}
