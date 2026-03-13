/**
 * @purpose Flow surface — active flow monitoring with gate tracking
 */

import type { StatusEntry } from "../backend.js"
import { SurfaceType } from "../surface-type.js"
import type { SurfaceContext, LiveData, NotificationRule } from "../surface-type.js"

export class FlowSurface extends SurfaceType {
  readonly type = "flows"
  readonly title = "Flows"
  readonly description = "Active flows and automation status"

  getCommand(_ctx: SurfaceContext): string {
    return 'watch -n 10 "jfl flows list 2>/dev/null || echo No flows configured"'
  }

  getStatusEntries(_ctx: SurfaceContext, data: LiveData): StatusEntry[] {
    const entries: StatusEntry[] = []
    if (data.flowData) {
      entries.push({ label: "Active", value: String(data.flowData.activeCount), color: "green" })
      if (data.flowData.gatedCount > 0) {
        entries.push({ label: "Gated", value: String(data.flowData.gatedCount), color: "yellow" })
      }
      if (data.flowData.needsApproval.length > 0) {
        entries.push({ label: "Needs approval", value: String(data.flowData.needsApproval.length), color: "yellow" })
      }
      if (data.flowData.recentFailures > 0) {
        entries.push({ label: "Failed", value: String(data.flowData.recentFailures), color: "red" })
      }
    }
    return entries
  }

  getNotificationRules(): NotificationRule[] {
    return [
      {
        event: "flow:needs_approval",
        condition: (data) => (data.flowData?.needsApproval.length ?? 0) > 0,
        title: "Flow needs approval",
        body: (data) => data.flowData?.needsApproval.join(", ") || "",
        urgency: "normal",
      },
      {
        event: "flow:failed",
        condition: (data) => (data.flowData?.recentFailures ?? 0) > 0,
        title: "Flow execution failed",
        urgency: "critical",
      },
    ]
  }

  getUpdateInterval(): number {
    return 10000
  }
}
