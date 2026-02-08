/**
 * Service Dependency Management
 *
 * Handles service dependencies - ensures services start in correct order,
 * auto-starts required dependencies, prevents stopping services with dependents.
 *
 * @purpose Dependency resolution and validation for service mesh
 */

import chalk from "chalk"
import * as fs from "fs"
import * as path from "path"
import { homedir } from "os"

const GLOBAL_SERVICES_FILE = path.join(homedir(), ".jfl", "services.json")
const SERVICE_MANAGER_URL = "http://localhost:3402"

// ============================================================================
// Types
// ============================================================================

interface Service {
  name: string
  type: string
  description: string
  depends_on?: string[]
  [key: string]: any
}

interface ServicesConfig {
  version: string
  services: Record<string, Service>
}

interface DependencyGraph {
  nodes: string[]
  edges: Map<string, string[]> // service -> dependencies
  dependents: Map<string, string[]> // service -> who depends on it
}

// ============================================================================
// Config Loading
// ============================================================================

function loadServicesConfig(): ServicesConfig {
  if (!fs.existsSync(GLOBAL_SERVICES_FILE)) {
    throw new Error(`Services file not found: ${GLOBAL_SERVICES_FILE}`)
  }

  const content = fs.readFileSync(GLOBAL_SERVICES_FILE, "utf-8")
  return JSON.parse(content)
}

// ============================================================================
// Dependency Graph Building
// ============================================================================

export function buildDependencyGraph(services: Record<string, Service>): DependencyGraph {
  const graph: DependencyGraph = {
    nodes: Object.keys(services),
    edges: new Map(),
    dependents: new Map(),
  }

  // Build edges (service -> dependencies)
  for (const [name, service] of Object.entries(services)) {
    const deps = service.depends_on || []
    graph.edges.set(name, deps)

    // Build reverse edges (service -> dependents)
    for (const dep of deps) {
      if (!graph.dependents.has(dep)) {
        graph.dependents.set(dep, [])
      }
      graph.dependents.get(dep)!.push(name)
    }
  }

  return graph
}

// ============================================================================
// Dependency Resolution
// ============================================================================

export function getStartOrder(serviceName: string, services: Record<string, Service>): string[] {
  const graph = buildDependencyGraph(services)
  const visited = new Set<string>()
  const order: string[] = []

  function visit(name: string) {
    if (visited.has(name)) return

    visited.add(name)

    // Visit dependencies first
    const deps = graph.edges.get(name) || []
    for (const dep of deps) {
      if (!services[dep]) {
        throw new Error(`Service "${name}" depends on unknown service "${dep}"`)
      }
      visit(dep)
    }

    order.push(name)
  }

  visit(serviceName)
  return order
}

export function getStopOrder(serviceName: string, services: Record<string, Service>): string[] {
  const graph = buildDependencyGraph(services)
  const visited = new Set<string>()
  const order: string[] = []

  function visit(name: string) {
    if (visited.has(name)) return

    visited.add(name)

    // Visit dependents first (reverse order for stop)
    const dependents = graph.dependents.get(name) || []
    for (const dependent of dependents) {
      visit(dependent)
    }

    order.push(name)
  }

  visit(serviceName)
  return order
}

export function detectCycles(services: Record<string, Service>): string[] | null {
  const graph = buildDependencyGraph(services)
  const visited = new Set<string>()
  const recursionStack = new Set<string>()
  const cycle: string[] = []

  function visit(name: string, path: string[]): boolean {
    if (recursionStack.has(name)) {
      // Found cycle
      const cycleStart = path.indexOf(name)
      cycle.push(...path.slice(cycleStart), name)
      return true
    }

    if (visited.has(name)) return false

    visited.add(name)
    recursionStack.add(name)

    const deps = graph.edges.get(name) || []
    for (const dep of deps) {
      if (visit(dep, [...path, name])) {
        return true
      }
    }

    recursionStack.delete(name)
    return false
  }

  for (const node of graph.nodes) {
    if (visit(node, [])) {
      return cycle
    }
  }

  return null
}

// ============================================================================
// Dependency Validation
// ============================================================================

export function validateDependencies(services: Record<string, Service>): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  // Check for unknown dependencies
  for (const [name, service] of Object.entries(services)) {
    const deps = service.depends_on || []
    for (const dep of deps) {
      if (!services[dep]) {
        errors.push(`Service "${name}" depends on unknown service "${dep}"`)
      }
    }
  }

  // Check for cycles
  const cycle = detectCycles(services)
  if (cycle) {
    errors.push(`Dependency cycle detected: ${cycle.join(" -> ")}`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// ============================================================================
// Service Status
// ============================================================================

export async function getServiceStatus(serviceName: string): Promise<any> {
  try {
    const response = await fetch(`${SERVICE_MANAGER_URL}/registry/${serviceName}`)
    if (!response.ok) return null

    const result = await response.json()
    return result.service
  } catch {
    return null
  }
}

export async function isServiceRunning(serviceName: string): Promise<boolean> {
  const status = await getServiceStatus(serviceName)
  return status?.status === "running"
}

// ============================================================================
// Dependency-Aware Start/Stop
// ============================================================================

export async function startWithDependencies(
  serviceName: string,
  options: {
    dryRun?: boolean
    verbose?: boolean
    onProgress?: (service: string, action: string) => void
  } = {}
): Promise<string[]> {
  const config = loadServicesConfig()
  const services = config.services

  if (!services[serviceName]) {
    throw new Error(`Service not found: ${serviceName}`)
  }

  // Validate dependencies
  const validation = validateDependencies(services)
  if (!validation.valid) {
    throw new Error(`Dependency validation failed:\n${validation.errors.join("\n")}`)
  }

  // Get start order
  const order = getStartOrder(serviceName, services)

  if (options.dryRun) {
    return order
  }

  // Start services in order
  const started: string[] = []

  for (const name of order) {
    if (options.onProgress) {
      options.onProgress(name, "checking")
    }

    const running = await isServiceRunning(name)

    if (running) {
      if (options.verbose) {
        console.log(chalk.dim(`  ${name} already running`))
      }
      continue
    }

    if (options.onProgress) {
      options.onProgress(name, "starting")
    }

    // Start service via Service Manager
    try {
      const response = await fetch(`${SERVICE_MANAGER_URL}/registry/${name}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "start", args: {} }),
      })

      if (response.ok) {
        started.push(name)
        if (options.verbose) {
          console.log(chalk.green(`  ✓ Started ${name}`))
        }
      } else {
        throw new Error(`Failed to start ${name}`)
      }
    } catch (error) {
      throw new Error(`Failed to start ${name}: ${error}`)
    }
  }

  return started
}

export async function stopWithDependents(
  serviceName: string,
  options: {
    dryRun?: boolean
    verbose?: boolean
    force?: boolean
    onProgress?: (service: string, action: string) => void
  } = {}
): Promise<string[]> {
  const config = loadServicesConfig()
  const services = config.services

  if (!services[serviceName]) {
    throw new Error(`Service not found: ${serviceName}`)
  }

  // Get stop order
  const order = getStopOrder(serviceName, services)

  // Check if any dependents are running (unless force)
  if (!options.force && order.length > 1) {
    const dependents = order.slice(0, -1) // All except the service itself
    const runningDependents: string[] = []

    for (const dep of dependents) {
      if (await isServiceRunning(dep)) {
        runningDependents.push(dep)
      }
    }

    if (runningDependents.length > 0) {
      throw new Error(
        `Cannot stop ${serviceName} - the following services depend on it and are running:\n` +
          runningDependents.map((d) => `  - ${d}`).join("\n") +
          `\n\nUse --force to stop all dependents`
      )
    }
  }

  if (options.dryRun) {
    return order
  }

  // Stop services in order
  const stopped: string[] = []

  for (const name of order) {
    if (options.onProgress) {
      options.onProgress(name, "checking")
    }

    const running = await isServiceRunning(name)

    if (!running) {
      if (options.verbose) {
        console.log(chalk.dim(`  ${name} already stopped`))
      }
      continue
    }

    if (options.onProgress) {
      options.onProgress(name, "stopping")
    }

    // Stop service via Service Manager
    try {
      const response = await fetch(`${SERVICE_MANAGER_URL}/registry/${name}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "stop", args: {} }),
      })

      if (response.ok) {
        stopped.push(name)
        if (options.verbose) {
          console.log(chalk.green(`  ✓ Stopped ${name}`))
        }
      } else {
        throw new Error(`Failed to stop ${name}`)
      }
    } catch (error) {
      throw new Error(`Failed to stop ${name}: ${error}`)
    }
  }

  return stopped
}

// ============================================================================
// Visualization
// ============================================================================

export function visualizeDependencies(services: Record<string, Service>): string {
  const graph = buildDependencyGraph(services)
  const lines: string[] = []

  lines.push(chalk.bold("\nService Dependencies:\n"))

  for (const [name, deps] of graph.edges.entries()) {
    if (deps.length === 0) continue

    lines.push(chalk.cyan(`${name}`))
    for (const dep of deps) {
      lines.push(chalk.dim(`  └─ depends on → ${dep}`))
    }
  }

  lines.push(chalk.bold("\nService Dependents:\n"))

  for (const [name, dependents] of graph.dependents.entries()) {
    if (dependents.length === 0) continue

    lines.push(chalk.cyan(`${name}`))
    for (const dependent of dependents) {
      lines.push(chalk.dim(`  └─ required by → ${dependent}`))
    }
  }

  return lines.join("\n")
}
