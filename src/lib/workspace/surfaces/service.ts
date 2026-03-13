/**
 * @purpose Service surface — registered service health monitoring
 */

import type { StatusEntry } from "../backend.js"
import { SurfaceType } from "../surface-type.js"
import type { SurfaceContext, LiveData, NotificationRule } from "../surface-type.js"

export class ServiceSurface extends SurfaceType {
  readonly type = "service"
  readonly title = "Service"
  readonly description = "Service health monitoring"

  getCommand(ctx: SurfaceContext): string {
    const name = ctx.serviceName || "unknown"
    return `watch -n 30 "jfl services status ${name} 2>/dev/null || echo 'Service ${name} not found'"`
  }

  getStatusEntries(ctx: SurfaceContext, data: LiveData): StatusEntry[] {
    const entries: StatusEntry[] = []
    if (ctx.serviceName) {
      entries.push({ label: "Service", value: ctx.serviceName, color: "cyan" })
    }
    if (data.serviceData) {
      const healthColor = data.serviceData.health === "healthy" ? "green" :
        data.serviceData.health === "degraded" ? "yellow" : "red"
      entries.push({ label: "Health", value: data.serviceData.health, color: healthColor })
      if (data.serviceData.uptime) {
        entries.push({ label: "Uptime", value: data.serviceData.uptime, color: "gray" })
      }
      if (data.serviceData.lastEvent) {
        entries.push({ label: "Last event", value: data.serviceData.lastEvent, color: "gray" })
      }
    }
    return entries
  }

  getNotificationRules(): NotificationRule[] {
    return [
      {
        event: "service:unhealthy",
        condition: (data) => data.serviceData?.health === "unhealthy",
        title: "Service unhealthy",
        urgency: "critical",
      },
    ]
  }

  getUpdateInterval(): number {
    return 30000
  }
}
