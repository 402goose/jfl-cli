/**
 * @purpose Notification dispatcher — matches events against surface rules, dispatches to backend
 */

import type { WorkspaceBackend } from "./backend.js"
import type { LiveData, NotificationRule } from "./surface-type.js"

interface ActiveRule {
  surfaceId: string
  rule: NotificationRule
  lastFired: number
}

const COOLDOWN_MS = 60_000

export class NotificationDispatcher {
  private backend: WorkspaceBackend
  private rules: ActiveRule[] = []

  constructor(backend: WorkspaceBackend) {
    this.backend = backend
  }

  register(surfaceId: string, rules: NotificationRule[]): void {
    for (const rule of rules) {
      this.rules.push({ surfaceId, rule, lastFired: 0 })
    }
  }

  unregister(surfaceId: string): void {
    this.rules = this.rules.filter((r) => r.surfaceId !== surfaceId)
  }

  check(data: LiveData): void {
    if (!this.backend.capabilities().notifications) return

    const now = Date.now()
    for (const active of this.rules) {
      if (now - active.lastFired < COOLDOWN_MS) continue
      if (!active.rule.condition) continue
      if (!active.rule.condition(data)) continue

      active.lastFired = now
      const body = active.rule.body ? active.rule.body(data) : undefined

      this.backend.notify({
        surfaceId: active.surfaceId,
        title: active.rule.title,
        body,
        urgency: active.rule.urgency,
      }).catch(() => {})
    }
  }
}
