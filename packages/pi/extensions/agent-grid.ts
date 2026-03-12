/**
 * Agent Grid Extension
 *
 * /grid command shows a live overlay of all active Pi sessions.
 * Polls Context Hub for agent:health events.
 * Beautiful themed card layout with status icons.
 *
 * @purpose /grid command — themed agent status overlay with live polling
 */

import { existsSync, readdirSync, statSync } from "fs"
import { join } from "path"
import type { PiContext, PiTheme } from "./types.js"
import { hubUrl, authToken } from "./map-bridge.js"
import { resolveDisplayName, formatAgentLabel } from "./agent-names.js"

interface AgentHealth {
  name: string
  role: string
  status: "running" | "idle" | "blocked" | "error"
  task?: string
  duration?: number
  model?: string
  lastSeen: number
}

const agents = new Map<string, AgentHealth>()

function formatDuration(ms?: number): string {
  if (!ms) return "-"
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m}m${rs > 0 ? ` ${rs}s` : ""}`
}

async function pollAgentHealth(): Promise<void> {
  try {
    const resp = await fetch(`${hubUrl}/api/events?pattern=agent:health&limit=50`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
    if (!resp.ok) return

    const data = await resp.json() as { events?: Array<{ data?: AgentHealth; ts?: string }> }
    for (const event of data.events ?? []) {
      if (!event.data?.name) continue
      agents.set(event.data.name, {
        ...event.data,
        lastSeen: event.ts ? new Date(event.ts).getTime() : Date.now(),
      })
    }
  } catch {}
}

function getLocalSessions(root: string): Array<{ name: string; age: number }> {
  const journalDir = join(root, ".jfl", "journal")
  if (!existsSync(journalDir)) return []
  const now = Date.now()
  const sessions: Array<{ name: string; age: number }> = []
  for (const f of readdirSync(journalDir)) {
    if (!f.startsWith("session-") || !f.endsWith(".jsonl")) continue
    try {
      const stat = statSync(join(journalDir, f))
      const age = now - stat.mtimeMs
      if (age < 600000) {
        sessions.push({ name: resolveDisplayName(f.replace(".jsonl", "").replace("session-", "")), age })
      }
    } catch {}
  }
  return sessions
}

export function setupAgentGrid(ctx: PiContext): void {
  ctx.on("map:agent:health", (data) => {
    const health = data as AgentHealth
    if (!health.name) return
    agents.set(health.name, { ...health, lastSeen: Date.now() })
  })

  ctx.registerCommand({
    name: "grid",
    description: "Show live agent grid overlay",
    async handler(_args, ctx) {
      if (!ctx.ui.hasUI) {
        ctx.ui.notify("Agent grid requires interactive mode", { level: "warn" })
        return
      }

      await pollAgentHealth()

      await ctx.ui.custom<void>((tui: any, theme: PiTheme, _kb: any, done: (r: void) => void) => {
        let interval: ReturnType<typeof setInterval> | null = null

        interval = setInterval(async () => {
          await pollAgentHealth()
          tui.requestRender()
        }, 3000)

        return {
          handleInput(key: string) {
            if (key === "\x1b" || key === "q") {
              if (interval) clearInterval(interval)
              done(undefined)
            }
          },

          render(width: number): string[] {
            const w = Math.min(width, 80)
            const lines: string[] = []
            const agentList = Array.from(agents.values())
            const localSessions = getLocalSessions(ctx.session.projectRoot)

            lines.push("")
            lines.push(`  ${theme.fg("accent", "◆")} ${theme.bold("Agent Grid")}`)
            lines.push(`  ${theme.fg("border", "─".repeat(w - 4))}`)
            lines.push("")

            if (agentList.length > 0) {
              lines.push(`  ${theme.fg("accent", "MAP Agents")} ${theme.fg("dim", `(${agentList.length})`)}`)
              lines.push("")

              for (const a of agentList) {
                const now = Date.now()
                const age = now - a.lastSeen
                const isOnline = age < 30000

                const statusIcon = a.status === "running" ? theme.fg("success", "●")
                  : a.status === "error" ? theme.fg("error", "✗")
                  : a.status === "blocked" ? theme.fg("warning", "◆")
                  : theme.fg("dim", "○")

                const onlineStr = isOnline ? "" : theme.fg("error", " (offline)")
                const displayName = resolveDisplayName(a.name)

                lines.push(`  ${statusIcon} ${theme.fg("text", displayName.padEnd(20))} ${theme.fg("muted", a.role ?? "")}${onlineStr}`)

                if (a.task) {
                  lines.push(`    ${theme.fg("dim", a.task.slice(0, w - 8))}`)
                }
                if (a.model || a.duration) {
                  const parts = [
                    a.model ? theme.fg("dim", a.model) : "",
                    a.duration ? theme.fg("dim", formatDuration(a.duration)) : "",
                  ].filter(Boolean)
                  if (parts.length) lines.push(`    ${parts.join(" │ ")}`)
                }
              }
            }

            if (localSessions.length > 0) {
              if (agentList.length > 0) lines.push("")
              lines.push(`  ${theme.fg("accent", "Local Sessions")} ${theme.fg("dim", `(${localSessions.length})`)}`)
              lines.push("")

              for (const s of localSessions) {
                const ageStr = s.age < 60000 ? `${Math.floor(s.age / 1000)}s`
                  : s.age < 3600000 ? `${Math.floor(s.age / 60000)}m`
                  : `${Math.floor(s.age / 3600000)}h`
                const icon = s.age < 120000 ? theme.fg("success", "●") : theme.fg("dim", "○")
                lines.push(`  ${icon} ${theme.fg("text", s.name)} ${theme.fg("dim", ageStr + " ago")}`)
              }
            }

            if (agentList.length === 0 && localSessions.length === 0) {
              lines.push(`  ${theme.fg("dim", "No active agents or sessions")}`)
              lines.push(`  ${theme.fg("dim", "Start agents: jfl pi agents run --team teams/gtm-team.yaml")}`)
            }

            lines.push("")
            lines.push(`  ${theme.fg("dim", "Esc/q close  │  refreshes every 3s")}`)
            lines.push("")

            return lines
          },

          invalidate() {},
        }
      }, { overlay: true })
    },
  })
}

export function emitAgentHealth(
  ctx: PiContext,
  health: Omit<AgentHealth, "lastSeen">
): void {
  ctx.emit("agent:health", { ...health, ts: new Date().toISOString() })
}

export function stopAgentGrid(): void {}
