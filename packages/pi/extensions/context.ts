/**
 * Context Extension
 *
 * Ensures Context Hub is running, injects recent context before each agent turn,
 * and registers the jfl_context tool with custom TUI rendering.
 * Context results show type-colored headers and collapsible sections.
 *
 * @purpose Context Hub integration — inject context, register themed jfl_context tool
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import type { PiContext, JflConfig, AgentStartEvent } from "./types.js"
import { contextRenderCall, contextRenderResult } from "./tool-renderers.js"

let hubBaseUrl = "http://localhost:4242"
let hubToken: string | null = null
let projectRoot = ""

function readToken(root: string): string | null {
  const tokenPath = join(root, ".jfl", "context-hub.token")
  if (existsSync(tokenPath)) {
    return readFileSync(tokenPath, "utf-8").trim()
  }
  return null
}

function getHubUrl(root: string): string {
  // 1. Runtime port file (written by context-hub when it starts)
  const portFile = join(root, ".jfl", "context-hub.port")
  if (existsSync(portFile)) {
    const port = readFileSync(portFile, "utf-8").trim()
    if (port) return `http://localhost:${port}`
  }

  // 2. Project config (static port assignment)
  const configFile = join(root, ".jfl", "config.json")
  if (existsSync(configFile)) {
    try {
      const config = JSON.parse(readFileSync(configFile, "utf-8"))
      const port = config.contextHub?.port
      if (port) return `http://localhost:${port}`
    } catch {}
  }

  return "http://localhost:4242"
}

function refreshHubUrl(): void {
  hubBaseUrl = getHubUrl(projectRoot)
  hubToken = readToken(projectRoot)
}

async function fetchContext(query?: string, limit = 10): Promise<string> {
  // Try current URL first, then refresh and retry once on failure
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const params = new URLSearchParams()
      if (query) params.set("query", query)
      params.set("limit", String(limit))

      const resp = await fetch(`${hubBaseUrl}/api/context?${params}`, {
        headers: hubToken ? { Authorization: `Bearer ${hubToken}` } : {},
        signal: AbortSignal.timeout(5000),
      })

      if (!resp.ok) {
        if (attempt === 0) { refreshHubUrl(); continue }
        return ""
      }

      const data = await resp.json() as { items?: Array<{ content: string; source?: string }> }
      if (!data.items?.length) return ""

      return data.items
        .map((item) => {
          const prefix = item.source ? `[${item.source}] ` : ""
          return `${prefix}${item.content}`
        })
        .join("\n\n")
    } catch {
      if (attempt === 0) { refreshHubUrl(); continue }
      return ""
    }
  }
  return ""
}

export async function setupContext(ctx: PiContext, _config: JflConfig): Promise<void> {
  const root = ctx.session.projectRoot
  projectRoot = root

  // Start Context Hub FIRST, then read the port it wrote
  try {
    execSync("jfl context-hub ensure", { cwd: root, stdio: "pipe", timeout: 15000 })
    ctx.log("Context Hub ensured", "debug")
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.log(`Context Hub ensure failed: ${msg}`, "debug")
  }

  // Now read the port (hub may have written .jfl/context-hub.port during ensure)
  hubBaseUrl = getHubUrl(root)
  hubToken = readToken(root)
  ctx.log(`Context Hub URL: ${hubBaseUrl}`, "debug")

  ctx.registerTool({
    name: "jfl_context",
    description: "Search JFL project context: journal entries, knowledge docs, memory. Use this to look up what happened in previous sessions, project decisions, or any project-specific knowledge.",
    promptSnippet: "Search project context: journals, knowledge docs, decisions",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to find relevant context",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 10)",
        },
      },
      required: ["query"],
    },
    async handler(input) {
      const { query, limit } = input as { query: string; limit?: number }
      const result = await fetchContext(query, limit ?? 10)
      return result || "No relevant context found."
    },
    renderCall: contextRenderCall,
    renderResult: contextRenderResult,
  })
}

export async function injectContext(
  _ctx: PiContext,
  _event: AgentStartEvent
): Promise<{ systemPromptAddition?: string } | void> {
  const context = await fetchContext(undefined, 10)
  if (!context) return

  return {
    systemPromptAddition: [
      "## JFL Project Context",
      "(Recent journal entries and project knowledge — use this to maintain continuity across sessions)",
      "",
      context,
    ].join("\n"),
  }
}
