#!/usr/bin/env node
/**
 * Context Hub MCP Server
 *
 * Provides context tools to Claude Code via MCP protocol.
 * Communicates with the Context Hub daemon via HTTP.
 *
 * @purpose MCP server for Context Hub integration with Claude Code
 */

import * as readline from "readline"

const CONTEXT_HUB_URL = process.env.CONTEXT_HUB_URL || "http://localhost:4242"

// ============================================================================
// Types
// ============================================================================

interface MCPRequest {
  jsonrpc: "2.0"
  id: number | string
  method: string
  params?: any
}

interface MCPResponse {
  jsonrpc: "2.0"
  id: number | string
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

interface ContextItem {
  source: string
  type: string
  title: string
  content: string
  path?: string
  relevance?: number
}

// ============================================================================
// MCP Server Implementation
// ============================================================================

const TOOLS = [
  {
    name: "context_get",
    description: "Get unified context from journal, knowledge docs, and code. Use at the start of tasks to understand the project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Optional search query to filter results"
        },
        taskType: {
          type: "string",
          enum: ["code", "spec", "content", "strategy", "general"],
          description: "Type of task for context prioritization"
        },
        maxItems: {
          type: "number",
          description: "Maximum number of context items to return (default: 30)"
        }
      }
    }
  },
  {
    name: "context_search",
    description: "Search across all context sources (journal, knowledge, code) for relevant information.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query"
        },
        maxItems: {
          type: "number",
          description: "Maximum results (default: 20)"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "context_status",
    description: "Check Context Hub status and available sources.",
    inputSchema: {
      type: "object" as const,
      properties: {}
    }
  },
  {
    name: "context_sessions",
    description: "See activity from other sessions/worktrees (informational only).",
    inputSchema: {
      type: "object" as const,
      properties: {
        hours: {
          type: "number",
          description: "Hours of history to include (default: 24)"
        }
      }
    }
  }
]

async function callContextHub(endpoint: string, body?: any): Promise<any> {
  try {
    const url = `${CONTEXT_HUB_URL}${endpoint}`
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    })

    if (!response.ok) {
      throw new Error(`Context Hub returned ${response.status}`)
    }

    return await response.json()
  } catch (error: any) {
    if (error.code === "ECONNREFUSED") {
      throw new Error("Context Hub is not running. Start it with: jfl context-hub start")
    }
    throw error
  }
}

function formatContextItems(items: ContextItem[]): string {
  if (items.length === 0) {
    return "No context items found."
  }

  const grouped: Record<string, ContextItem[]> = {}
  for (const item of items) {
    if (!grouped[item.source]) {
      grouped[item.source] = []
    }
    grouped[item.source].push(item)
  }

  const sections: string[] = []

  for (const [source, sourceItems] of Object.entries(grouped)) {
    const header = `## ${source.toUpperCase()}\n`
    const itemLines = sourceItems.map(item => {
      let line = `- **${item.title}**`
      if (item.path) {
        line += ` (${item.path})`
      }
      line += `\n  ${item.content.slice(0, 200)}${item.content.length > 200 ? "..." : ""}`
      return line
    }).join("\n")
    sections.push(header + itemLines)
  }

  return sections.join("\n\n")
}

async function handleToolCall(name: string, args: any): Promise<string> {
  switch (name) {
    case "context_get": {
      const result = await callContextHub("/api/context", {
        query: args.query,
        taskType: args.taskType,
        maxItems: args.maxItems || 30
      })
      return formatContextItems(result.items)
    }

    case "context_search": {
      if (!args.query) {
        throw new Error("query is required")
      }
      const result = await callContextHub("/api/context/search", {
        query: args.query,
        maxItems: args.maxItems || 20
      })
      return formatContextItems(result.items)
    }

    case "context_status": {
      const result = await callContextHub("/api/context/status")
      const sources = Object.entries(result.sources)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(", ")

      return `Context Hub Status:
- Status: ${result.status}
- Port: ${result.port}
- Sources: ${sources || "none"}
- Items: ${result.itemCount}`
    }

    case "context_sessions": {
      // For now, return a placeholder - cross-session requires reading worktrees
      return `Cross-session activity (last ${args.hours || 24} hours):
- Feature: Cross-session tracking not yet implemented
- Use 'git worktree list' to see other active sessions`
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

function handleRequest(request: MCPRequest): MCPResponse {
  const response: MCPResponse = {
    jsonrpc: "2.0",
    id: request.id
  }

  try {
    switch (request.method) {
      case "initialize":
        response.result = {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "jfl-context-hub",
            version: "1.0.0"
          }
        }
        break

      case "tools/list":
        response.result = { tools: TOOLS }
        break

      case "tools/call":
        // Handle async in caller
        throw new Error("ASYNC")

      case "notifications/initialized":
        // Acknowledge initialization
        return response

      default:
        response.error = {
          code: -32601,
          message: `Method not found: ${request.method}`
        }
    }
  } catch (error: any) {
    if (error.message === "ASYNC") throw error
    response.error = {
      code: -32000,
      message: error.message
    }
  }

  return response
}

async function handleAsyncRequest(request: MCPRequest): Promise<MCPResponse> {
  if (request.method === "tools/call") {
    const { name, arguments: args } = request.params || {}
    try {
      const result = await handleToolCall(name, args || {})
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{ type: "text", text: result }]
        }
      }
    } catch (error: any) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32000,
          message: error.message
        }
      }
    }
  }
  return handleRequest(request)
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  })

  rl.on("line", async (line) => {
    try {
      const request: MCPRequest = JSON.parse(line)

      let response: MCPResponse
      try {
        response = handleRequest(request)
      } catch (error: any) {
        if (error.message === "ASYNC") {
          response = await handleAsyncRequest(request)
        } else {
          throw error
        }
      }

      // Only send response if it has an id (not a notification)
      if (request.id !== undefined) {
        console.log(JSON.stringify(response))
      }
    } catch (error: any) {
      // Log errors to stderr so they don't corrupt the MCP stream
      console.error(`MCP Error: ${error.message}`)
    }
  })

  rl.on("close", () => {
    process.exit(0)
  })
}

main().catch(console.error)
