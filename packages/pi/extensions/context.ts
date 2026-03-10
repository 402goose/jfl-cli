/**
 * Context Extension
 *
 * Ensures Context Hub is running, injects recent context before each agent turn,
 * and registers the jfl_context tool for in-session queries.
 *
 * @purpose Context Hub integration — inject context into agent turns, register jfl_context tool
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import type { PiContext, JflConfig, AgentStartEvent } from "./types.js"

let hubBaseUrl = "http://localhost:4242"
let hubToken: string | null = null

function readToken(root: string): string | null {
  const tokenPath = join(root, ".jfl", "context-hub.token")
  if (existsSync(tokenPath)) {
    return readFileSync(tokenPath, "utf-8").trim()
  }
  return null
}

function getHubUrl(root: string): string {
  const portFile = join(root, ".jfl", "context-hub.port")
  if (existsSync(portFile)) {
    const port = readFileSync(portFile, "utf-8").trim()
    if (port) return `http://localhost:${port}`
  }
  return "http://localhost:4242"
}

async function fetchContext(query?: string, limit = 10): Promise<string> {
  try {
    const params = new URLSearchParams()
    if (query) params.set("query", query)
    params.set("limit", String(limit))

    const resp = await fetch(`${hubBaseUrl}/api/context?${params}`, {
      headers: hubToken ? { Authorization: `Bearer ${hubToken}` } : {},
    })

    if (!resp.ok) return ""
    const data = await resp.json() as { items?: Array<{ content: string; source?: string }> }
    if (!data.items?.length) return ""

    return data.items
      .map((item) => {
        const prefix = item.source ? `[${item.source}] ` : ""
        return `${prefix}${item.content}`
      })
      .join("\n\n")
  } catch {
    return ""
  }
}

export async function setupContext(ctx: PiContext, _config: JflConfig): Promise<void> {
  const root = ctx.session.projectRoot
  hubToken = readToken(root)
  hubBaseUrl = getHubUrl(root)

  try {
    execSync("jfl context-hub ensure", { cwd: root, stdio: "ignore" })
    ctx.log("Context Hub ensured", "debug")
  } catch {
    ctx.log("Context Hub ensure failed (may already be running)", "debug")
  }

  ctx.registerTool({
    name: "jfl_context",
    description: "Search JFL project context: journal entries, knowledge docs, memory. Use this to look up what happened in previous sessions, project decisions, or any project-specific knowledge.",
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
