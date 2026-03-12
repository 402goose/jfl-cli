/**
 * @purpose Workspace backend interface — contract for cmux and tmux adapters
 */

export interface StatusEntry {
  label: string
  value: string
  color?: "green" | "yellow" | "red" | "gray" | "cyan"
}

export interface LogEntry {
  ts: string
  level: "info" | "warn" | "error"
  message: string
}

export interface NotificationOpts {
  surfaceId: string
  title: string
  body?: string
  urgency?: "low" | "normal" | "critical"
}

export interface CreateSurfaceOpts {
  workspaceId: string
  title: string
  command?: string
  size?: string
  focus?: boolean
  splitFrom?: string
  splitDirection?: "horizontal" | "vertical"
}

export interface BackendCapabilities {
  sidebar: boolean
  notifications: boolean
  mouse: boolean
}

export interface WorkspaceBackend {
  readonly name: string

  connect(): Promise<void>
  disconnect(): Promise<void>
  isAvailable(): boolean

  createWorkspace(name: string): Promise<string>
  closeWorkspace(id: string): Promise<void>
  createSurface(opts: CreateSurfaceOpts): Promise<string>
  closeSurface(id: string): Promise<void>
  splitSurface(id: string, direction: "horizontal" | "vertical"): Promise<string>
  focusSurface(id: string): Promise<void>
  sendText(surfaceId: string, text: string): Promise<void>

  setStatus(surfaceId: string, entries: StatusEntry[]): Promise<void>
  setProgress(surfaceId: string, label: string, value: number): Promise<void>
  addLog(surfaceId: string, entry: LogEntry): Promise<void>

  notify(opts: NotificationOpts): Promise<void>

  capabilities(): BackendCapabilities
}

export function detectBackend(): "cmux" | "tmux" {
  if (process.env.CMUX_WORKSPACE_ID) return "cmux"

  try {
    const { existsSync } = require("fs")
    if (existsSync("/tmp/cmux.sock")) return "cmux"
  } catch {}

  try {
    const { execSync } = require("child_process")
    execSync("which cmux", { stdio: "ignore" })
    return "cmux"
  } catch {}

  return "tmux"
}
