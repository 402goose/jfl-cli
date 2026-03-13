/**
 * @purpose Shell surface — standard terminal pane
 */

import type { StatusEntry } from "../backend.js"
import { SurfaceType } from "../surface-type.js"
import type { SurfaceContext, LiveData, NotificationRule } from "../surface-type.js"

export class ShellSurface extends SurfaceType {
  readonly type = "shell"
  readonly title = "Shell"
  readonly description = "Terminal shell"

  getCommand(_ctx: SurfaceContext): string {
    return process.env.SHELL || "/bin/zsh"
  }

  getStatusEntries(_ctx: SurfaceContext, _data: LiveData): StatusEntry[] {
    return []
  }

  getNotificationRules(): NotificationRule[] {
    return []
  }
}
