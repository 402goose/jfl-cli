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
import {
  initializeDatabase,
  getMemoryStats,
  insertMemory
} from "../lib/memory-db.js"
import { searchMemories } from "../lib/memory-search.js"
import { indexJournalEntries, startPeriodicIndexing } from "../lib/memory-indexer.js"
import { getProjectPort } from "../utils/context-hub-port.js"
import { getConfigValue, setConfig } from "../utils/jfl-config.js"
import Conf from "conf"
import { MAPEventBus } from "../lib/map-event-bus.js"
import { WebSocketServer } from "ws"
import type { MAPEventType } from "../types/map.js"
import { telemetry } from "../lib/telemetry.js"

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

function validateAuth(req: http.IncomingMessage, projectRoot: string, url?: URL): boolean {
  const tokenFile = getTokenFile(projectRoot)

  // If no token file exists, allow access (backwards compatibility during migration)
  if (!fs.existsSync(tokenFile)) {
    return true
  }

  const expectedToken = fs.readFileSync(tokenFile, 'utf-8').trim()

  // Check Authorization header first
  const authHeader = req.headers['authorization']
  if (authHeader) {
    const providedToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader
    if (providedToken === expectedToken) return true
  }

  // Fall back to ?token= query param (needed for SSE/EventSource which can't set headers)
  if (url) {
    const queryToken = url.searchParams.get('token')
    if (queryToken && queryToken === expectedToken) return true
  }

  return false
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

function readJournalEntries(projectRoot: string, limit = 50): ContextItem[] {
  const journalDir = path.join(projectRoot, ".jfl", "journal")
  const items: ContextItem[] = []

  if (!fs.existsSync(journalDir)) {
    return items
  }

  // Sort by modification time (newest first) so recent entries aren't buried
  const files = fs.readdirSync(journalDir)
    .filter(f => f.endsWith(".jsonl"))
    .map(f => ({
      name: f,
      mtime: fs.statSync(path.join(journalDir, f)).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(f => f.name)

  // Read all entries from all files, then sort globally by timestamp
  const allEntries: ContextItem[] = []

  for (const file of files) {
    const filePath = path.join(journalDir, file)
    const content = fs.readFileSync(filePath, "utf-8")
    const lines = content.trim().split("\n").filter(l => l.trim())

    for (const line of lines) {
      try {
        const entry: JournalEntry = JSON.parse(line)
        allEntries.push({
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

  // Sort all entries by timestamp descending, then take the limit
  allEntries.sort((a, b) => {
    const ta = a.timestamp || ""
    const tb = b.timestamp || ""
    return tb.localeCompare(ta)
  })

  return allEntries.slice(0, limit)
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

function createServer(projectRoot: string, port: number, eventBus?: MAPEventBus): http.Server {
  const server = http.createServer((req, res) => {
    const requestStart = Date.now()
    const pathname = new URL(req.url || "/", `http://localhost:${port}`).pathname

    // Intercept writeHead to capture status code for telemetry
    let capturedStatus = 200
    const originalWriteHead = res.writeHead.bind(res)
    res.writeHead = function(statusCode: number, ...args: any[]) {
      capturedStatus = statusCode
      return originalWriteHead(statusCode, ...args)
    } as any

    // Track request on response finish (skip health/OPTIONS/dashboard)
    const shouldTrack = req.method !== "OPTIONS"
      && pathname !== "/health"
      && !pathname.startsWith("/dashboard")
    if (shouldTrack) {
      res.on('finish', () => {
        telemetry.track({
          category: 'context_hub',
          event: 'context_hub:request',
          endpoint: pathname,
          method: req.method,
          status_code: capturedStatus,
          duration_ms: Date.now() - requestStart,
          hub_port: port,
        })
      })
    }

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

    // Dashboard - served without API auth (has its own token flow in JS)
    if (url.pathname.startsWith("/dashboard")) {
      import("../dashboard/index.js").then(({ handleDashboardRoutes }) => {
        if (!handleDashboardRoutes(req, res, projectRoot, port)) {
          res.writeHead(404, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: "Not found" }))
        }
      }).catch(() => {
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Dashboard module failed to load" }))
      })
      return
    }

    // All other endpoints require auth
    if (!validateAuth(req, projectRoot, url)) {
      telemetry.track({
        category: 'context_hub',
        event: 'context_hub:auth_failed',
        endpoint: pathname,
      })
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

          telemetry.track({
            category: 'context_hub',
            event: 'context_hub:context_loaded',
            item_count: context.items.length,
            journal_count: context.items.filter(i => i.source === 'journal').length,
            knowledge_count: context.items.filter(i => i.source === 'knowledge').length,
            code_count: context.items.filter(i => i.source === 'code').length,
            query_length: query ? query.length : 0,
          })

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

          const searchStart = Date.now()
          const context = getUnifiedContext(projectRoot, query)
          context.items = context.items
            .filter(item => item.relevance && item.relevance > 0)
            .slice(0, maxItems)

          telemetry.track({
            category: 'context_hub',
            event: 'context_hub:search',
            result_count: context.items.length,
            duration_ms: Date.now() - searchStart,
            has_query: true,
            query_length: query.length,
          })

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

    // Memory search
    if (url.pathname === "/api/memory/search" && req.method === "POST") {
      let body = ""
      req.on("data", chunk => body += chunk)
      req.on("end", async () => {
        try {
          const { query, type, maxItems = 10, since } = JSON.parse(body || "{}")
          if (!query) {
            res.writeHead(400, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ error: "query required" }))
            return
          }

          const results = await searchMemories(query, { type, maxItems, since })

          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ results }))
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: err.message }))
        }
      })
      return
    }

    // Memory status
    if (url.pathname === "/api/memory/status" && req.method === "GET") {
      getMemoryStats()
        .then(stats => {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify(stats))
        })
        .catch((err: any) => {
          res.writeHead(500, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: err.message }))
        })
      return
    }

    // Memory add
    if (url.pathname === "/api/memory/add" && req.method === "POST") {
      let body = ""
      req.on("data", chunk => body += chunk)
      req.on("end", async () => {
        try {
          const { title, content, tags } = JSON.parse(body || "{}")
          if (!title || !content) {
            res.writeHead(400, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ error: "title and content required" }))
            return
          }

          const id = await insertMemory({
            source: 'manual',
            title,
            content,
            created_at: new Date().toISOString()
          })

          res.writeHead(201, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ id }))
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: err.message }))
        }
      })
      return
    }

    // Cross-project health
    if (url.pathname === "/api/projects" && req.method === "GET") {
      const tracked = getTrackedProjects()
      Promise.all(
        tracked.map(async (p) => {
          // Self-check: if this is our own port, we know we're OK
          if (p.port === port) {
            return {
              name: p.path.split("/").pop() || p.path,
              path: p.path,
              port: p.port,
              status: "OK" as DoctorStatus,
              pid: process.pid,
              message: "This instance",
            }
          }
          const result = await diagnoseProject(p.path, p.port)
          return {
            name: p.path.split("/").pop() || p.path,
            path: p.path,
            port: p.port,
            status: result.status,
            pid: result.pid,
            message: result.message,
          }
        })
      )
        .then((results) => {
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify(results))
        })
        .catch((err: any) => {
          res.writeHead(500, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: err.message }))
        })
      return
    }

    // Publish event
    if (url.pathname === "/api/events" && req.method === "POST") {
      if (!eventBus) {
        res.writeHead(503, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Event bus not initialized" }))
        return
      }
      let body = ""
      req.on("data", chunk => body += chunk)
      req.on("end", () => {
        try {
          const { type, source, target, session, data, ttl } = JSON.parse(body || "{}")
          if (!type || !source) {
            res.writeHead(400, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ error: "type and source required" }))
            return
          }
          const event = eventBus.emit({
            type: type as MAPEventType,
            source,
            target,
            session,
            data: data || {},
            ttl,
          })
          res.writeHead(201, { "Content-Type": "application/json" })
          res.end(JSON.stringify(event))
        } catch (err: any) {
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ error: err.message }))
        }
      })
      return
    }

    // Get recent events
    if (url.pathname === "/api/events" && req.method === "GET") {
      if (!eventBus) {
        res.writeHead(503, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Event bus not initialized" }))
        return
      }
      const since = url.searchParams.get("since") || undefined
      const pattern = url.searchParams.get("pattern") || undefined
      const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : 50

      const events = eventBus.getEvents({ since, pattern, limit })
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ events, count: events.length }))
      return
    }

    // SSE event stream
    if (url.pathname === "/api/events/stream" && req.method === "GET") {
      if (!eventBus) {
        res.writeHead(503, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "Event bus not initialized" }))
        return
      }
      const patterns = (url.searchParams.get("patterns") || "*").split(",")

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      })
      res.write("retry: 3000\n\n")

      const sub = eventBus.subscribe({
        clientId: `sse-${Date.now()}`,
        patterns,
        transport: "sse",
        callback: (event) => {
          res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        },
      })

      req.on("close", () => {
        eventBus.unsubscribe(sub.id)
      })
      return
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Not found" }))
  })

  // WebSocket upgrade for event streaming
  if (eventBus) {
    const wss = new WebSocketServer({ noServer: true })

    server.on("upgrade", (request, socket, head) => {
      const reqUrl = new URL(request.url || "/", `http://localhost:${port}`)

      if (reqUrl.pathname !== "/ws/events") {
        socket.destroy()
        return
      }

      if (!validateAuth(request, projectRoot, reqUrl)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
        socket.destroy()
        return
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        const patterns = (reqUrl.searchParams.get("patterns") || "*").split(",")

        const sub = eventBus.subscribe({
          clientId: `ws-${Date.now()}`,
          patterns,
          transport: "websocket",
          callback: (event) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify(event))
            }
          },
        })

        ws.on("close", () => {
          eventBus.unsubscribe(sub.id)
        })

        ws.on("error", () => {
          eventBus.unsubscribe(sub.id)
        })
      })
    })
  }

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

// ============================================================================
// Cross-Project Helpers
// ============================================================================

function getTrackedProjects(): Array<{ path: string; port: number }> {
  // Read from both config sources (Conf library + XDG config)
  const confStore = new Conf({ projectName: "jfl" })
  const confProjects = (confStore.get("projects") as string[]) || []
  const xdgProjects = (getConfigValue("projects") as string[]) || []

  // Deduplicate
  const allPaths = [...new Set([...confProjects, ...xdgProjects])]

  return allPaths
    .filter(p => fs.existsSync(path.join(p, ".jfl")))
    .map(p => ({ path: p, port: getProjectPort(p) }))
}

async function ensureForProject(
  projectRoot: string,
  port: number,
  quiet = false
): Promise<{ status: "running" | "started" | "failed"; message: string }> {
  const status = isRunning(projectRoot)
  if (status.running) {
    try {
      const response = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(2000)
      })
      if (response.ok) {
        return { status: "running", message: `Already running (PID: ${status.pid})` }
      }
    } catch {
      // Process exists but not responding, fall through
    }
  }

  const portInUse = await isPortInUse(port)
  if (portInUse) {
    try {
      const response = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(2000)
      })
      if (response.ok) {
        return { status: "running", message: "Running (PID file missing but healthy)" }
      }
    } catch {
      // Not responding
    }

    try {
      const lsofOutput = execSync(`lsof -ti :${port}`, { encoding: 'utf-8' }).trim()
      if (lsofOutput) {
        const orphanedPid = parseInt(lsofOutput.split('\n')[0], 10)
        if (!status.pid || orphanedPid !== status.pid) {
          process.kill(orphanedPid, 'SIGTERM')
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
    } catch {
      // lsof failed or process already gone
    }
  }

  const result = await startDaemon(projectRoot, port)
  if (result.success) {
    return { status: "started", message: result.message }
  }
  return { status: "failed", message: result.message }
}

type DoctorStatus = "OK" | "ZOMBIE" | "DOWN" | "STALE"

interface DoctorResult {
  path: string
  port: number
  status: DoctorStatus
  pid?: number
  message?: string
}

async function diagnoseProject(projectPath: string, port: number): Promise<DoctorResult> {
  if (!fs.existsSync(projectPath)) {
    return { path: projectPath, port, status: "STALE", message: "Directory does not exist" }
  }

  const pidStatus = isRunning(projectPath)
  if (!pidStatus.running) {
    return { path: projectPath, port, status: "DOWN", pid: undefined }
  }

  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(2000)
    })
    if (response.ok) {
      return { path: projectPath, port, status: "OK", pid: pidStatus.pid }
    }
  } catch {
    // Not responding
  }

  return { path: projectPath, port, status: "ZOMBIE", pid: pidStatus.pid, message: "PID exists but not responding" }
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

  // Start as detached process with CONTEXT_HUB_DAEMON=1 so the serve
  // action knows to ignore SIGTERM during its startup grace period
  const child = spawn(jflCmd, ["context-hub", "serve", "--port", String(port)], {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", fs.openSync(logFile, "a"), fs.openSync(logFile, "a")],
    env: { ...process.env, NODE_ENV: "production", CONTEXT_HUB_DAEMON: "1" }
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

    // Clean up PID file (preserve token for seamless restart)
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile)
    }

    return { success: true, message: "Context Hub stopped" }
  } catch (err) {
    return { success: false, message: `Failed to stop daemon: ${err}` }
  }
}

// ============================================================================
// Auto-Install Daemon
// ============================================================================

export async function ensureDaemonInstalled(opts?: { quiet?: boolean }): Promise<boolean> {
  const quiet = opts?.quiet ?? false

  if (process.platform !== "darwin") {
    return false
  }

  const plistLabel = "com.jfl.context-hub"
  const plistDir = path.join(homedir(), "Library", "LaunchAgents")
  const plistPath = path.join(plistDir, `${plistLabel}.plist`)
  const logPath = path.join(homedir(), ".config", "jfl", "context-hub-agent.log")

  // If plist exists, check if loaded
  if (fs.existsSync(plistPath)) {
    try {
      const output = execSync("launchctl list", { encoding: "utf-8" })
      if (output.includes(plistLabel)) {
        return true
      }
    } catch {
      // launchctl failed, try to reload
    }

    // Exists but not loaded — reload it
    try {
      execSync(`launchctl load "${plistPath}"`, { stdio: "ignore" })
      if (!quiet) {
        console.log(chalk.green(`\n  Daemon reloaded.`))
        console.log(chalk.gray(`  Plist: ${plistPath}\n`))
      }
      return true
    } catch {
      // Fall through to full install
    }
  }

  // Full install
  let jflPath = ""
  try {
    jflPath = execSync("which jfl", { encoding: "utf-8" }).trim()
  } catch {
    jflPath = process.argv[1] || "jfl"
  }

  const logDir = path.dirname(logPath)
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${plistLabel}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${jflPath}</string>
        <string>context-hub</string>
        <string>ensure-all</string>
        <string>--quiet</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>300</integer>
    <key>ProcessType</key>
    <string>Background</string>
    <key>LowPriorityIO</key>
    <true/>
    <key>Nice</key>
    <integer>10</integer>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${logPath}</string>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
</dict>
</plist>
`

  if (!fs.existsSync(plistDir)) {
    fs.mkdirSync(plistDir, { recursive: true })
  }

  // Unload if partially loaded
  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: "ignore" })
  } catch {
    // Not loaded, fine
  }

  fs.writeFileSync(plistPath, plistContent)

  try {
    execSync(`launchctl load "${plistPath}"`)
    if (!quiet) {
      console.log(chalk.green(`\n  Daemon installed and loaded.`))
      console.log(chalk.gray(`  Plist: ${plistPath}`))
      console.log(chalk.gray(`  Log:   ${logPath}`))
      console.log(chalk.gray(`  Runs ensure-all every 5 minutes + on login.\n`))
    }
    return true
  } catch {
    if (!quiet) {
      console.log(chalk.red(`\n  Failed to load daemon.\n`))
    }
    return false
  }
}

// ============================================================================
// CLI Command
// ============================================================================

export async function contextHubCommand(
  action?: string,
  options: { port?: number; global?: boolean; quiet?: boolean } = {}
) {
  const isGlobal = options.global || false
  const projectRoot = isGlobal ? homedir() : process.cwd()
  const port = options.port || getProjectPort(projectRoot)

  // Ensure directories exist
  if (isGlobal) {
    // Global mode: use XDG directories
    const { JFL_PATHS, ensureJflDirs } = await import("../utils/jfl-paths.js")
    ensureJflDirs()
  } else {
    // Project mode: use .jfl/
    const jflDir = path.join(projectRoot, ".jfl")
    if (!fs.existsSync(jflDir)) {
      fs.mkdirSync(jflDir, { recursive: true })
    }
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
      await ensureForProject(projectRoot, port, true)
      break
    }

    case "ensure-all": {
      const tracked = getTrackedProjects()
      if (tracked.length === 0) {
        if (!options.quiet) {
          console.log(chalk.yellow("\n  No tracked projects found.\n"))
        }
        break
      }

      const results: Array<{ name: string; result: Awaited<ReturnType<typeof ensureForProject>> }> = []

      for (const project of tracked) {
        const name = path.basename(project.path)
        const result = await ensureForProject(project.path, project.port, true)
        results.push({ name, result })
      }

      if (!options.quiet) {
        console.log(chalk.bold("\n  Context Hub - ensure-all\n"))
        for (const { name, result } of results) {
          const icon = result.status === "failed" ? chalk.red("✗") : chalk.green("✓")
          const label = result.status === "started" ? chalk.cyan("started") :
                        result.status === "running" ? chalk.green("running") :
                        chalk.red("failed")
          console.log(`  ${icon} ${chalk.bold(name)} — ${label}`)
        }
        const ok = results.filter(r => r.result.status !== "failed").length
        const fail = results.filter(r => r.result.status === "failed").length
        console.log(chalk.gray(`\n  ${ok} running, ${fail} failed\n`))
      }
      break
    }

    case "doctor": {
      const confStoreDoctor = new Conf({ projectName: "jfl" })
      const confProjectsDoctor = (confStoreDoctor.get("projects") as string[]) || []
      const xdgProjectsDoctor = (getConfigValue("projects") as string[]) || []
      const allProjects = [...new Set([...confProjectsDoctor, ...xdgProjectsDoctor])]

      if (allProjects.length === 0) {
        console.log(chalk.yellow("\n  No tracked projects found.\n"))
        break
      }

      const cleanMode = process.argv.includes("--clean")

      if (cleanMode) {
        const before = allProjects.length
        const valid = allProjects.filter(p => fs.existsSync(p))
        // Write cleaned list back to both stores
        confStoreDoctor.set("projects", valid.filter(p => confProjectsDoctor.includes(p)))
        setConfig("projects", valid.filter(p => xdgProjectsDoctor.includes(p)))
        const removed = before - valid.length
        if (removed > 0) {
          console.log(chalk.green(`\n  Removed ${removed} stale project${removed > 1 ? "s" : ""} from tracker.\n`))
        } else {
          console.log(chalk.green("\n  No stale projects found.\n"))
        }
        break
      }

      console.log(chalk.bold("\n  Context Hub - doctor\n"))

      let staleCount = 0
      let downCount = 0
      let zombieCount = 0
      let okCount = 0

      for (const projectPath of allProjects) {
        const projectPort = getProjectPort(projectPath)
        const result = await diagnoseProject(projectPath, projectPort)
        const name = path.basename(result.path)

        switch (result.status) {
          case "OK":
            console.log(`  ${chalk.green("OK")}     ${chalk.bold(name)} — PID ${result.pid}, port ${result.port}`)
            okCount++
            break
          case "ZOMBIE":
            console.log(`  ${chalk.red("ZOMBIE")} ${chalk.bold(name)} — PID ${result.pid} not responding on port ${result.port}`)
            zombieCount++
            break
          case "DOWN":
            console.log(`  ${chalk.red("DOWN")}   ${chalk.bold(name)} — not running (port ${result.port})`)
            downCount++
            break
          case "STALE":
            console.log(`  ${chalk.yellow("STALE")}  ${chalk.gray(result.path)} — directory missing`)
            staleCount++
            break
        }
      }

      console.log()
      if (downCount > 0 || zombieCount > 0) {
        console.log(chalk.gray(`  Hint: run ${chalk.cyan("jfl context-hub ensure-all")} to start all hubs`))
      }
      if (staleCount > 0) {
        console.log(chalk.gray(`  Hint: run ${chalk.cyan("jfl context-hub doctor --clean")} to remove stale entries`))
      }
      if (okCount === allProjects.length) {
        console.log(chalk.green("  All projects healthy."))
      }
      console.log()
      break
    }

    case "install-daemon": {
      const result = await ensureDaemonInstalled({ quiet: false })
      if (!result) {
        console.log(chalk.yellow("\n  Daemon install skipped (non-macOS or failed).\n"))
      }
      break
    }

    case "uninstall-daemon": {
      const plistLabel = "com.jfl.context-hub"
      const plistPath = path.join(homedir(), "Library", "LaunchAgents", `${plistLabel}.plist`)

      if (!fs.existsSync(plistPath)) {
        console.log(chalk.yellow("\n  Daemon not installed.\n"))
        break
      }

      try {
        execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" })
      } catch {
        // Already unloaded
      }

      fs.unlinkSync(plistPath)
      console.log(chalk.green("\n  Daemon uninstalled.\n"))
      break
    }

    case "serve": {
      // Run server in foreground (used by daemon)
      const serviceEventsPath = path.join(projectRoot, ".jfl", "service-events.jsonl")
      const mapPersistPath = path.join(projectRoot, ".jfl", "map-events.jsonl")
      const journalDir = path.join(projectRoot, ".jfl", "journal")

      const eventBus = new MAPEventBus({
        maxSize: 1000,
        persistPath: mapPersistPath,
        serviceEventsPath,
        journalDir: fs.existsSync(journalDir) ? journalDir : null,
      })

      const server = createServer(projectRoot, port, eventBus)
      let isListening = false

      // When spawned as daemon, ignore SIGTERM during startup grace period.
      // The parent process (hook runner) may exit and send SIGTERM to the
      // process group before we're fully detached. After grace period,
      // re-enable normal shutdown handling.
      const isDaemon = process.env.CONTEXT_HUB_DAEMON === "1"
      let startupGrace = isDaemon
      if (isDaemon) {
        setTimeout(() => {
          startupGrace = false
        }, 5000)
      }

      // Error handling - keep process alive
      process.on("uncaughtException", (err) => {
        console.error(`Uncaught exception: ${err.message}`)
        console.error(err.stack)
        telemetry.track({
          category: 'error',
          event: 'error:hub_crash',
          error_type: err.constructor.name,
          error_code: (err as any).code || undefined,
          hub_port: port,
          hub_uptime_s: isListening ? Math.floor((Date.now() - hubStartTime) / 1000) : 0,
        })
      })

      process.on("unhandledRejection", (reason, promise) => {
        console.error(`Unhandled rejection at ${promise}: ${reason}`)
        // Don't exit - log and continue
      })

      server.on("error", (err: any) => {
        console.error(`Server error: ${err.message}`)
        telemetry.track({
          category: 'error',
          event: 'error:hub_server',
          error_type: err.constructor.name,
          error_code: err.code || undefined,
          hub_port: port,
        })
        if (err.code === "EADDRINUSE") {
          console.error(`Port ${port} is already in use. Exiting.`)
          process.exit(1)
        }
      })

      const hubStartTime = Date.now()

      server.listen(port, async () => {
        isListening = true
        const timestamp = new Date().toISOString()
        console.log(`[${timestamp}] Context Hub listening on port ${port}`)
        console.log(`[${timestamp}] PID: ${process.pid}`)

        telemetry.track({
          category: 'context_hub',
          event: 'context_hub:started',
          hub_port: port,
          duration_ms: Date.now() - hubStartTime,
        })

        // Initialize memory system
        try {
          await initializeDatabase()
          console.log(`[${timestamp}] Memory database initialized`)

          // Index existing journal entries
          const stats = await indexJournalEntries()
          if (stats.added > 0) {
            console.log(`[${timestamp}] Indexed ${stats.added} new journal entries`)
          }

          // Start periodic indexing (every 60 seconds)
          startPeriodicIndexing(60000)
          console.log(`[${timestamp}] Periodic memory indexing started`)
        } catch (err: any) {
          console.error(`[${timestamp}] Failed to initialize memory system:`, err.message)
          // Don't exit - memory is optional
        }

        console.log(`[${timestamp}] MAP event bus initialized (buffer: 1000, subscribers: ${eventBus.getSubscriberCount()})`)
        console.log(`[${timestamp}] Ready to serve requests`)
      })

      // Handle shutdown gracefully
      const shutdown = (signal: string) => {
        // During startup grace period (daemon mode), ignore SIGTERM from
        // parent process cleanup. This prevents the hook runner from
        // killing the hub before it's fully detached.
        if (startupGrace && signal === "SIGTERM") {
          const ts = new Date().toISOString()
          console.log(`[${ts}] Ignoring ${signal} during startup grace period (PID: ${process.pid}, Parent: ${process.ppid})`)
          return
        }
        if (!isListening) {
          // Server never started, just exit
          process.exit(0)
          return
        }
        // Log who sent the signal for debugging
        const timestamp = new Date().toISOString()
        console.log(`[${timestamp}] Received ${signal}`)
        console.log(`[${timestamp}] PID: ${process.pid}, Parent PID: ${process.ppid}`)
        console.log(`[${timestamp}] Shutting down...`)
        telemetry.track({
          category: 'context_hub',
          event: 'context_hub:stopped',
          hub_port: port,
          hub_uptime_s: Math.floor((Date.now() - hubStartTime) / 1000),
        })
        server.close(() => {
          eventBus.destroy()
          console.log(`[${new Date().toISOString()}] Server closed`)
          process.exit(0)
        })
        // Force exit after 5s if server doesn't close
        setTimeout(() => {
          console.log(`[${new Date().toISOString()}] Force exit after timeout`)
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
          const timestamp = new Date().toISOString()
          console.log(`[${timestamp}] Heartbeat: Still running (PID: ${process.pid})`)
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

    case "dashboard": {
      const token = getOrCreateToken(projectRoot)
      const dashUrl = `http://localhost:${port}/dashboard?token=${token}`
      try {
        execSync(`open "${dashUrl}"`)
      } catch {
        // open not available — print URL instead
      }
      console.log(chalk.gray(`  Opening ${dashUrl}`))
      break
    }

    case "clear-logs": {
      // Clear both global and local log files
      const { JFL_FILES } = await import("../utils/jfl-paths.js")
      const globalLogFile = path.join(JFL_FILES.servicesLogs, "context-hub.log")
      const localLogFile = getLogFile(projectRoot)

      let cleared = 0

      if (fs.existsSync(globalLogFile)) {
        fs.writeFileSync(globalLogFile, '')
        console.log(chalk.green('✓ Global Context Hub logs cleared'))
        console.log(chalk.gray(`  File: ${globalLogFile}`))
        cleared++
      }

      if (fs.existsSync(localLogFile) && localLogFile !== globalLogFile) {
        fs.writeFileSync(localLogFile, '')
        console.log(chalk.green('✓ Local Context Hub logs cleared'))
        console.log(chalk.gray(`  File: ${localLogFile}`))
        cleared++
      }

      if (cleared === 0) {
        console.log(chalk.yellow('No log files found'))
      }
      break
    }

    default: {
      console.log(chalk.bold("\n  Context Hub - Unified context for AI agents\n"))
      console.log(chalk.gray("  Commands:"))
      console.log("    jfl context-hub start            Start the daemon")
      console.log("    jfl context-hub stop             Stop the daemon")
      console.log("    jfl context-hub restart          Restart the daemon")
      console.log("    jfl context-hub status           Check if running")
      console.log("    jfl context-hub ensure           Start if not running (for hooks)")
      console.log("    jfl context-hub ensure-all       Ensure all tracked projects are running")
      console.log("    jfl context-hub doctor           Diagnose all tracked projects")
      console.log("    jfl context-hub doctor --clean   Remove stale project entries")
      console.log("    jfl context-hub dashboard        Open web dashboard in browser")
      console.log("    jfl context-hub install-daemon   Install macOS launchd keepalive")
      console.log("    jfl context-hub uninstall-daemon Remove macOS launchd keepalive")
      console.log("    jfl context-hub logs             Show real-time logs (TUI)")
      console.log("    jfl context-hub clear-logs       Clear log file")
      console.log("    jfl context-hub query            Quick context query")
      console.log()
      console.log(chalk.gray("  Options:"))
      console.log("    --port <port>   Port to run on (default: per-project)")
      console.log("    --quiet         Suppress output (for daemon use)")
      console.log()
    }
  }
}
