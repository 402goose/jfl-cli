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

function matchScopePattern(pattern: string, value: string): boolean {
  if (pattern === "*") return true
  if (pattern === value) return true
  if (pattern.includes("*")) {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$")
    return regex.test(value)
  }
  return false
}

export async function scopeCommand(action?: string, ...args: string[]): Promise<void> {
  switch (action) {
    case "list":
    case undefined:
      await listScopes()
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

    default:
      console.log(chalk.yellow("Unknown action. Usage: jfl scope [list|set|test]"))
  }
}
