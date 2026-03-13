/**
 * @purpose Training surface — replay buffer and training tuple monitoring
 */

import type { StatusEntry } from "../backend.js"
import { SurfaceType } from "../surface-type.js"
import type { SurfaceContext, LiveData, NotificationRule } from "../surface-type.js"

export class TrainingSurface extends SurfaceType {
  readonly type = "training"
  readonly title = "Training"
  readonly description = "Training buffer and tuple stats"

  getCommand(_ctx: SurfaceContext): string {
    return 'watch -n 10 "jfl eval buffer --compact 2>/dev/null || echo No training buffer yet"'
  }

  getStatusEntries(_ctx: SurfaceContext, _data: LiveData): StatusEntry[] {
    return []
  }

  getNotificationRules(): NotificationRule[] {
    return []
  }

  getUpdateInterval(): number {
    return 10000
  }
}
