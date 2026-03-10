/**
 * CRM Tool Extension
 *
 * Registers jfl_crm tool with custom TUI rendering.
 * Delegates to ./crm CLI (Google Sheets backed).
 * Renders pipeline data with color-coded deal stages.
 *
 * @purpose jfl_crm tool — themed CRM display with deal status colors
 */

import { execSync } from "child_process"
import type { PiContext } from "./types.js"
import { crmRenderCall, crmRenderResult } from "./tool-renderers.js"

let projectRoot = ""

export function setupCrmTool(ctx: PiContext): void {
  projectRoot = ctx.session.projectRoot

  ctx.registerTool({
    name: "jfl_crm",
    description: "Query or update the JFL CRM (contacts, deals, pipeline). Delegates to ./crm CLI backed by Google Sheets.",
    promptSnippet: "Query CRM pipeline, contacts, and deals via Google Sheets",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "CRM subcommand: list, prep, stale, priority, touch, update, add",
        },
        args: {
          type: "string",
          description: "Arguments for the subcommand (e.g., contact name, field, value)",
        },
      },
      required: ["command"],
    },
    async handler(input) {
      const { command, args } = input as { command: string; args?: string }
      const fullCmd = args ? `./crm ${command} ${args}` : `./crm ${command}`

      try {
        const output = execSync(fullCmd, {
          cwd: projectRoot,
          timeout: 15000,
          encoding: "utf-8",
        })
        return output.trim()
      } catch (err: unknown) {
        const error = err as { message?: string; stderr?: Buffer }
        if (error.stderr) {
          const stderr = error.stderr.toString().trim()
          if (stderr) return `Error: ${stderr}`
        }
        return `Error running crm: ${error.message ?? String(err)}`
      }
    },
    renderCall: crmRenderCall,
    renderResult: crmRenderResult,
  })
}
