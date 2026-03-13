/**
 * @purpose Topology surface — service dependency graph
 */

import type { StatusEntry } from "../backend.js"
import { SurfaceType } from "../surface-type.js"
import type { SurfaceContext, LiveData, NotificationRule } from "../surface-type.js"

export class TopologySurface extends SurfaceType {
  readonly type = "topology"
  readonly title = "Topology"
  readonly description = "Service dependency graph"

  getCommand(_ctx: SurfaceContext): string {
    return 'jfl services deps 2>/dev/null || echo "No services registered"'
  }

  getStatusEntries(_ctx: SurfaceContext, _data: LiveData): StatusEntry[] {
    return []
  }

  getNotificationRules(): NotificationRule[] {
    return []
  }
}
