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
import { homedir } from "os"
import { fileURLToPath } from "url"

const DEFAULT_PORT = 4242
const PID_FILE = ".jfl/context-hub.pid"
const LOG_FILE = ".jfl/logs/context-hub.log"
const TOKEN_FILE = ".jfl/context-hub.token"

// ============================================================================
// Security
// ============================================================================

function generateToken(): string {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')
}

function getTokenFile(projectRoot: string): string {
  return path.join(projectRoot, TOKEN_FILE)
}

function getOrCreateToken(projectRoot: string): string {
  const tokenFile = getTokenFile(projectRoot)

  if (fs.existsSync(tokenFile)) {
    return fs.readFileSync(tokenFile, 'utf-8').trim()
  }

  const token = generateToken()
  fs.writeFileSync(tokenFile, token, { mode: 0o600 }) // Owner read/write only
  return token
}

function validateAuth(req: http.IncomingMessage, projectRoot: string): boolean {
  const tokenFile = getTokenFile(projectRoot)

  // If no token file exists, allow access (backwards compatibility during migration)
  if (!fs.existsSync(tokenFile)) {
    return true
  }

  const expectedToken = fs.readFileSync(tokenFile, 'utf-8').trim()
  const authHeader = req.headers['authorization']

  if (!authHeader) {
    return false
  }

  // Support "Bearer <token>" format
  const providedToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader

  return providedToken === expectedToken
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer()
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true)
      } else {
        resolve(false)
      }
    })
    server.once('listening', () => {
      server.close()
      resolve(false)
    })
    server.listen(port)
  })
}

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
// Service Discovery
// ============================================================================

interface ServiceInfo {
  name: string
  type: string
  description: string
  path: string
  status: "running" | "stopped" | "unknown"
  mcp?: {
    enabled: boolean
    transport: string
  }
  commands?: {
    start?: string
    stop?: string
    logs?: string
  }
  healthcheck?: string
  port?: number
  dependencies?: string[]
}

function discoverServices(projectRoot: string): Record<string, ServiceInfo> {
  const services: Record<string, ServiceInfo> = {}

  // Look for .jfl/services.json in current project and parent directories
  // Also search sibling GTM directories
  const searchPaths = [
    projectRoot,
    path.join(projectRoot, ".."),
    path.join(projectRoot, "../.."),
  ]

  // Add sibling directories (e.g., if in jfl-cli, check ../JFL-GTM)
  const parentDir = path.join(projectRoot, "..")
  if (fs.existsSync(parentDir)) {
    try {
      const siblings = fs.readdirSync(parentDir, { withFileTypes: true })
      for (const sibling of siblings) {
        if (sibling.isDirectory() && (sibling.name.includes("GTM") || sibling.name.includes("gtm"))) {
          searchPaths.push(path.join(parentDir, sibling.name))
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  for (const searchPath of searchPaths) {
    if (!fs.existsSync(searchPath)) continue

    const servicesFile = path.join(searchPath, ".jfl/services.json")

    if (fs.existsSync(servicesFile)) {
      try {
        const servicesData = JSON.parse(fs.readFileSync(servicesFile, "utf-8"))

        for (const [serviceName, serviceData] of Object.entries(servicesData)) {
          const data = serviceData as any

          // Check if service has service.json with MCP info
          let mcpInfo: ServiceInfo["mcp"] | undefined
          const serviceJsonPath = path.join(data.path, "service.json")

          if (fs.existsSync(serviceJsonPath)) {
            try {
              const serviceJson = JSON.parse(fs.readFileSync(serviceJsonPath, "utf-8"))
              if (serviceJson.mcp) {
                mcpInfo = {
                  enabled: serviceJson.mcp.enabled || false,
                  transport: serviceJson.mcp.transport || "stdio"
                }
              }
            } catch {
              // Ignore parse errors
            }
          }

          // Determine service status (basic check - could be enhanced)
          let status: ServiceInfo["status"] = "unknown"
          if (data.port) {
            // Could check if port is in use
            status = "stopped"
          }

          services[serviceName] = {
            name: serviceName,
            type: data.type || "unknown",
            description: data.description || "",
            path: data.path,
            status,
            mcp: mcpInfo,
            commands: data.commands,
            healthcheck: data.healthcheck,
            port: data.port,
            dependencies: data.dependencies
          }
        }
      } catch (err) {
        console.error(`Failed to read services from ${servicesFile}:`, err)
      }
    }
  }

  return services
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
// Search & Scoring (TF-IDF style)
// ============================================================================

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 2)
}

function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1)
  }
  // Normalize by document length
  for (const [term, count] of tf) {
    tf.set(term, count / tokens.length)
  }
  return tf
}

function computeIDF(documents: string[][]): Map<string, number> {
  const idf = new Map<string, number>()
  const N = documents.length

  // Count documents containing each term
  const docCount = new Map<string, number>()
  for (const doc of documents) {
    const uniqueTerms = new Set(doc)
    for (const term of uniqueTerms) {
      docCount.set(term, (docCount.get(term) || 0) + 1)
    }
  }

  // Compute IDF
  for (const [term, count] of docCount) {
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1)
  }

  return idf
}

function scoreItem(
  item: ContextItem,
  queryTokens: string[],
  idf: Map<string, number>
): number {
  const text = `${item.title} ${item.content}`
  const tokens = tokenize(text)
  const tf = computeTF(tokens)

  let score = 0
  for (const queryTerm of queryTokens) {
    const termTF = tf.get(queryTerm) || 0
    const termIDF = idf.get(queryTerm) || 1
    score += termTF * termIDF
  }

  // Boost title matches
  const titleTokens = new Set(tokenize(item.title))
  for (const queryTerm of queryTokens) {
    if (titleTokens.has(queryTerm)) {
      score *= 1.5
    }
  }

  // Boost recent items (journal)
  if (item.source === "journal" && item.timestamp) {
    const age = Date.now() - new Date(item.timestamp).getTime()
    const daysSinceUpdate = age / (1000 * 60 * 60 * 24)
    if (daysSinceUpdate < 7) {
      score *= 1.3 // Boost recent entries
    }
  }

  return score
}

function semanticSearch(items: ContextItem[], query: string): ContextItem[] {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return items

  // Build corpus for IDF
  const documents = items.map(item => tokenize(`${item.title} ${item.content}`))
  const idf = computeIDF(documents)

  // Score and sort
  for (const item of items) {
    item.relevance = scoreItem(item, queryTokens, idf)
  }

  return items
    .filter(item => (item.relevance || 0) > 0)
    .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
}

// ============================================================================
// Orchestrator
// ============================================================================

function getUnifiedContext(projectRoot: string, query?: string, taskType?: string): UnifiedContext {
  const journalItems = readJournalEntries(projectRoot)
  const knowledgeItems = readKnowledgeDocs(projectRoot)
  const codeItems = readCodeContext(projectRoot)

  let items = [...journalItems, ...knowledgeItems, ...codeItems]

  // Apply semantic search if query provided
  if (query) {
    items = semanticSearch(items, query)
  }

  return {
    items,
    sources: {
      journal: journalItems.length > 0,
      knowledge: knowledgeItems.length > 0,
      code: codeItems.length > 0,
      memory: false
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
    // CORS - include Authorization header
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

    if (req.method === "OPTIONS") {
      res.writeHead(200)
      res.end()
      return
    }

    const url = new URL(req.url || "/", `http://localhost:${port}`)

    // Health check - no auth required (for monitoring)
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok", port }))
      return
    }

    // All other endpoints require auth
    if (!validateAuth(req, projectRoot)) {
      res.writeHead(401, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        error: "Unauthorized",
        message: "Provide token via Authorization header: Bearer <token>",
        tokenFile: ".jfl/context-hub.token"
      }))
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

    // Services registry
    if (url.pathname === "/api/services" && req.method === "GET") {
      try {
        const services = discoverServices(projectRoot)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify(services))
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: err.message }))
      }
      return
    }

    // Get specific service
    if (url.pathname.startsWith("/api/services/") && req.method === "GET") {
      try {
        const serviceName = url.pathname.replace("/api/services/", "")
        const services = discoverServices(projectRoot)
        const service = services[serviceName]

        if (!service) {
          res.writeHead(404, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "Service not found" }))
          return
        }

        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify(service))
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: err.message }))
      }
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

export function isRunning(projectRoot: string): { running: boolean; pid?: number } {
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

async function startDaemon(projectRoot: string, port: number): Promise<{ success: boolean; message: string }> {
  const status = isRunning(projectRoot)
  if (status.running) {
    return { success: true, message: `Context Hub already running (PID: ${status.pid})` }
  }

  // Check if port is in use by another process
  const portInUse = await isPortInUse(port)
  if (portInUse) {
    return { success: false, message: `Port ${port} is already in use by another process` }
  }

  const logFile = getLogFile(projectRoot)
  const pidFile = getPidFile(projectRoot)

  // Generate auth token before starting
  const token = getOrCreateToken(projectRoot)

  // Find jfl command (prefer global install)
  let jflCmd = "jfl"
  try {
    // Try to find jfl in PATH
    execSync("which jfl", { encoding: "utf-8" }).trim()
  } catch {
    // Fall back to current process
    jflCmd = process.argv[1]
  }

  // Start as detached process
  const child = spawn(jflCmd, ["context-hub", "serve", "--port", String(port)], {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", fs.openSync(logFile, "a"), fs.openSync(logFile, "a")],
    env: { ...process.env, NODE_ENV: "production" }
  })

  child.unref()

  // Wait a moment to ensure process started
  await new Promise(resolve => setTimeout(resolve, 500))

  // Write PID file EARLY to avoid race conditions
  if (child.pid) {
    // Write PID file immediately
    fs.writeFileSync(pidFile, String(child.pid))

    // Then verify process is still running
    try {
      process.kill(child.pid, 0)
      // Give it a bit more time to be ready
      await new Promise(resolve => setTimeout(resolve, 300))
      return { success: true, message: `Started (PID: ${child.pid}). Token: ${token.slice(0, 8)}...` }
    } catch {
      // Process died, clean up PID file
      fs.unlinkSync(pidFile)
      return { success: false, message: "Process started but immediately exited" }
    }
  }

  return { success: false, message: "Failed to spawn daemon process" }
}

async function stopDaemon(projectRoot: string): Promise<{ success: boolean; message: string }> {
  const status = isRunning(projectRoot)
  if (!status.running || !status.pid) {
    return { success: true, message: "Context Hub is not running" }
  }

  const pidFile = getPidFile(projectRoot)
  const tokenFile = getTokenFile(projectRoot)

  try {
    // Send SIGTERM first (graceful)
    process.kill(status.pid, "SIGTERM")

    // Wait up to 3 seconds for graceful shutdown
    let attempts = 0
    while (attempts < 6) {
      await new Promise(resolve => setTimeout(resolve, 500))
      try {
        process.kill(status.pid, 0) // Check if still running
        attempts++
      } catch {
        // Process is gone
        break
      }
    }

    // If still running after 3 seconds, force kill
    try {
      process.kill(status.pid, 0)
      process.kill(status.pid, "SIGKILL")
      await new Promise(resolve => setTimeout(resolve, 100))
    } catch {
      // Process is gone, that's fine
    }

    // Clean up PID and token files
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile)
    }
    if (fs.existsSync(tokenFile)) {
      fs.unlinkSync(tokenFile)
    }

    return { success: true, message: "Context Hub stopped" }
  } catch (err) {
    return { success: false, message: `Failed to stop daemon: ${err}` }
  }
}

// ============================================================================
// CLI Command
// ============================================================================

export async function contextHubCommand(
  action?: string,
  options: { port?: number; global?: boolean } = {}
) {
  const isGlobal = options.global || false
  const projectRoot = isGlobal ? homedir() : process.cwd()
  const port = options.port || DEFAULT_PORT

  // Ensure .jfl directory exists
  const jflDir = isGlobal
    ? path.join(homedir(), ".jfl")
    : path.join(projectRoot, ".jfl")

  if (!fs.existsSync(jflDir)) {
    fs.mkdirSync(jflDir, { recursive: true })
  }

  switch (action) {
    case "start": {
      const spinner = ora("Starting Context Hub...").start()
      const result = await startDaemon(projectRoot, port)
      if (result.success) {
        // Check if it was already running
        if (result.message.includes("already running")) {
          spinner.info(result.message)
        } else {
          // Wait for server to be ready
          await new Promise(resolve => setTimeout(resolve, 500))
          const status = isRunning(projectRoot)
          spinner.succeed(`Context Hub started on port ${port} (PID: ${status.pid})`)
          console.log(chalk.gray(`  Token file: .jfl/context-hub.token`))
        }
      } else {
        spinner.fail(result.message)
      }
      break
    }

    case "stop": {
      const spinner = ora("Stopping Context Hub...").start()
      const result = await stopDaemon(projectRoot)
      if (result.success) {
        spinner.succeed(result.message)
      } else {
        spinner.fail(result.message)
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
        // Already running, verify it's healthy
        try {
          const response = await fetch(`http://localhost:${port}/health`, {
            signal: AbortSignal.timeout(2000)
          })
          if (response.ok) {
            // Healthy and running, nothing to do
            return
          }
        } catch {
          // Process exists but not responding, fall through to cleanup
        }
      }

      // Check if port is blocked by orphaned process
      const portInUse = await isPortInUse(port)
      if (portInUse) {
        // Port is in use - check if it's actually Context Hub
        try {
          const response = await fetch(`http://localhost:${port}/health`, {
            signal: AbortSignal.timeout(2000)
          })
          if (response.ok) {
            // It's a healthy Context Hub but PID file is missing/wrong
            // Don't kill it - just return
            return
          }
        } catch {
          // Process on port is not responding to health check
          // Only kill if we're confident it's not a Context Hub
        }

        // Port in use but not responding - try to clean up
        try {
          const lsofOutput = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' }).trim()
          if (lsofOutput) {
            const orphanedPid = parseInt(lsofOutput.split('\n')[0], 10)
            // Only kill if it's different from our tracked PID
            if (!status.pid || orphanedPid !== status.pid) {
              process.kill(orphanedPid, 'SIGTERM')
              await new Promise(resolve => setTimeout(resolve, 500)) // Wait for cleanup
            }
          }
        } catch {
          // lsof failed or process already gone
        }
      }

      // Start silently
      await startDaemon(projectRoot, port)
      break
    }

    case "serve": {
      // Run server in foreground (used by daemon)
      const server = createServer(projectRoot, port)
      let isListening = false

      // Error handling - keep process alive
      process.on("uncaughtException", (err) => {
        console.error(`Uncaught exception: ${err.message}`)
        console.error(err.stack)
        // Don't exit - log and continue
      })

      process.on("unhandledRejection", (reason, promise) => {
        console.error(`Unhandled rejection at ${promise}: ${reason}`)
        // Don't exit - log and continue
      })

      server.on("error", (err: any) => {
        console.error(`Server error: ${err.message}`)
        if (err.code === "EADDRINUSE") {
          console.error(`Port ${port} is already in use. Exiting.`)
          process.exit(1)
        }
        // For other errors, don't exit
      })

      server.listen(port, () => {
        isListening = true
        console.log(`Context Hub listening on port ${port}`)
        console.log(`PID: ${process.pid}`)
        console.log(`Ready to serve requests`)
      })

      // Handle shutdown gracefully
      const shutdown = (signal: string) => {
        if (!isListening) {
          // Server never started, just exit
          process.exit(0)
          return
        }
        // Log who sent the signal for debugging
        const stack = new Error().stack
        console.log(`[${new Date().toISOString()}] Received ${signal}`)
        console.log(`PID: ${process.pid}, Parent PID: ${process.ppid}`)
        console.log("Shutting down...")
        server.close(() => {
          console.log("Server closed")
          process.exit(0)
        })
        // Force exit after 5s if server doesn't close
        setTimeout(() => {
          console.log("Force exit after timeout")
          process.exit(1)
        }, 5000)
      }

      process.on("SIGTERM", () => shutdown("SIGTERM"))
      process.on("SIGINT", () => shutdown("SIGINT"))

      // Keep process alive with heartbeat
      const heartbeat = setInterval(() => {
        // Heartbeat - ensures event loop stays active
        // Also log periodically so we know it's alive
        if (isListening && Date.now() % 300000 < 60000) { // Every 5 minutes
          console.log(`Heartbeat: Still running (PID: ${process.pid})`)
        }
      }, 60000)

      // Cleanup heartbeat on exit
      process.on("exit", () => {
        clearInterval(heartbeat)
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

    case "logs": {
      // Launch TUI log viewer
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = path.dirname(__filename)
      const logViewer = spawn(process.execPath, [
        path.join(__dirname, "../ui/context-hub-logs.js")
      ], {
        stdio: "inherit",
        cwd: projectRoot
      })

      logViewer.on("exit", (code: number) => {
        process.exit(code || 0)
      })
      break
    }

    default: {
      console.log(chalk.bold("\n  Context Hub - Unified context for AI agents\n"))
      console.log(chalk.gray("  Commands:"))
      console.log("    jfl context-hub start     Start the daemon")
      console.log("    jfl context-hub stop      Stop the daemon")
      console.log("    jfl context-hub restart   Restart the daemon")
      console.log("    jfl context-hub status    Check if running")
      console.log("    jfl context-hub logs      Show real-time logs (TUI)")
      console.log("    jfl context-hub ensure    Start if not running (for hooks)")
      console.log("    jfl context-hub query     Quick context query")
      console.log()
      console.log(chalk.gray("  Options:"))
      console.log("    --port <port>   Port to run on (default: 4242)")
      console.log()
    }
  }
}
