/**
 * jfl context-hub - Unified context layer for AI agents
 *
 * Provides context from journal, knowledge docs, and code to any AI.
 * Works locally (CLI) and hosted (platform).
 *
 * @purpose CLI command for Context Hub daemon management
 */

import chalk from "chalk"
import ora from "ora"
import { execSync, spawn, ChildProcess } from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as http from "http"
import * as readline from "readline"

const DEFAULT_PORT = 4242
const PID_FILE = ".jfl/context-hub.pid"
const LOG_FILE = ".jfl/logs/context-hub.log"

// ============================================================================
// Types
// ============================================================================

interface ContextItem {
  source: "journal" | "knowledge" | "code" | "memory"
  type: string
  title: string
  content: string
  path?: string
  timestamp?: string
  relevance?: number
}

interface UnifiedContext {
  items: ContextItem[]
  sources: {
    journal: boolean
    knowledge: boolean
    code: boolean
    memory: boolean
  }
  query?: string
  taskType?: string
}

interface JournalEntry {
  v?: number
  ts?: string
  session?: string
  type?: string
  title?: string
  summary?: string
  detail?: string
  files?: string[]
  decision?: string
  learned?: string[]
}

// ============================================================================
// Journal Reader
// ============================================================================

function readJournalEntries(projectRoot: string, limit = 20): ContextItem[] {
  const journalDir = path.join(projectRoot, ".jfl", "journal")
  const items: ContextItem[] = []

  if (!fs.existsSync(journalDir)) {
    return items
  }

  const files = fs.readdirSync(journalDir)
    .filter(f => f.endsWith(".jsonl"))
    .sort()
    .reverse()

  for (const file of files) {
    if (items.length >= limit) break

    const filePath = path.join(journalDir, file)
    const content = fs.readFileSync(filePath, "utf-8")
    const lines = content.trim().split("\n").filter(l => l.trim())

    for (const line of lines.reverse()) {
      if (items.length >= limit) break

      try {
        const entry: JournalEntry = JSON.parse(line)
        items.push({
          source: "journal",
          type: entry.type || "entry",
          title: entry.title || "Untitled",
          content: entry.summary || entry.detail || "",
          timestamp: entry.ts,
          path: filePath
        })
      } catch {
        // Skip malformed lines
      }
    }
  }

  return items
}

// ============================================================================
// Knowledge Reader
// ============================================================================

function readKnowledgeDocs(projectRoot: string): ContextItem[] {
  const knowledgeDir = path.join(projectRoot, "knowledge")
  const items: ContextItem[] = []

  if (!fs.existsSync(knowledgeDir)) {
    return items
  }

  const priorityFiles = [
    "VISION.md",
    "ROADMAP.md",
    "NARRATIVE.md",
    "THESIS.md",
    "BRAND_DECISIONS.md",
    "TASKS.md"
  ]

  for (const filename of priorityFiles) {
    const filePath = path.join(knowledgeDir, filename)
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8")
      const title = filename.replace(".md", "").replace(/_/g, " ")

      items.push({
        source: "knowledge",
        type: "doc",
        title,
        content: content.slice(0, 2000), // Truncate for context
        path: filePath
      })
    }
  }

  return items
}

// ============================================================================
// Code Context Reader
// ============================================================================

function extractPurpose(content: string): string | null {
  const match = content.match(/@purpose\s+(.+?)(?:\n|\*)/i)
  return match ? match[1].trim() : null
}

function readCodeContext(projectRoot: string, limit = 30): ContextItem[] {
  const items: ContextItem[] = []

  // Look for files with @purpose in common locations
  const searchDirs = [
    path.join(projectRoot, "src"),
    path.join(projectRoot, "app"),
    path.join(projectRoot, "lib"),
    path.join(projectRoot, "components"),
    path.join(projectRoot, "product", "src"),
    path.join(projectRoot, "product", "packages")
  ]

  const extensions = [".ts", ".tsx", ".js", ".jsx"]

  function scanDir(dir: string, depth = 0) {
    if (depth > 4 || items.length >= limit) return
    if (!fs.existsSync(dir)) return

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        if (items.length >= limit) break
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue

        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          scanDir(fullPath, depth + 1)
        } else if (extensions.some(ext => entry.name.endsWith(ext))) {
          try {
            const content = fs.readFileSync(fullPath, "utf-8")
            const purpose = extractPurpose(content)

            if (purpose) {
              items.push({
                source: "code",
                type: "file",
                title: entry.name,
                content: purpose,
                path: fullPath
              })
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  for (const dir of searchDirs) {
    scanDir(dir)
  }

  return items
}

// ============================================================================
// Orchestrator
// ============================================================================

function getUnifiedContext(projectRoot: string, query?: string, taskType?: string): UnifiedContext {
  const journalItems = readJournalEntries(projectRoot)
  const knowledgeItems = readKnowledgeDocs(projectRoot)
  const codeItems = readCodeContext(projectRoot)

  // TODO: Add memory/embeddings support when available

  const items = [...journalItems, ...knowledgeItems, ...codeItems]

  // Simple relevance scoring if query provided
  if (query) {
    const queryLower = query.toLowerCase()
    for (const item of items) {
      const text = `${item.title} ${item.content}`.toLowerCase()
      item.relevance = text.includes(queryLower) ? 1 : 0
    }
    items.sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
  }

  return {
    items,
    sources: {
      journal: journalItems.length > 0,
      knowledge: knowledgeItems.length > 0,
      code: codeItems.length > 0,
      memory: false // TODO: implement
    },
    query,
    taskType
  }
}

// ============================================================================
// HTTP Server
// ============================================================================

function createServer(projectRoot: string, port: number): http.Server {
  const server = http.createServer((req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")

    if (req.method === "OPTIONS") {
      res.writeHead(200)
      res.end()
      return
    }

    const url = new URL(req.url || "/", `http://localhost:${port}`)

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok", port }))
      return
    }

    // Status
    if (url.pathname === "/api/context/status" && req.method === "GET") {
      const context = getUnifiedContext(projectRoot)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        status: "running",
        port,
        sources: context.sources,
        itemCount: context.items.length
      }))
      return
    }

    // Get context
    if (url.pathname === "/api/context" && req.method === "POST") {
      let body = ""
      req.on("data", chunk => body += chunk)
      req.on("end", () => {
        try {
          const { query, taskType, maxItems } = JSON.parse(body || "{}")
          const context = getUnifiedContext(projectRoot, query, taskType)

          if (maxItems && context.items.length > maxItems) {
            context.items = context.items.slice(0, maxItems)
          }

          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify(context))
        } catch (err: any) {
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: err.message }))
        }
      })
      return
    }

    // Search
    if (url.pathname === "/api/context/search" && req.method === "POST") {
      let body = ""
      req.on("data", chunk => body += chunk)
      req.on("end", () => {
        try {
          const { query, maxItems = 20 } = JSON.parse(body || "{}")
          if (!query) {
            res.writeHead(400, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ error: "query required" }))
            return
          }

          const context = getUnifiedContext(projectRoot, query)
          context.items = context.items
            .filter(item => item.relevance && item.relevance > 0)
            .slice(0, maxItems)

          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify(context))
        } catch (err: any) {
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: err.message }))
        }
      })
      return
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Not found" }))
  })

  return server
}

// ============================================================================
// Daemon Management
// ============================================================================

function getPidFile(projectRoot: string): string {
  return path.join(projectRoot, PID_FILE)
}

function getLogFile(projectRoot: string): string {
  const logFile = path.join(projectRoot, LOG_FILE)
  const logDir = path.dirname(logFile)
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  return logFile
}

function isRunning(projectRoot: string): { running: boolean; pid?: number } {
  const pidFile = getPidFile(projectRoot)

  if (!fs.existsSync(pidFile)) {
    return { running: false }
  }

  const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10)

  try {
    process.kill(pid, 0) // Check if process exists
    return { running: true, pid }
  } catch {
    // Process doesn't exist, clean up stale PID file
    fs.unlinkSync(pidFile)
    return { running: false }
  }
}

function startDaemon(projectRoot: string, port: number): boolean {
  const status = isRunning(projectRoot)
  if (status.running) {
    console.log(chalk.yellow(`Context Hub already running (PID: ${status.pid})`))
    return true
  }

  const logFile = getLogFile(projectRoot)
  const pidFile = getPidFile(projectRoot)

  // Start as detached process
  const child = spawn(process.execPath, [process.argv[1], "context-hub", "serve", "--port", String(port)], {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", fs.openSync(logFile, "a"), fs.openSync(logFile, "a")]
  })

  child.unref()

  // Write PID file
  if (child.pid) {
    fs.writeFileSync(pidFile, String(child.pid))
    return true
  }

  return false
}

function stopDaemon(projectRoot: string): boolean {
  const status = isRunning(projectRoot)
  if (!status.running || !status.pid) {
    console.log(chalk.gray("Context Hub is not running"))
    return true
  }

  try {
    process.kill(status.pid, "SIGTERM")
    const pidFile = getPidFile(projectRoot)
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile)
    }
    return true
  } catch (err) {
    console.error(chalk.red("Failed to stop daemon"))
    return false
  }
}

// ============================================================================
// CLI Command
// ============================================================================

export async function contextHubCommand(
  action?: string,
  options: { port?: number } = {}
) {
  const projectRoot = process.cwd()
  const port = options.port || DEFAULT_PORT

  // Ensure .jfl directory exists
  const jflDir = path.join(projectRoot, ".jfl")
  if (!fs.existsSync(jflDir)) {
    fs.mkdirSync(jflDir, { recursive: true })
  }

  switch (action) {
    case "start": {
      const spinner = ora("Starting Context Hub...").start()
      if (startDaemon(projectRoot, port)) {
        // Wait for server to be ready
        await new Promise(resolve => setTimeout(resolve, 500))
        const status = isRunning(projectRoot)
        spinner.succeed(`Context Hub started on port ${port} (PID: ${status.pid})`)
      } else {
        spinner.fail("Failed to start Context Hub")
      }
      break
    }

    case "stop": {
      const spinner = ora("Stopping Context Hub...").start()
      if (stopDaemon(projectRoot)) {
        spinner.succeed("Context Hub stopped")
      } else {
        spinner.fail("Failed to stop Context Hub")
      }
      break
    }

    case "restart": {
      await contextHubCommand("stop", options)
      await new Promise(resolve => setTimeout(resolve, 500))
      await contextHubCommand("start", options)
      break
    }

    case "status": {
      const status = isRunning(projectRoot)
      if (status.running) {
        console.log(chalk.green(`\n  Context Hub is running`))
        console.log(chalk.gray(`  PID: ${status.pid}`))
        console.log(chalk.gray(`  Port: ${port}`))

        // Try to get more info from the API
        try {
          const response = await fetch(`http://localhost:${port}/api/context/status`)
          const data = await response.json()
          console.log(chalk.gray(`  Sources: ${Object.entries(data.sources).filter(([,v]) => v).map(([k]) => k).join(", ")}`))
          console.log(chalk.gray(`  Items: ${data.itemCount}`))
        } catch {
          // Server might not be responding yet
        }
        console.log()
      } else {
        console.log(chalk.yellow("\n  Context Hub is not running"))
        console.log(chalk.gray("  Run: jfl context-hub start\n"))
      }
      break
    }

    case "ensure": {
      const status = isRunning(projectRoot)
      if (status.running) {
        // Already running, nothing to do
        return
      }
      // Start silently
      startDaemon(projectRoot, port)
      break
    }

    case "serve": {
      // Run server in foreground (used by daemon)
      const server = createServer(projectRoot, port)
      server.listen(port, () => {
        console.log(`Context Hub listening on port ${port}`)
      })

      // Handle shutdown
      process.on("SIGTERM", () => {
        server.close()
        process.exit(0)
      })
      process.on("SIGINT", () => {
        server.close()
        process.exit(0)
      })
      break
    }

    case "query": {
      // Quick query for testing
      const context = getUnifiedContext(projectRoot)
      console.log(chalk.bold("\n  Context Hub Query\n"))
      console.log(chalk.gray(`  Sources: ${Object.entries(context.sources).filter(([,v]) => v).map(([k]) => k).join(", ")}`))
      console.log(chalk.gray(`  Items: ${context.items.length}\n`))

      for (const item of context.items.slice(0, 10)) {
        console.log(chalk.cyan(`  [${item.source}] ${item.title}`))
        console.log(chalk.gray(`    ${item.content.slice(0, 100)}${item.content.length > 100 ? "..." : ""}`))
      }
      console.log()
      break
    }

    default: {
      console.log(chalk.bold("\n  Context Hub - Unified context for AI agents\n"))
      console.log(chalk.gray("  Commands:"))
      console.log("    jfl context-hub start     Start the daemon")
      console.log("    jfl context-hub stop      Stop the daemon")
      console.log("    jfl context-hub restart   Restart the daemon")
      console.log("    jfl context-hub status    Check if running")
      console.log("    jfl context-hub ensure    Start if not running (for hooks)")
      console.log("    jfl context-hub query     Quick context query")
      console.log()
      console.log(chalk.gray("  Options:"))
      console.log("    --port <port>   Port to run on (default: 4242)")
      console.log()
    }
  }
}
