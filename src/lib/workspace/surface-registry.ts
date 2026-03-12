/**
 * @purpose Surface registry — all surface types + agent/service discovery from project state
 */

import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { SurfaceType } from "./surface-type.js"
import {
  ClaudeSurface,
  ShellSurface,
  EventStreamSurface,
  EvalSurface,
  FlowSurface,
  AgentSurface,
  ServiceSurface,
  TelemetrySurface,
  PortfolioSurface,
  TopologySurface,
  TrainingSurface,
} from "./surfaces/index.js"

export interface DiscoveredItem {
  name: string
  surfaceType: SurfaceType
  category: "builtin" | "agent" | "service"
  description: string
  inWorkspace: boolean
  agentName?: string
  serviceName?: string
}

export interface ProjectScan {
  agents: string[]
  services: string[]
  hasEvalData: boolean
  hasFlows: boolean
  hasTrainingBuffer: boolean
  suggestions: string[]
}

const BUILTIN_TYPES: SurfaceType[] = [
  new ClaudeSurface(),
  new ShellSurface(),
  new EventStreamSurface(),
  new EvalSurface(),
  new FlowSurface(),
  new AgentSurface(),
  new ServiceSurface(),
  new TelemetrySurface(),
  new PortfolioSurface(),
  new TopologySurface(),
  new TrainingSurface(),
]

export function getSurfaceType(type: string): SurfaceType | null {
  return BUILTIN_TYPES.find((t) => t.type === type) || null
}

export function getAllSurfaceTypes(): SurfaceType[] {
  return [...BUILTIN_TYPES]
}

export function listAgentNames(root: string): string[] {
  const agentsDir = join(root, ".jfl", "agents")
  if (!existsSync(agentsDir)) return []
  try {
    return readdirSync(agentsDir)
      .filter((f) => f.endsWith(".toml"))
      .map((f) => f.replace(".toml", ""))
  } catch {
    return []
  }
}

export function getRegisteredServices(root: string): string[] {
  const configPath = join(root, ".jfl", "config.json")
  if (!existsSync(configPath)) return []
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    return (config.registered_services || []).map((s: { name: string }) => s.name)
  } catch {
    return []
  }
}

export function scanProject(root: string): ProjectScan {
  const agents = listAgentNames(root)
  const services = getRegisteredServices(root)
  const hasEvalData = existsSync(join(root, ".jfl", "eval", "eval.jsonl"))
  const hasTrainingBuffer = existsSync(join(root, ".jfl", "replay"))

  let hasFlows = false
  try {
    const flowsDir = join(root, ".jfl", "flows")
    if (existsSync(flowsDir)) {
      const files = readdirSync(flowsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      hasFlows = files.length > 0
    }
  } catch {}

  const suggestions: string[] = []

  for (const agent of agents) {
    suggestions.push(`${agent} agent → jfl ide add ${agent}`)
  }

  if (services.length > 0) {
    suggestions.push(`${services.length} service(s) → jfl ide add events`)
  }

  if (hasEvalData) {
    suggestions.push("eval data found → jfl ide add eval")
  }

  if (hasFlows) {
    suggestions.push("flows configured → jfl ide add flows")
  }

  return { agents, services, hasEvalData, hasFlows, hasTrainingBuffer, suggestions }
}

export function getAvailableItems(root: string, activeSurfaces: string[]): DiscoveredItem[] {
  const items: DiscoveredItem[] = []
  const isActive = (name: string) => activeSurfaces.includes(name)

  for (const st of BUILTIN_TYPES) {
    if (st.type === "agent" || st.type === "service") continue
    items.push({
      name: st.type,
      surfaceType: st,
      category: "builtin",
      description: st.description,
      inWorkspace: isActive(st.type),
    })
  }

  for (const agent of listAgentNames(root)) {
    items.push({
      name: agent,
      surfaceType: new AgentSurface(),
      category: "agent",
      description: `Agent: ${agent}`,
      inWorkspace: isActive(agent),
      agentName: agent,
    })
  }

  for (const service of getRegisteredServices(root)) {
    items.push({
      name: service,
      surfaceType: new ServiceSurface(),
      category: "service",
      description: `Service: ${service}`,
      inWorkspace: isActive(service),
      serviceName: service,
    })
  }

  return items
}
