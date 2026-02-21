/**
 * OpenClaw Agent Registry
 *
 * Manages the multi-GTM agent registry at ~/.config/jfl/openclaw-agents.json.
 * Tracks which agents are registered, their GTM workspaces, and active sessions.
 *
 * @purpose Multi-GTM agent registry management for OpenClaw protocol
 * @spec specs/OPENCLAW_SPEC.md#5-multi-gtm-agent-registry
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname, basename } from "path"
import { JFL_PATHS } from "../utils/jfl-paths.js"

const REGISTRY_FILE = join(JFL_PATHS.config, "openclaw-agents.json")

// ============================================================================
// Types
// ============================================================================

export interface GtmRegistration {
  id: string
  name: string
  path: string
  default: boolean
  registered_at: string
}

export interface AgentSession {
  branch: string
  started_at: string
  worktree: string | null
}

export interface AgentEntry {
  id: string
  runtime: string
  manifest_path: string | null
  registered_gtms: GtmRegistration[]
  active_gtm: string | null
  session: AgentSession | null
}

export interface AgentRegistry {
  version: string
  agents: Record<string, AgentEntry>
}

// ============================================================================
// Registry I/O
// ============================================================================

function loadRegistry(): AgentRegistry {
  if (!existsSync(REGISTRY_FILE)) {
    return { version: "1.0", agents: {} }
  }

  try {
    return JSON.parse(readFileSync(REGISTRY_FILE, "utf-8"))
  } catch {
    return { version: "1.0", agents: {} }
  }
}

function saveRegistry(registry: AgentRegistry): void {
  const dir = dirname(REGISTRY_FILE)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2) + "\n")
}

// ============================================================================
// Agent Operations
// ============================================================================

export function getAgent(agentId: string): AgentEntry | null {
  const registry = loadRegistry()
  return registry.agents[agentId] || null
}

export function listAgents(): AgentEntry[] {
  const registry = loadRegistry()
  return Object.values(registry.agents)
}

export function ensureAgent(agentId: string, runtime: string = "custom"): AgentEntry {
  const registry = loadRegistry()

  if (!registry.agents[agentId]) {
    registry.agents[agentId] = {
      id: agentId,
      runtime,
      manifest_path: null,
      registered_gtms: [],
      active_gtm: null,
      session: null,
    }
    saveRegistry(registry)
  }

  return registry.agents[agentId]
}

export function setManifestPath(agentId: string, manifestPath: string): void {
  const registry = loadRegistry()
  if (registry.agents[agentId]) {
    registry.agents[agentId].manifest_path = manifestPath
    saveRegistry(registry)
  }
}

// ============================================================================
// GTM Operations
// ============================================================================

export function registerGtm(
  agentId: string,
  gtmPath: string,
  gtmName: string,
  setDefault: boolean = false
): GtmRegistration {
  const registry = loadRegistry()
  const agent = registry.agents[agentId]
  if (!agent) {
    throw new Error(`Agent "${agentId}" not found in registry. Call ensureAgent() first.`)
  }

  const gtmId = basename(gtmPath).toLowerCase().replace(/[^a-z0-9-]/g, "-")

  // Check if already registered
  const existing = agent.registered_gtms.find((g) => g.path === gtmPath)
  if (existing) {
    if (setDefault) {
      agent.registered_gtms.forEach((g) => (g.default = false))
      existing.default = true
    }
    saveRegistry(registry)
    return existing
  }

  // If first GTM or explicit default, mark as default
  const isDefault = setDefault || agent.registered_gtms.length === 0

  if (isDefault) {
    agent.registered_gtms.forEach((g) => (g.default = false))
  }

  const registration: GtmRegistration = {
    id: gtmId,
    name: gtmName,
    path: gtmPath,
    default: isDefault,
    registered_at: new Date().toISOString(),
  }

  agent.registered_gtms.push(registration)

  if (isDefault) {
    agent.active_gtm = gtmId
  }

  saveRegistry(registry)
  return registration
}

export function getActiveGtm(agentId: string): GtmRegistration | null {
  const agent = getAgent(agentId)
  if (!agent || !agent.active_gtm) return null

  return agent.registered_gtms.find((g) => g.id === agent.active_gtm) || null
}

export function switchGtm(agentId: string, gtmId: string): GtmRegistration {
  const registry = loadRegistry()
  const agent = registry.agents[agentId]
  if (!agent) {
    throw new Error(`Agent "${agentId}" not found in registry`)
  }

  const gtm = agent.registered_gtms.find((g) => g.id === gtmId)
  if (!gtm) {
    throw new Error(`GTM "${gtmId}" not registered for agent "${agentId}"`)
  }

  agent.active_gtm = gtmId
  saveRegistry(registry)
  return gtm
}

export function listGtms(agentId: string): GtmRegistration[] {
  const agent = getAgent(agentId)
  if (!agent) return []
  return agent.registered_gtms
}

export function removeGtm(agentId: string, gtmId: string): boolean {
  const registry = loadRegistry()
  const agent = registry.agents[agentId]
  if (!agent) return false

  const idx = agent.registered_gtms.findIndex((g) => g.id === gtmId)
  if (idx === -1) return false

  agent.registered_gtms.splice(idx, 1)

  if (agent.active_gtm === gtmId) {
    agent.active_gtm = agent.registered_gtms[0]?.id || null
  }

  saveRegistry(registry)
  return true
}

// ============================================================================
// Session Operations
// ============================================================================

export function updateSession(
  agentId: string,
  session: AgentSession | null
): void {
  const registry = loadRegistry()
  const agent = registry.agents[agentId]
  if (!agent) {
    throw new Error(`Agent "${agentId}" not found in registry`)
  }

  agent.session = session
  saveRegistry(registry)
}

export function getActiveSession(agentId: string): AgentSession | null {
  const agent = getAgent(agentId)
  return agent?.session || null
}

export function clearSession(agentId: string): void {
  updateSession(agentId, null)
}

// ============================================================================
// Utility
// ============================================================================

export function removeAgent(agentId: string): boolean {
  const registry = loadRegistry()
  if (!registry.agents[agentId]) return false
  delete registry.agents[agentId]
  saveRegistry(registry)
  return true
}

export function getRegistryPath(): string {
  return REGISTRY_FILE
}
