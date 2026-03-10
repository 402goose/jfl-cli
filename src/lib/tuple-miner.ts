/**
 * @purpose Mine training tuples from existing journals, MAP events, telemetry, and eval history
 */

import { readFileSync, existsSync, readdirSync } from "fs"
import { join, basename } from "path"
import { homedir } from "os"
import type { RLState, RLAction, RLReward, TrainingBufferEntry } from "./training-buffer.js"

interface JournalEntry {
  v?: number
  ts: string
  session?: string
  type: string
  status?: string
  title: string
  summary: string
  detail?: string
  files?: string[]
  score_delta?: number
  learned?: string[]
  decision?: string
  agent_id?: string
  incomplete?: string[]
}

interface MAPEvent {
  ts: string
  type: string
  id?: string
  source?: string
  data?: Record<string, any>
  [key: string]: any
}

export type MinedTuple = Omit<TrainingBufferEntry, "id" | "v" | "ts">

export interface MineStats {
  journalTuples: number
  sessionTuples: number
  flowTuples: number
  evalTuples: number
  telemetryTuples: number
  directories: string[]
  totalMined: number
  skippedTypes: number
}

export interface MineOptions {
  dirs?: string[]
  all?: boolean
  telemetry?: boolean
}

const ACTION_TYPE_MAP: Record<string, RLAction["type"]> = {
  feature: "feature",
  fix: "fix",
  decision: "config",
  discovery: "experiment",
  milestone: "feature",
  spec: "config",
  experiment: "experiment",
  progress: "feature",
}

const SKIP_TYPES = new Set(["session", "session-end"])

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return []
  const items: T[] = []
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    if (!line.trim()) continue
    try { items.push(JSON.parse(line)) } catch {}
  }
  return items
}

function inferScope(files?: string[]): RLAction["scope"] {
  if (!files || files.length === 0) return "small"
  if (files.length <= 3) return "small"
  if (files.length <= 7) return "medium"
  return "large"
}

function inferReward(entry: JournalEntry): { delta: number; quality: number; improved: boolean } {
  if (entry.score_delta !== undefined) {
    const d = Number(entry.score_delta) || 0
    return {
      delta: d,
      quality: d > 0 ? 1.0 : 0.5,
      improved: d > 0,
    }
  }

  const isComplete = entry.status === "complete"
  const isBlocked = entry.status === "blocked"

  if (isBlocked) return { delta: -0.01, quality: 0.0, improved: false }
  if (entry.status === "incomplete") return { delta: -0.005, quality: 0.3, improved: false }

  switch (entry.type) {
    case "milestone": return { delta: 0.05, quality: 1.0, improved: true }
    case "feature": return { delta: 0.02, quality: 0.9, improved: true }
    case "fix": return { delta: 0.015, quality: 0.85, improved: true }
    case "discovery": return { delta: 0.005, quality: 0.7, improved: true }
    case "decision": return { delta: 0.0, quality: 0.6, improved: false }
    case "spec": return { delta: 0.005, quality: 0.65, improved: true }
    default: return { delta: 0.01, quality: 0.5, improved: isComplete }
  }
}

function scanJournalFiles(projectDir: string): string[] {
  const journalDir = join(projectDir, ".jfl", "journal")
  if (!existsSync(journalDir)) return []
  return readdirSync(journalDir)
    .filter(f => f.endsWith(".jsonl"))
    .map(f => join(journalDir, f))
}

function loadAllJournals(projectDir: string): JournalEntry[] {
  const entries: JournalEntry[] = []
  for (const file of scanJournalFiles(projectDir)) {
    entries.push(...readJsonl<JournalEntry>(file))
  }
  return entries.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""))
}

export function mineJournalTuples(projectDir: string): MinedTuple[] {
  const entries = loadAllJournals(projectDir)
  const projectName = basename(projectDir)
  const tuples: MinedTuple[] = []
  let runningScore = 0
  const recentDeltas: number[] = []

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry.type || SKIP_TYPES.has(entry.type)) continue

    const actionType = ACTION_TYPE_MAP[entry.type]
    if (!actionType) continue

    const reward = inferReward(entry)
    const prevScore = runningScore
    runningScore += reward.delta
    recentDeltas.push(reward.delta)
    if (recentDeltas.length > 10) recentDeltas.shift()

    tuples.push({
      agent: entry.agent_id || extractAuthor(entry.session) || "human",
      state: {
        composite_score: Math.max(0, prevScore),
        dimension_scores: {},
        tests_passing: 0,
        tests_total: 0,
        trajectory_length: i,
        recent_deltas: [...recentDeltas.slice(0, -1)],
        agent: entry.agent_id || extractAuthor(entry.session) || "human",
      },
      action: {
        type: actionType,
        description: `${entry.title}: ${entry.summary}`.slice(0, 200),
        files_affected: entry.files || [],
        scope: inferScope(entry.files),
        branch: entry.session || "main",
      },
      reward: {
        composite_delta: reward.delta,
        dimension_deltas: {},
        tests_added: 0,
        quality_score: reward.quality,
        improved: reward.improved,
      },
      metadata: {
        branch: entry.session || "main",
        source: "mined",
        mine_source: `journal:${projectName}`,
      },
    })
  }

  return tuples
}

export function mineFlowTuples(projectDir: string): MinedTuple[] {
  const mapEvents = readJsonl<MAPEvent>(join(projectDir, ".jfl", "map-events.jsonl"))
  const projectName = basename(projectDir)

  const triggered = mapEvents.filter(e => e.type === "flow:triggered")
  const completed = mapEvents.filter(e => e.type === "flow:completed")

  const tuples: MinedTuple[] = []

  for (const trigger of triggered) {
    const flowName = trigger.data?.flow_name || trigger.data?.flow || "unknown"
    const triggerTime = new Date(trigger.ts).getTime()

    const completion = completed.find(c => {
      const cName = c.data?.flow_name || c.data?.flow
      const cTime = new Date(c.ts).getTime()
      return cName === flowName && cTime > triggerTime && cTime - triggerTime < 60000
    })

    tuples.push({
      agent: "flow-engine",
      state: {
        composite_score: 0,
        dimension_scores: {},
        tests_passing: 0,
        tests_total: 0,
        trajectory_length: tuples.length,
        recent_deltas: [],
        agent: "flow-engine",
      },
      action: {
        type: "config",
        description: `Flow: ${flowName} (trigger: ${trigger.data?.trigger_event_type || "?"})`,
        files_affected: [],
        scope: "small",
        branch: "main",
      },
      reward: {
        composite_delta: completion ? 0.005 : -0.005,
        dimension_deltas: {},
        tests_added: 0,
        quality_score: completion ? 1.0 : 0.0,
        improved: !!completion,
      },
      metadata: {
        branch: "main",
        source: "mined",
        mine_source: `flow:${projectName}`,
      },
    })
  }

  return tuples
}

export function mineSessionTuples(projectDir: string): MinedTuple[] {
  const mapEvents = readJsonl<MAPEvent>(join(projectDir, ".jfl", "map-events.jsonl"))
  const projectName = basename(projectDir)

  const starts = mapEvents.filter(e => e.type === "session:started")
  const ends = mapEvents.filter(e => e.type === "session:ended")

  const journals = loadAllJournals(projectDir)
  const tuples: MinedTuple[] = []

  for (const start of starts) {
    const startTime = new Date(start.ts).getTime()

    const end = ends.find(e => {
      const t = new Date(e.ts).getTime()
      return t > startTime && t - startTime < 24 * 60 * 60 * 1000
    })
    if (!end) continue

    const endTime = new Date(end.ts).getTime()
    const durationMin = Math.round((endTime - startTime) / 60000)

    const sessionEntries = journals.filter(e => {
      const t = new Date(e.ts).getTime()
      return t >= startTime && t <= endTime
    })

    if (sessionEntries.length === 0) continue

    const features = sessionEntries.filter(e => e.type === "feature").length
    const fixes = sessionEntries.filter(e => e.type === "fix").length
    const decisions = sessionEntries.filter(e => e.type === "decision").length
    const complete = sessionEntries.filter(e => e.status === "complete").length
    const allFiles = [...new Set(sessionEntries.flatMap(e => e.files || []))]
    const completionRate = complete / sessionEntries.length

    const dominantType = features >= fixes ? "feature" : "fix"

    tuples.push({
      agent: extractAuthor(start.data?.session) || "session",
      state: {
        composite_score: 0,
        dimension_scores: { features, fixes, decisions },
        tests_passing: 0,
        tests_total: 0,
        trajectory_length: tuples.length,
        recent_deltas: [],
        agent: "session",
      },
      action: {
        type: dominantType,
        description: `Session: ${sessionEntries.length} entries (${features}F/${fixes}B/${decisions}D), ${durationMin}min`,
        files_affected: allFiles.slice(0, 20),
        scope: allFiles.length > 10 ? "large" : allFiles.length > 3 ? "medium" : "small",
        branch: start.data?.session || "main",
      },
      reward: {
        composite_delta: completionRate * 0.02 + features * 0.01 + fixes * 0.005,
        dimension_deltas: {},
        tests_added: 0,
        quality_score: completionRate,
        improved: completionRate > 0.5,
      },
      metadata: {
        branch: start.data?.session || "main",
        source: "mined",
        mine_source: `session:${projectName}`,
      },
    })
  }

  return tuples
}

export function mineEvalTuples(projectDir: string): MinedTuple[] {
  const mapEvents = readJsonl<MAPEvent>(join(projectDir, ".jfl", "map-events.jsonl"))
  const projectName = basename(projectDir)

  const evalEvents = mapEvents.filter(e => e.type === "eval:scored")
  const tuples: MinedTuple[] = []

  for (const ev of evalEvents) {
    const d = ev.data || {}
    const composite = Number(d.composite) || 0
    const baseline = Number(d.baseline) || 0
    const delta = Number(d.delta) || (composite - baseline)

    tuples.push({
      agent: d.agent || "unknown",
      state: {
        composite_score: baseline,
        dimension_scores: {},
        tests_passing: d.tests_passed ?? 0,
        tests_total: d.tests_total ?? 0,
        trajectory_length: tuples.length,
        recent_deltas: [],
        agent: d.agent || "unknown",
      },
      action: {
        type: "experiment",
        description: `Eval: ${d.branch || "?"} (PR #${d.pr_number || "?"})`,
        files_affected: [],
        scope: "medium",
        branch: d.branch || "main",
      },
      reward: {
        composite_delta: delta,
        dimension_deltas: {},
        tests_added: 0,
        quality_score: composite,
        improved: d.improved ?? delta > 0,
      },
      metadata: {
        branch: d.branch || "main",
        pr_number: d.pr_number ? parseInt(d.pr_number, 10) : undefined,
        source: "mined",
        mine_source: `eval:${projectName}`,
      },
    })
  }

  return tuples
}

export function mineTelemetryTuples(): MinedTuple[] {
  const archivePath = join(homedir(), ".local", "share", "jfl", "telemetry-archive.jsonl")
  if (!existsSync(archivePath)) return []

  const events = readJsonl<Record<string, any>>(archivePath)

  const sessions = new Map<string, Record<string, any>[]>()
  for (const e of events) {
    if (!e.session_id) continue
    if (!sessions.has(e.session_id)) sessions.set(e.session_id, [])
    sessions.get(e.session_id)!.push(e)
  }

  const tuples: MinedTuple[] = []

  for (const [sessionId, sessionEvents] of sessions) {
    if (sessionEvents.length < 10) continue

    const commands = sessionEvents.filter(e => e.category === "command")
    const errors = sessionEvents.filter(e => e.category === "error")
    const flows = sessionEvents.filter(e => e.event?.startsWith("flow:"))
    const hubReqs = sessionEvents.filter(e => e.category === "context_hub")
    const hooks = sessionEvents.filter(e => e.category === "hooks")

    if (commands.length === 0 && flows.length === 0) continue

    const errorRate = sessionEvents.length > 0 ? errors.length / sessionEvents.length : 0
    const flowTriggered = flows.filter(f => f.event === "flow:triggered").length
    const flowCompleted = flows.filter(f => f.event === "flow:completed").length
    const flowSuccessRate = flowTriggered > 0 ? flowCompleted / flowTriggered : 1

    const commandNames = commands.map(c => c.command || "?")
    const uniqueCommands = [...new Set(commandNames)]
    const totalDuration = commands.reduce((sum, c) => sum + (c.duration_ms || 0), 0)

    tuples.push({
      agent: "telemetry",
      state: {
        composite_score: 0,
        dimension_scores: {
          error_rate: errorRate,
          hub_requests: hubReqs.length,
          hook_calls: hooks.length,
          flow_success: flowSuccessRate,
        },
        tests_passing: 0,
        tests_total: 0,
        trajectory_length: tuples.length,
        recent_deltas: [],
        agent: "telemetry",
      },
      action: {
        type: "experiment",
        description: `Telemetry: ${commands.length} cmds (${uniqueCommands.join(",").slice(0, 60)}), ${flows.length} flows, ${errors.length} err, ${Math.round(totalDuration / 1000)}s`,
        files_affected: [],
        scope: commands.length > 20 ? "large" : commands.length > 5 ? "medium" : "small",
        branch: sessionId,
      },
      reward: {
        composite_delta: (1 - errorRate) * 0.01 * flowSuccessRate,
        dimension_deltas: { error_rate: -errorRate, flow_success: flowSuccessRate },
        tests_added: 0,
        quality_score: (1 - errorRate) * flowSuccessRate,
        improved: errorRate < 0.1,
      },
      metadata: {
        branch: sessionId,
        source: "mined",
        mine_source: "telemetry:global",
      },
    })
  }

  return tuples
}

function extractAuthor(session?: string): string | null {
  if (!session) return null
  const match = session.match(/session-(\w+)-\d/)
  return match ? match[1] : null
}

function findJflProjects(): string[] {
  try {
    const configPath = join(homedir(), ".config", "jfl", "config.json")
    if (!existsSync(configPath)) return []

    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    const codeDir = config.codeDirectory
    if (!codeDir || !existsSync(codeDir)) return []

    return readdirSync(codeDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => join(codeDir, d.name))
      .filter(d => existsSync(join(d, ".jfl")))
  } catch {
    return []
  }
}

export function mineAll(options: MineOptions): { tuples: MinedTuple[]; stats: MineStats } {
  let dirs = options.dirs ? [...options.dirs] : [process.cwd()]

  if (options.all) {
    const projectDirs = findJflProjects()
    for (const d of projectDirs) {
      if (!dirs.includes(d)) dirs.push(d)
    }
  }

  const stats: MineStats = {
    journalTuples: 0,
    sessionTuples: 0,
    flowTuples: 0,
    evalTuples: 0,
    telemetryTuples: 0,
    directories: dirs,
    totalMined: 0,
    skippedTypes: 0,
  }

  const allTuples: MinedTuple[] = []

  for (const dir of dirs) {
    const journalTuples = mineJournalTuples(dir)
    stats.journalTuples += journalTuples.length
    allTuples.push(...journalTuples)

    const flowTuples = mineFlowTuples(dir)
    stats.flowTuples += flowTuples.length
    allTuples.push(...flowTuples)

    const sessionTuples = mineSessionTuples(dir)
    stats.sessionTuples += sessionTuples.length
    allTuples.push(...sessionTuples)

    const evalTuples = mineEvalTuples(dir)
    stats.evalTuples += evalTuples.length
    allTuples.push(...evalTuples)
  }

  if (options.telemetry) {
    const telemetryTuples = mineTelemetryTuples()
    stats.telemetryTuples = telemetryTuples.length
    allTuples.push(...telemetryTuples)
  }

  stats.totalMined = allTuples.length
  return { tuples: allTuples, stats }
}
