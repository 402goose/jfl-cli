/**
 * @purpose Data pipeline — SSE + polling + file watching + agent session tracking to keep surfaces live
 */

import { existsSync, readFileSync, readdirSync, watch as fsWatch, FSWatcher } from "fs"
import { join } from "path"
import { getHubConfig, hubFetch } from "../hub-client.js"
import type {
  SurfaceType,
  LiveData,
  HubEventSnapshot,
  EvalSnapshot,
  FlowSnapshot,
  AgentSessionSnapshot,
  AgentRoundSnapshot,
  TrainingSnapshot,
  ProjectConfigSnapshot,
  ChildProjectSnapshot,
} from "./surface-type.js"
import type { StatusEntry, WorkspaceBackend } from "./backend.js"
import { readProjectConfig } from "./surface-registry.js"

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

    this.liveData.projectConfig = readProjectConfig(this.projectRoot)

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
      this.pollAgentSessions()
      this.pollTrainingBuffer()
      this.pollChildProjects()
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

  private pollAgentSessions(): void {
    const sessionsDir = join(this.projectRoot, ".jfl", "sessions")
    if (!existsSync(sessionsDir)) {
      this.liveData.agentSessions = []
      return
    }

    const sessions: AgentSessionSnapshot[] = []

    try {
      const dirs = readdirSync(sessionsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())

      for (const dir of dirs) {
        const statePath = join(sessionsDir, dir.name, "state.json")
        if (!existsSync(statePath)) continue

        try {
          const state = JSON.parse(readFileSync(statePath, "utf-8"))
          const snapshot: AgentSessionSnapshot = {
            agentName: state.agentName || dir.name.split("-")[0],
            sessionId: state.id || dir.name,
            metric: state.config?.metric || "unknown",
            direction: state.config?.direction || "maximize",
            baseline: state.baselineMetric || 0,
            currentScore: state.baselineMetric || 0,
            delta: 0,
            round: state.round || 0,
            explorationRate: state.config?.policy?.exploration_rate || 0.2,
            status: state.status || "active",
            rounds: [],
            produces: state.config?.context_scope?.produces || [],
            consumes: state.config?.context_scope?.consumes || [],
            branch: state.branch,
            startedAt: state.startedAt,
          }

          const resultsPath = join(sessionsDir, dir.name, "results.tsv")
          if (existsSync(resultsPath)) {
            snapshot.rounds = parseResultsTsv(resultsPath)
            if (snapshot.rounds.length > 0) {
              const keptRounds = snapshot.rounds.filter((r) => r.kept)
              const totalDelta = keptRounds.reduce((sum, r) => sum + r.delta, 0)
              snapshot.delta = totalDelta
              snapshot.currentScore = snapshot.baseline + totalDelta
              snapshot.round = snapshot.rounds.length
            }
          }

          // Decay exploration rate based on rounds
          if (state.config?.policy) {
            const decay = state.config.policy.decay_per_round || 0.01
            const minExplore = state.config.policy.min_exploration || 0.05
            const initial = state.config.policy.exploration_rate || 0.2
            snapshot.explorationRate = Math.max(minExplore, initial - (decay * snapshot.round))
          }

          sessions.push(snapshot)
        } catch {}
      }
    } catch {}

    this.liveData.agentSessions = sessions
  }

  private pollTrainingBuffer(): void {
    const bufferPath = join(this.projectRoot, ".jfl", "training-buffer.jsonl")
    if (!existsSync(bufferPath)) {
      this.liveData.trainingData = undefined
      return
    }

    try {
      const content = readFileSync(bufferPath, "utf-8")
      const lines = content.trim().split("\n").filter(Boolean)
      const entries = lines.map((l) => {
        try { return JSON.parse(l) } catch { return null }
      }).filter(Boolean)

      const byAgent: Record<string, number> = {}
      const bySource: Record<string, number> = {}
      let totalReward = 0
      let improvedCount = 0

      for (const e of entries) {
        const agent = e.agent || "unknown"
        byAgent[agent] = (byAgent[agent] || 0) + 1

        const source = e.metadata?.source || "unknown"
        bySource[source] = (bySource[source] || 0) + 1

        const reward = e.reward?.composite_delta ?? 0
        totalReward += reward
        if (e.reward?.improved) improvedCount++
      }

      this.liveData.trainingData = {
        totalTuples: entries.length,
        positiveReward: improvedCount,
        byAgent,
        bySource,
        avgReward: entries.length > 0 ? totalReward / entries.length : 0,
        improvedRate: entries.length > 0 ? improvedCount / entries.length : 0,
        lastWritten: entries.length > 0 ? entries[entries.length - 1].ts : undefined,
      }
    } catch {
      this.liveData.trainingData = undefined
    }
  }

  private pollChildProjects(): void {
    const config = this.liveData.projectConfig
    if (!config || config.type === "service") {
      this.liveData.childProjects = undefined
      return
    }

    const children: ChildProjectSnapshot[] = []

    for (const svc of config.registeredServices) {
      const child: ChildProjectSnapshot = {
        name: svc.name,
        type: svc.type,
        path: svc.path,
        health: "unknown",
      }

      if (svc.path && existsSync(svc.path)) {
        const childConfigPath = join(svc.path, ".jfl", "config.json")
        if (existsSync(childConfigPath)) {
          try {
            const childConfig = JSON.parse(readFileSync(childConfigPath, "utf-8"))
            child.contextScope = childConfig.context_scope
          } catch {}
        }

        const childEvalPath = join(svc.path, ".jfl", "eval", "eval.jsonl")
        if (existsSync(childEvalPath)) {
          try {
            const content = readFileSync(childEvalPath, "utf-8")
            const lines = content.trim().split("\n").filter(Boolean)
            if (lines.length >= 1) {
              const latest = JSON.parse(lines[lines.length - 1])
              const previous = lines.length >= 2 ? JSON.parse(lines[lines.length - 2]) : null
              const score = latest.composite ?? 0
              child.evalScore = score
              const prevScore = previous?.composite ?? score
              const delta = score - prevScore
              child.evalTrend = delta > 0.001 ? "up" : delta < -0.001 ? "down" : "flat"
            }
          } catch {}
        }

        const childAgentsDir = join(svc.path, ".jfl", "agents")
        if (existsSync(childAgentsDir)) {
          try {
            const agentFiles = readdirSync(childAgentsDir).filter((f) => f.endsWith(".toml"))
            child.activeAgents = agentFiles.length
          } catch {}
        }

        const childFlowsDir = join(svc.path, ".jfl", "flows")
        if (existsSync(childFlowsDir)) {
          try {
            const flowFiles = readdirSync(childFlowsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
            child.activeFlows = flowFiles.length
          } catch {}
        }

        child.health = "healthy"
      } else {
        child.health = svc.status === "active" ? "unknown" : "unhealthy"
      }

      children.push(child)
    }

    this.liveData.childProjects = children
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

    const sessionsDir = join(this.projectRoot, ".jfl", "sessions")
    if (existsSync(sessionsDir)) {
      try {
        const w = fsWatch(sessionsDir, { persistent: false, recursive: true }, () => {
          this.pollAgentSessions()
          this.pushUpdates()
        })
        this.watchers.push(w)
      } catch {}
    }

    const bufferPath = join(this.projectRoot, ".jfl", "training-buffer.jsonl")
    if (existsSync(bufferPath)) {
      try {
        const dir = join(this.projectRoot, ".jfl")
        const w = fsWatch(dir, { persistent: false }, (_, filename) => {
          if (filename === "training-buffer.jsonl") {
            this.pollTrainingBuffer()
            this.pushUpdates()
          }
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

function parseResultsTsv(path: string): AgentRoundSnapshot[] {
  try {
    const content = readFileSync(path, "utf-8")
    const lines = content.trim().split("\n")
    if (lines.length <= 1) return []

    const rounds: AgentRoundSnapshot[] = []
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split("\t")
      if (parts.length < 7) continue

      rounds.push({
        round: parseInt(parts[0], 10) || i,
        task: parts[1] || "",
        metricBefore: parseFloat(parts[2]) || 0,
        metricAfter: parseFloat(parts[3]) || 0,
        delta: parseFloat(parts[4]) || 0,
        kept: parts[5] === "1",
        durationMs: parseInt(parts[6], 10) || 0,
      })
    }

    return rounds
  } catch {
    return []
  }
}
