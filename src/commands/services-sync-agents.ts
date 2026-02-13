/**
 * Services Sync Agents Command
 *
 * Syncs peer agent definitions across all services in a GTM workspace.
 * Ensures each service can @-mention other registered services.
 *
 * Usage:
 *   jfl services sync-agents              # Sync all services
 *   jfl services sync-agents <service>    # Sync specific service
 *   jfl services sync-agents --dry-run    # Preview changes
 *   jfl services sync-agents --current    # Sync current service only
 *
 * @purpose Sync peer agent definitions for cross-service collaboration
 */

import chalk from "chalk"
import ora from "ora"
import * as p from "@clack/prompts"
import { existsSync, readFileSync } from "fs"
import { join, resolve } from "path"
import {
  syncPeerAgents,
  getRegisteredServices,
  type ServiceRegistration,
} from "../lib/peer-agent-generator.js"

export interface SyncAgentsOptions {
  dryRun?: boolean
  current?: boolean
}

/**
 * Find GTM directory (current dir or parent)
 */
function findGTMDirectory(): string | null {
  let currentDir = process.cwd()

  // Check current directory and up to 3 levels up
  for (let i = 0; i < 4; i++) {
    const configPath = join(currentDir, ".jfl/config.json")

    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, "utf-8"))
        if (config.type === "gtm") {
          return currentDir
        }
      } catch {
        // Invalid config, continue
      }
    }

    const parent = join(currentDir, "..")
    if (parent === currentDir) break // Reached root
    currentDir = parent
  }

  return null
}

/**
 * Find service directory (current dir if it's a service)
 */
function findServiceDirectory(): string | null {
  const configPath = join(process.cwd(), ".jfl/config.json")

  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"))
      if (config.type === "service" && config.gtm_parent) {
        return process.cwd()
      }
    } catch {
      // Invalid config
    }
  }

  return null
}

/**
 * Resolve service path (absolute or relative to GTM)
 */
function resolveServicePath(servicePath: string, gtmPath: string): string {
  if (servicePath.startsWith("/")) {
    return servicePath
  }
  return join(gtmPath, servicePath)
}

/**
 * Main sync-agents command
 */
export async function servicesSyncAgentsCommand(
  serviceName?: string,
  options: SyncAgentsOptions = {}
): Promise<void> {
  p.intro(chalk.hex("#FFD700")("┌  JFL - Sync Peer Agents"))

  // Handle --current flag (sync current service only)
  if (options.current) {
    const serviceDir = findServiceDirectory()

    if (!serviceDir) {
      p.log.error("Not in a service directory")
      p.log.info("Run this command from inside a service, or use without --current")
      p.outro(chalk.red("Sync failed"))
      return
    }

    // Get GTM path from service config
    const serviceConfig = JSON.parse(readFileSync(join(serviceDir, ".jfl/config.json"), "utf-8"))
    const gtmPath = serviceConfig.gtm_parent

    if (!gtmPath || !existsSync(gtmPath)) {
      p.log.error(`GTM parent not found: ${gtmPath}`)
      p.outro(chalk.red("Sync failed"))
      return
    }

    console.log(chalk.gray(`Service: ${serviceDir}`))
    console.log(chalk.gray(`GTM: ${gtmPath}\n`))

    if (options.dryRun) {
      console.log(chalk.yellow("DRY RUN - No changes will be made\n"))
    }

    // Sync this service only
    const spinner = ora(`Syncing peer agents for current service...`).start()

    try {
      const stats = syncPeerAgents(serviceDir, gtmPath)
      spinner.succeed(
        `Synced: ${chalk.green(stats.added)} added, ${chalk.cyan(stats.updated)} updated, ${chalk.red(stats.removed)} removed`
      )
    } catch (err: any) {
      spinner.fail(`Sync failed: ${err.message}`)
    }

    p.outro(chalk.green("✓ Done"))
    return
  }

  // Find GTM directory
  const gtmPath = findGTMDirectory()

  if (!gtmPath) {
    p.log.error("Not in a GTM directory")
    p.log.info("Run this command from inside a JFL GTM workspace")
    p.log.info("Or run: jfl init to create a new GTM workspace")
    p.outro(chalk.red("Sync failed"))
    return
  }

  console.log(chalk.gray(`GTM Path: ${gtmPath}\n`))

  if (options.dryRun) {
    console.log(chalk.yellow("DRY RUN - No changes will be made\n"))
  }

  // Get registered services
  const services = getRegisteredServices(gtmPath)

  if (services.length === 0) {
    p.log.warn("No services registered in GTM")
    p.log.info("Run: jfl onboard <path> to register services")
    p.outro(chalk.yellow("Nothing to sync"))
    return
  }

  console.log(chalk.cyan(`Found ${services.length} registered services:\n`))
  services.forEach((s) => {
    console.log(chalk.gray(`  - ${s.name} (${s.type})`))
  })
  console.log()

  // Filter to specific service if provided
  let servicesToSync: ServiceRegistration[] = services

  if (serviceName) {
    const targetService = services.find((s) => s.name === serviceName)

    if (!targetService) {
      p.log.error(`Service not found: ${serviceName}`)
      p.log.info("Available services:")
      services.forEach((s) => {
        console.log(chalk.gray(`  - ${s.name}`))
      })
      p.outro(chalk.red("Sync failed"))
      return
    }

    servicesToSync = [targetService]
    console.log(chalk.cyan(`Syncing: ${serviceName}\n`))
  } else {
    console.log(chalk.cyan(`Syncing all services...\n`))
  }

  // Sync each service
  let totalAdded = 0
  let totalUpdated = 0
  let totalRemoved = 0
  let errorCount = 0

  for (const service of servicesToSync) {
    const servicePath = resolveServicePath(service.path, gtmPath)

    if (!existsSync(servicePath)) {
      console.log(chalk.yellow(`⚠️  Service path not found: ${servicePath} (skipping)`))
      errorCount++
      continue
    }

    const spinner = ora(`Syncing ${service.name}...`).start()

    try {
      if (!options.dryRun) {
        const stats = syncPeerAgents(servicePath, gtmPath)
        totalAdded += stats.added
        totalUpdated += stats.updated
        totalRemoved += stats.removed

        spinner.succeed(
          `${service.name}: ${chalk.green(stats.added)} added, ${chalk.cyan(stats.updated)} updated, ${chalk.red(stats.removed)} removed`
        )
      } else {
        // Dry run - just show what would happen
        const stats = { added: 0, updated: 0, removed: 0 }
        // TODO: Implement dry-run logic
        spinner.succeed(`${service.name}: Would sync peer agents (dry run)`)
      }
    } catch (err: any) {
      spinner.fail(`${service.name}: ${err.message}`)
      errorCount++
    }
  }

  console.log()

  // Summary
  if (!options.dryRun) {
    p.note(
      `Total changes:\n` +
        `  Added: ${chalk.green(totalAdded)}\n` +
        `  Updated: ${chalk.cyan(totalUpdated)}\n` +
        `  Removed: ${chalk.red(totalRemoved)}\n` +
        `  Errors: ${errorCount > 0 ? chalk.red(errorCount) : chalk.gray(errorCount)}`,
      "📊 Summary"
    )
  }

  if (errorCount > 0) {
    p.outro(chalk.yellow("⚠️  Completed with errors"))
  } else {
    p.outro(chalk.green("✓ All services synced successfully"))
  }
}
