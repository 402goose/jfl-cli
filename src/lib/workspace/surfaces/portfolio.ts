/**
 * @purpose Portfolio surface — aggregate health, eval, agents, and cost across child projects
 */

import type { StatusEntry } from "../backend.js"
import { SurfaceType } from "../surface-type.js"
import type { SurfaceContext, LiveData, NotificationRule } from "../surface-type.js"

export class PortfolioSurface extends SurfaceType {
  readonly type = "portfolio"
  readonly title = "Portfolio"
  readonly description = "Aggregate health across all products"

  getCommand(_ctx: SurfaceContext): string {
    return 'watch -n 30 "jfl portfolio health 2>/dev/null || echo No portfolio data"'
  }

  getStatusEntries(_ctx: SurfaceContext, data: LiveData): StatusEntry[] {
    const entries: StatusEntry[] = []
    const children = data.childProjects || []

    if (children.length === 0) {
      entries.push({ label: "Products", value: "none discovered", color: "gray" })
      return entries
    }

    entries.push({
      label: "Products",
      value: `${children.length}`,
      color: "cyan",
    })

    for (const child of children) {
      const healthIcon = child.health === "healthy" ? "●"
        : child.health === "degraded" ? "◐"
        : child.health === "unhealthy" ? "○"
        : "?"
      const healthColor = child.health === "healthy" ? "green"
        : child.health === "degraded" ? "yellow"
        : child.health === "unhealthy" ? "red"
        : "gray"

      let detail = ""
      if (child.evalScore !== undefined) {
        const trend = child.evalTrend === "up" ? "▲" : child.evalTrend === "down" ? "▼" : "="
        detail += ` eval:${child.evalScore.toFixed(2)}${trend}`
      }
      if (child.activeAgents !== undefined && child.activeAgents > 0) {
        detail += ` ${child.activeAgents}ag`
      }
      if (child.activeFlows !== undefined && child.activeFlows > 0) {
        detail += ` ${child.activeFlows}fl`
      }

      entries.push({
        label: `${healthIcon} ${child.name}`,
        value: detail.trim() || child.type,
        color: healthColor,
      })
    }

    const totalAgents = children.reduce((sum, c) => sum + (c.activeAgents || 0), 0)
    if (totalAgents > 0) {
      entries.push({ label: "Agents", value: `${totalAgents} active across products`, color: "cyan" })
    }

    const totalCost = children.reduce((sum, c) => sum + (c.costToday || 0), 0)
    if (totalCost > 0) {
      entries.push({
        label: "Cost",
        value: `$${totalCost.toFixed(2)}/today`,
        color: totalCost > 10 ? "yellow" : "green",
      })
    }

    const contextFlows = children.filter((c) => c.contextScope).length
    if (contextFlows > 0) {
      entries.push({ label: "Context", value: `${contextFlows} scoped`, color: "cyan" })
    }

    return entries
  }

  getNotificationRules(): NotificationRule[] {
    return [
      {
        event: "portfolio:child_unhealthy",
        condition: (data) => {
          const children = data.childProjects || []
          return children.some((c) => c.health === "unhealthy")
        },
        title: "Product unhealthy",
        body: (data) => {
          const unhealthy = (data.childProjects || []).filter((c) => c.health === "unhealthy")
          return unhealthy.map((c) => c.name).join(", ")
        },
        urgency: "critical",
      },
      {
        event: "portfolio:eval_regression",
        condition: (data) => {
          const children = data.childProjects || []
          return children.some((c) => c.evalTrend === "down")
        },
        title: "Eval regression in product",
        body: (data) => {
          const regressed = (data.childProjects || []).filter((c) => c.evalTrend === "down")
          return regressed.map((c) => `${c.name}: ${c.evalScore?.toFixed(3)}`).join(", ")
        },
        urgency: "normal",
      },
    ]
  }

  getUpdateInterval(): number {
    return 30000
  }
}
