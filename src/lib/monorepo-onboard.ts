/**
 * Monorepo Onboarding
 *
 * Handles the full onboarding flow for a TS/JS monorepo:
 * 1. Detect monorepo structure
 * 2. Show the user what was found
 * 3. Generate agents for each package (apps + libraries)
 * 4. Generate a coordinator agent for the root
 * 5. Write dependency graph doc
 * 6. Generate a Pi team definition
 * 7. Update GTM config
 *
 * @purpose Monorepo service onboarding — detect, generate agents, write Pi team
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs"
import { join, basename } from "path"
import {
  detectMonorepo,
  generateDependencyGraphDoc,
  generateMonorepoAgentName,
  type MonorepoInfo,
  type MonorepoPackage,
} from "./monorepo-detector.js"
import { type AgentDefinition, writeAgentDefinition } from "./agent-generator.js"
import { writeSkillFiles } from "./skill-generator.js"

export { detectMonorepo } from "./monorepo-detector.js"
export type { MonorepoInfo, MonorepoPackage } from "./monorepo-detector.js"

export interface MonorepoOnboardResult {
  info: MonorepoInfo
  agents: string[]
  coordinatorAgent: string
  teamFile: string | null
  depGraphFile: string
  skipped: string[]
}

function getAgentColor(role: MonorepoPackage["role"]): AgentDefinition["color"] {
  switch (role) {
    case "app": return "green"
    case "package": return "blue"
    case "config": return "purple"
    case "tool": return "red"
  }
}

function generateCoordinatorCapabilities(info: MonorepoInfo): string[] {
  return [
    `Understand the full monorepo structure (${info.packages.length} packages)`,
    `Run monorepo-wide commands: \`${info.commands.buildAll}\`, \`${info.commands.testAll}\``,
    "Coordinate cross-cutting changes across packages",
    "Understand the dependency graph and impact of changes",
    "Route tasks to the correct package agent",
    "Manage workspace-level configuration (root package.json, turbo.json, etc.)",
    "Resolve dependency conflicts between packages",
    "Write journal entries for monorepo-level operations",
  ]
}

function generatePackageCapabilities(pkg: MonorepoPackage, info: MonorepoInfo): string[] {
  const caps: string[] = []

  const filterCmd = info.commands.filterRun(pkg.name, "dev")
  caps.push(`Run package commands: \`${filterCmd}\``)

  if (pkg.role === "app") {
    caps.push("Start, stop, and restart this app")
    if (pkg.metadata.port) caps.push(`Monitor app on port ${pkg.metadata.port}`)
    caps.push("Run tests and validate changes")
    caps.push("Deploy updates")
  }

  if (pkg.role === "package") {
    caps.push("Build and test this library")
    caps.push(`This library is consumed by: ${pkg.consumers.join(", ") || "nothing yet"}`)
    caps.push("Understand the public API surface")
    caps.push("Ensure changes don't break consumers")
  }

  if (pkg.role === "config") {
    caps.push("Manage shared configuration")
    caps.push("Understand which packages use this config")
    caps.push("Validate config changes across the monorepo")
  }

  if (pkg.role === "tool") {
    caps.push("Run and maintain this tool")
    caps.push("Understand tool usage patterns")
  }

  if (pkg.internalDeps.length > 0) {
    caps.push(`Depends on: ${pkg.internalDeps.join(", ")}`)
  }

  caps.push("Read and understand package code")
  caps.push("Write journal entries for significant operations")
  caps.push("Emit events to the MAP event bus")

  return caps
}

function writeCoordinatorAgent(info: MonorepoInfo, gtmPath: string): string {
  const agentName = `${info.rootName}-coordinator`
  const agentsDir = join(gtmPath, ".claude", "agents")
  mkdirSync(agentsDir, { recursive: true })

  const appList = info.apps
    .map(a => `- **@${generateMonorepoAgentName(info.rootName, a.name)}** — ${a.metadata.type} (${a.relativePath})`)
    .join("\n")

  const libList = info.libs
    .map(l => `- **@${generateMonorepoAgentName(info.rootName, l.name)}** — ${l.role} (${l.relativePath})`)
    .join("\n")

  const capabilities = generateCoordinatorCapabilities(info)

  const content = `---
name: ${agentName}
version: 1.0.0
color: purple
description: Coordinator agent for ${info.rootName} monorepo (${info.type} + ${info.manager})
---

# Monorepo Coordinator: ${info.rootName}

**Working Directory:** \`${info.root}\`
**Structure:** ${info.type} + ${info.manager} (${info.packages.length} packages)

## Your Role

You are the **coordinator** for the ${info.rootName} monorepo. You understand the full
dependency graph and can route tasks to the correct package agent, run monorepo-wide
operations, and coordinate cross-cutting changes.

## Package Agents

### Apps
${appList || "No apps detected."}

### Libraries
${libList || "No libraries detected."}

## Capabilities

${capabilities.map(c => `- ${c}`).join("\n")}

## Dependency Graph

Read \`knowledge/DEPENDENCY_GRAPH.md\` for the full dependency map and impact matrix.

**Key rule:** Before changing a library, check who consumes it. Use the impact matrix.

## Commands

| Scope | Command |
|-------|---------|
| Build all | \`${info.commands.buildAll}\` |
| Test all | \`${info.commands.testAll}\` |
${info.apps.map(a => `| ${a.name} only | \`${info.commands.filterRun(a.name, "dev")}\` |`).join("\n")}
${info.commands.affected ? `| Affected by last commit | \`${info.commands.affected}\` |` : ""}

## When to Handle vs Delegate

**Handle yourself (coordinator):**
- Monorepo-wide operations (build all, test all, lint all)
- Root config changes (turbo.json, root package.json, workspace config)
- Dependency version alignment across packages
- Understanding impact of a change across the graph

**Delegate to package agent:**
- Changes scoped to a single package
- App-specific operations (start, deploy, debug)
- Library API changes (the library agent understands its public surface)
- Package-specific tests

## Workflow for Cross-Cutting Changes

1. Identify all affected packages (check DEPENDENCY_GRAPH.md)
2. Start with the leaf dependencies (no consumers)
3. Work up the graph — change deps before consumers
4. Run \`${info.commands.testAll}\` to verify
5. Write journal entry summarizing the cross-cutting change
`

  const agentFile = join(agentsDir, `${agentName}.md`)
  writeFileSync(agentFile, content)
  return agentName
}

function writePackageAgent(
  pkg: MonorepoPackage,
  info: MonorepoInfo,
  gtmPath: string
): string {
  const agentName = generateMonorepoAgentName(info.rootName, pkg.name)
  const agentsDir = join(gtmPath, ".claude", "agents")
  mkdirSync(agentsDir, { recursive: true })

  const capabilities = generatePackageCapabilities(pkg, info)
  const filterDev = info.commands.filterRun(pkg.name, "dev")
  const filterBuild = info.commands.filterRun(pkg.name, "build")
  const filterTest = info.commands.filterRun(pkg.name, "test")

  const depsSection = pkg.internalDeps.length > 0
    ? `\n## Internal Dependencies\n\nThis package depends on:\n${pkg.internalDeps.map(d => `- **${d}** (@${generateMonorepoAgentName(info.rootName, d)})`).join("\n")}\n\nIf you need changes in a dependency, coordinate with its agent or the coordinator.\n`
    : ""

  const consumersSection = pkg.consumers.length > 0
    ? `\n## Consumers\n\nThese packages depend on you:\n${pkg.consumers.map(c => `- **${c}** (@${generateMonorepoAgentName(info.rootName, c)})`).join("\n")}\n\n**Breaking changes require coordinating with consumers.** Check with the coordinator.\n`
    : ""

  const content = `---
name: ${agentName}
version: 1.0.0
color: ${getAgentColor(pkg.role)}
description: ${pkg.metadata.description} (${pkg.role} in ${info.rootName} monorepo)
---

# Package Agent: ${pkg.name}

**Working Directory:** \`${pkg.path}\`
**Role:** ${pkg.role} in ${info.rootName} monorepo
**Path:** \`${pkg.relativePath}\`
${pkg.metadata.port ? `**Port:** ${pkg.metadata.port}` : ""}

## Your Role

You are the agent for **${pkg.name}**, a ${pkg.role} in the ${info.rootName} monorepo.
${pkg.role === "app" ? "You manage this application's code, deployment, and operations." : ""}
${pkg.role === "package" ? "You manage this library's code, public API, and ensure consumers aren't broken." : ""}
${pkg.role === "config" ? "You manage shared configuration used across the monorepo." : ""}
${pkg.role === "tool" ? "You manage this development tool." : ""}

## Capabilities

${capabilities.map(c => `- ${c}`).join("\n")}

## Commands

| Action | Command |
|--------|---------|
| Dev | \`${filterDev}\` |
| Build | \`${filterBuild}\` |
| Test | \`${filterTest}\` |
${depsSection}${consumersSection}

## Monorepo Context

**Coordinator:** @${info.rootName}-coordinator
**Dependency graph:** \`knowledge/DEPENDENCY_GRAPH.md\`
**Monorepo root:** \`${info.root}\`

When your changes affect other packages, notify the coordinator.
When you need changes in a dependency, ask the coordinator to route it.

## Journal Entries

Write to \`.jfl/journal/\` after significant work:

\`\`\`json
{"v":1,"ts":"...","session":"...","type":"feature","title":"${pkg.name}: ...","summary":"...","files":["${pkg.relativePath}/..."]}
\`\`\`
`

  const agentFile = join(agentsDir, `${agentName}.md`)
  writeFileSync(agentFile, content)
  return agentName
}

function generatePiTeam(info: MonorepoInfo, gtmPath: string): string | null {
  const teamDir = join(gtmPath, "teams")
  mkdirSync(teamDir, { recursive: true })

  const coordinatorName = `${info.rootName}-coordinator`

  const agents: Array<{
    name: string
    role: string
    description: string
    model: string
    skills: string[]
  }> = []

  agents.push({
    name: coordinatorName,
    role: "coordinator",
    description: `Monorepo coordinator — understands dependency graph, routes tasks, runs cross-cutting operations`,
    model: "anthropic/claude-sonnet-4-20250514",
    skills: ["hud", "context"],
  })

  for (const app of info.apps) {
    const agentName = generateMonorepoAgentName(info.rootName, app.name)
    agents.push({
      name: agentName,
      role: app.metadata.type === "web" ? "frontend" : app.metadata.type === "api" ? "backend" : "builder",
      description: `${app.metadata.description} (${app.relativePath})`,
      model: "anthropic/claude-sonnet-4-20250514",
      skills: ["hud", "context", "fly-deploy"],
    })
  }

  for (const lib of info.libs) {
    const agentName = generateMonorepoAgentName(info.rootName, lib.name)
    agents.push({
      name: agentName,
      role: lib.role === "config" ? "config" : lib.role === "tool" ? "tooling" : "library",
      description: `${lib.metadata.description} (${lib.relativePath})`,
      model: "anthropic/claude-sonnet-4-20250514",
      skills: ["hud", "context"],
    })
  }

  const yamlLines: string[] = [
    `# ${info.rootName} Monorepo Team`,
    `# Auto-generated from ${info.type} + ${info.manager} workspace`,
    `# ${info.packages.length} packages: ${info.apps.length} apps, ${info.libs.length} libraries`,
    "",
    "team:",
    `  name: ${info.rootName}`,
    `  description: "Agents for the ${info.rootName} monorepo"`,
    "",
    "agents:",
  ]

  for (const agent of agents) {
    yamlLines.push(
      `  - name: ${agent.name}`,
      `    role: ${agent.role}`,
      `    description: "${agent.description}"`,
      `    model: ${agent.model}`,
      `    skills:`,
      ...agent.skills.map(s => `      - ${s}`),
      "",
    )
  }

  const teamFile = join(teamDir, `${info.rootName}-team.yaml`)
  writeFileSync(teamFile, yamlLines.join("\n"))
  return teamFile
}

export function onboardMonorepo(
  root: string,
  gtmPath: string,
  options?: { skip?: string[] }
): MonorepoOnboardResult | null {
  const info = detectMonorepo(root)
  if (!info) return null

  const skip = new Set(options?.skip || [])
  const agents: string[] = []
  const skipped: string[] = []

  const coordinatorAgent = writeCoordinatorAgent(info, gtmPath)
  agents.push(coordinatorAgent)

  for (const pkg of info.packages) {
    if (skip.has(pkg.name)) {
      skipped.push(pkg.name)
      continue
    }

    const agentName = writePackageAgent(pkg, info, gtmPath)
    agents.push(agentName)

    writeSkillFiles(pkg.metadata, pkg.path, gtmPath)
  }

  const knowledgeDir = join(gtmPath, "knowledge")
  mkdirSync(knowledgeDir, { recursive: true })
  const depGraphFile = join(knowledgeDir, "DEPENDENCY_GRAPH.md")
  writeFileSync(depGraphFile, generateDependencyGraphDoc(info))

  const teamFile = generatePiTeam(info, gtmPath)

  const configPath = join(gtmPath, ".jfl", "config.json")
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"))
      if (!config.registered_services) config.registered_services = []

      const existing = config.registered_services.findIndex(
        (s: any) => s.path === root
      )

      const serviceEntry = {
        name: info.rootName,
        path: root,
        type: "monorepo",
        status: "active",
        monorepo: {
          tool: info.type,
          manager: info.manager,
          workspace_globs: info.workspaceGlobs,
          apps: info.apps.map(a => ({
            name: a.name,
            path: a.relativePath,
            port: a.metadata.port,
            agent: `@${generateMonorepoAgentName(info.rootName, a.name)}`,
          })),
          packages: info.libs.map(l => ({
            name: l.name,
            path: l.relativePath,
            role: l.role,
            consumers: l.consumers,
            agent: `@${generateMonorepoAgentName(info.rootName, l.name)}`,
          })),
        },
        agents: agents.map(a => `@${a}`),
        last_sync: new Date().toISOString(),
      }

      if (existing >= 0) {
        config.registered_services[existing] = serviceEntry
      } else {
        config.registered_services.push(serviceEntry)
      }

      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
    } catch {}
  }

  const manifestPath = join(gtmPath, ".jfl", "projects.manifest.json")
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"))
      if (!manifest.projects) manifest.projects = {}

      manifest.projects[info.rootName] = {
        type: "monorepo",
        monorepo_tool: info.type,
        location: root,
        description: `${info.type} monorepo (${info.packages.length} packages)`,
        agent_enabled: true,
        agents: agents.map(a => `@${a}`),
      }

      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
    } catch {}
  }

  return {
    info,
    agents,
    coordinatorAgent,
    teamFile,
    depGraphFile,
    skipped,
  }
}

export function formatOnboardSummary(result: MonorepoOnboardResult): string {
  const { info, agents, teamFile } = result

  const lines: string[] = [
    "",
    `  Monorepo: ${info.rootName} (${info.type} + ${info.manager})`,
    `  Packages: ${info.packages.length} total`,
    "",
    "  APPS:",
  ]

  for (const app of info.apps) {
    const agentName = generateMonorepoAgentName(info.rootName, app.name)
    const port = app.metadata.port ? `:${app.metadata.port}` : ""
    lines.push(`    @${agentName}  ${app.relativePath}  ${app.metadata.type}${port}`)
  }

  lines.push("", "  LIBRARIES:")
  for (const lib of info.libs) {
    const agentName = generateMonorepoAgentName(info.rootName, lib.name)
    const consumers = lib.consumers.length > 0 ? `→ ${lib.consumers.join(", ")}` : ""
    lines.push(`    @${agentName}  ${lib.relativePath}  ${lib.role}  ${consumers}`)
  }

  lines.push(
    "",
    `  COORDINATOR: @${info.rootName}-coordinator`,
    `  Agents: ${agents.length} total`,
    `  Dependency graph: knowledge/DEPENDENCY_GRAPH.md`,
  )

  if (teamFile) {
    lines.push(`  Pi team: ${teamFile}`)
  }

  if (result.skipped.length > 0) {
    lines.push(`  Skipped: ${result.skipped.join(", ")}`)
  }

  lines.push("")

  return lines.join("\n")
}
