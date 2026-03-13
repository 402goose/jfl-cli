/**
 * @purpose Surface registry — all surface types + agent/service discovery + config-aware recommendations
 */

import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { SurfaceType } from "./surface-type.js"
import type { ProjectConfigSnapshot } from "./surface-type.js"
import {
  ClaudeSurface,
  ShellSurface,
  EventStreamSurface,
  EvalSurface,
  FlowSurface,
  AgentSurface,
  AgentOverviewSurface,
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
  configType: "gtm" | "service" | "portfolio"
  projectName: string
  portfolioParent?: string
  gtmParent?: string
}

const BUILTIN_TYPES: SurfaceType[] = [
  new ClaudeSurface(),
  new ShellSurface(),
  new EventStreamSurface(),
  new EvalSurface(),
  new FlowSurface(),
  new AgentSurface(),
  new AgentOverviewSurface(),
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

export function getRegisteredServices(root: string): Array<{ name: string; path: string; type: string; status: string }> {
  const configPath = join(root, ".jfl", "config.json")
  if (!existsSync(configPath)) return []
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    return (config.registered_services || []).map((s: { name: string; path?: string; type?: string; status?: string }) => ({
      name: s.name,
      path: s.path || "",
      type: s.type || "unknown",
      status: s.status || "unknown",
    }))
  } catch {
    return []
  }
}

export function getRegisteredServiceNames(root: string): string[] {
  return getRegisteredServices(root).map((s) => s.name)
}

export function readProjectConfig(root: string): ProjectConfigSnapshot {
  const configPath = join(root, ".jfl", "config.json")
  const defaults: ProjectConfigSnapshot = {
    name: root.split("/").pop() || "workspace",
    type: "gtm",
    registeredServices: [],
    agents: [],
  }

  if (!existsSync(configPath)) return defaults

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"))
    return {
      name: raw.name || defaults.name,
      type: raw.type || "gtm",
      registeredServices: (raw.registered_services || []).map((s: Record<string, string>) => ({
        name: s.name,
        path: s.path || "",
        type: s.type || "unknown",
        status: s.status || "unknown",
      })),
      agents: listAgentNames(root),
      portfolioParent: raw.portfolio_parent,
      gtmParent: raw.gtm_parent,
      contextScope: raw.context_scope,
    }
  } catch {
    return defaults
  }
}

export function scanProject(root: string): ProjectScan {
  const config = readProjectConfig(root)
  const agents = config.agents
  const services = config.registeredServices.map((s) => s.name)
  const hasEvalData = existsSync(join(root, ".jfl", "eval", "eval.jsonl"))
  const hasTrainingBuffer = existsSync(join(root, ".jfl", "training-buffer.jsonl"))

  let hasFlows = false
  try {
    const flowsDir = join(root, ".jfl", "flows")
    if (existsSync(flowsDir)) {
      const files = readdirSync(flowsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      hasFlows = files.length > 0
    }
  } catch {}

  const suggestions: string[] = []

  if (agents.length > 0) {
    if (agents.length <= 3) {
      for (const agent of agents) {
        suggestions.push(`${agent} agent -> jfl ide add ${agent}`)
      }
    } else {
      suggestions.push(`${agents.length} agents -> jfl ide add agents (overview)`)
    }
  }

  if (services.length > 0) {
    suggestions.push(`${services.length} service(s) -> jfl ide add events`)
  }

  if (hasEvalData) {
    suggestions.push("eval data found -> jfl ide add eval")
  }

  if (hasFlows) {
    suggestions.push("flows configured -> jfl ide add flows")
  }

  if (hasTrainingBuffer) {
    suggestions.push("training buffer -> jfl ide add training")
  }

  if (config.type === "portfolio") {
    suggestions.push("portfolio mode -> jfl ide add portfolio")
  }

  return {
    agents,
    services,
    hasEvalData,
    hasFlows,
    hasTrainingBuffer,
    suggestions,
    configType: config.type,
    projectName: config.name,
    portfolioParent: config.portfolioParent,
    gtmParent: config.gtmParent,
  }
}

export function getDefaultLayout(root: string): Array<{ name: string; type: string; agentName?: string; serviceName?: string; size?: string; focus?: boolean; row?: number }> {
  const scan = scanProject(root)
  const layout: Array<{ name: string; type: string; agentName?: string; serviceName?: string; size?: string; focus?: boolean; row?: number }> = []

  layout.push({ name: "claude", type: "claude", size: "50%", focus: true, row: 0 })
  layout.push({ name: "shell", type: "shell", size: "50%", row: 0 })

  switch (scan.configType) {
    case "service":
      if (scan.hasEvalData) {
        layout.push({ name: "eval", type: "eval", row: 1 })
      }
      if (scan.agents.length > 0 && scan.agents.length <= 2) {
        for (const agent of scan.agents) {
          layout.push({ name: agent, type: "agent", agentName: agent, row: 1 })
        }
      } else if (scan.agents.length > 2) {
        layout.push({ name: "agents", type: "agents", row: 1 })
      }
      break

    case "gtm":
      if (scan.agents.length > 0) {
        layout.push({ name: "agents", type: "agents", row: 1 })
      }
      if (scan.hasEvalData) {
        layout.push({ name: "eval", type: "eval", row: 1 })
      }
      if (scan.hasFlows) {
        layout.push({ name: "flows", type: "flows", row: 1 })
      }
      break

    case "portfolio":
      layout.push({ name: "portfolio", type: "portfolio", row: 1 })
      break
  }

  return layout
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
      name: service.name,
      surfaceType: new ServiceSurface(),
      category: "service",
      description: `Service: ${service.name} (${service.type})`,
      inWorkspace: isActive(service.name),
      serviceName: service.name,
    })
  }

  return items
}
