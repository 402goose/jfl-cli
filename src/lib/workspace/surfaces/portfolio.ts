/**
 * @purpose Portfolio surface — aggregate health across registered services
 */

import type { StatusEntry } from "../backend.js"
import { SurfaceType } from "../surface-type.js"
import type { SurfaceContext, LiveData, NotificationRule } from "../surface-type.js"

export class PortfolioSurface extends SurfaceType {
  readonly type = "portfolio"
  readonly title = "Portfolio"
  readonly description = "Aggregate service health overview"

  getCommand(_ctx: SurfaceContext): string {
    return 'watch -n 30 "jfl portfolio health 2>/dev/null || echo No portfolio data"'
  }

  getStatusEntries(_ctx: SurfaceContext, _data: LiveData): StatusEntry[] {
    return []
  }

  getNotificationRules(): NotificationRule[] {
    return [
      {
        event: "portfolio:child_unhealthy",
        title: "Child service unhealthy",
        urgency: "critical",
      },
    ]
  }

  getUpdateInterval(): number {
    return 30000
  }
}
