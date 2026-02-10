/**
 * Service Orchestration
 *
 * Execute multi-service workflows defined in services.json.
 * Supports sequential and parallel execution with health checks.
 *
 * @purpose Multi-service orchestration engine for complex deployments and workflows
 */

import chalk from "chalk"
import ora, { Ora } from "ora"
import * as fs from "fs"
import * as path from "path"
import { homedir } from "os"
import { JFL_PATHS } from "../utils/jfl-paths.js"

const GLOBAL_SERVICES_FILE = path.join(JFL_PATHS.data, "services.json")
const SERVICE_MANAGER_URL = "http://localhost:3402"

// ============================================================================
// Types
// ============================================================================

interface OrchestrationStep {
  type: "sequential" | "parallel"
  services: string[]
  action: string
  waitForHealth?: boolean
  timeout?: number
  continueOnError?: boolean
}

interface Orchestration {
  name: string
  description: string
  steps: OrchestrationStep[]
}

interface OrchestrationConfig {
  version: string
  orchestrations: Record<string, Omit<Orchestration, 'name'>>
  services: Record<string, any>
}

// ============================================================================
// Config Loading
// ============================================================================

function loadOrchestrations(): OrchestrationConfig {
  if (!fs.existsSync(GLOBAL_SERVICES_FILE)) {
    throw new Error(`Services file not found: ${GLOBAL_SERVICES_FILE}`)
  }

  const content = fs.readFileSync(GLOBAL_SERVICES_FILE, "utf-8")
  return JSON.parse(content)
}

// ============================================================================
// Service Manager API
// ============================================================================

async function callService(serviceName: string, tool: string, args: any = {}): Promise<any> {
  const response = await fetch(`${SERVICE_MANAGER_URL}/registry/${serviceName}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to call ${serviceName}.${tool}: ${error}`)
  }

  const result = await response.json()
  return result.result
}

async function getServiceStatus(serviceName: string): Promise<any> {
  const response = await fetch(`${SERVICE_MANAGER_URL}/registry/${serviceName}`)

  if (!response.ok) {
    throw new Error(`Service not found: ${serviceName}`)
  }

  const result = await response.json()
  return result.service
}

async function checkServiceHealth(serviceName: string): Promise<boolean> {
  try {
    const result = await callService(serviceName, "health", {})
    return !result.includes("failed") && !result.includes("timeout")
  } catch {
    return false
  }
}

// ============================================================================
// Orchestration Execution
// ============================================================================

async function executeStep(step: OrchestrationStep, spinner: Ora): Promise<void> {
  if (step.type === "sequential") {
    // Execute services one by one
    for (const serviceName of step.services) {
      await executeServiceAction(serviceName, step, spinner)
    }
  } else if (step.type === "parallel") {
    // Execute all services at once
    const promises = step.services.map((serviceName) =>
      executeServiceAction(serviceName, step, spinner)
    )

    const results = await Promise.allSettled(promises)

    // Check for errors if not continuing on error
    if (!step.continueOnError) {
      const failures = results.filter((r) => r.status === "rejected")
      if (failures.length > 0) {
        throw new Error(
          `${failures.length} service(s) failed: ${failures
            .map((f: any) => f.reason?.message)
            .join(", ")}`
        )
      }
    }
  }
}

async function executeServiceAction(
  serviceName: string,
  step: OrchestrationStep,
  spinner: Ora
): Promise<void> {
  spinner.text = `${step.action}: ${serviceName}`

  try {
    // Execute the action
    const result = await callService(serviceName, step.action, {})

    // Wait for health check if requested
    if (step.waitForHealth) {
      spinner.text = `Waiting for ${serviceName} to be healthy...`

      const timeout = step.timeout || 30000 // 30 seconds default
      const startTime = Date.now()

      while (Date.now() - startTime < timeout) {
        const healthy = await checkServiceHealth(serviceName)
        if (healthy) {
          spinner.succeed(chalk.green(`✓ ${serviceName} ${step.action} (healthy)`))
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      if (step.continueOnError) {
        spinner.warn(chalk.yellow(`⚠ ${serviceName} ${step.action} (health check timeout)`))
      } else {
        throw new Error(`Health check timeout for ${serviceName}`)
      }
    } else {
      spinner.succeed(chalk.green(`✓ ${serviceName} ${step.action}`))
    }
  } catch (error) {
    if (step.continueOnError) {
      spinner.warn(chalk.yellow(`⚠ ${serviceName} ${step.action} failed: ${error}`))
    } else {
      spinner.fail(chalk.red(`✗ ${serviceName} ${step.action} failed`))
      throw error
    }
  }
}

// ============================================================================
// Main Command
// ============================================================================

export async function orchestrate(name: string, options: { dryRun?: boolean } = {}): Promise<void> {
  const spinner = ora("Loading orchestration...").start()

  try {
    const config = loadOrchestrations()

    if (!config.orchestrations || !config.orchestrations[name]) {
      spinner.fail(`Orchestration "${name}" not found`)
      console.log(chalk.dim("\nAvailable orchestrations:"))
      if (config.orchestrations) {
        Object.entries(config.orchestrations).forEach(([key, orch]) => {
          console.log(chalk.cyan(`  ${key}`))
          console.log(chalk.dim(`    ${orch.description}`))
        })
      } else {
        console.log(chalk.dim("  None defined yet"))
        console.log(chalk.dim("\nTo add orchestrations, edit ~/.jfl/services.json"))
      }
      process.exit(1)
    }

    const orchestration = config.orchestrations[name]

    spinner.succeed(`Loaded orchestration: ${name}`)
    console.log(chalk.dim(orchestration.description))
    console.log()

    // Dry run - just show what would happen
    if (options.dryRun) {
      console.log(chalk.bold("Dry run - steps that would execute:"))
      console.log()

      orchestration.steps.forEach((step, index) => {
        console.log(chalk.cyan(`Step ${index + 1}: ${step.type}`))
        console.log(chalk.dim(`  Services: ${step.services.join(", ")}`))
        console.log(chalk.dim(`  Action: ${step.action}`))
        if (step.waitForHealth) {
          console.log(chalk.dim(`  Wait for health: yes`))
        }
        if (step.continueOnError) {
          console.log(chalk.dim(`  Continue on error: yes`))
        }
        console.log()
      })

      return
    }

    // Execute steps
    spinner.start("Executing orchestration...")

    for (let i = 0; i < orchestration.steps.length; i++) {
      const step = orchestration.steps[i]
      spinner.text = `Step ${i + 1}/${orchestration.steps.length}: ${step.type} ${step.action}`

      await executeStep(step, spinner)
    }

    spinner.succeed(chalk.green(`✓ Orchestration "${name}" completed successfully`))
  } catch (error) {
    spinner.fail("Orchestration failed")
    console.error(chalk.red(error instanceof Error ? error.message : String(error)))
    process.exit(1)
  }
}

export async function listOrchestrations(): Promise<void> {
  try {
    const config = loadOrchestrations()

    console.log(chalk.bold("\nAvailable Orchestrations:"))
    console.log()

    if (!config.orchestrations || Object.keys(config.orchestrations).length === 0) {
      console.log(chalk.dim("  No orchestrations defined yet"))
      console.log()
      console.log(chalk.dim("To add orchestrations, edit ~/.jfl/services.json:"))
      console.log()
      console.log(chalk.dim('  "orchestrations": {'))
      console.log(chalk.dim('    "dev-stack": {'))
      console.log(chalk.dim('      "description": "Start development environment",'))
      console.log(chalk.dim('      "steps": ['))
      console.log(chalk.dim('        {'))
      console.log(chalk.dim('          "type": "sequential",'))
      console.log(chalk.dim('          "services": ["database", "api", "frontend"],'))
      console.log(chalk.dim('          "action": "start",'))
      console.log(chalk.dim('          "waitForHealth": true'))
      console.log(chalk.dim('        }'))
      console.log(chalk.dim('      ]'))
      console.log(chalk.dim('    }'))
      console.log(chalk.dim('  }'))
      console.log()
      return
    }

    Object.entries(config.orchestrations).forEach(([key, orch]) => {
      console.log(chalk.cyan(`  ${key}`))
      console.log(chalk.dim(`    ${orch.description}`))
      console.log(chalk.dim(`    Steps: ${orch.steps.length}`))

      orch.steps.forEach((step, index) => {
        const serviceList = step.services.slice(0, 3).join(", ")
        const more = step.services.length > 3 ? ` +${step.services.length - 3} more` : ""
        console.log(
          chalk.dim(
            `      ${index + 1}. ${step.type} ${step.action}: ${serviceList}${more}`
          )
        )
      })

      console.log()
    })

    console.log(chalk.dim("Commands:"))
    console.log(chalk.dim("  jfl orchestrate <name>          - Run orchestration"))
    console.log(chalk.dim("  jfl orchestrate <name> --dry-run - Preview steps"))
    console.log()
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)))
    process.exit(1)
  }
}

export async function createOrchestration(name: string): Promise<void> {
  const spinner = ora("Creating orchestration template...").start()

  try {
    const config = loadOrchestrations()

    if (!config.orchestrations) {
      config.orchestrations = {}
    }

    if (config.orchestrations[name]) {
      spinner.warn(`Orchestration "${name}" already exists`)
      return
    }

    // Get list of available services
    const services = Object.keys(config.services).slice(0, 3)

    // Create template
    config.orchestrations[name] = {
      description: `Orchestration: ${name}`,
      steps: [
        {
          type: "sequential",
          services: services.length > 0 ? services : ["service1", "service2"],
          action: "start",
          waitForHealth: true,
          timeout: 30000,
          continueOnError: false,
        },
      ],
    }

    // Save config
    fs.writeFileSync(GLOBAL_SERVICES_FILE, JSON.stringify(config, null, 2))

    spinner.succeed(`Created orchestration template: ${name}`)
    console.log()
    console.log(chalk.dim(`Edit ~/.jfl/services.json to customize the orchestration`))
    console.log(chalk.dim(`Then run: jfl orchestrate ${name}`))
    console.log()
  } catch (error) {
    spinner.fail("Failed to create orchestration")
    console.error(chalk.red(error instanceof Error ? error.message : String(error)))
    process.exit(1)
  }
}
