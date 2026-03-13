/**
 * @purpose Tmux backend — exec-based fallback with mouse support, no sidebar/notifications
 */

import { execSync } from "child_process"
import type {
  WorkspaceBackend,
  BackendCapabilities,
  CreateSurfaceOpts,
  StatusEntry,
  LogEntry,
  NotificationOpts,
} from "./backend.js"

export class TmuxAdapter implements WorkspaceBackend {
  readonly name = "tmux"
  private sessionName = ""

  isAvailable(): boolean {
    try {
      execSync("which tmux", { stdio: "ignore" })
      return true
    } catch {
      return false
    }
  }

  async connect(): Promise<void> {
    // Enable mouse support globally for any tmux session we create
  }

  async disconnect(): Promise<void> {
    // No persistent connection
  }

  capabilities(): BackendCapabilities {
    return { sidebar: false, notifications: false, mouse: true }
  }

  private exec(cmd: string): string {
    try {
      return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim()
    } catch {
      return ""
    }
  }

  private sessionExists(name: string): boolean {
    try {
      execSync(`tmux has-session -t "${name}" 2>/dev/null`, { stdio: "ignore" })
      return true
    } catch {
      return false
    }
  }

  async createWorkspace(name: string): Promise<string> {
    this.sessionName = name

    if (this.sessionExists(name)) {
      return name
    }

    this.exec(`tmux new-session -d -s "${name}" -x 200 -y 50`)
    // Enable mouse
    this.exec(`tmux set-option -t "${name}" -g mouse on`)
    // Better key bindings that don't conflict with Claude Code
    this.exec(`tmux set-option -t "${name}" prefix C-a`)
    return name
  }

  async closeWorkspace(id: string): Promise<void> {
    this.exec(`tmux kill-session -t "${id}"`)
  }

  async createSurface(opts: CreateSurfaceOpts): Promise<string> {
    const session = opts.workspaceId || this.sessionName
    const paneId = `${session}:${opts.title.replace(/\s+/g, "-").toLowerCase()}`

    if (opts.splitFrom) {
      const dir = opts.splitDirection === "vertical" ? "-v" : "-h"
      const sizeFlag = opts.size ? `-p ${parseInt(opts.size)}` : ""
      const result = this.exec(`tmux split-window ${dir} ${sizeFlag} -t "${opts.splitFrom}" -P -F "#{pane_id}"`)

      if (opts.command) {
        this.exec(`tmux send-keys -t "${result || opts.splitFrom}" "${this.escapeForTmux(opts.command)}" Enter`)
      }

      if (opts.focus) {
        this.exec(`tmux select-pane -t "${result || opts.splitFrom}"`)
      }

      return result || paneId
    }

    // Create new window
    const result = this.exec(`tmux new-window -t "${session}" -n "${opts.title}" -P -F "#{pane_id}"`)

    if (opts.command) {
      this.exec(`tmux send-keys -t "${result || session}" "${this.escapeForTmux(opts.command)}" Enter`)
    }

    if (opts.focus) {
      this.exec(`tmux select-window -t "${session}:${opts.title}"`)
    }

    return result || paneId
  }

  async closeSurface(id: string): Promise<void> {
    this.exec(`tmux kill-pane -t "${id}"`)
  }

  async splitSurface(id: string, direction: "horizontal" | "vertical"): Promise<string> {
    const dir = direction === "vertical" ? "-v" : "-h"
    const result = this.exec(`tmux split-window ${dir} -t "${id}" -P -F "#{pane_id}"`)
    return result || ""
  }

  async focusSurface(id: string): Promise<void> {
    this.exec(`tmux select-pane -t "${id}"`)
  }

  async sendText(surfaceId: string, text: string): Promise<void> {
    this.exec(`tmux send-keys -t "${surfaceId}" "${this.escapeForTmux(text)}" Enter`)
  }

  // No-ops for tmux (no sidebar support)
  async setStatus(_surfaceId: string, _entries: StatusEntry[]): Promise<void> {}
  async setProgress(_surfaceId: string, _label: string, _value: number): Promise<void> {}
  async addLog(_surfaceId: string, _entry: LogEntry): Promise<void> {}
  async notify(_opts: NotificationOpts): Promise<void> {}

  private escapeForTmux(text: string): string {
    return text.replace(/"/g, '\\"').replace(/\$/g, "\\$")
  }
}
