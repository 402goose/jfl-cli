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
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"

const CONTEXT_HUB_URL = process.env.CONTEXT_HUB_URL || "http://localhost:4242"
const TOKEN_FILE = ".jfl/context-hub.token"

// ============================================================================
// Auth
// ============================================================================

function getAuthToken(): string | null {
  // Try to find token file by walking up from cwd
  let dir = process.cwd()
  const root = path.parse(dir).root

  while (dir !== root) {
    const tokenPath = path.join(dir, TOKEN_FILE)
    if (fs.existsSync(tokenPath)) {
      return fs.readFileSync(tokenPath, 'utf-8').trim()
    }
    dir = path.dirname(dir)
  }

  return null
}

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
    const token = getAuthToken()

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    }

    if (token) {
      headers["Authorization"] = `Bearer ${token}`
    }

    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined
    })

    if (response.status === 401) {
      throw new Error("Unauthorized. Token file may be missing or invalid. Restart Context Hub: jfl context-hub restart")
    }

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

// ============================================================================
// Cross-Session Tracking
// ============================================================================

interface SessionInfo {
  name: string
  path: string
  branch: string
  isActive: boolean
  recentCommits: string[]
  journalSummary: string
  workingOn: string
}

function findRepoRoot(): string | null {
  let dir = process.cwd()
  const root = path.parse(dir).root

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, '.jfl'))) {
      return dir
    }
    dir = path.dirname(dir)
  }
  return null
}

function getSessionsActivity(hours: number): string {
  const repoRoot = findRepoRoot()
  if (!repoRoot) {
    return "Not in a JFL project directory."
  }

  const currentBranch = execSync('git branch --show-current', { cwd: repoRoot, encoding: 'utf-8' }).trim()
  const sessions: SessionInfo[] = []

  try {
    // Get all worktrees
    const worktreeOutput = execSync('git worktree list --porcelain', { cwd: repoRoot, encoding: 'utf-8' })
    const worktrees = parseWorktrees(worktreeOutput)

    // Get journal directory (should be in main repo)
    const journalDir = path.join(repoRoot, '.jfl', 'journal')

    for (const wt of worktrees) {
      if (!wt.branch.startsWith('session-')) continue

      const session: SessionInfo = {
        name: wt.branch,
        path: wt.path,
        branch: wt.branch,
        isActive: checkIfActive(wt.path),
        recentCommits: getRecentCommits(repoRoot, wt.branch, 3),
        journalSummary: '',
        workingOn: ''
      }

      // Read journal for this session
      const journalFile = path.join(journalDir, `${wt.branch}.jsonl`)
      if (fs.existsSync(journalFile)) {
        const entries = readJournalEntries(journalFile, hours)
        if (entries.length > 0) {
          session.journalSummary = entries.map(e => `- ${e.title}`).join('\n')
          session.workingOn = entries[entries.length - 1].title
        }
      }

      sessions.push(session)
    }
  } catch (error: any) {
    return `Error reading sessions: ${error.message}`
  }

  if (sessions.length === 0) {
    return "No other sessions found."
  }

  // Format output
  const lines: string[] = [`## Active Sessions (last ${hours}h)\n`]

  const activeSessions = sessions.filter(s => s.isActive && s.branch !== currentBranch)
  const staleSessions = sessions.filter(s => !s.isActive && s.branch !== currentBranch)

  if (activeSessions.length > 0) {
    lines.push('### Currently Active\n')
    for (const s of activeSessions) {
      lines.push(`**${s.name}**`)
      if (s.workingOn) {
        lines.push(`  Working on: ${s.workingOn}`)
      }
      if (s.recentCommits.length > 0) {
        lines.push(`  Recent commits:`)
        for (const c of s.recentCommits) {
          lines.push(`    - ${c}`)
        }
      }
      lines.push('')
    }
  }

  if (staleSessions.length > 0) {
    lines.push('### Recently Active (stale)\n')
    for (const s of staleSessions.slice(0, 5)) {
      lines.push(`**${s.name}**`)
      if (s.workingOn) {
        lines.push(`  Last worked on: ${s.workingOn}`)
      }
      lines.push('')
    }
  }

  // Check for potential overlap
  const currentJournalFile = path.join(repoRoot, '.jfl', 'journal', `${currentBranch}.jsonl`)
  if (fs.existsSync(currentJournalFile)) {
    const currentEntries = readJournalEntries(currentJournalFile, hours)
    if (currentEntries.length > 0 && activeSessions.length > 0) {
      const currentWork = currentEntries[currentEntries.length - 1].title.toLowerCase()
      for (const s of activeSessions) {
        if (s.workingOn && hasOverlap(currentWork, s.workingOn.toLowerCase())) {
          lines.push(`\n⚠️  **Potential overlap detected** with ${s.name}`)
          lines.push(`   They're working on: ${s.workingOn}`)
        }
      }
    }
  }

  return lines.join('\n')
}

function parseWorktrees(output: string): { path: string, branch: string }[] {
  const worktrees: { path: string, branch: string }[] = []
  const lines = output.split('\n')

  let currentPath = ''
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      currentPath = line.substring(9)
    } else if (line.startsWith('branch refs/heads/')) {
      const branch = line.substring(18)
      if (currentPath) {
        worktrees.push({ path: currentPath, branch })
      }
    }
  }

  return worktrees
}

function checkIfActive(worktreePath: string): boolean {
  // Check for auto-commit PID
  const pidFile = path.join(worktreePath, '.jfl', 'auto-commit.pid')
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10)
      if (pid > 0) {
        // Check if process is running
        try {
          process.kill(pid, 0) // Doesn't kill, just checks if it exists
          return true
        } catch {
          // Process not running
        }
      }
    } catch {
      // Ignore read errors
    }
  }
  return false
}

function getRecentCommits(repoRoot: string, branch: string, count: number): string[] {
  try {
    const output = execSync(
      `git log --oneline -${count} "${branch}" 2>/dev/null`,
      { cwd: repoRoot, encoding: 'utf-8' }
    )
    return output.trim().split('\n').filter(l => l)
  } catch {
    return []
  }
}

interface JournalEntry {
  ts: string
  title: string
  type: string
  summary?: string
}

function readJournalEntries(journalFile: string, hours: number): JournalEntry[] {
  const entries: JournalEntry[] = []
  const cutoff = Date.now() - (hours * 60 * 60 * 1000)

  try {
    const content = fs.readFileSync(journalFile, 'utf-8')
    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as JournalEntry
        const entryTime = new Date(entry.ts).getTime()
        if (entryTime >= cutoff) {
          entries.push(entry)
        }
      } catch {
        // Skip invalid JSON lines
      }
    }
  } catch {
    // File doesn't exist or can't be read
  }

  return entries
}

function hasOverlap(work1: string, work2: string): boolean {
  // Simple keyword overlap detection
  const keywords1 = new Set(work1.split(/\s+/).filter(w => w.length > 4))
  const keywords2 = new Set(work2.split(/\s+/).filter(w => w.length > 4))

  let overlap = 0
  for (const kw of keywords1) {
    if (keywords2.has(kw)) overlap++
  }

  return overlap >= 2 // At least 2 significant words in common
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
      return getSessionsActivity(args.hours || 24)
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
