/**
 * Context Hub Port Resolution
 *
 * Deterministic per-project port assignment for Context Hub.
 * Prevents port conflicts when multiple JFL projects run simultaneously.
 *
 * Resolution order: env var > config.json > hash-based fallback
 *
 * @purpose Deterministic per-project Context Hub port resolution
 */

import * as fs from "fs"
import * as path from "path"

const PORT_MIN = 4200
const PORT_MAX = 4999
const PORT_RANGE = PORT_MAX - PORT_MIN + 1

/**
 * djb2 hash of a string, mapped to port range 4200-4999
 */
export function computePortFromPath(projectPath: string): number {
  const normalized = path.resolve(projectPath)
  let hash = 5381
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) >>> 0
  }
  return PORT_MIN + (hash % PORT_RANGE)
}

/**
 * Get the Context Hub port for the current project.
 *
 * Resolution order:
 * 1. CONTEXT_HUB_PORT env var
 * 2. .jfl/config.json → contextHub.port
 * 3. Hash-based fallback from project path
 */
export function getProjectPort(root?: string): number {
  // 1. Env var
  const envPort = process.env.CONTEXT_HUB_PORT
  if (envPort) {
    const parsed = parseInt(envPort, 10)
    if (!isNaN(parsed) && parsed > 0) return parsed
  }

  // 2. Config file
  const projectRoot = root || process.cwd()
  const configPath = path.join(projectRoot, ".jfl", "config.json")
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
      if (config.contextHub?.port) {
        return config.contextHub.port
      }
    } catch {
      // Fall through to hash
    }
  }

  // 3. Hash fallback
  return computePortFromPath(projectRoot)
}

/**
 * Get the full Context Hub URL for the current project.
 */
export function getProjectHubUrl(root?: string): string {
  return `http://localhost:${getProjectPort(root)}`
}

/**
 * Persist the computed port into .jfl/config.json and .mcp.json
 * so all tools use the same port.
 */
export function persistProjectPort(root: string): number {
  const port = getProjectPort(root)

  // Write to .jfl/config.json
  const configPath = path.join(root, ".jfl", "config.json")
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
      if (!config.contextHub) config.contextHub = {}
      config.contextHub.port = port
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
    } catch {
      // Non-fatal
    }
  }

  // Write to .mcp.json
  const mcpPath = path.join(root, ".mcp.json")
  try {
    let mcpConfig: any = {}
    if (fs.existsSync(mcpPath)) {
      mcpConfig = JSON.parse(fs.readFileSync(mcpPath, "utf-8"))
    }
    if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {}
    if (!mcpConfig.mcpServers["jfl-context"]) {
      mcpConfig.mcpServers["jfl-context"] = {
        command: "jfl-context-hub-mcp",
        args: [],
        env: {}
      }
    }
    mcpConfig.mcpServers["jfl-context"].env = {
      ...mcpConfig.mcpServers["jfl-context"].env,
      CONTEXT_HUB_URL: `http://localhost:${port}`
    }
    fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + "\n")
  } catch {
    // Non-fatal
  }

  return port
}
