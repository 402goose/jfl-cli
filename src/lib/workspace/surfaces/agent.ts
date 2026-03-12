/**
 * @purpose Agent surface — scoped RL agent execution with metric tracking
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
    if (data.agentData) {
      entries.push({ label: "Metric", value: data.agentData.metric, color: "cyan" })
      entries.push({ label: "Score", value: data.agentData.score.toFixed(4), color: "green" })
      entries.push({ label: "Round", value: String(data.agentData.round), color: "gray" })
      entries.push({
        label: "Explore",
        value: `${(data.agentData.explorationRate * 100).toFixed(0)}%`,
        color: data.agentData.explorationRate > 0.1 ? "yellow" : "green",
      })
    }
    if (ctx.agentName) {
      entries.unshift({ label: "Agent", value: ctx.agentName, color: "cyan" })
    }
    return entries
  }

  getNotificationRules(): NotificationRule[] {
    return [
      {
        event: "agent:round_complete",
        title: "Agent round complete",
        body: (data) => `Score: ${data.agentData?.score.toFixed(4) || "?"}`,
        urgency: "low",
      },
      {
        event: "agent:error",
        title: "Agent error",
        urgency: "critical",
      },
    ]
  }

  getUpdateInterval(): number {
    return 5000
  }
}
