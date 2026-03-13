/**
 * @purpose Claude surface — primary AI assistant pane
 */

import type { StatusEntry } from "../backend.js"
import { SurfaceType } from "../surface-type.js"
import type { SurfaceContext, LiveData, NotificationRule } from "../surface-type.js"

export class ClaudeSurface extends SurfaceType {
  readonly type = "claude"
  readonly title = "Claude"
  readonly description = "AI assistant (Claude Code)"

  getCommand(_ctx: SurfaceContext): string {
    return "claude"
  }

  getStatusEntries(_ctx: SurfaceContext, data: LiveData): StatusEntry[] {
    const entries: StatusEntry[] = []
    if (data.telemetryData) {
      entries.push({ label: "Cost today", value: `$${data.telemetryData.costToday.toFixed(2)}`, color: "cyan" })
    }
    return entries
  }

  getNotificationRules(): NotificationRule[] {
    return []
  }
}
