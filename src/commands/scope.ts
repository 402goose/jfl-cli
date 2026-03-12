/**
 * jfl scope — View and manage service context scopes
 *
 * @purpose CLI commands to view, set, and test context scope declarations
 */

import chalk from "chalk"
import * as fs from "fs"
import * as path from "path"
import type { ContextScope, ServiceRegistration, GTMConfig } from "../lib/service-gtm.js"

function findProjectRoot(): string | null {
  let dir = process.cwd()
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".jfl", "config.json"))) {
      return dir
    }
    dir = path.dirname(dir)
  }
  return null
}

function loadConfig(root: string): GTMConfig | null {
  const configPath = path.join(root, ".jfl", "config.json")
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as GTMConfig
  } catch {
    return null
  }
}

function saveConfig(root: string, config: GTMConfig): void {
  const configPath = path.join(root, ".jfl", "config.json")
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
}

function formatScope(scope: ContextScope | undefined, indent: string = "  "): string {
  if (!scope) return `${indent}${chalk.dim("(no scope declared — unrestricted)")}`

  const lines: string[] = []

  if (scope.produces?.length) {
    lines.push(`${indent}${chalk.green("produces:")}`)
    for (const p of scope.produces) {
      lines.push(`${indent}  ${chalk.green("+")} ${p}`)
    }
  }

  if (scope.consumes?.length) {
    lines.push(`${indent}${chalk.cyan("consumes:")}`)
    for (const c of scope.consumes) {
      lines.push(`${indent}  ${chalk.cyan("←")} ${c}`)
    }
  }

  if (scope.denied?.length) {
    lines.push(`${indent}${chalk.red("denied:")}`)
    for (const d of scope.denied) {
      lines.push(`${indent}  ${chalk.red("✗")} ${d}`)
    }
  }

  return lines.length > 0 ? lines.join("\n") : `${indent}${chalk.dim("(empty scope)")}`
}

async function listScopes(): Promise<void> {
  const root = findProjectRoot()
  if (!root) {
    console.log(chalk.red("Not in a JFL project"))
    return
  }

  const config = loadConfig(root)
  if (!config) {
    console.log(chalk.red("No .jfl/config.json found"))
    return
  }

  console.log(chalk.bold("\nContext Scopes"))
  console.log(chalk.dim("─".repeat(50)))

  // Show this workspace's scope
  console.log(`\n${chalk.bold(config.name || "this workspace")} ${chalk.dim(`(${config.type})`)}`)
  console.log(formatScope(config.context_scope))

  // Show registered services' scopes
  const services = config.registered_services || []
  if (services.length === 0) {
    console.log(chalk.dim("\nNo registered services"))
    return
  }

  for (const svc of services) {
    const status = svc.status === "active" ? chalk.green("active") : chalk.dim("inactive")
    console.log(`\n${chalk.bold(svc.name)} ${chalk.dim("—")} ${status}`)

    // Check the service's own config for scope
    const svcConfigPath = path.join(svc.path, ".jfl", "config.json")
    let svcScope: ContextScope | undefined = svc.context_scope

    if (!svcScope && fs.existsSync(svcConfigPath)) {
      try {
        const svcConfig = JSON.parse(fs.readFileSync(svcConfigPath, "utf-8"))
        svcScope = svcConfig.context_scope
      } catch {
        // skip
      }
    }

    console.log(formatScope(svcScope))
  }

  console.log()
}

async function setScope(serviceName: string, scopeType: string, patterns: string[]): Promise<void> {
  const root = findProjectRoot()
  if (!root) {
    console.log(chalk.red("Not in a JFL project"))
    return
  }

  const config = loadConfig(root)
  if (!config) {
    console.log(chalk.red("No .jfl/config.json found"))
    return
  }

  if (!["produces", "consumes", "denied"].includes(scopeType)) {
    console.log(chalk.red(`Invalid scope type: ${scopeType}. Must be: produces, consumes, denied`))
    return
  }

  // Find the service
  if (serviceName === "self" || serviceName === config.name) {
    if (!config.context_scope) config.context_scope = {}
    ;(config.context_scope as any)[scopeType] = patterns
    saveConfig(root, config)
    console.log(chalk.green(`Updated ${config.name || "workspace"} scope.${scopeType}`))
    return
  }

  const services = config.registered_services || []
  const svc = services.find(s => s.name === serviceName)
  if (!svc) {
    console.log(chalk.red(`Service "${serviceName}" not found. Available: ${services.map(s => s.name).join(", ")}`))
    return
  }

  if (!svc.context_scope) svc.context_scope = {}
  ;(svc.context_scope as any)[scopeType] = patterns
  saveConfig(root, config)

  // Also update the service's own config if it exists
  const svcConfigPath = path.join(svc.path, ".jfl", "config.json")
  if (fs.existsSync(svcConfigPath)) {
    try {
      const svcConfig = JSON.parse(fs.readFileSync(svcConfigPath, "utf-8"))
      if (!svcConfig.context_scope) svcConfig.context_scope = {}
      svcConfig.context_scope[scopeType] = patterns
      fs.writeFileSync(svcConfigPath, JSON.stringify(svcConfig, null, 2) + "\n")
    } catch {
      // non-fatal
    }
  }

  console.log(chalk.green(`Updated ${serviceName} scope.${scopeType}: [${patterns.join(", ")}]`))
}

async function testScope(serviceName: string, eventType: string, eventSource: string): Promise<void> {
  const root = findProjectRoot()
  if (!root) {
    console.log(chalk.red("Not in a JFL project"))
    return
  }

  const config = loadConfig(root)
  if (!config) {
    console.log(chalk.red("No .jfl/config.json found"))
    return
  }

  const services = config.registered_services || []
  const svc = services.find(s => s.name === serviceName)
  const scope = svc?.context_scope || (serviceName === "self" ? config.context_scope : undefined)

  if (!scope) {
    console.log(chalk.yellow(`${serviceName}: No scope declared — event would be ${chalk.green("ALLOWED")} (unrestricted)`))
    return
  }

  // Check denied
  const denied = scope.denied || []
  for (const pattern of denied) {
    if (matchScopePattern(pattern, eventType) || matchScopePattern(pattern, eventSource)) {
      console.log(chalk.red(`${serviceName}: event "${eventType}" from "${eventSource}" — DENIED by pattern "${pattern}"`))
      return
    }
  }

  // Check consumes
  const consumes = scope.consumes || []
  if (consumes.length > 0) {
    const allowed = consumes.some(p =>
      matchScopePattern(p, eventType) || matchScopePattern(p, eventSource)
    )
    if (!allowed) {
      console.log(chalk.red(`${serviceName}: event "${eventType}" from "${eventSource}" — NOT in consumes list`))
      return
    }
  }

  console.log(chalk.green(`${serviceName}: event "${eventType}" from "${eventSource}" — ALLOWED`))
}

export function matchScopePattern(pattern: string, value: string): boolean {
  if (pattern === "*") return true
  if (pattern === value) return true
  if (pattern.includes("*")) {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$")
    return regex.test(value)
  }
  return false
}

interface ScopeNode {
  name: string
  type: string
  scope: ContextScope | undefined
}

function collectNodes(config: GTMConfig): ScopeNode[] {
  const nodes: ScopeNode[] = [{
    name: config.name || "workspace",
    type: config.type || "gtm",
    scope: config.context_scope,
  }]

  for (const svc of config.registered_services || []) {
    let scope = svc.context_scope
    if (!scope) {
      const svcConfigPath = path.join(svc.path, ".jfl", "config.json")
      if (fs.existsSync(svcConfigPath)) {
        try {
          const svcConfig = JSON.parse(fs.readFileSync(svcConfigPath, "utf-8"))
          scope = svcConfig.context_scope
        } catch { /* skip */ }
      }
    }
    nodes.push({ name: svc.name, type: svc.type || "service", scope })
  }

  return nodes
}

function allPatterns(nodes: ScopeNode[]): string[] {
  const set = new Set<string>()
  for (const n of nodes) {
    for (const p of n.scope?.produces || []) set.add(p)
    for (const c of n.scope?.consumes || []) set.add(c)
    for (const d of n.scope?.denied || []) set.add(d)
  }
  return [...set].sort()
}

interface ScopeEdge {
  from: string
  to: string
  pattern: string
  type: "flow" | "denied"
}

interface ScopeWarning {
  service: string
  message: string
}

function buildEdges(nodes: ScopeNode[]): { edges: ScopeEdge[], warnings: ScopeWarning[] } {
  const edges: ScopeEdge[] = []
  const warnings: ScopeWarning[] = []

  for (const consumer of nodes) {
    const consumes = consumer.scope?.consumes || []
    const denied = consumer.scope?.denied || []

    for (const pattern of consumes) {
      // Find producers that match this consume pattern
      let hasProducer = false
      for (const producer of nodes) {
        if (producer.name === consumer.name) continue
        const produces = producer.scope?.produces || []
        const matches = produces.some(p => matchScopePattern(pattern, p) || matchScopePattern(p, pattern))
        if (matches) {
          hasProducer = true
          edges.push({ from: producer.name, to: consumer.name, pattern, type: "flow" })
        }
      }

      // Check if consumed pattern is also denied
      const selfDenied = denied.some(d => matchScopePattern(d, pattern) || matchScopePattern(pattern, d))
      if (selfDenied) {
        warnings.push({
          service: consumer.name,
          message: `consumes "${pattern}" but also denies a matching pattern`,
        })
      }

      if (!hasProducer && pattern !== "*") {
        warnings.push({
          service: consumer.name,
          message: `consumes "${pattern}" but no service produces it`,
        })
      }
    }

    // Denied edges
    for (const pattern of denied) {
      for (const producer of nodes) {
        if (producer.name === consumer.name) continue
        const produces = producer.scope?.produces || []
        const matches = produces.some(p => matchScopePattern(pattern, p) || matchScopePattern(p, pattern))
        if (matches) {
          edges.push({ from: producer.name, to: consumer.name, pattern, type: "denied" })
        }
      }
    }

    // Unrestricted warning
    if (!consumer.scope && consumer.type !== "gtm") {
      warnings.push({
        service: consumer.name,
        message: "no scope declared — unrestricted access",
      })
    }
  }

  return { edges, warnings }
}

async function vizScopes(): Promise<void> {
  const root = findProjectRoot()
  if (!root) {
    console.log(chalk.red("Not in a JFL project"))
    return
  }

  const config = loadConfig(root)
  if (!config) {
    console.log(chalk.red("No .jfl/config.json found"))
    return
  }

  const nodes = collectNodes(config)
  if (nodes.length <= 1) {
    console.log(chalk.dim("\nNo registered services to visualize"))
    return
  }

  const { edges, warnings } = buildEdges(nodes)
  const patterns = allPatterns(nodes)

  // Header
  console.log(chalk.bold("\nScope Graph"))
  console.log(chalk.dim("─".repeat(60)))

  // Node summary
  console.log(chalk.bold("\nNodes"))
  for (const n of nodes) {
    const produces = n.scope?.produces || []
    const consumes = n.scope?.consumes || []
    const denied = n.scope?.denied || []
    const tag = n.type === "gtm" ? chalk.blue("gtm") : chalk.dim("svc")
    const scopeStatus = !n.scope
      ? chalk.yellow("unrestricted")
      : `${chalk.green(`+${produces.length}`)} ${chalk.cyan(`<${consumes.length}`)} ${chalk.red(`x${denied.length}`)}`
    console.log(`  ${tag} ${chalk.bold(n.name)}  ${scopeStatus}`)
  }

  // Flow edges
  const flowEdges = edges.filter(e => e.type === "flow")
  const denyEdges = edges.filter(e => e.type === "denied")

  if (flowEdges.length > 0) {
    console.log(chalk.bold("\nFlows") + chalk.dim("  (producer -> consumer)"))
    for (const e of flowEdges) {
      console.log(`  ${chalk.green(e.from)} ${chalk.dim("──>")} ${chalk.cyan(e.to)}  ${chalk.dim(e.pattern)}`)
    }
  }

  if (denyEdges.length > 0) {
    console.log(chalk.bold("\nBlocked") + chalk.dim("  (producer -x- consumer)"))
    for (const e of denyEdges) {
      console.log(`  ${chalk.green(e.from)} ${chalk.red("─x─")} ${chalk.cyan(e.to)}  ${chalk.dim(e.pattern)}`)
    }
  }

  // Isolation matrix
  if (nodes.length > 1 && patterns.length > 0) {
    console.log(chalk.bold("\nAccess Matrix"))
    const nameWidth = Math.max(...nodes.map(n => n.name.length), 8)

    // Header row
    const patternLabels = patterns.map(p => {
      const short = p.length > 12 ? p.slice(0, 11) + "~" : p
      return short.padEnd(13)
    })
    console.log(`  ${"".padEnd(nameWidth)}  ${patternLabels.join("")}`)

    for (const node of nodes) {
      const cells: string[] = []
      for (const p of patterns) {
        const produces = (node.scope?.produces || []).some(pr => matchScopePattern(pr, p) || matchScopePattern(p, pr))
        const consumes = (node.scope?.consumes || []).some(c => matchScopePattern(c, p) || matchScopePattern(p, c))
        const denied = (node.scope?.denied || []).some(d => matchScopePattern(d, p) || matchScopePattern(p, d))

        let cell: string
        if (denied) cell = chalk.red("  DENY       ")
        else if (produces && consumes) cell = chalk.yellow("  P+C        ")
        else if (produces) cell = chalk.green("  PROD       ")
        else if (consumes) cell = chalk.cyan("  READ       ")
        else if (!node.scope) cell = chalk.yellow("  *          ")
        else cell = chalk.dim("  -          ")
        cells.push(cell)
      }
      console.log(`  ${node.name.padEnd(nameWidth)}  ${cells.join("")}`)
    }
  }

  // Warnings
  if (warnings.length > 0) {
    console.log(chalk.bold("\nWarnings"))
    for (const w of warnings) {
      console.log(`  ${chalk.yellow("[!!]")} ${chalk.bold(w.service)}: ${w.message}`)
    }
  } else {
    console.log(chalk.green("\nNo scope warnings"))
  }

  console.log()
}

export async function scopeCommand(action?: string, ...args: string[]): Promise<void> {
  switch (action) {
    case "list":
    case undefined:
      await listScopes()
      break

    case "viz":
      await vizScopes()
      break

    case "set": {
      const [serviceName, scopeType, ...patterns] = args
      if (!serviceName || !scopeType || patterns.length === 0) {
        console.log(chalk.yellow("Usage: jfl scope set <service> <produces|consumes|denied> <pattern1> [pattern2] ..."))
        console.log(chalk.dim('  Example: jfl scope set seo-agent denied "team-journals:*" "shadow:*"'))
        return
      }
      await setScope(serviceName, scopeType, patterns)
      break
    }

    case "test": {
      const [serviceName, eventType, eventSource] = args
      if (!serviceName || !eventType) {
        console.log(chalk.yellow("Usage: jfl scope test <service> <event-type> [event-source]"))
        console.log(chalk.dim('  Example: jfl scope test seo-agent journal:entry journal:productrank-lobsters'))
        return
      }
      await testScope(serviceName, eventType, eventSource || "unknown")
      break
    }

    case "impact": {
      const [serviceName, ...changeScopes] = args
      if (!serviceName) {
        console.log(chalk.yellow("Usage: jfl scope impact <service> [scope1] [scope2] ..."))
        console.log(chalk.dim('  Example: jfl scope impact jfl-cli cli:api-change cli:command-change'))
        console.log(chalk.dim('  If no scopes given, uses all produces from the service'))
        return
      }
      await detectImpact(serviceName, changeScopes)
      break
    }

    default:
      console.log(chalk.yellow("Unknown action. Usage: jfl scope [list|set|test|viz|impact]"))
  }
}

/**
 * Detect which services are affected by a change in the given service.
 * Matches the service's produces against all other services' consumes.
 */
async function detectImpact(serviceName: string, changeScopes: string[]): Promise<void> {
  const root = findProjectRoot()
  if (!root) { console.log(chalk.red("Not in a JFL project")); return }
  const config = loadConfig(root)
  if (!config) { console.log(chalk.red("Cannot load config")); return }

  // Resolve the source service's produces
  const services = config.registered_services || []
  const sourceService = services.find(s => s.name === serviceName)

  let producesPatterns = changeScopes
  if (producesPatterns.length === 0 && sourceService?.path) {
    const svcConfig = loadConfig(sourceService.path)
    producesPatterns = svcConfig?.context_scope?.produces || []
  }

  if (producesPatterns.length === 0) {
    console.log(chalk.yellow(`No produces patterns for ${serviceName}`))
    return
  }

  const isJson = process.argv.includes("--json")
  const affected: { service: string; path: string; matchedPatterns: string[] }[] = []

  for (const svc of services) {
    if (svc.name === serviceName) continue
    if (!svc.path) continue

    const svcConfig = loadConfig(svc.path)
    const consumes = svcConfig?.context_scope?.consumes || []

    const matched: string[] = []
    for (const produce of producesPatterns) {
      for (const consume of consumes) {
        if (scopeMatches(produce, consume)) {
          matched.push(`${produce} ↔ ${consume}`)
        }
      }
    }

    if (matched.length > 0) {
      affected.push({ service: svc.name, path: svc.path, matchedPatterns: matched })
    }
  }

  if (isJson) {
    console.log(JSON.stringify({ source: serviceName, produces: producesPatterns, affected }, null, 2))
    return
  }

  if (affected.length === 0) {
    console.log(chalk.green(`✔ No downstream impact from ${serviceName} changes`))
    return
  }

  console.log(chalk.bold(`\n${chalk.cyan("⚡")} Impact from ${chalk.bold(serviceName)} changes:\n`))
  for (const a of affected) {
    console.log(`  ${chalk.yellow("→")} ${chalk.bold(a.service)}`)
    for (const m of a.matchedPatterns) {
      console.log(`    ${chalk.dim(m)}`)
    }
  }
  console.log()
}

function scopeMatches(event: string, pattern: string): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -1)
    return event.startsWith(prefix)
  }
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1)
    return event.startsWith(prefix)
  }
  return event === pattern
}
