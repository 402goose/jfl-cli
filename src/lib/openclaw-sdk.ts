/**
 * OpenClaw TypeScript SDK
 *
 * Thin wrapper around Context Hub HTTP API and direct file I/O.
 * For Node.js agent runtimes (Clawdbot, custom) that prefer imports over shell-outs.
 *
 * Primary path: HTTP to Context Hub (fast, no process spawn).
 * Fallback: Shell out to `jfl openclaw` commands.
 *
 * @purpose Runtime-agnostic SDK for OpenClaw agent protocol
 * @spec specs/OPENCLAW_SPEC.md
 */

import { execSync } from "child_process"
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "fs"
import { join } from "path"
import axios, { type AxiosInstance } from "axios"

// ============================================================================
// Types
// ============================================================================

export interface OpenClawConfig {
  agentId: string
  hubUrl?: string
  gtmPath?: string
}

export interface SessionInfo {
  session_id: string
  branch: string
  gtm_path: string
  gtm_name: string
  context_hub: { url: string; healthy: boolean }
  auto_commit: { running: boolean; interval: number }
}

export interface HealthStatus {
  healthy: boolean
  context_hub: boolean
  uncommitted_changes: boolean
  last_commit: string | null
  session_duration_seconds: number
}

export interface ContextItem {
  source: string
  type: string
  title: string
  content: string
  path?: string
  relevance?: number
}

export interface MemoryResult {
  id: string
  title: string
  summary: string
  type: string
  ts: string
  relevance: string
  score: number
}

export interface JournalEntry {
  v: number
  ts: string
  session: string
  type: "feature" | "fix" | "decision" | "milestone" | "spec" | "discovery"
  status?: "complete" | "incomplete" | "blocked"
  title: string
  summary: string
  detail?: string
  files?: string[]
  decision?: string
  incomplete?: string[]
  next?: string
  learned?: string[]
}

export interface GtmInfo {
  id: string
  name: string
  path: string
  default: boolean
  registered_at: string
}

export interface ServiceInfo {
  name: string
  path: string
  type: string
  status: string
}

// ============================================================================
// Client
// ============================================================================

export class OpenClawClient {
  private agentId: string
  private hubUrl: string
  private gtmPath: string | null
  private http: AxiosInstance
  private sessionId: string | null = null

  constructor(config: OpenClawConfig) {
    this.agentId = config.agentId
    this.hubUrl = config.hubUrl || "http://localhost:4242"
    this.gtmPath = config.gtmPath || null

    this.http = axios.create({
      baseURL: this.hubUrl,
      timeout: 10000,
      headers: this.getAuthHeaders(),
    })
  }

  // ==========================================================================
  // Session Lifecycle
  // ==========================================================================

  async sessionStart(gtmPath?: string): Promise<SessionInfo> {
    const result = this.cli(
      `session-start --agent ${this.agentId}${gtmPath ? ` --gtm "${gtmPath}"` : ""} --json`
    )
    const info: SessionInfo = JSON.parse(result)
    this.sessionId = info.session_id
    this.gtmPath = info.gtm_path
    return info
  }

  async sessionEnd(sync: boolean = false): Promise<void> {
    this.cli(`session-end${sync ? " --sync" : ""} --json`)
    this.sessionId = null
  }

  async heartbeat(): Promise<HealthStatus> {
    const result = this.cli("heartbeat --json")
    return JSON.parse(result)
  }

  // ==========================================================================
  // Context (via HTTP API)
  // ==========================================================================

  async getContext(
    query?: string,
    taskType?: string
  ): Promise<ContextItem[]> {
    try {
      const resp = await this.http.post("/api/context", {
        query,
        taskType,
        maxItems: 30,
      })
      return resp.data.items || resp.data || []
    } catch {
      // Fallback to CLI
      const args = [
        query ? `--query "${query}"` : "",
        taskType ? `--task-type ${taskType}` : "",
      ]
        .filter(Boolean)
        .join(" ")
      const result = this.cli(`context ${args} --json`)
      return JSON.parse(result)
    }
  }

  async searchMemory(
    query: string,
    type?: string
  ): Promise<MemoryResult[]> {
    try {
      const resp = await this.http.post("/api/memory/search", {
        query,
        type,
        maxItems: 10,
      })
      return resp.data.results || resp.data || []
    } catch {
      // Fallback not available for memory search via CLI
      return []
    }
  }

  // ==========================================================================
  // Journal (direct JSONL append)
  // ==========================================================================

  async writeJournal(entry: Partial<JournalEntry>): Promise<void> {
    const session = this.sessionId || this.getCurrentSessionBranch()

    if (!session) {
      throw new Error("No active session. Call sessionStart() first.")
    }

    const gtmPath = this.resolveGtmPath()
    if (!gtmPath) {
      throw new Error("No GTM path resolved. Register with a GTM first.")
    }

    const journalDir = join(gtmPath, ".jfl", "journal")
    if (!existsSync(journalDir)) {
      mkdirSync(journalDir, { recursive: true })
    }

    const fullEntry: JournalEntry = {
      v: 1,
      ts: new Date().toISOString(),
      session,
      type: entry.type || "feature",
      title: entry.title || "Untitled",
      summary: entry.summary || "",
      ...entry,
    } as JournalEntry

    const journalFile = join(journalDir, `${session}.jsonl`)
    appendFileSync(journalFile, JSON.stringify(fullEntry) + "\n")
  }

  // ==========================================================================
  // GTM Management
  // ==========================================================================

  async listGtms(): Promise<GtmInfo[]> {
    const result = this.cli("gtm-list --json")
    return JSON.parse(result)
  }

  async switchGtm(gtmId: string): Promise<void> {
    this.cli(`gtm-switch "${gtmId}" --json`)
  }

  async createGtm(name: string, path?: string): Promise<string> {
    const args = path ? `"${name}" --path "${path}"` : `"${name}"`
    const result = this.cli(`gtm-create ${args} --json`)
    const parsed = JSON.parse(result)
    return parsed.path || parsed.gtm_path
  }

  // ==========================================================================
  // Service Coordination
  // ==========================================================================

  async tagService(name: string, message: string): Promise<void> {
    this.cli(`tag "${name}" "${message}"`)
  }

  async listServices(): Promise<ServiceInfo[]> {
    const gtmPath = this.resolveGtmPath()
    if (!gtmPath) return []

    const configPath = join(gtmPath, ".jfl", "config.json")
    if (!existsSync(configPath)) return []

    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"))
      return config.registered_services || []
    } catch {
      return []
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private cli(subcommand: string): string {
    try {
      return execSync(`jfl openclaw ${subcommand}`, {
        encoding: "utf-8",
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim()
    } catch (err: any) {
      throw new Error(
        `jfl openclaw ${subcommand} failed: ${err.stderr || err.message}`
      )
    }
  }

  private getAuthHeaders(): Record<string, string> {
    const gtmPath = this.resolveGtmPath()
    if (!gtmPath) return {}

    const tokenPath = join(gtmPath, ".jfl", "context-hub.token")
    if (!existsSync(tokenPath)) return {}

    const token = readFileSync(tokenPath, "utf-8").trim()
    return { Authorization: `Bearer ${token}` }
  }

  private resolveGtmPath(): string | null {
    if (this.gtmPath) return this.gtmPath

    // Try to get from registry via CLI
    try {
      const result = this.cli("status --json")
      const status = JSON.parse(result)
      return status.gtm_path || null
    } catch {
      return null
    }
  }

  private getCurrentSessionBranch(): string | null {
    try {
      return execSync("git branch --show-current", {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim()
    } catch {
      return null
    }
  }
}
