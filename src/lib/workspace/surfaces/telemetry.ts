/**
 * @purpose Telemetry surface — error rates, cost tracking, anomaly detection
 */

import type { StatusEntry } from "../backend.js"
import { SurfaceType } from "../surface-type.js"
import type { SurfaceContext, LiveData, NotificationRule } from "../surface-type.js"

export class TelemetrySurface extends SurfaceType {
  readonly type = "telemetry"
  readonly title = "Telemetry"
  readonly description = "Error rates, costs, and anomalies"

  getCommand(_ctx: SurfaceContext): string {
    return 'watch -n 60 "jfl telemetry digest --compact 2>/dev/null || echo No telemetry data"'
  }

  getStatusEntries(_ctx: SurfaceContext, data: LiveData): StatusEntry[] {
    const entries: StatusEntry[] = []
    if (data.telemetryData) {
      entries.push({
        label: "Error rate",
        value: `${(data.telemetryData.errorRate * 100).toFixed(1)}%`,
        color: data.telemetryData.errorRate > 0.05 ? "red" : "green",
      })
      entries.push({ label: "Cost today", value: `$${data.telemetryData.costToday.toFixed(2)}`, color: "cyan" })
      if (data.telemetryData.anomalies.length > 0) {
        entries.push({ label: "Anomalies", value: String(data.telemetryData.anomalies.length), color: "yellow" })
      }
    }
    return entries
  }

  getNotificationRules(): NotificationRule[] {
    return [
      {
        event: "telemetry:cost_spike",
        condition: (data) => (data.telemetryData?.costToday ?? 0) > 10,
        title: "Cost spike detected",
        body: (data) => `$${data.telemetryData?.costToday.toFixed(2)} today`,
        urgency: "normal",
      },
      {
        event: "telemetry:anomaly",
        condition: (data) => (data.telemetryData?.anomalies.length ?? 0) > 0,
        title: "Telemetry anomaly",
        urgency: "normal",
      },
    ]
  }

  getUpdateInterval(): number {
    return 60000
  }
}
