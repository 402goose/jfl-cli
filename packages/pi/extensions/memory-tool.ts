/**
 * Memory Tool Extension
 *
 * Registers jfl_memory_search tool that queries Context Hub memory API.
 *
 * @purpose jfl_memory_search tool — semantic memory search via Context Hub
 */

import type { PiContext } from "./types.js"
import { hubUrl, authToken } from "./map-bridge.js"

export function setupMemoryTool(ctx: PiContext): void {
  ctx.registerTool({
    name: "jfl_memory_search",
    description: "Search JFL project memory — find past decisions, learnings, and patterns across all sessions",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to find relevant memories",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 10)",
        },
        type: {
          type: "string",
          description: "Filter by entry type: feature, fix, decision, discovery, milestone, all",
          enum: ["feature", "fix", "decision", "discovery", "milestone", "all"],
        },
      },
      required: ["query"],
    },
    async handler(input) {
      const { query, limit, type } = input as { query: string; limit?: number; type?: string }

      try {
        const params = new URLSearchParams({ query, limit: String(limit ?? 10) })
        if (type && type !== "all") params.set("type", type)

        const resp = await fetch(`${hubUrl}/api/memory/search?${params}`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        })

        if (!resp.ok) return "Memory search unavailable."
        const data = await resp.json() as { results?: Array<{ content: string; title?: string; ts?: string; type?: string }> }

        if (!data.results?.length) return "No memories found."

        return data.results
          .map(r => {
            const header = [r.type && `[${r.type}]`, r.title].filter(Boolean).join(" ")
            return [header, r.content].filter(Boolean).join("\n")
          })
          .join("\n\n---\n\n")
      } catch {
        return "Memory search unavailable — Context Hub may not be running."
      }
    },
  })
}
