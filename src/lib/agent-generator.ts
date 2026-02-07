/**
 * Agent Generator
 *
 * Generates service agent definitions in GTM .claude/agents/ directory
 *
 * @purpose Generate service agent definitions for GTM integration
 */

import { writeFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import type { ServiceMetadata } from "./service-detector.js"

export interface AgentDefinition {
  name: string
  color: "green" | "purple" | "blue" | "red"
  description: string
  capabilities: string[]
  safetyGates: string[]
  workingDirectory: string
  knowledgeDocs: string[]
}

/**
 * Map service type to agent color
 */
function getAgentColor(type: ServiceMetadata["type"]): AgentDefinition["color"] {
  switch (type) {
    case "web":
    case "api":
    case "worker":
      return "green" // Implementation agents
    case "infrastructure":
      return "purple" // Coordination agents
    case "container":
      return "blue" // Strategic/data agents
    case "cli":
      return "green" // Implementation
    default:
      return "green"
  }
}

/**
 * Generate capabilities based on service type
 */
function generateCapabilities(
  metadata: ServiceMetadata,
  servicePath: string
): string[] {
  const caps: string[] = []

  // Common capabilities
  caps.push("Read and understand service architecture from knowledge/ docs")
  caps.push("Update service status in .jfl/status.json")
  caps.push("Emit events to GTM event bus")
  caps.push("Write journal entries for significant operations")

  // Type-specific capabilities
  if (metadata.type === "web" || metadata.type === "api") {
    caps.push("Start, stop, restart the service")
    caps.push("Check service health and logs")
    caps.push("Deploy updates to production")
    caps.push("Run tests and validate changes")
  }

  if (metadata.type === "container") {
    caps.push("Manage Docker containers (start, stop, logs, exec)")
    caps.push("Inspect container health and resource usage")
    caps.push("Update container configuration")
  }

  if (metadata.type === "infrastructure") {
    caps.push("Monitor service status across GTM")
    caps.push("Perform health checks and diagnostics")
    caps.push("Execute cleanup and maintenance operations")
  }

  return caps
}

/**
 * Generate safety gates for operations that require approval
 */
function generateSafetyGates(metadata: ServiceMetadata): string[] {
  const gates: string[] = []

  // Destructive operations always require approval
  gates.push("Deploy to production - requires user approval")
  gates.push("Destructive operations (force push, delete data, etc.) - requires explicit confirmation")

  if (metadata.type === "container") {
    gates.push("Container restart - confirm first unless health check failing")
  }

  if (metadata.type === "infrastructure") {
    gates.push("Cleanup operations - verify scope before execution")
  }

  return gates
}

/**
 * Generate agent definition content
 */
export function generateAgentDefinition(
  metadata: ServiceMetadata,
  servicePath: string,
  gtmPath: string
): AgentDefinition {
  const name = `service-${metadata.name}`
  const color = getAgentColor(metadata.type)
  const capabilities = generateCapabilities(metadata, servicePath)
  const safetyGates = generateSafetyGates(metadata)

  const knowledgeDocs = [
    "SERVICE_SPEC.md - What this service does",
    "ARCHITECTURE.md - How it's built",
    "DEPLOYMENT.md - How to deploy/restart",
    "RUNBOOK.md - Common operations",
  ]

  return {
    name,
    color,
    description: metadata.description,
    capabilities,
    safetyGates,
    workingDirectory: servicePath,
    knowledgeDocs,
  }
}

/**
 * Write agent definition to GTM repo
 */
export function writeAgentDefinition(
  agentDef: AgentDefinition,
  gtmPath: string
): string {
  const agentsDir = join(gtmPath, ".claude/agents")

  // Ensure directory exists
  if (!existsSync(agentsDir)) {
    mkdirSync(agentsDir, { recursive: true })
  }

  const agentFile = join(agentsDir, `${agentDef.name}.md`)

  const content = `---
name: ${agentDef.name}
version: 1.0.0
color: ${agentDef.color}
description: ${agentDef.description}
---

# Service Agent: ${agentDef.name}

**Working Directory:** \`${agentDef.workingDirectory}\`

## Your Role

You are the service agent for **${agentDef.name}**. You manage this service's codebase, operations, and integration with the GTM ecosystem.

## Knowledge Base

Before handling requests, read your knowledge docs to understand the service:

${agentDef.knowledgeDocs.map((doc) => `- **${doc}**`).join("\n")}

These are located in: \`${agentDef.workingDirectory}/knowledge/\`

## Capabilities

You can:

${agentDef.capabilities.map((cap) => `- ${cap}`).join("\n")}

## Safety Gates (Require User Approval)

${agentDef.safetyGates.map((gate) => `- ${gate}`).join("\n")}

## Workflow

When you receive a request:

1. **Read knowledge docs** to understand context
2. **Check current status** (\`.jfl/status.json\`)
3. **Perform the operation**
4. **Update status** with changes
5. **Emit event** to GTM event bus
6. **Write journal entry** if significant
7. **Respond** with what you did

## Status Updates

Update \`.jfl/status.json\` after operations:

\`\`\`json
{
  "service": "${agentDef.name}",
  "status": "running|stopped|error",
  "last_updated": "ISO timestamp",
  "recent_changes": ["array", "of", "changes"],
  "health": "healthy|degraded|error"
}
\`\`\`

## Event Emission

Emit events to GTM event bus for coordination:

\`\`\`bash
cat >> ${agentDef.workingDirectory}/.jfl/service-events.jsonl << EOF
{"ts":"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)","service":"${agentDef.name}","type":"update|deploy|restart|error","message":"...", "session":"..."}
EOF
\`\`\`

## Journal Entries

Write journal entries for significant operations:

\`\`\`bash
cat >> ${agentDef.workingDirectory}/.jfl/journal/\${SESSION}.jsonl << EOF
{"v":1,"ts":"...","session":"...","type":"feature|fix|deployment","title":"...","summary":"...","detail":"..."}
EOF
\`\`\`

## Communication with GTM

You can be invoked via:
- **@-mention**: User says \`@${agentDef.name} <request>\` in GTM Claude session
- **/skill**: User runs \`/${agentDef.name} <subcommand>\` skill

When spawned, the GTM agent may provide context from GTM knowledge docs. Use this to align with overall strategy.

## Example Requests

**"What's your current status?"**
\`\`\`bash
cat .jfl/status.json
\`\`\`

**"Show me recent changes"**
\`\`\`bash
git log --oneline -10
cat .jfl/journal/*.jsonl | tail -5
\`\`\`

**"Restart the service"**
1. Check if safe to restart
2. Run stop command
3. Run start command
4. Verify health
5. Update status
6. Emit event
7. Respond with outcome

**"Deploy to production"**
1. Ask user for confirmation (safety gate!)
2. Run tests if available
3. Run deploy command
4. Monitor deployment
5. Update status
6. Emit event
7. Write journal entry
8. Respond with outcome

## Remember

- **Read knowledge docs first** - Don't guess, understand the service
- **Safety gates matter** - Get approval for risky operations
- **Status transparency** - Always update status.json
- **Emit events** - Let GTM know what you're doing
- **Journal significant work** - Help future sessions understand what happened
`

  writeFileSync(agentFile, content)

  return agentFile
}
