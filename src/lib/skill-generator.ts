/**
 * Skill Generator
 *
 * Generates service skill wrappers in GTM .claude/skills/ directory
 *
 * @purpose Generate skill wrappers for service agent invocation
 */

import { writeFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import type { ServiceMetadata } from "./service-detector.js"

/**
 * Generate skill definition (SKILL.md)
 */
export function generateSkillDefinition(
  metadata: ServiceMetadata,
  servicePath: string
): string {
  const skillName = metadata.name

  return `---
name: ${skillName}
version: 1.0.0
type: service
description: ${metadata.description}
service_path: ${servicePath}
---

# ${skillName} - Service Agent Skill

Quick access to **${metadata.name}** service agent.

## Usage

\`\`\`
/${skillName} [command]
\`\`\`

## Commands

| Command | Description |
|---------|-------------|
| \`status\` | Show service status |
| \`logs\` | Show service logs |
| \`start\` | Start the service |
| \`stop\` | Stop the service |
| \`restart\` | Restart the service |
| \`health\` | Check service health |
| \`recent\` | Show recent changes |
| \`deploy\` | Deploy to production (requires approval) |

## Examples

\`\`\`
/${skillName} status
/${skillName} logs
/${skillName} restart
/${skillName} deploy
\`\`\`

## How It Works

This skill spawns the **service-${skillName}** agent with your request. The agent:

1. Reads service knowledge docs (SERVICE_SPEC, ARCHITECTURE, DEPLOYMENT, RUNBOOK)
2. Performs the requested operation
3. Updates service status
4. Emits event to GTM
5. Writes journal entry if significant
6. Returns the result

## Metadata

- **Type**: ${metadata.type}
- **Port**: ${metadata.port || "N/A"}
- **Version**: ${metadata.version}
- **Dependencies**: ${metadata.dependencies.join(", ") || "None"}
${metadata.healthcheck ? `- **Healthcheck**: \`${metadata.healthcheck}\`` : ""}

## Service Path

\`${servicePath}\`

## Knowledge Docs

- \`${servicePath}/knowledge/SERVICE_SPEC.md\`
- \`${servicePath}/knowledge/ARCHITECTURE.md\`
- \`${servicePath}/knowledge/DEPLOYMENT.md\`
- \`${servicePath}/knowledge/RUNBOOK.md\`

## Direct Invocation

You can also invoke via @-mention in conversation:

\`\`\`
@${skillName} what's your current status?
@${skillName} show me recent changes
@${skillName} deploy latest changes
\`\`\`
`
}

/**
 * Generate skill handler script
 */
export function generateSkillHandler(
  metadata: ServiceMetadata,
  servicePath: string,
  gtmPath: string
): string {
  const skillName = metadata.name

  return `#!/bin/bash
#
# Service Agent Skill Handler: ${skillName}
#
# Routes skill invocations to service agent
#

set -e

COMMAND="\${1:-status}"
GTM_PATH="${gtmPath}"
SERVICE_PATH="${servicePath}"
SERVICE_NAME="${skillName}"

# Validate command
case "$COMMAND" in
    status|logs|start|stop|restart|health|recent|deploy|help)
        # Valid command
        ;;
    *)
        echo "Unknown command: $COMMAND"
        echo ""
        echo "Available commands:"
        echo "  status   - Show service status"
        echo "  logs     - Show service logs"
        echo "  start    - Start the service"
        echo "  stop     - Stop the service"
        echo "  restart  - Restart the service"
        echo "  health   - Check service health"
        echo "  recent   - Show recent changes"
        echo "  deploy   - Deploy to production"
        echo "  help     - Show this help"
        exit 1
        ;;
esac

# For help, show skill documentation
if [[ "$COMMAND" == "help" ]]; then
    cat << EOF
Service Agent Skill: ${skillName}

Commands:
  /${skillName} status   - Show service status
  /${skillName} logs     - Show service logs
  /${skillName} start    - Start the service
  /${skillName} stop     - Stop the service
  /${skillName} restart  - Restart the service
  /${skillName} health   - Check service health
  /${skillName} recent   - Show recent changes
  /${skillName} deploy   - Deploy to production

Metadata:
  Type:    ${metadata.type}
  Port:    ${metadata.port || "N/A"}
  Version: ${metadata.version}
  Path:    ${servicePath}

You can also use @-mentions:
  @${skillName} what's your status?
  @${skillName} show recent changes
  @${skillName} deploy latest version
EOF
    exit 0
fi

# Quick status check (no agent spawn needed)
if [[ "$COMMAND" == "status" ]]; then
    if [[ -f "$SERVICE_PATH/.jfl/status.json" ]]; then
        echo "Service Status: ${skillName}"
        echo ""
        jq '.' "$SERVICE_PATH/.jfl/status.json"
    else
        echo "Status file not found. Service may not be onboarded yet."
        exit 1
    fi
    exit 0
fi

# Quick health check (no agent spawn needed)
if [[ "$COMMAND" == "health" ]]; then
    ${metadata.healthcheck || 'echo "No healthcheck defined"'}
    exit $?
fi

# Quick recent changes (no agent spawn needed)
if [[ "$COMMAND" == "recent" ]]; then
    echo "Recent Changes: ${skillName}"
    echo ""
    if [[ -f "$SERVICE_PATH/.jfl/status.json" ]]; then
        jq -r '.recent_changes[]' "$SERVICE_PATH/.jfl/status.json"
    fi
    echo ""
    echo "Recent Journal Entries:"
    cat "$SERVICE_PATH/.jfl/journal"/*.jsonl 2>/dev/null | tail -5 | jq -r '"\(.ts) - \(.title)"'
    echo ""
    echo "Recent Commits:"
    cd "$SERVICE_PATH" && git log --oneline -5
    exit 0
fi

# For other commands, this should spawn the service agent via Claude Code
# Since we're in a skill handler, we need to return instructions for Claude
cat << EOF
[SPAWN_SERVICE_AGENT]
Service: ${skillName}
Command: $COMMAND
Agent: service-${skillName}
Working Directory: ${servicePath}

Claude should:
1. Spawn Task tool with subagent_type="general-purpose"
2. Set working directory to: ${servicePath}
3. Pass this request to the agent:

   "You are the service agent for ${skillName}.

   Your working directory is: ${servicePath}

   Read your knowledge docs to understand the service:
   - knowledge/SERVICE_SPEC.md
   - knowledge/ARCHITECTURE.md
   - knowledge/DEPLOYMENT.md
   - knowledge/RUNBOOK.md

   User request: $COMMAND the service

   Execute the operation, update status, emit event, write journal, and report outcome."

[/SPAWN_SERVICE_AGENT]
EOF
`
}

/**
 * Write skill files to GTM repo
 */
export function writeSkillFiles(
  metadata: ServiceMetadata,
  servicePath: string,
  gtmPath: string
): string {
  const skillName = metadata.name
  const skillDir = join(gtmPath, ".claude/skills", skillName)

  // Ensure directory exists
  if (!existsSync(skillDir)) {
    mkdirSync(skillDir, { recursive: true })
  }

  // Write SKILL.md
  const skillMd = generateSkillDefinition(metadata, servicePath)
  const skillMdPath = join(skillDir, "SKILL.md")
  writeFileSync(skillMdPath, skillMd)

  // Write handler.sh
  const handler = generateSkillHandler(metadata, servicePath, gtmPath)
  const handlerPath = join(skillDir, "handler.sh")
  writeFileSync(handlerPath, handler, { mode: 0o755 })

  return skillDir
}
