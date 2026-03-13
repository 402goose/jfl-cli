/**
 * @purpose Agent surface — scoped RL agent execution with live round data from session state
 */

import type { StatusEntry } from "../backend.js"
import { SurfaceType } from "../surface-type.js"
import type { SurfaceContext, LiveData, NotificationRule } from "../surface-type.js"

export class AgentSurface extends SurfaceType {
  readonly type = "agent"
  readonly title = "Agent"
  readonly description = "Scoped RL agent runner"

  getCommand(ctx: SurfaceContext): string {
    const name = ctx.agentName || "default"
    return `jfl peter agent run ${name} 2>/dev/null || echo "Agent ${name} failed to start"`
  }

  getStatusEntries(ctx: SurfaceContext, data: LiveData): StatusEntry[] {
    const entries: StatusEntry[] = []
    const agentName = ctx.agentName

    if (agentName) {
      entries.push({ label: "Agent", value: agentName, color: "cyan" })
    }

    const session = agentName
      ? (data.agentSessions || []).find((s) => s.agentName === agentName)
      : null

    if (session) {
      const trendIcon = session.delta > 0 ? "+" : session.delta < 0 ? "" : "="
      entries.push({
        label: session.metric,
        value: `${session.currentScore.toFixed(4)} (${trendIcon}${session.delta.toFixed(4)})`,
        color: session.delta > 0 ? "green" : session.delta < 0 ? "red" : "gray",
      })
      entries.push({ label: "Baseline", value: session.baseline.toFixed(4), color: "gray" })
      entries.push({ label: "Round", value: String(session.round), color: "gray" })
      entries.push({
        label: "Explore",
        value: `${(session.explorationRate * 100).toFixed(0)}%`,
        color: session.explorationRate > 0.1 ? "yellow" : "green",
      })
      entries.push({
        label: "Status",
        value: session.status,
        color: session.status === "active" ? "green" : session.status === "failed" ? "red" : "gray",
      })

      const kept = session.rounds.filter((r) => r.kept).length
      const total = session.rounds.length
      if (total > 0) {
        entries.push({
          label: "Rounds",
          value: `${kept}/${total} kept`,
          color: kept > total / 2 ? "green" : "yellow",
        })
      }

      for (const r of session.rounds.slice(-3).reverse()) {
        const icon = r.kept ? "+" : "x"
        const label = `R${r.round}`
        const delta = r.delta > 0 ? `+${r.delta.toFixed(4)}` : r.delta.toFixed(4)
        entries.push({
          label,
          value: `${icon} ${delta} ${r.task.slice(0, 30)}`,
          color: r.kept ? "green" : "red",
        })
      }

      if (session.produces.length > 0) {
        entries.push({ label: "Produces", value: session.produces.join(", "), color: "cyan" })
      }
      if (session.consumes.length > 0) {
        entries.push({ label: "Consumes", value: session.consumes.join(", "), color: "cyan" })
      }
    } else if (data.agentData) {
      entries.push({ label: "Metric", value: data.agentData.metric, color: "cyan" })
      entries.push({ label: "Score", value: data.agentData.score.toFixed(4), color: "green" })
      entries.push({ label: "Round", value: String(data.agentData.round), color: "gray" })
      entries.push({
        label: "Explore",
        value: `${(data.agentData.explorationRate * 100).toFixed(0)}%`,
        color: data.agentData.explorationRate > 0.1 ? "yellow" : "green",
      })
    }

    return entries
  }

  getNotificationRules(): NotificationRule[] {
    return [
      {
        event: "agent:round_complete",
        condition: (data) => {
          const sessions = data.agentSessions || []
          return sessions.some((s) => s.status === "active" && s.rounds.length > 0)
        },
        title: "Agent round complete",
        body: (data) => {
          const s = (data.agentSessions || []).find((s) => s.status === "active")
          if (!s) return "Round complete"
          const last = s.rounds[s.rounds.length - 1]
          return last ? `${s.agentName} R${last.round}: ${last.kept ? "kept" : "reverted"} (${last.delta > 0 ? "+" : ""}${last.delta.toFixed(4)})` : `${s.agentName}: score ${s.currentScore.toFixed(4)}`
        },
        urgency: "low",
      },
      {
        event: "agent:error",
        condition: (data) => {
          const sessions = data.agentSessions || []
          return sessions.some((s) => s.status === "failed")
        },
        title: "Agent error",
        urgency: "critical",
      },
    ]
  }

  getUpdateInterval(): number {
    return 5000
  }
}
