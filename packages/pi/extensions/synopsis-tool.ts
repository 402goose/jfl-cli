/**
 * Synopsis Tool Extension
 *
 * Registers jfl_synopsis tool that runs the synopsis CLI command.
 *
 * @purpose jfl_synopsis tool — aggregated work summary across sessions
 */

import { execSync } from "child_process"
import { existsSync } from "fs"
import { join } from "path"
import type { PiContext } from "./types.js"

let projectRoot = ""

function findSynopsisScript(root: string): string | null {
  const candidates = [
    join(root, "product", "packages", "memory", "dist", "journal", "cli.js"),
    join(root, "..", "jfl-platform", "packages", "memory", "dist", "journal", "cli.js"),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

export function setupSynopsisTool(ctx: PiContext): void {
  projectRoot = ctx.session.projectRoot

  ctx.registerTool({
    name: "jfl_synopsis",
    description: "Get a work summary across all sessions — what happened, who did what, time breakdown",
    inputSchema: {
      type: "object",
      properties: {
        hours: {
          type: "number",
          description: "How many hours back to summarize (default: 24)",
        },
        author: {
          type: "string",
          description: "Filter by git author name or username",
        },
      },
    },
    async handler(input) {
      const { hours, author } = input as { hours?: number; author?: string }

      const synopsisScript = findSynopsisScript(projectRoot)
      if (synopsisScript) {
        try {
          const args = [String(hours ?? 24), author].filter(Boolean).join(" ")
          const output = execSync(`node "${synopsisScript}" synopsis ${args}`, {
            cwd: projectRoot,
            timeout: 30000,
            encoding: "utf-8",
          })
          return output.trim()
        } catch {}
      }

      try {
        const args = ["synopsis", String(hours ?? 24), author && `--author "${author}"`]
          .filter(Boolean)
          .join(" ")
        const output = execSync(`jfl synopsis ${args}`, {
          cwd: projectRoot,
          timeout: 30000,
          encoding: "utf-8",
        })
        return output.trim()
      } catch (err) {
        return `Synopsis unavailable: ${err}`
      }
    },
  })
}
