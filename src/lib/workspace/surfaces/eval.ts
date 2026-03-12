/**
 * @purpose Eval surface — metrics dashboard with composite score tracking
 */

import type { StatusEntry } from "../backend.js"
import { SurfaceType } from "../surface-type.js"
import type { SurfaceContext, LiveData, NotificationRule } from "../surface-type.js"

export class EvalSurface extends SurfaceType {
  readonly type = "eval"
  readonly title = "Eval"
  readonly description = "Eval metrics dashboard (auto-refresh)"

  getCommand(_ctx: SurfaceContext): string {
    return 'watch -n 5 "cat .jfl/eval/eval.jsonl 2>/dev/null | tail -20 || echo No eval data yet"'
  }

  getStatusEntries(_ctx: SurfaceContext, data: LiveData): StatusEntry[] {
    const entries: StatusEntry[] = []
    if (data.evalData) {
      const { latestComposite, delta, trend } = data.evalData
      const trendIcon = trend === "up" ? "^" : trend === "down" ? "v" : "="
      const color = trend === "up" ? "green" : trend === "down" ? "red" : "gray"
      entries.push({ label: "Composite", value: latestComposite.toFixed(4), color: "cyan" })
      entries.push({ label: "Delta", value: `${delta >= 0 ? "+" : ""}${delta.toFixed(4)} ${trendIcon}`, color })
    }
    return entries
  }

  getNotificationRules(): NotificationRule[] {
    return [
      {
        event: "eval:improved",
        condition: (data) => (data.evalData?.delta ?? 0) > 0.01,
        title: "Eval score improved",
        body: (data) => `Composite: ${data.evalData?.latestComposite.toFixed(4)} (+${data.evalData?.delta.toFixed(4)})`,
        urgency: "normal",
      },
      {
        event: "eval:regressed",
        condition: (data) => (data.evalData?.delta ?? 0) < -0.01,
        title: "Eval score regressed",
        body: (data) => `Composite: ${data.evalData?.latestComposite.toFixed(4)} (${data.evalData?.delta.toFixed(4)})`,
        urgency: "critical",
      },
    ]
  }
}
