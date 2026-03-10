/**
 * Native Notifications Extension
 *
 * Sends terminal notifications (OSC 777/99) when:
 * - Agent finishes a long task (>10s)
 * - Journal entry is recommended
 * - Eval score changes significantly
 *
 * Supports Ghostty, iTerm2, WezTerm, Kitty, Windows Terminal.
 *
 * @purpose Terminal-native notifications for key JFL events
 */

import type { PiContext, JflConfig } from "./types.js"

let enabled = true
let agentStartTime = 0
const LONG_TASK_THRESHOLD_MS = 10000

function notifyOSC777(title: string, body: string): void {
  process.stdout.write(`\x1b]777;notify;${title};${body}\x07`)
}

function notifyOSC99(title: string, body: string): void {
  process.stdout.write(`\x1b]99;i=1:d=0;${title}\x1b\\`)
  process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`)
}

function notify(title: string, body: string): void {
  if (!enabled) return

  try {
    if (process.env.KITTY_WINDOW_ID) {
      notifyOSC99(title, body)
    } else {
      notifyOSC777(title, body)
    }
  } catch {}
}

export function setupNotifications(ctx: PiContext, config: JflConfig): void {
  if (config.pi?.disable_notifications) {
    enabled = false
    return
  }

  ctx.on("agent:start", () => {
    agentStartTime = Date.now()
  })

  ctx.on("agent:end", (data: any) => {
    const elapsed = Date.now() - agentStartTime
    if (elapsed > LONG_TASK_THRESHOLD_MS) {
      const seconds = Math.floor(elapsed / 1000)
      const reason = data?.exitReason ?? "done"
      notify("JFL", `Agent finished (${seconds}s) — ${reason}`)
    }
  })

  ctx.on("journal:written", (data: any) => {
    const title = data?.title ?? "entry"
    notify("JFL Journal", title)
  })

  ctx.registerCommand({
    name: "notify",
    description: "Toggle native terminal notifications",
    async handler(_args, ctx) {
      enabled = !enabled
      ctx.ui.notify(`Notifications ${enabled ? "enabled" : "disabled"}`, { level: "info" })
    },
  })
}
