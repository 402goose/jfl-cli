/**
 * Peer Agent Generator
 *
 * Generates peer service agent references in service .claude/agents/ directory.
 * Enables service-to-service @-mentions while maintaining security boundaries.
 *
 * @purpose Generate peer service agent references for cross-service collaboration
 */

import { writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "fs"
import { join } from "path"
import { readFileSync } from "fs"

export interface PeerAgentDefinition {
  name: string // peer-service-{name}
  serviceName: string // Actual service name
  serviceType: string // api, web, worker, etc.
  servicePath: string // Absolute path
  capabilities: string[]
  description: string
}

export interface ServiceRegistration {
  name: string
  path: string
  type: string
  registered_at: string
  status: string
}

/**
 * Get registered services from GTM config
 */
export function getRegisteredServices(gtmPath: string): ServiceRegistration[] {
  const configPath = join(gtmPath, ".jfl/config.json")

  if (!existsSync(configPath)) {
    return []
  }

  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    return config.registered_services || []
  } catch {
    return []
  }
}

/**
 * Generate peer agent definition from service metadata
 */
export function generatePeerAgentDefinition(
  peerService: ServiceRegistration,
  currentServicePath: string,
  gtmPath: string
): PeerAgentDefinition {
  const name = `peer-service-${peerService.name}`

  // Generate capability-based triggers
  const capabilities = generatePeerCapabilities(peerService.type)

  return {
    name,
    serviceName: peerService.name,
    serviceType: peerService.type,
    servicePath: peerService.path,
    capabilities,
    description: `Peer service for ${peerService.name} (${peerService.type})`,
  }
}

/**
 * Generate capabilities based on service type
 */
function generatePeerCapabilities(serviceType: string): string[] {
  const caps: string[] = []

  switch (serviceType) {
    case "web":
    case "api":
      caps.push("Handle API requests and serve data")
      caps.push("Manage database operations")
      caps.push("Process user input and validation")
      break

    case "worker":
      caps.push("Process background jobs and queues")
      caps.push("Handle scheduled tasks")
      caps.push("Perform async operations")
      break

    case "cli":
      caps.push("Execute command-line operations")
      caps.push("Automate workflows")
      caps.push("Provide interactive tools")
      break

    case "library":
      caps.push("Provide reusable functionality")
      caps.push("Support code development and testing")
      caps.push("Maintain documentation and examples")
      caps.push("Build and publish artifacts")
      break

    case "infrastructure":
      caps.push("Monitor system health")
      caps.push("Aggregate metrics and logs")
      caps.push("Coordinate service operations")
      break

    case "container":
      caps.push("Manage containerized services")
      caps.push("Handle Docker operations")
      caps.push("Control service lifecycle")
      break

    default:
      caps.push("Provide service-specific functionality")
  }

  return caps
}

/**
 * Write peer agent definition to service's .claude/agents/ directory
 */
export function writePeerAgentDefinition(
  agentDef: PeerAgentDefinition,
  servicePath: string
): string {
  const agentsDir = join(servicePath, ".claude/agents")

  // Ensure directory exists
  if (!existsSync(agentsDir)) {
    mkdirSync(agentsDir, { recursive: true })
  }

  const agentFile = join(agentsDir, `${agentDef.name}.md`)

  const whenToUse = generateWhenToUse(agentDef.serviceType, agentDef.serviceName)

  const content = `---
name: ${agentDef.name}
version: 1.0.0
color: blue
description: ${agentDef.description}
type: peer-service
---

# Peer Service: ${agentDef.serviceName}

**Service Type:** ${agentDef.serviceType}
**Service Path:** \`${agentDef.servicePath}\`

## When to Collaborate

${whenToUse}

## Capabilities

${agentDef.capabilities.map((cap) => `- ${cap}`).join("\n")}

## How to Invoke

Use @-mention to collaborate with this peer service:

\`\`\`
@${agentDef.name} what's your current status?
@${agentDef.name} can you help with [specific task]?
@${agentDef.name} what changed recently?
\`\`\`

## Security

- This is a **peer service** - you can see its status but cannot modify its files
- All operations route through Service Manager with security checks
- You cannot call yourself as a peer (self-calls are blocked)
- Destructive operations require explicit approval

## Communication Pattern

When you @-mention this peer:
1. Service Manager validates the request
2. Peer agent spawns in its own working directory
3. Peer agent processes the request with its own context
4. Result returns to you
5. You can continue collaborating or work independently

## Examples

**Status check:**
\`\`\`
@${agentDef.name} what's your current status?
\`\`\`

**Request collaboration:**
\`\`\`
@${agentDef.name} I need help with [specific task]. Can you handle [specific part]?
\`\`\`

**Context sharing:**
\`\`\`
@${agentDef.name} what changed in your service in the last 24 hours?
\`\`\`

## Remember

- **Collaborate when:** Task outside your service's core responsibility, need data from another service, coordinating multi-service operation
- **Handle alone when:** Task within your service's domain, operation is service-local
- **Always provide context:** When asking for help, explain what you need and why
`

  writeFileSync(agentFile, content)

  return agentFile
}

/**
 * Generate "When to Use" guidance based on service type
 */
function generateWhenToUse(serviceType: string, serviceName: string): string {
  switch (serviceType) {
    case "api":
      return `Use \`@peer-service-${serviceName}\` when you need to:
- Check API endpoint status or health
- Understand API routes and handlers
- Coordinate API changes that affect your service
- Get data from API endpoints
- Verify API schema or contracts`

    case "web":
      return `Use \`@peer-service-${serviceName}\` when you need to:
- Check frontend deployment status
- Understand UI components or flows
- Coordinate UI changes with backend
- Get user-facing content or copy
- Verify frontend build status`

    case "worker":
      return `Use \`@peer-service-${serviceName}\` when you need to:
- Check background job status
- Understand job queue state
- Coordinate async operations
- Trigger or schedule jobs
- Verify job processing results`

    case "library":
      return `Use \`@peer-service-${serviceName}\` when you need to:
- Understand library APIs and interfaces
- Work on plugin or package features
- Run library tests and builds
- Update documentation
- Debug integration issues`

    case "infrastructure":
      return `Use \`@peer-service-${serviceName}\` when you need to:
- Check system health across services
- Get aggregated metrics or logs
- Coordinate service deployments
- Understand infrastructure state
- Verify connectivity or resources`

    case "container":
      return `Use \`@peer-service-${serviceName}\` when you need to:
- Check container status
- Understand Docker configuration
- Coordinate container operations
- Verify container health
- Get container logs or metrics`

    case "cli":
      return `Use \`@peer-service-${serviceName}\` when you need to:
- Execute CLI commands
- Automate workflows
- Run scripts or tools
- Get CLI output or results
- Verify CLI functionality`

    default:
      return `Use \`@peer-service-${serviceName}\` when you need to:
- Check service status
- Understand service capabilities
- Coordinate with this service
- Get service-specific data
- Verify service operations`
  }
}

/**
 * Sync peer agents for a service - add/update/remove peer agent files
 */
export function syncPeerAgents(
  servicePath: string,
  gtmPath: string
): { added: number; updated: number; removed: number } {
  const stats = { added: 0, updated: 0, removed: 0 }

  // Get service name from its config
  const serviceConfigPath = join(servicePath, ".jfl/config.json")
  if (!existsSync(serviceConfigPath)) {
    throw new Error(`Service config not found: ${serviceConfigPath}`)
  }

  const serviceConfig = JSON.parse(readFileSync(serviceConfigPath, "utf-8"))
  const currentServiceName = serviceConfig.name

  // Get registered services from GTM
  const registeredServices = getRegisteredServices(gtmPath)

  // Filter out current service (can't be peer with self)
  const peerServices = registeredServices.filter((s) => s.name !== currentServiceName)

  // Ensure .claude/agents directory exists
  const agentsDir = join(servicePath, ".claude/agents")
  if (!existsSync(agentsDir)) {
    mkdirSync(agentsDir, { recursive: true })
  }

  // Get existing peer agent files
  const existingPeerFiles = existsSync(agentsDir)
    ? readdirSync(agentsDir).filter((f) => f.startsWith("peer-service-") && f.endsWith(".md"))
    : []

  // Generate/update peer agent files for all registered services
  const currentPeerFiles = new Set<string>()

  for (const peerService of peerServices) {
    const agentDef = generatePeerAgentDefinition(peerService, servicePath, gtmPath)
    const fileName = `${agentDef.name}.md`
    currentPeerFiles.add(fileName)

    const filePath = join(agentsDir, fileName)

    if (existsSync(filePath)) {
      // Update existing
      writePeerAgentDefinition(agentDef, servicePath)
      stats.updated++
    } else {
      // Add new
      writePeerAgentDefinition(agentDef, servicePath)
      stats.added++
    }
  }

  // Remove stale peer agent files (services that were unregistered)
  for (const existingFile of existingPeerFiles) {
    if (!currentPeerFiles.has(existingFile)) {
      unlinkSync(join(agentsDir, existingFile))
      stats.removed++
    }
  }

  return stats
}
