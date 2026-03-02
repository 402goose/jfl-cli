/**
 * @purpose Manage narrowly-scoped agents — init scaffolding, list, status
 */

import chalk from "chalk"
import * as fs from "fs"
import * as path from "path"
import { generateManifest, generatePolicy, generateLifecycle, parseManifest } from "../lib/agent-manifest.js"

function getAgentsDir(): string {
  return path.join(process.cwd(), ".jfl", "agents")
}

function getFlowsDir(): string {
  return path.join(process.cwd(), ".jfl", "flows")
}

async function initAgent(name: string, options: { description?: string } = {}): Promise<void> {
  if (!/^[a-z0-9-]+$/.test(name)) {
    console.log(chalk.red(`\n  Invalid agent name: "${name}"`))
    console.log(chalk.gray("  Use lowercase letters, numbers, and hyphens only\n"))
    return
  }

  const agentDir = path.join(getAgentsDir(), name)
  if (fs.existsSync(agentDir)) {
    console.log(chalk.yellow(`\n  Agent "${name}" already exists at .jfl/agents/${name}/\n`))
    return
  }

  fs.mkdirSync(agentDir, { recursive: true })

  const manifestContent = generateManifest(name, options.description)
  fs.writeFileSync(path.join(agentDir, "manifest.yaml"), manifestContent)

  const policyContent = generatePolicy()
  fs.writeFileSync(path.join(agentDir, "policy.json"), policyContent)

  const triggerPattern = "session:ended"
  const lifecycleContent = generateLifecycle(name, triggerPattern)

  const flowsDir = getFlowsDir()
  fs.mkdirSync(flowsDir, { recursive: true })
  fs.writeFileSync(path.join(flowsDir, `${name}.yaml`), lifecycleContent)

  console.log(chalk.bold(`\n  Agent scaffolded: ${name}\n`))
  console.log(chalk.gray("  Created:"))
  console.log(`    .jfl/agents/${name}/manifest.yaml`)
  console.log(`    .jfl/agents/${name}/policy.json`)
  console.log(`    .jfl/flows/${name}.yaml`)
  console.log()
  console.log(chalk.gray("  Next steps:"))
  console.log(`    1. Edit manifest.yaml — set triggers, capabilities, runtime`)
  console.log(`    2. Edit policy.json — set cost limits, approval gates`)
  console.log(`    3. Edit .jfl/flows/${name}.yaml — customize lifecycle flow`)
  console.log(`    4. Run ${chalk.cyan("jfl agent status " + name)} to verify`)
  console.log()
}

async function listAgents(): Promise<void> {
  const agentsDir = getAgentsDir()

  console.log(chalk.bold("\n  Registered Agents\n"))

  if (!fs.existsSync(agentsDir)) {
    console.log(chalk.gray("  No agents registered."))
    console.log(chalk.gray(`  Run ${chalk.cyan("jfl agent init <name>")} to create one.\n`))
    return
  }

  const entries = fs.readdirSync(agentsDir).filter(f =>
    fs.statSync(path.join(agentsDir, f)).isDirectory()
  )

  if (entries.length === 0) {
    console.log(chalk.gray("  No agents registered."))
    console.log(chalk.gray(`  Run ${chalk.cyan("jfl agent init <name>")} to create one.\n`))
    return
  }

  for (const name of entries) {
    const manifestPath = path.join(agentsDir, name, "manifest.yaml")
    const policyPath = path.join(agentsDir, name, "policy.json")

    const hasManifest = fs.existsSync(manifestPath)
    const hasPolicy = fs.existsSync(policyPath)

    let description = ""
    let agentType = ""
    if (hasManifest) {
      try {
        const { parse } = await import("yaml")
        const manifest = parse(fs.readFileSync(manifestPath, "utf-8"))
        description = manifest.description || ""
        agentType = manifest.type || ""
      } catch {}
    }

    const status = hasManifest && hasPolicy ? chalk.green("ok") : chalk.yellow("incomplete")
    const typeTag = agentType ? chalk.gray(` [${agentType}]`) : ""
    const desc = description ? chalk.gray(` — ${description}`) : ""
    console.log(`  ${status}  ${chalk.bold(name)}${typeTag}${desc}`)
  }

  console.log()
}

async function statusAgent(name: string): Promise<void> {
  const agentDir = path.join(getAgentsDir(), name)

  if (!fs.existsSync(agentDir)) {
    console.log(chalk.red(`\n  Agent "${name}" not found.`))
    console.log(chalk.gray(`  Run ${chalk.cyan("jfl agent init " + name)} to create it.\n`))
    return
  }

  console.log(chalk.bold(`\n  Agent: ${name}\n`))

  const manifestPath = path.join(agentDir, "manifest.yaml")
  const policyPath = path.join(agentDir, "policy.json")
  const flowPath = path.join(getFlowsDir(), `${name}.yaml`)

  const checks = [
    { file: "manifest.yaml", path: manifestPath },
    { file: "policy.json", path: policyPath },
    { file: `flows/${name}.yaml`, path: flowPath },
  ]

  for (const check of checks) {
    if (fs.existsSync(check.path)) {
      console.log(chalk.green("  [ok] ") + check.file)
    } else {
      console.log(chalk.red("  [!!] ") + check.file + chalk.gray(" — missing"))
    }
  }

  if (fs.existsSync(manifestPath)) {
    try {
      const { parse } = await import("yaml")
      const manifest = parse(fs.readFileSync(manifestPath, "utf-8"))
      console.log()
      console.log(chalk.gray("  Type:         ") + (manifest.type || "unknown"))
      console.log(chalk.gray("  Version:      ") + (manifest.version || "0.0.0"))
      if (manifest.triggers?.length) {
        const triggers = manifest.triggers.map((t: any) => t.pattern || t.schedule).join(", ")
        console.log(chalk.gray("  Triggers:     ") + triggers)
      }
      if (manifest.capabilities?.length) {
        console.log(chalk.gray("  Capabilities: ") + manifest.capabilities.join(", "))
      }
      if (manifest.runtime?.command) {
        console.log(chalk.gray("  Runtime:      ") + manifest.runtime.command + " " + (manifest.runtime.args || []).join(" "))
      }
    } catch {}
  }

  if (fs.existsSync(policyPath)) {
    try {
      const policy = JSON.parse(fs.readFileSync(policyPath, "utf-8"))
      console.log(chalk.gray("  Cost limit:   ") + `$${policy.cost_limit_usd}`)
      console.log(chalk.gray("  Approval:     ") + policy.approval_gate)
      console.log(chalk.gray("  Max conc.:    ") + policy.max_concurrent)
    } catch {}
  }

  console.log()
}

export async function agentCommand(action?: string, nameOrOptions?: string, options?: { description?: string }): Promise<void> {
  switch (action) {
    case "init":
      if (!nameOrOptions) {
        console.log(chalk.red("\n  Agent name required."))
        console.log(chalk.gray("  Usage: jfl agent init <name>\n"))
        return
      }
      await initAgent(nameOrOptions, options || {})
      break
    case "list":
      await listAgents()
      break
    case "status":
      if (!nameOrOptions) {
        console.log(chalk.red("\n  Agent name required."))
        console.log(chalk.gray("  Usage: jfl agent status <name>\n"))
        return
      }
      await statusAgent(nameOrOptions)
      break
    default:
      console.log(chalk.bold("\n  jfl agent — Manage narrowly-scoped agents\n"))
      console.log(chalk.gray("  Commands:"))
      console.log("    jfl agent init <name>     Scaffold a new agent (manifest + policy + flows)")
      console.log("    jfl agent list            List registered agents")
      console.log("    jfl agent status <name>   Show agent health and config")
      console.log()
  }
}
