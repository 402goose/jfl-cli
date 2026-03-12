/**
 * Agent Display Name Resolver
 *
 * Converts raw agent identifiers (file paths, kebab-case names, frontmatter names)
 * into clean, human-readable display names for the TUI.
 *
 * @purpose Resolve ugly agent IDs to pretty display names across all TUI surfaces
 */

import { existsSync, readFileSync, readdirSync } from "fs"
import { join, basename } from "path"

export interface AgentInfo {
  id: string
  displayName: string
  type: "service" | "peer" | "skill" | "custom"
  color?: string
  description?: string
  serviceName?: string
}

const displayNameCache = new Map<string, AgentInfo>()
let projectRoot = ""

export function initAgentNames(root: string): void {
  projectRoot = root
  displayNameCache.clear()
  scanAgentFiles(root)
}

function scanAgentFiles(root: string): void {
  const agentsDir = join(root, ".claude", "agents")
  if (!existsSync(agentsDir)) return

  for (const file of readdirSync(agentsDir)) {
    if (!file.endsWith(".md") || file.startsWith("_") || file === "README.md") continue

    const filePath = join(agentsDir, file)
    try {
      const content = readFileSync(filePath, "utf-8")
      const info = parseAgentFile(file, content)
      if (info) displayNameCache.set(info.id, info)
    } catch {}
  }
}

function parseAgentFile(filename: string, content: string): AgentInfo | null {
  const id = filename.replace(/\.md$/, "")

  const frontmatter = parseFrontmatter(content)
  const fmName = frontmatter.name ?? id
  const color = frontmatter.color
  const description = frontmatter.description

  const type = detectAgentType(id, frontmatter)
  const serviceName = extractServiceName(id)
  const displayName = frontmatter.label
    ?? frontmatter.display_name
    ?? buildDisplayName(id, type)

  return { id, displayName, type, color, description, serviceName }
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}

  const result: Record<string, string> = {}
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w[\w_-]*)\s*:\s*(.+)/)
    if (kv) result[kv[1]] = kv[2].trim()
  }
  return result
}

function detectAgentType(id: string, fm: Record<string, string>): AgentInfo["type"] {
  if (fm.type === "peer-service" || id.startsWith("peer-service-") || id.startsWith("peer-")) return "peer"
  if (id.startsWith("service-") || fm.type === "service") return "service"
  const skillNames = ["web-architect", "content-creator", "brand-architect"]
  if (skillNames.includes(id)) return "skill"
  return "custom"
}

function extractServiceName(id: string): string {
  return id
    .replace(/^service-/, "")
    .replace(/^peer-service-/, "")
    .replace(/^peer-/, "")
}

function buildDisplayName(id: string, type: AgentInfo["type"]): string {
  const clean = extractServiceName(id)
  const titled = kebabToTitle(clean)
  if (type === "peer") return titled
  return titled
}

function kebabToTitle(str: string): string {
  return str
    .split("-")
    .map(word => {
      if (word.length <= 3 && word === word.toUpperCase()) return word
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(" ")
}

/**
 * Resolve any raw agent identifier to a clean display name.
 *
 * Handles:
 *   .claude/agents/service-stratus-api.md  → Stratus API
 *   service-stratus-api                     → Stratus API
 *   peer-service-context-hub               → Context Hub
 *   stratus-api.md                         → Stratus API
 *   web-architect                          → Web Architect
 */
export function resolveDisplayName(raw: string): string {
  const id = raw
    .replace(/^@/, "")
    .replace(/^\.?claude\/agents\//, "")
    .replace(/\.md$/, "")
    .replace(/^.*\//, "")

  const cached = displayNameCache.get(id)
  if (cached) return cached.displayName

  const type = detectAgentType(id, {})
  return buildDisplayName(id, type)
}

/**
 * Resolve to full agent info (name, type, color, description).
 */
export function resolveAgentInfo(raw: string): AgentInfo {
  const id = raw
    .replace(/^@/, "")
    .replace(/^\.?claude\/agents\//, "")
    .replace(/\.md$/, "")
    .replace(/^.*\//, "")

  const cached = displayNameCache.get(id)
  if (cached) return cached

  const type = detectAgentType(id, {})
  return {
    id,
    displayName: buildDisplayName(id, type),
    type,
    serviceName: extractServiceName(id),
  }
}

/**
 * Get all known agents with display info.
 */
export function listAgents(): AgentInfo[] {
  if (displayNameCache.size === 0 && projectRoot) scanAgentFiles(projectRoot)
  return Array.from(displayNameCache.values())
}

/**
 * Format an agent name for TUI display with optional type badge.
 */
export function formatAgentLabel(raw: string, opts?: { badge?: boolean }): string {
  const info = resolveAgentInfo(raw)

  if (!opts?.badge) return info.displayName

  const badges: Record<AgentInfo["type"], string> = {
    service: "svc",
    peer: "peer",
    skill: "skill",
    custom: "",
  }

  const badge = badges[info.type]
  return badge ? `${info.displayName} [${badge}]` : info.displayName
}
