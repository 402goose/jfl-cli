/**
 * @purpose Cmux backend — socket client using cmux's real V1/V2 protocol
 *
 * cmux has two socket protocols:
 *   V1: plain text commands, newline-delimited (used for sidebar, notifications, focus)
 *   V2: JSON {"id": uuid, "method": "...", "params": {...}} → {"ok": true, "result": {...}}
 *       Used for workspace/pane/surface CRUD
 *
 * Socket path resolution:
 *   1. CMUX_SOCKET_PATH or CMUX_SOCKET env
 *   2. /tmp/cmux.sock (default)
 *   3. /tmp/cmux-debug.sock (fallback)
 *   4. /tmp/cmux-staging.sock (fallback)
 *
 * Reference: github.com/manaflow-ai/cmux CLI/cmux.swift
 */

import { createConnection, Socket } from "net"
import { existsSync } from "fs"
import { execSync } from "child_process"
import { randomUUID } from "crypto"
import type {
  WorkspaceBackend,
  BackendCapabilities,
  CreateSurfaceOpts,
  StatusEntry,
  LogEntry,
  NotificationOpts,
} from "./backend.js"

const SOCKET_PATHS = [
  "/tmp/cmux.sock",
  "/tmp/cmux-debug.sock",
  "/tmp/cmux-staging.sock",
]

function resolveSocketPath(): string {
  const envPath = process.env.CMUX_SOCKET_PATH || process.env.CMUX_SOCKET
  if (envPath && existsSync(envPath)) return envPath
  for (const p of SOCKET_PATHS) {
    if (existsSync(p)) return p
  }
  return SOCKET_PATHS[0]
}

export class CmuxAdapter implements WorkspaceBackend {
  readonly name = "cmux"
  private socket: Socket | null = null
  private socketPath: string
  private buffer = ""
  private responseQueue: Array<{ resolve: (v: string) => void; reject: (e: Error) => void }> = []

  constructor() {
    this.socketPath = resolveSocketPath()
  }

  isAvailable(): boolean {
    if (process.env.CMUX_WORKSPACE_ID) return true
    if (process.env.CMUX_SOCKET_PATH || process.env.CMUX_SOCKET) {
      const p = process.env.CMUX_SOCKET_PATH || process.env.CMUX_SOCKET
      if (p && existsSync(p)) return true
    }
    for (const p of SOCKET_PATHS) {
      if (existsSync(p)) return true
    }
    try {
      execSync("which cmux", { stdio: "ignore" })
      return true
    } catch {
      return false
    }
  }

  async connect(): Promise<void> {
    if (this.socket) return
    this.socketPath = resolveSocketPath()

    return new Promise((resolve, reject) => {
      const sock = createConnection(this.socketPath)
      const timeout = setTimeout(() => {
        sock.destroy()
        reject(new Error(`cmux socket timeout: ${this.socketPath}`))
      }, 5000)

      sock.on("connect", () => {
        clearTimeout(timeout)
        this.socket = sock
        resolve()
      })

      sock.on("data", (data) => {
        this.buffer += data.toString()
        const lines = this.buffer.split("\n")
        this.buffer = lines.pop() || ""
        for (const line of lines) {
          if (!line.trim()) continue
          const pending = this.responseQueue.shift()
          if (pending) pending.resolve(line)
        }
      })

      sock.on("error", (err) => {
        clearTimeout(timeout)
        if (!this.socket) reject(err)
      })

      sock.on("close", () => {
        this.socket = null
        for (const p of this.responseQueue) {
          p.reject(new Error("cmux socket closed"))
        }
        this.responseQueue = []
      })
    })
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
  }

  capabilities(): BackendCapabilities {
    return { sidebar: true, notifications: true, mouse: true }
  }

  // V1 protocol: plain text command, newline-terminated, plain text response
  private sendV1(command: string): Promise<string> {
    if (!this.socket) throw new Error("cmux not connected")
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this.responseQueue.findIndex((p) => p.resolve === wrappedResolve)
        if (idx >= 0) this.responseQueue.splice(idx, 1)
        reject(new Error(`cmux V1 timeout: ${command}`))
      }, 10000)

      const wrappedResolve = (v: string) => { clearTimeout(timeout); resolve(v) }
      const wrappedReject = (e: Error) => { clearTimeout(timeout); reject(e) }

      this.responseQueue.push({ resolve: wrappedResolve, reject: wrappedReject })
      this.socket!.write(command + "\n")
    })
  }

  // V2 protocol: JSON request → JSON response with ok/error
  private async sendV2(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const request = JSON.stringify({ id: randomUUID(), method, params })
    const raw = await this.sendV1(request)

    if (raw.startsWith("ERROR:")) {
      throw new Error(raw)
    }

    const response = JSON.parse(raw)
    if (response.ok) {
      return response.result || {}
    }
    if (response.error) {
      throw new Error(`${response.error.code || "error"}: ${response.error.message || "Unknown"}`)
    }
    throw new Error("V2 request failed")
  }

  private getWorkspaceId(): string {
    return process.env.CMUX_WORKSPACE_ID || ""
  }

  // --- Workspace lifecycle ---

  async createWorkspace(name: string): Promise<string> {
    const result = await this.sendV2("workspace.create", { cwd: process.cwd() })
    const wsId = (result.workspace_ref as string) || (result.workspace_id as string) || name
    return wsId
  }

  async closeWorkspace(id: string): Promise<void> {
    await this.sendV2("workspace.close", { workspace_id: id })
  }

  // --- Surface/pane management ---

  async createSurface(opts: CreateSurfaceOpts): Promise<string> {
    let surfaceId: string

    if (opts.splitFrom) {
      // Split from existing surface
      const direction = opts.splitDirection === "vertical" ? "down" : "right"
      const params: Record<string, unknown> = {
        direction,
        workspace_id: opts.workspaceId,
      }
      if (opts.splitFrom) params.surface_id = opts.splitFrom
      const result = await this.sendV2("surface.split", params)
      surfaceId = (result.surface_ref as string) || (result.surface_id as string) || ""
    } else {
      // Create new pane
      const params: Record<string, unknown> = {
        workspace_id: opts.workspaceId,
        direction: "right",
      }
      const result = await this.sendV2("pane.create", params)
      surfaceId = (result.surface_ref as string) || (result.surface_id as string) || ""
    }

    // Send command to surface if specified
    if (opts.command && surfaceId) {
      await this.sleep(500)
      await this.sendV2("surface.send_text", {
        text: opts.command + "\n",
        surface_id: surfaceId,
        workspace_id: opts.workspaceId,
      })
    }

    if (opts.focus && surfaceId) {
      try {
        await this.sendV2("pane.focus", {
          surface_id: surfaceId,
          workspace_id: opts.workspaceId,
        })
      } catch {}
    }

    return surfaceId
  }

  async closeSurface(id: string): Promise<void> {
    await this.sendV2("surface.close", { surface_id: id })
  }

  async splitSurface(id: string, direction: "horizontal" | "vertical"): Promise<string> {
    const dir = direction === "vertical" ? "down" : "right"
    const result = await this.sendV2("surface.split", { surface_id: id, direction: dir })
    return (result.surface_ref as string) || (result.surface_id as string) || ""
  }

  async focusSurface(id: string): Promise<void> {
    await this.sendV2("pane.focus", { surface_id: id })
  }

  async sendText(surfaceId: string, text: string): Promise<void> {
    await this.sendV2("surface.send_text", { surface_id: surfaceId, text: text + "\n" })
  }

  // --- Sidebar metadata (V1 protocol) ---

  async setStatus(surfaceId: string, entries: StatusEntry[]): Promise<void> {
    const wsId = this.getWorkspaceId() || surfaceId
    for (const entry of entries) {
      let cmd = `set_status ${entry.label} ${this.socketQuote(entry.value)} --tab=${wsId}`
      if (entry.color) cmd += ` --color=${entry.color}`
      await this.sendV1(cmd)
    }
  }

  async setProgress(surfaceId: string, label: string, value: number): Promise<void> {
    const wsId = this.getWorkspaceId() || surfaceId
    const clamped = Math.max(0, Math.min(1, value))
    let cmd = `set_progress ${clamped}`
    if (label) cmd += ` --label=${this.socketQuote(label)}`
    cmd += ` --tab=${wsId}`
    await this.sendV1(cmd)
  }

  async addLog(surfaceId: string, entry: LogEntry): Promise<void> {
    const wsId = this.getWorkspaceId() || surfaceId
    let cmd = `log --level=${entry.level}`
    cmd += ` --tab=${wsId} -- ${this.socketQuote(entry.message)}`
    await this.sendV1(cmd)
  }

  // --- Notifications (V1 protocol) ---

  async notify(opts: NotificationOpts): Promise<void> {
    const wsId = this.getWorkspaceId() || opts.surfaceId
    const sfId = opts.surfaceId || ""
    let payload = `--title ${this.socketQuote(opts.title)}`
    if (opts.body) payload += ` --body ${this.socketQuote(opts.body)}`
    await this.sendV1(`notify_target ${wsId} ${sfId} ${payload}`)
  }

  private socketQuote(text: string): string {
    if (/^[a-zA-Z0-9._\-/]+$/.test(text)) return text
    return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }
}
