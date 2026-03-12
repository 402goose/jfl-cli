/**
 * @purpose Cmux backend — socket client for cmux workspace app (JSON-newline protocol)
 */

import { createConnection, Socket } from "net"
import { existsSync } from "fs"
import { execSync } from "child_process"
import type {
  WorkspaceBackend,
  BackendCapabilities,
  CreateSurfaceOpts,
  StatusEntry,
  LogEntry,
  NotificationOpts,
} from "./backend.js"

const SOCKET_PATH = "/tmp/cmux.sock"

interface CmuxResponse {
  ok: boolean
  id?: string
  error?: string
  [key: string]: unknown
}

export class CmuxAdapter implements WorkspaceBackend {
  readonly name = "cmux"
  private socket: Socket | null = null
  private buffer = ""
  private pending = new Map<number, { resolve: (v: CmuxResponse) => void; reject: (e: Error) => void }>()
  private seq = 0

  isAvailable(): boolean {
    if (process.env.CMUX_WORKSPACE_ID) return true
    if (existsSync(SOCKET_PATH)) return true
    try {
      execSync("which cmux", { stdio: "ignore" })
      return true
    } catch {
      return false
    }
  }

  async connect(): Promise<void> {
    if (this.socket) return

    return new Promise((resolve, reject) => {
      const sock = createConnection(SOCKET_PATH)
      const timeout = setTimeout(() => {
        sock.destroy()
        reject(new Error("cmux socket connection timeout"))
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
          try {
            const msg = JSON.parse(line) as CmuxResponse & { seq?: number }
            if (msg.seq !== undefined && this.pending.has(msg.seq)) {
              const p = this.pending.get(msg.seq)!
              this.pending.delete(msg.seq)
              if (msg.ok) p.resolve(msg)
              else p.reject(new Error(msg.error || "cmux error"))
            }
          } catch {}
        }
      })

      sock.on("error", (err) => {
        clearTimeout(timeout)
        reject(err)
      })

      sock.on("close", () => {
        this.socket = null
        for (const [, p] of this.pending) {
          p.reject(new Error("cmux socket closed"))
        }
        this.pending.clear()
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

  private send(method: string, params: Record<string, unknown> = {}): Promise<CmuxResponse> {
    if (!this.socket) throw new Error("cmux not connected")

    const seq = this.seq++
    const msg = JSON.stringify({ seq, method, ...params }) + "\n"

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(seq)
        reject(new Error(`cmux timeout: ${method}`))
      }, 10000)

      this.pending.set(seq, {
        resolve: (v) => { clearTimeout(timeout); resolve(v) },
        reject: (e) => { clearTimeout(timeout); reject(e) },
      })

      this.socket!.write(msg)
    })
  }

  async createWorkspace(name: string): Promise<string> {
    const res = await this.send("workspace.create", { name })
    return res.id || name
  }

  async closeWorkspace(id: string): Promise<void> {
    await this.send("workspace.close", { id })
  }

  async createSurface(opts: CreateSurfaceOpts): Promise<string> {
    const params: Record<string, unknown> = {
      workspace: opts.workspaceId,
      title: opts.title,
    }
    if (opts.command) params.command = opts.command
    if (opts.size) params.size = opts.size
    if (opts.focus) params.focus = true
    if (opts.splitFrom) {
      params.split_from = opts.splitFrom
      params.split_direction = opts.splitDirection || "horizontal"
    }

    const res = await this.send("surface.create", params)
    return res.id || opts.title
  }

  async closeSurface(id: string): Promise<void> {
    await this.send("surface.close", { id })
  }

  async splitSurface(id: string, direction: "horizontal" | "vertical"): Promise<string> {
    const res = await this.send("surface.split", { id, direction })
    return res.id || ""
  }

  async focusSurface(id: string): Promise<void> {
    await this.send("surface.focus", { id })
  }

  async sendText(surfaceId: string, text: string): Promise<void> {
    await this.send("surface.send_text", { id: surfaceId, text })
  }

  async setStatus(surfaceId: string, entries: StatusEntry[]): Promise<void> {
    await this.send("surface.set_status", { id: surfaceId, entries })
  }

  async setProgress(surfaceId: string, label: string, value: number): Promise<void> {
    await this.send("surface.set_progress", { id: surfaceId, label, value: Math.max(0, Math.min(1, value)) })
  }

  async addLog(surfaceId: string, entry: LogEntry): Promise<void> {
    await this.send("surface.add_log", { id: surfaceId, entry })
  }

  async notify(opts: NotificationOpts): Promise<void> {
    await this.send("notify", {
      surface: opts.surfaceId,
      title: opts.title,
      body: opts.body,
      urgency: opts.urgency || "normal",
    })
  }
}
