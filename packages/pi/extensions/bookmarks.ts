/**
 * Bookmarks Extension
 *
 * Registers /bookmark and /unbookmark for marking key decisions,
 * milestones, and important moments in the session tree.
 * Labels show up in Pi's /tree navigation for easy jumping.
 *
 * Also auto-bookmarks when journal entries of type "decision" or
 * "milestone" are written.
 *
 * @purpose Session tree bookmarks for key JFL moments
 */

import type { PiContext } from "./types.js"

let latestEntryId: string | undefined

export function setupBookmarks(ctx: PiContext): void {
  ctx.registerCommand({
    name: "bookmark",
    description: "Bookmark the last message (usage: /bookmark [label])",
    async handler(args, ctx) {
      const label = args.trim() || `jfl-${Date.now()}`

      const sm = ctx.pi.sessionManager
      if (!sm) {
        ctx.ui.notify("Session manager unavailable", { level: "warn" })
        return
      }

      const entries = sm.getEntries?.() ?? sm.getBranch?.() ?? []
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i]
        if (entry?.type === "message" && entry?.message?.role === "assistant") {
          ctx.pi.setLabel(entry.id, label)
          ctx.ui.notify(`Bookmarked: ${label}`, { level: "success" })
          latestEntryId = entry.id
          return
        }
      }

      ctx.ui.notify("No assistant message to bookmark", { level: "warn" })
    },
  })

  ctx.registerCommand({
    name: "unbookmark",
    description: "Remove the most recent bookmark",
    async handler(_args, ctx) {
      const sm = ctx.pi.sessionManager
      if (!sm) return

      const entries = sm.getEntries?.() ?? sm.getBranch?.() ?? []
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i]
        const label = sm.getLabel?.(entry?.id)
        if (label) {
          ctx.pi.setLabel(entry.id, undefined)
          ctx.ui.notify(`Removed: ${label}`, { level: "info" })
          return
        }
      }

      ctx.ui.notify("No bookmarked entry found", { level: "warn" })
    },
  })

  ctx.on("journal:written", (data: any) => {
    if (!data) return
    const type = data.type
    if (type === "decision" || type === "milestone") {
      const sm = ctx.pi.sessionManager
      if (!sm) return

      const entries = sm.getEntries?.() ?? []
      if (entries.length > 0) {
        const last = entries[entries.length - 1]
        if (last?.id) {
          const label = `${type}: ${(data.title ?? "").slice(0, 40)}`
          ctx.pi.setLabel(last.id, label)
        }
      }
    }
  })
}
