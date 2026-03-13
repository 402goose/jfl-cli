/**
 * @purpose Agent overview surface — shows all scoped RL agents, their sessions, training buffer, and event routing
 */

import type { StatusEntry } from "../backend.js"
import { SurfaceType } from "../surface-type.js"
import type { SurfaceContext, LiveData, NotificationRule } from "../surface-type.js"

export class AgentOverviewSurface extends SurfaceType {
  readonly type = "agents"
  readonly title = "Agent Overview"
  readonly description = "All agents: sessions, metrics, training, event routing"

  getCommand(ctx: SurfaceContext): string {
    return `watch -n 5 "jfl peter status 2>/dev/null || jfl eval list --compact 2>/dev/null || echo 'No agent data yet'"`
  }

  getStatusEntries(_ctx: SurfaceContext, data: LiveData): StatusEntry[] {
    const entries: StatusEntry[] = []

    const sessions = data.agentSessions || []
    const active = sessions.filter((s) => s.status === "active")
    const completed = sessions.filter((s) => s.status === "completed")

    entries.push({
      label: "Active",
      value: `${active.length} agent${active.length !== 1 ? "s" : ""}`,
      color: active.length > 0 ? "green" : "gray",
    })

    for (const s of active) {
      const trendIcon = s.delta > 0 ? "+" : s.delta < 0 ? "" : "="
      entries.push({
        label: s.agentName,
        value: `R${s.round} ${s.metric}:${s.currentScore.toFixed(3)} ${trendIcon}${s.delta.toFixed(3)}`,
        color: s.delta > 0 ? "green" : s.delta < 0 ? "red" : "gray",
      })
    }

    if (completed.length > 0) {
      entries.push({
        label: "Done",
        value: `${completed.length} session${completed.length !== 1 ? "s" : ""}`,
        color: "gray",
      })
    }

    if (data.trainingData) {
      const td = data.trainingData
      entries.push({
        label: "Buffer",
        value: `${td.totalTuples} tuples | ${td.positiveReward} positive`,
        color: td.totalTuples > 0 ? "cyan" : "gray",
      })
      if (td.improvedRate > 0) {
        entries.push({
          label: "Win rate",
          value: `${(td.improvedRate * 100).toFixed(0)}%`,
          color: td.improvedRate > 0.3 ? "green" : "yellow",
        })
      }
    }

    const routing = buildEventRouting(sessions)
    if (routing.length > 0) {
      entries.push({ label: "Routing", value: "", color: "gray" })
      for (const r of routing.slice(0, 3)) {
        entries.push({ label: "", value: r, color: "cyan" })
      }
    }

    return entries
  }

  getNotificationRules(): NotificationRule[] {
    return [
      {
        event: "agent:session_complete",
        condition: (data) => {
          const sessions = data.agentSessions || []
          return sessions.some((s) => s.status === "completed" && s.delta > 0)
        },
        title: "Agent session improved",
        body: (data) => {
          const s = (data.agentSessions || []).find((s) => s.status === "completed" && s.delta > 0)
          return s ? `${s.agentName}: +${s.delta.toFixed(4)} ${s.metric}` : "Agent improved"
        },
        urgency: "normal",
      },
      {
        event: "agent:pr_created",
        title: "Agent created PR",
        urgency: "normal",
      },
      {
        event: "agent:error",
        condition: (data) => {
          const sessions = data.agentSessions || []
          return sessions.some((s) => s.status === "failed")
        },
        title: "Agent session failed",
        urgency: "critical",
      },
    ]
  }

  getUpdateInterval(): number {
    return 5000
  }
}

function buildEventRouting(sessions: LiveData["agentSessions"]): string[] {
  if (!sessions || sessions.length === 0) return []

  const routes: string[] = []
  const producerMap = new Map<string, string>()

  for (const s of sessions) {
    for (const p of s.produces) {
      producerMap.set(p, s.agentName)
    }
  }

  for (const s of sessions) {
    for (const c of s.consumes) {
      const producer = producerMap.get(c)
      if (producer) {
        routes.push(`${producer} -> ${s.agentName} (${c})`)
      }
    }
  }

  return routes
}
