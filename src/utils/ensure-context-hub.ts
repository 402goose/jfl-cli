import Conf from "conf"
import { contextHubCommand } from "../commands/context-hub.js"
import { getProjectPort } from "./context-hub-port.js"

const config = new Conf({ projectName: "jfl" })

interface ContextHubConfig {
  mode?: "global" | "per-project"
  port?: number
  autoStart?: boolean
}

/**
 * Check if context-hub is healthy by pinging health endpoint
 */
async function isContextHubHealthy(port: number): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)

    const response = await fetch(`http://localhost:${port}/health`, {
      signal: controller.signal
    })

    clearTimeout(timeoutId)
    return response.ok
  } catch {
    return false
  }
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
  const port = contextHubConfig?.port ?? getProjectPort()

  try {
    // First check if it's already running AND healthy
    const healthy = await isContextHubHealthy(port)
    if (healthy) {
      // Already running and responding - nothing to do
      return
    }

    // Not healthy - ensure it's running (will clean up orphaned processes if needed)
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
    port: getProjectPort(),
    autoStart: true
  }
}

/**
 * Set context-hub configuration
 */
export function setContextHubConfig(cfg: ContextHubConfig): void {
  config.set("contextHub", cfg)
}
