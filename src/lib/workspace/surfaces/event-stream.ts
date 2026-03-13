/**
 * @purpose Event stream surface — live Context Hub events
 */

import type { StatusEntry } from "../backend.js"
import { SurfaceType } from "../surface-type.js"
import type { SurfaceContext, LiveData, NotificationRule } from "../surface-type.js"

export class EventStreamSurface extends SurfaceType {
  readonly type = "events"
  readonly title = "Events"
  readonly description = "Live event stream from Context Hub"

  getCommand(_ctx: SurfaceContext): string {
    return 'jfl context-hub events --follow 2>/dev/null || echo "Context Hub not running. Run: jfl context-hub start"'
  }

  getStatusEntries(_ctx: SurfaceContext, data: LiveData): StatusEntry[] {
    const entries: StatusEntry[] = []
    if (data.hubEvents) {
      entries.push({ label: "Events/24h", value: String(data.hubEvents.count24h), color: "cyan" })
      if (data.hubEvents.topTypes.length > 0) {
        const top = data.hubEvents.topTypes[0]
        entries.push({ label: "Top type", value: `${top.type} (${top.count})`, color: "gray" })
      }
      if (data.hubEvents.recentErrors.length > 0) {
        entries.push({ label: "Errors", value: String(data.hubEvents.recentErrors.length), color: "red" })
      }
    }
    return entries
  }

  getNotificationRules(): NotificationRule[] {
    return [
      {
        event: "error",
        condition: (data) => (data.hubEvents?.recentErrors.length ?? 0) > 0,
        title: "Error events detected",
        urgency: "critical",
      },
    ]
  }

  getUpdateInterval(): number {
    return 10000
  }
}
