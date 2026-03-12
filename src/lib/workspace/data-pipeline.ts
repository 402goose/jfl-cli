/**
 * @purpose Data pipeline — SSE + polling + file watching to keep surfaces live
 */

import { existsSync, readFileSync, watch as fsWatch, FSWatcher } from "fs"
import { join } from "path"
import { getHubConfig, hubFetch } from "../hub-client.js"
import type { SurfaceType, LiveData, HubEventSnapshot, EvalSnapshot, FlowSnapshot } from "./surface-type.js"
import type { StatusEntry, WorkspaceBackend } from "./backend.js"

interface RegisteredSurface {
  id: string
  surfaceType: SurfaceType
  projectRoot: string
  agentName?: string
  serviceName?: string
  lastUpdate: number
}

export class DataPipeline {
  private surfaces = new Map<string, RegisteredSurface>()
  private backend: WorkspaceBackend
  private projectRoot: string
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private watchers: FSWatcher[] = []
  private liveData: LiveData = {}
  private hubAvailable = false
  private sseAbort: AbortController | null = null

  constructor(backend: WorkspaceBackend, projectRoot: string) {
    this.backend = backend
    this.projectRoot = projectRoot
  }

  registerSurface(id: string, surfaceType: SurfaceType, opts?: { agentName?: string; serviceName?: string }): void {
    this.surfaces.set(id, {
      id,
      surfaceType,
      projectRoot: this.projectRoot,
      agentName: opts?.agentName,
      serviceName: opts?.serviceName,
      lastUpdate: 0,
    })
  }

  unregisterSurface(id: string): void {
    this.surfaces.delete(id)
  }

  async start(): Promise<void> {
    const hub = getHubConfig(this.projectRoot)
    this.hubAvailable = hub !== null

    if (this.hubAvailable) {
      this.startSSE()
    }

    this.startPolling()
    this.startFileWatching()
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }

    if (this.sseAbort) {
      this.sseAbort.abort()
      this.sseAbort = null
    }

    for (const w of this.watchers) {
      w.close()
    }
    this.watchers = []
  }

  getLiveData(): LiveData {
    return { ...this.liveData }
  }

  private startSSE(): void {
    const hub = getHubConfig(this.projectRoot)
    if (!hub) return

    this.sseAbort = new AbortController()
    const url = `${hub.baseUrl}/api/events/stream?patterns=*`
    const headers: Record<string, string> = {}
    if (hub.token) headers["Authorization"] = `Bearer ${hub.token}`

    const connect = () => {
      fetch(url, { headers, signal: this.sseAbort!.signal })
        .then(async (res) => {
          if (!res.ok || !res.body) return
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() || ""

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const event = JSON.parse(line.slice(6))
                  this.handleSSEEvent(event)
                } catch {}
              }
            }
          }
        })
        .catch(() => {
          // Reconnect after delay if not aborted
          if (this.sseAbort && !this.sseAbort.signal.aborted) {
            setTimeout(connect, 5000)
          }
        })
    }

    connect()
  }

  private handleSSEEvent(event: { type?: string; data?: Record<string, unknown> }): void {
    if (!event.type) return

    if (event.type.startsWith("error") || event.type.includes(":error")) {
      if (!this.liveData.hubEvents) {
        this.liveData.hubEvents = { count24h: 0, topTypes: [], recentErrors: [] }
      }
      this.liveData.hubEvents.recentErrors.push({
        ts: new Date().toISOString(),
        type: event.type,
        message: String(event.data?.message || ""),
      })
      if (this.liveData.hubEvents.recentErrors.length > 20) {
        this.liveData.hubEvents.recentErrors = this.liveData.hubEvents.recentErrors.slice(-20)
      }
    }

    this.pushUpdates()
  }

  private startPolling(): void {
    const tick = async () => {
      const now = Date.now()

      for (const [, surface] of this.surfaces) {
        const interval = surface.surfaceType.getUpdateInterval()
        if (now - surface.lastUpdate < interval) continue
        surface.lastUpdate = now
      }

      if (this.hubAvailable) {
        await this.pollHubData()
      }

      this.pollFileData()
      this.pushUpdates()
    }

    tick()
    this.pollTimer = setInterval(tick, 5000)
  }

  private async pollHubData(): Promise<void> {
    try {
      const events = await hubFetch<{ events?: Array<{ type: string }> }>("/api/events/recent?limit=100")
      if (events?.events) {
        const typeCounts = new Map<string, number>()
        for (const e of events.events) {
          typeCounts.set(e.type, (typeCounts.get(e.type) || 0) + 1)
        }
        const topTypes = [...typeCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([type, count]) => ({ type, count }))

        this.liveData.hubEvents = {
          count24h: events.events.length,
          topTypes,
          recentErrors: this.liveData.hubEvents?.recentErrors || [],
        }
      }
    } catch {}

    try {
      const flows = await hubFetch<{ flows?: Array<{ enabled: boolean; gate?: { requires_approval?: boolean } }> }>("/api/flows")
      if (flows?.flows) {
        const active = flows.flows.filter((f) => f.enabled)
        const gated = flows.flows.filter((f) => f.gate?.requires_approval)
        this.liveData.flowData = {
          activeCount: active.length,
          gatedCount: gated.length,
          recentFailures: 0,
          needsApproval: [],
        }
      }
    } catch {}
  }

  private pollFileData(): void {
    const evalPath = join(this.projectRoot, ".jfl", "eval", "eval.jsonl")
    if (existsSync(evalPath)) {
      try {
        const content = readFileSync(evalPath, "utf-8")
        const lines = content.trim().split("\n").filter(Boolean)
        if (lines.length >= 1) {
          const latest = JSON.parse(lines[lines.length - 1])
          const previous = lines.length >= 2 ? JSON.parse(lines[lines.length - 2]) : null
          const latestComposite = latest.composite ?? 0
          const previousComposite = previous?.composite ?? latestComposite
          const delta = latestComposite - previousComposite

          this.liveData.evalData = {
            latestComposite,
            previousComposite,
            delta,
            trend: delta > 0.001 ? "up" : delta < -0.001 ? "down" : "flat",
            agentScores: [],
          }
        }
      } catch {}
    }
  }

  private startFileWatching(): void {
    const evalDir = join(this.projectRoot, ".jfl", "eval")
    if (existsSync(evalDir)) {
      try {
        const w = fsWatch(evalDir, { persistent: false }, () => {
          this.pollFileData()
          this.pushUpdates()
        })
        this.watchers.push(w)
      } catch {}
    }

    const journalDir = join(this.projectRoot, ".jfl", "journal")
    if (existsSync(journalDir)) {
      try {
        const w = fsWatch(journalDir, { persistent: false }, () => {
          this.pushUpdates()
        })
        this.watchers.push(w)
      } catch {}
    }
  }

  private pushUpdates(): void {
    if (!this.backend.capabilities().sidebar) return

    for (const [, surface] of this.surfaces) {
      const ctx = {
        projectRoot: surface.projectRoot,
        surfaceId: surface.id,
        agentName: surface.agentName,
        serviceName: surface.serviceName,
      }

      const entries: StatusEntry[] = surface.surfaceType.getStatusEntries(ctx, this.liveData)
      if (entries.length > 0) {
        this.backend.setStatus(surface.id, entries).catch(() => {})
      }
    }
  }
}
