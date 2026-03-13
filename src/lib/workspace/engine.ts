/**
 * @purpose WorkspaceEngine controller — stays running, manages surfaces, pushes live data, adapts to project type
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import type { WorkspaceBackend, CreateSurfaceOpts } from "./backend.js"
import { detectBackend } from "./backend.js"
import { CmuxAdapter } from "./cmux-adapter.js"
import { TmuxAdapter } from "./tmux-adapter.js"
import { DataPipeline } from "./data-pipeline.js"
import { NotificationDispatcher } from "./notifications.js"
import { getSurfaceType, scanProject, getAvailableItems, getDefaultLayout, readProjectConfig } from "./surface-registry.js"
import { AgentSurface } from "./surfaces/agent.js"
import { ServiceSurface } from "./surfaces/service.js"
import type { SurfaceType, SurfaceContext, ProjectConfigSnapshot } from "./surface-type.js"

export interface ActiveSurface {
  id: string
  name: string
  surfaceType: SurfaceType
  agentName?: string
  serviceName?: string
}

export interface EngineState {
  workspaceId: string
  backend: string
  projectType: string
  projectName: string
  surfaces: Array<{ name: string; type: string; agentName?: string; serviceName?: string }>
  parentProject?: string
  childCount?: number
}

interface LayoutEntry {
  name: string
  type: string
  agentName?: string
  serviceName?: string
  size?: string
  focus?: boolean
  row?: number
}

export class WorkspaceEngine {
  private backend: WorkspaceBackend
  private pipeline: DataPipeline
  private notifications: NotificationDispatcher
  private projectRoot: string
  private projectConfig: ProjectConfigSnapshot
  private workspaceId = ""
  private surfaces = new Map<string, ActiveSurface>()
  private running = false
  private notifyTimer: ReturnType<typeof setInterval> | null = null

  constructor(projectRoot: string, backendOverride?: "cmux" | "tmux") {
    this.projectRoot = projectRoot
    this.projectConfig = readProjectConfig(projectRoot)
    const backendType = backendOverride || detectBackend()

    if (backendType === "cmux") {
      this.backend = new CmuxAdapter()
    } else {
      this.backend = new TmuxAdapter()
    }

    this.pipeline = new DataPipeline(this.backend, projectRoot)
    this.notifications = new NotificationDispatcher(this.backend)
  }

  getBackendName(): string {
    return this.backend.name
  }

  isBackendAvailable(): boolean {
    return this.backend.isAvailable()
  }

  getCapabilities() {
    return this.backend.capabilities()
  }

  getProjectConfig(): ProjectConfigSnapshot {
    return this.projectConfig
  }

  async launch(): Promise<void> {
    if (this.running) return

    await this.backend.connect()

    const projectName = this.projectConfig.name || this.projectRoot.split("/").pop() || "workspace"
    this.workspaceId = await this.backend.createWorkspace(projectName)
    this.running = true

    let layout = this.loadLayout()
    if (layout.length === 0) {
      layout = getDefaultLayout(this.projectRoot)
    }

    let firstSurfaceId: string | null = null
    for (const entry of layout) {
      const id = await this.createSurfaceFromEntry(entry, firstSurfaceId)
      if (!firstSurfaceId) firstSurfaceId = id
    }

    await this.pipeline.start()

    this.notifyTimer = setInterval(() => {
      const data = this.pipeline.getLiveData()
      this.notifications.check(data)
    }, 5000)

    this.saveLayout(layout)
  }

  async addSurface(name: string, opts?: { agentName?: string; serviceName?: string; row?: number }): Promise<string | null> {
    let surfaceType: SurfaceType | null = getSurfaceType(name)
    let agentName = opts?.agentName
    let serviceName = opts?.serviceName

    if (!surfaceType && agentName) {
      surfaceType = new AgentSurface()
    } else if (!surfaceType && serviceName) {
      surfaceType = new ServiceSurface()
    } else if (!surfaceType) {
      const scan = scanProject(this.projectRoot)
      if (scan.agents.includes(name)) {
        surfaceType = new AgentSurface()
        agentName = name
      } else if (scan.services.includes(name)) {
        surfaceType = new ServiceSurface()
        serviceName = name
      }
    }

    if (!surfaceType) return null

    const ctx: SurfaceContext = {
      projectRoot: this.projectRoot,
      surfaceId: "",
      agentName,
      serviceName,
    }

    const createOpts: CreateSurfaceOpts = {
      workspaceId: this.workspaceId,
      title: agentName || serviceName || surfaceType.title,
      command: surfaceType.getCommand(ctx),
    }

    if (this.running && this.surfaces.size > 0) {
      const lastSurface = [...this.surfaces.values()].pop()
      if (lastSurface) {
        createOpts.splitFrom = lastSurface.id
        createOpts.splitDirection = "horizontal"
      }
    }

    const id = await this.backend.createSurface(createOpts)

    const active: ActiveSurface = {
      id,
      name: agentName || serviceName || surfaceType.type,
      surfaceType,
      agentName,
      serviceName,
    }

    this.surfaces.set(id, active)
    this.pipeline.registerSurface(id, surfaceType, { agentName, serviceName })
    this.notifications.register(id, surfaceType.getNotificationRules())

    this.persistLayout()
    return id
  }

  async removeSurface(name: string): Promise<boolean> {
    for (const [id, surface] of this.surfaces) {
      if (surface.name === name || surface.agentName === name || surface.serviceName === name) {
        await this.backend.closeSurface(id)
        this.surfaces.delete(id)
        this.pipeline.unregisterSurface(id)
        this.notifications.unregister(id)
        this.persistLayout()
        return true
      }
    }
    return false
  }

  async openChild(name: string): Promise<boolean> {
    const config = this.projectConfig
    const service = config.registeredServices.find((s) => s.name === name)
    if (!service?.path || !existsSync(service.path)) return false

    const ctx: SurfaceContext = {
      projectRoot: this.projectRoot,
      surfaceId: "",
    }

    const cmd = `cd "${service.path}" && jfl ide 2>/dev/null || $SHELL`
    const createOpts: CreateSurfaceOpts = {
      workspaceId: this.workspaceId,
      title: name,
      command: cmd,
    }

    if (this.surfaces.size > 0) {
      const lastSurface = [...this.surfaces.values()].pop()
      if (lastSurface) {
        createOpts.splitFrom = lastSurface.id
        createOpts.splitDirection = "horizontal"
      }
    }

    const id = await this.backend.createSurface(createOpts)
    const { ShellSurface } = await import("./surfaces/shell.js")

    this.surfaces.set(id, {
      id,
      name,
      surfaceType: new ShellSurface(),
      serviceName: name,
    })

    this.persistLayout()
    return true
  }

  getParentPath(): string | null {
    return this.projectConfig.portfolioParent || this.projectConfig.gtmParent || null
  }

  async stop(): Promise<void> {
    if (!this.running) return

    if (this.notifyTimer) {
      clearInterval(this.notifyTimer)
      this.notifyTimer = null
    }

    await this.pipeline.stop()
    await this.backend.closeWorkspace(this.workspaceId)
    await this.backend.disconnect()
    this.surfaces.clear()
    this.running = false
  }

  getActiveSurfaces(): ActiveSurface[] {
    return [...this.surfaces.values()]
  }

  getState(): EngineState {
    return {
      workspaceId: this.workspaceId,
      backend: this.backend.name,
      projectType: this.projectConfig.type,
      projectName: this.projectConfig.name,
      surfaces: [...this.surfaces.values()].map((s) => ({
        name: s.name,
        type: s.surfaceType.type,
        agentName: s.agentName,
        serviceName: s.serviceName,
      })),
      parentProject: this.projectConfig.portfolioParent || this.projectConfig.gtmParent,
      childCount: this.projectConfig.registeredServices.length,
    }
  }

  getAvailableItems(): ReturnType<typeof getAvailableItems> {
    const activeNames = [...this.surfaces.values()].map((s) => s.name)
    return getAvailableItems(this.projectRoot, activeNames)
  }

  getScanResults() {
    return scanProject(this.projectRoot)
  }

  getLiveData() {
    return this.pipeline.getLiveData()
  }

  isRunning(): boolean {
    return this.running
  }

  private async createSurfaceFromEntry(entry: LayoutEntry, splitFrom: string | null): Promise<string> {
    let surfaceType = getSurfaceType(entry.type)
    if (!surfaceType) {
      if (entry.agentName) surfaceType = new AgentSurface()
      else if (entry.serviceName) surfaceType = new ServiceSurface()
    }
    if (!surfaceType) {
      const { ShellSurface } = await import("./surfaces/shell.js")
      surfaceType = new ShellSurface()
    }

    const ctx: SurfaceContext = {
      projectRoot: this.projectRoot,
      surfaceId: "",
      agentName: entry.agentName,
      serviceName: entry.serviceName,
    }

    const createOpts: CreateSurfaceOpts = {
      workspaceId: this.workspaceId,
      title: entry.name,
      command: surfaceType.getCommand(ctx),
      size: entry.size,
      focus: entry.focus,
    }

    if (splitFrom) {
      createOpts.splitFrom = splitFrom
      createOpts.splitDirection = "horizontal"
    }

    const id = await this.backend.createSurface(createOpts)

    this.surfaces.set(id, {
      id,
      name: entry.name,
      surfaceType,
      agentName: entry.agentName,
      serviceName: entry.serviceName,
    })

    this.pipeline.registerSurface(id, surfaceType, {
      agentName: entry.agentName,
      serviceName: entry.serviceName,
    })
    this.notifications.register(id, surfaceType.getNotificationRules())

    return id
  }

  private loadLayout(): LayoutEntry[] {
    const layoutPath = join(this.projectRoot, ".jfl", "ide.yml")
    if (!existsSync(layoutPath)) return []

    try {
      const content = readFileSync(layoutPath, "utf-8")
      return this.parseLayout(content)
    } catch {
      return []
    }
  }

  private parseLayout(content: string): LayoutEntry[] {
    const entries: LayoutEntry[] = []
    const lines = content.split("\n")
    let currentRow = 0
    let inPanes = false

    interface PaneAcc {
      title?: string
      command?: string
      type?: string
      size?: string
      focus?: boolean
      agent?: string
    }

    let currentPane: PaneAcc | null = null

    const flush = () => {
      if (currentPane?.title) {
        entries.push({
          name: currentPane.agent || currentPane.type || currentPane.title.toLowerCase().replace(/\s+/g, "-"),
          type: currentPane.type || "shell",
          agentName: currentPane.agent,
          size: currentPane.size,
          focus: currentPane.focus,
          row: currentRow,
        })
      }
      currentPane = null
    }

    for (const line of lines) {
      const stripped = line.trim()
      if (!stripped || stripped.startsWith("#")) continue
      const indent = line.length - line.trimStart().length

      if (indent === 2 && stripped.startsWith("- size:")) {
        flush()
        currentRow++
        inPanes = false
      } else if (indent === 4 && stripped === "panes:") {
        inPanes = true
      } else if (inPanes && indent === 6 && stripped.startsWith("- title:")) {
        flush()
        const title = stripped.replace("- title:", "").trim().replace(/^["']|["']$/g, "")
        currentPane = { title }
      } else if (currentPane && indent >= 8) {
        const ci = stripped.indexOf(":")
        if (ci > 0) {
          const k = stripped.slice(0, ci).trim()
          let v = stripped.slice(ci + 1).trim()
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1)
          }
          if (k === "type") currentPane.type = v
          if (k === "size") currentPane.size = v
          if (k === "focus" && v === "true") currentPane.focus = true
          if (k === "agent") currentPane.agent = v
          if (k === "command") currentPane.command = v
        }
      }
    }
    flush()

    return entries
  }

  private persistLayout(): void {
    const entries: LayoutEntry[] = [...this.surfaces.values()].map((s) => ({
      name: s.name,
      type: s.surfaceType.type,
      agentName: s.agentName,
      serviceName: s.serviceName,
    }))
    this.saveLayout(entries)
  }

  private saveLayout(entries: LayoutEntry[]): void {
    const dir = join(this.projectRoot, ".jfl")
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const projectName = this.projectConfig.name || this.projectRoot.split("/").pop() || "workspace"
    const lines: string[] = [
      `name: ${projectName}`,
      "before: jfl context-hub ensure 2>/dev/null",
      "",
      "rows:",
      "  - size: 100%",
      "    panes:",
    ]

    for (const entry of entries) {
      const displayName = entry.agentName || entry.serviceName || entry.name
      lines.push(`      - title: "${displayName}"`)

      const surfaceType = getSurfaceType(entry.type) ||
        (entry.agentName ? new AgentSurface() : null) ||
        (entry.serviceName ? new ServiceSurface() : null)

      if (surfaceType) {
        const ctx: SurfaceContext = {
          projectRoot: this.projectRoot,
          surfaceId: "",
          agentName: entry.agentName,
          serviceName: entry.serviceName,
        }
        const cmd = surfaceType.getCommand(ctx)
        if (cmd) {
          const escaped = cmd.includes('"')
            ? cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
            : cmd
          lines.push(`        command: "${escaped}"`)
        }
      }

      if (entry.size) lines.push(`        size: ${entry.size}`)
      if (entry.focus) lines.push("        focus: true")
      lines.push(`        type: ${entry.type}`)
      if (entry.agentName) lines.push(`        agent: ${entry.agentName}`)
    }

    lines.push("")
    const layoutPath = join(this.projectRoot, ".jfl", "ide.yml")
    writeFileSync(layoutPath, lines.join("\n"))

    const rootPath = join(this.projectRoot, "ide.yml")
    writeFileSync(rootPath, lines.join("\n"))
  }
}
