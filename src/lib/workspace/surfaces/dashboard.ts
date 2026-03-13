/**
 * @purpose Dashboard surface — opens JFL platform dashboard in cmux's built-in browser pane
 *
 * cmux has a scriptable browser (ported from agent-browser). When JFL platform
 * is running locally, we open the dashboard right in the workspace. Agents can
 * interact with it via cmux browser commands.
 */

import type { StatusEntry } from "../backend.js"
import { SurfaceType } from "../surface-type.js"
import type { SurfaceContext, LiveData, NotificationRule } from "../surface-type.js"

export class DashboardSurface extends SurfaceType {
  readonly type = "dashboard"
  readonly title = "Dashboard"
  readonly description = "JFL platform dashboard (browser pane)"

  getCommand(ctx: SurfaceContext): string {
    // When running inside cmux, we can use the browser pane type.
    // The engine will detect this and use pane.create with type=browser instead.
    // Fallback for tmux: open in default browser
    return 'open http://localhost:3000/dashboard 2>/dev/null || echo "JFL Platform not running. Start with: jfl deploy local"'
  }

  isBrowserPane(): boolean {
    return true
  }

  getBrowserUrl(): string {
    return "http://localhost:3000/dashboard"
  }

  getStatusEntries(_ctx: SurfaceContext, _data: LiveData): StatusEntry[] {
    return []
  }

  getNotificationRules(): NotificationRule[] {
    return []
  }
}
