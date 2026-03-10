/**
 * Agent Grid Extension
 *
 * Full-screen /grid overlay showing live status of all Pi RPC agents.
 * Polls Context Hub SSE for agent:health events every 2s.
 * Navigation: j/k, Enter, q.
 *
 * @purpose /grid command — 2×3 agent card display with live MAP updates
 */

import type { PiContext } from "./types.js"
import { hubUrl, authToken } from "./map-bridge.js"

interface AgentHealth {
  name: string
  role: string
  status: "running" | "idle" | "blocked" | "error"
  task?: string
  duration?: number
  model?: string
  lastSeen: number
}

const STATUS_ICONS: Record<string, string> = {
  running: "●",
  idle: "○",
  blocked: "◆",
  error: "✗",
}

const STATUS_COLORS: Record<string, string> = {
  running: "green",
  idle: "white",
  blocked: "yellow",
  error: "red",
}

const agents = new Map<string, AgentHealth>()
let pollInterval: ReturnType<typeof setInterval> | null = null

function formatDuration(ms?: number): string {
  if (!ms) return "-"
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m}m ${rs}s`
}

function buildGridLines(): string[] {
  const agentList = Array.from(agents.values())
  const lines: string[] = ["─ Agent Grid ──────────────────────────────────────────────────"]

  if (agentList.length === 0) {
    lines.push("  No active agents. Run: jfl pi agents run --team teams/gtm-team.yaml")
    return lines
  }

  const COLS = 3
  for (let row = 0; row < Math.ceil(agentList.length / COLS); row++) {
    const rowAgents = agentList.slice(row * COLS, row * COLS + COLS)
    const nameLine = rowAgents.map(a => {
      const icon = STATUS_ICONS[a.status] ?? "?"
      return `${icon} ${a.name.padEnd(16)}`
    }).join("│ ")
    lines.push(`  ${nameLine}`)

    const roleLine = rowAgents.map(a => a.role.slice(0, 18).padEnd(18)).join("│ ")
    lines.push(`  ${roleLine}`)

    const taskLine = rowAgents.map(a => {
      const task = (a.task ?? "idle").slice(0, 18).padEnd(18)
      return task
    }).join("│ ")
    lines.push(`  ${taskLine}`)

    const durationLine = rowAgents.map(a => {
      const now = Date.now()
      const age = now - a.lastSeen
      const dur = age < 30000 ? formatDuration(a.duration) : "offline"
      return dur.padEnd(18)
    }).join("│ ")
    lines.push(`  ${durationLine}`)

    lines.push("  " + "─".repeat(60))
  }

  lines.push("  [j/k] navigate  [Enter] detail  [q] close")
  return lines
}

async function pollAgentHealth(ctx: PiContext): Promise<void> {
  try {
    const resp = await fetch(`${hubUrl}/api/events?pattern=agent:health&limit=50`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
    if (!resp.ok) return

    const data = await resp.json() as { events?: Array<{ data?: AgentHealth; ts?: string }> }
    for (const event of data.events ?? []) {
      if (!event.data?.name) continue
      agents.set(event.data.name, {
        ...event.data,
        lastSeen: event.ts ? new Date(event.ts).getTime() : Date.now(),
      })
    }

    ctx.ui.setWidget("agent-grid-footer", buildGridLines(), { placement: "footer" })
  } catch {}
}

export function setupAgentGrid(ctx: PiContext): void {
  ctx.on("map:agent:health", (data) => {
    const health = data as AgentHealth
    if (!health.name) return
    agents.set(health.name, { ...health, lastSeen: Date.now() })
    ctx.ui.setWidget("agent-grid-footer", buildGridLines(), { placement: "footer" })
  })

  ctx.registerCommand({
    name: "grid",
    description: "Show live agent grid",
    async handler(_args, ctx) {
      if (!pollInterval) {
        pollInterval = setInterval(() => pollAgentHealth(ctx), 2000)
      }

      await pollAgentHealth(ctx)
      const lines = buildGridLines()
      ctx.ui.custom((screen: unknown) => {
        void screen
        ctx.ui.setWidget("agent-grid-overlay", lines, { placement: "aboveEditor" })
      })
    },
  })
}

export function emitAgentHealth(
  ctx: PiContext,
  health: Omit<AgentHealth, "lastSeen">
): void {
  ctx.emit("agent:health", { ...health, ts: new Date().toISOString() })
}

export function stopAgentGrid(): void {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}
