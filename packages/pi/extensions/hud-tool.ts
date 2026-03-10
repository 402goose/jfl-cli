/**
 * HUD Tool Extension
 *
 * Registers jfl_hud tool and /hud command.
 * Updates the aboveEditor widget after each agent turn.
 *
 * @purpose jfl_hud tool + /hud command + aboveEditor widget
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import type { PiContext } from "./types.js"

let projectRoot = ""

function getDaysToLaunch(root: string): string | null {
  const roadmapPath = join(root, "knowledge", "ROADMAP.md")
  if (!existsSync(roadmapPath)) return null

  const content = readFileSync(roadmapPath, "utf-8")
  const dateMatch = content.match(/(\d{4}-\d{2}-\d{2})/m)
  if (!dateMatch) return null

  const launchDate = new Date(dateMatch[1])
  const now = new Date()
  const diff = Math.ceil((launchDate.getTime() - now.getTime()) / 86400000)
  return diff > 0 ? `${diff}d to launch` : `${Math.abs(diff)}d past launch`
}

function getProjectPhase(root: string): string {
  const roadmapPath = join(root, "knowledge", "ROADMAP.md")
  if (!existsSync(roadmapPath)) return "unknown"

  const content = readFileSync(roadmapPath, "utf-8")
  const phaseMatch = content.match(/## (?:Phase|Current Phase)[:\s]*([^\n]+)/i)
  return phaseMatch ? phaseMatch[1].trim() : "unknown"
}

function buildHudLines(root: string): string[] {
  const configPath = join(root, ".jfl", "config.json")
  let projectName = root.split("/").pop() ?? "JFL"
  let projectType = "gtm"

  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8")) as { name?: string; type?: string }
      if (config.name) projectName = config.name
      if (config.type) projectType = config.type
    } catch {}
  }

  const days = getDaysToLaunch(root)
  const phase = getProjectPhase(root)

  const lines = [
    `◆ ${projectName} [${projectType}]`,
    days ? `  ${days}` : "",
    `  Phase: ${phase}`,
  ].filter(Boolean)

  try {
    const crmOutput = execSync("./crm list --compact 2>/dev/null | head -3", {
      cwd: root,
      timeout: 5000,
      encoding: "utf-8",
    }).trim()
    if (crmOutput) {
      lines.push("  Pipeline:", ...crmOutput.split("\n").map(l => `    ${l}`))
    }
  } catch {}

  return lines
}

export function setupHudTool(ctx: PiContext): void {
  projectRoot = ctx.session.projectRoot

  const initialLines = buildHudLines(projectRoot)
  ctx.ui.setWidget("jfl-hud", initialLines, { placement: "aboveEditor" })

  ctx.registerTool({
    name: "jfl_hud",
    description: "Get the current JFL project dashboard — timeline, phase, pipeline status, and next action",
    inputSchema: {
      type: "object",
      properties: {},
    },
    async handler() {
      return buildHudLines(projectRoot).join("\n")
    },
  })

  ctx.registerCommand({
    name: "hud",
    description: "Show project dashboard",
    async handler(_args, ctx) {
      const lines = buildHudLines(projectRoot)
      ctx.ui.setWidget("jfl-hud", lines, { placement: "aboveEditor" })
      ctx.ui.notify(lines.join("\n"), { level: "info" })
    },
  })
}

export async function updateHudWidget(ctx: PiContext): Promise<void> {
  if (!projectRoot) return
  const lines = buildHudLines(projectRoot)
  ctx.ui.setWidget("jfl-hud", lines, { placement: "aboveEditor" })
}
