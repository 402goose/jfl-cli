/**
 * Onboard Command
 *
 * Onboard a service repo as a service agent in the GTM ecosystem
 *
 * Usage:
 *   jfl onboard <path|url>
 *   jfl onboard /Users/user/code/myservice
 *   jfl onboard git@github.com:user/repo.git
 *
 * @purpose Onboard services with full agent infrastructure
 */

import chalk from "chalk"
import ora from "ora"
import * as p from "@clack/prompts"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { execSync } from "child_process"
import { join, resolve } from "path"
import { homedir } from "os"
import {
  extractServiceMetadata,
  detectServiceName,
  type ServiceMetadata,
} from "../lib/service-detector.js"
import {
  generateAgentDefinition,
  writeAgentDefinition,
} from "../lib/agent-generator.js"
import { writeSkillFiles } from "../lib/skill-generator.js"

export interface OnboardOptions {
  name?: string
  type?: ServiceMetadata["type"]
  description?: string
  skipGit?: boolean
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
 * Clone git repository to standard location
 */
function cloneRepository(url: string, targetDir?: string): string {
  // Extract repo name from URL
  const match = url.match(/\/([^\/]+?)(\.git)?$/)
  if (!match) {
    throw new Error(`Could not extract repo name from URL: ${url}`)
  }

  const repoName = match[1]

  // Default clone directory
  const cloneDir = targetDir || join(homedir(), "code/formation")

  // Check if repo already exists
  const repoPath = join(cloneDir, repoName)

  if (existsSync(repoPath)) {
    console.log(chalk.yellow(`\n⚠️  Repository already exists at ${repoPath}`))

    // Pull latest
    const spinner = ora("Pulling latest changes...").start()
    try {
      execSync("git pull", { cwd: repoPath, stdio: "pipe" })
      spinner.succeed("Updated to latest")
    } catch (err: any) {
      spinner.fail("Failed to pull (may have uncommitted changes)")
      console.log(chalk.gray("  Continuing with existing repo"))
    }

    return repoPath
  }

  // Clone the repo
  const spinner = ora(`Cloning ${repoName}...`).start()
  try {
    execSync(`git clone ${url} ${repoPath}`, { stdio: "pipe" })
    spinner.succeed(`Cloned to ${repoPath}`)
    return repoPath
  } catch (err: any) {
    spinner.fail("Failed to clone repository")
    throw new Error(`Git clone failed: ${err.message}`)
  }
}

/**
 * Run GTM onboard-service.sh script
 */
function runGTMOnboardScript(
  servicePath: string,
  serviceName: string,
  serviceType: ServiceMetadata["type"],
  description: string,
  gtmPath: string
): void {
  const scriptPath = join(gtmPath, "scripts/services/onboard-service.sh")

  if (!existsSync(scriptPath)) {
    throw new Error(`Onboard script not found: ${scriptPath}`)
  }

  const spinner = ora("Setting up service agent infrastructure...").start()

  try {
    execSync(
      `bash ${scriptPath} "${servicePath}" "${serviceName}" "${serviceType}" "${description}"`,
      {
        cwd: gtmPath,
        stdio: "pipe",
        encoding: "utf-8",
      }
    )
    spinner.succeed("Service agent infrastructure created")
  } catch (err: any) {
    spinner.fail("Failed to run onboard script")
    throw new Error(`Onboard script failed: ${err.stderr || err.message}`)
  }
}

/**
 * Update GTM services.json
 */
function updateServicesJSON(
  metadata: ServiceMetadata,
  servicePath: string,
  gtmPath: string
): void {
  const servicesFile = join(gtmPath, ".jfl/services.json")

  if (!existsSync(servicesFile)) {
    console.log(chalk.yellow("⚠️  services.json not found, skipping"))
    return
  }

  const services = JSON.parse(readFileSync(servicesFile, "utf-8"))

  // Check if service already exists
  if (services[metadata.name]) {
    console.log(chalk.yellow(`  Service ${metadata.name} already in services.json, updating...`))
  }

  // Build service entry
  const serviceEntry: any = {
    name: metadata.name.charAt(0).toUpperCase() + metadata.name.slice(1),
    type: metadata.type === "web" || metadata.type === "api" ? "process" : metadata.type,
    description: metadata.description,
    path: servicePath,
  }

  if (metadata.port) {
    serviceEntry.port = metadata.port
    serviceEntry.detection = `lsof -i :${metadata.port} | grep LISTEN`
  }

  if (metadata.commands) {
    serviceEntry.commands = {}
    if (metadata.commands.start) serviceEntry.commands.start = metadata.commands.start
    if (metadata.commands.stop) serviceEntry.commands.stop = metadata.commands.stop
    if (metadata.commands.logs) serviceEntry.commands.logs = metadata.commands.logs
  }

  if (metadata.healthcheck) {
    serviceEntry.healthcheck = metadata.healthcheck
  }

  // Add to services
  services[metadata.name] = serviceEntry

  // Write back
  writeFileSync(servicesFile, JSON.stringify(services, null, 2) + "\n")

  console.log(chalk.green(`✓ Updated services.json`))
}

/**
 * Update GTM projects.manifest.json
 */
function updateProjectsManifest(
  metadata: ServiceMetadata,
  servicePath: string,
  gtmPath: string
): void {
  const manifestFile = join(gtmPath, ".jfl/projects.manifest.json")

  if (!existsSync(manifestFile)) {
    console.log(chalk.yellow("⚠️  projects.manifest.json not found, skipping"))
    return
  }

  const manifest = JSON.parse(readFileSync(manifestFile, "utf-8"))

  // Check if already exists
  if (manifest.projects && manifest.projects[metadata.name]) {
    // Update agent_enabled flag
    manifest.projects[metadata.name].agent_enabled = true
    console.log(chalk.yellow(`  Service ${metadata.name} already in manifest, enabled agent`))
  } else {
    // Add new entry
    if (!manifest.projects) {
      manifest.projects = {}
    }

    manifest.projects[metadata.name] = {
      type: "service",
      service_type: metadata.type,
      location: servicePath,
      description: metadata.description,
      agent_enabled: true,
    }

    console.log(chalk.green(`✓ Added to projects.manifest.json`))
  }

  // Write back
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n")
}

/**
 * Emit onboard event to service-events.jsonl
 */
function emitOnboardEvent(
  metadata: ServiceMetadata,
  gtmPath: string
): void {
  const eventsFile = join(gtmPath, ".jfl/service-events.jsonl")

  const event = {
    ts: new Date().toISOString(),
    service: metadata.name,
    type: "onboard",
    message: `Service agent onboarded for ${metadata.name}`,
    session: "jfl-cli",
  }

  try {
    const eventLine = JSON.stringify(event) + "\n"

    if (existsSync(eventsFile)) {
      // Append
      const currentContent = readFileSync(eventsFile, "utf-8")
      writeFileSync(eventsFile, currentContent + eventLine)
    } else {
      // Create new
      writeFileSync(eventsFile, eventLine)
    }

    console.log(chalk.green(`✓ Emitted onboard event`))
  } catch (err: any) {
    console.log(chalk.yellow(`⚠️  Failed to emit event: ${err.message}`))
  }
}

/**
 * Main onboard command
 */
export async function onboardCommand(
  pathOrUrl: string,
  options: OnboardOptions = {}
): Promise<void> {
  p.intro(chalk.hex("#FFD700")("┌  JFL - Onboard Service Agent"))

  // Find GTM directory
  const gtmPath = findGTMDirectory()

  if (!gtmPath) {
    p.log.error("Not in a GTM directory")
    p.log.info("Run this command from inside a JFL GTM workspace")
    p.log.info("Or run: jfl init to create a new GTM workspace")
    p.outro(chalk.red("Onboarding failed"))
    return
  }

  console.log(chalk.gray(`GTM Path: ${gtmPath}\n`))

  let servicePath: string

  // Determine if path or URL
  const isGitURL =
    pathOrUrl.startsWith("git@") ||
    pathOrUrl.startsWith("https://") ||
    pathOrUrl.startsWith("http://")

  if (isGitURL && !options.skipGit) {
    // Clone the repository
    console.log(chalk.cyan("📦 Git repository detected"))
    servicePath = cloneRepository(pathOrUrl)
    console.log()
  } else {
    // Resolve local path
    servicePath = resolve(pathOrUrl)

    if (!existsSync(servicePath)) {
      p.log.error(`Path does not exist: ${servicePath}`)
      p.outro(chalk.red("Onboarding failed"))
      return
    }

    console.log(chalk.gray(`Service Path: ${servicePath}\n`))
  }

  // Auto-detect service metadata
  const spinner = ora("Auto-detecting service metadata...").start()

  let metadata: ServiceMetadata

  try {
    metadata = extractServiceMetadata(servicePath)
    spinner.succeed("Service metadata detected")
  } catch (err: any) {
    spinner.fail("Failed to detect metadata")
    throw err
  }

  // Allow overrides
  if (options.name) {
    metadata.name = options.name
  }
  if (options.type) {
    metadata.type = options.type
  }
  if (options.description) {
    metadata.description = options.description
  }

  // Display detected metadata
  p.note(
    `Name:         ${chalk.cyan(metadata.name)}\n` +
    `Type:         ${chalk.cyan(metadata.type)}\n` +
    `Description:  ${chalk.gray(metadata.description)}\n` +
    `Port:         ${metadata.port ? chalk.cyan(metadata.port) : chalk.gray("N/A")}\n` +
    `Version:      ${chalk.gray(metadata.version)}\n` +
    `Dependencies: ${chalk.gray(metadata.dependencies.join(", ") || "None")}`,
    chalk.hex("#00FF88")("📋 Service Metadata")
  )

  // Confirm with user
  const confirmed = await p.confirm({
    message: "Proceed with onboarding?",
    initialValue: true,
  })

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Onboarding cancelled")
    return
  }

  console.log()

  // Step 1: Run GTM onboard-service.sh script
  console.log(chalk.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
  console.log(chalk.cyan("  Step 1: Service Agent Infrastructure"))
  console.log(chalk.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"))

  runGTMOnboardScript(
    servicePath,
    metadata.name,
    metadata.type,
    metadata.description,
    gtmPath
  )

  console.log()

  // Step 2: Generate agent definition
  console.log(chalk.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
  console.log(chalk.cyan("  Step 2: GTM Agent Integration"))
  console.log(chalk.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"))

  const agentDef = generateAgentDefinition(metadata, servicePath, gtmPath)
  const agentFile = writeAgentDefinition(agentDef, gtmPath)
  console.log(chalk.green(`✓ Created agent definition: ${agentFile}`))

  // Step 3: Generate skill wrapper
  const skillDir = writeSkillFiles(metadata, servicePath, gtmPath)
  console.log(chalk.green(`✓ Created skill wrapper: ${skillDir}`))

  // Step 4: Update GTM manifests
  updateServicesJSON(metadata, servicePath, gtmPath)
  updateProjectsManifest(metadata, servicePath, gtmPath)

  // Step 5: Emit event
  emitOnboardEvent(metadata, gtmPath)

  console.log()

  // Success summary
  p.note(
    `Service agent is ready!\n\n` +
    `Now you can:\n` +
    `  • Use @-mentions: ${chalk.cyan(`@${metadata.name} what's your status?`)}\n` +
    `  • Run skill commands: ${chalk.cyan(`/${metadata.name} status`)}\n` +
    `  • Service agent manages its own codebase\n\n` +
    `Files created:\n` +
    `  ${chalk.gray(`${servicePath}/CLAUDE.md`)}\n` +
    `  ${chalk.gray(`${servicePath}/.jfl/`)}\n` +
    `  ${chalk.gray(`${servicePath}/.claude/`)}\n` +
    `  ${chalk.gray(`${servicePath}/knowledge/`)}\n` +
    `  ${chalk.gray(`${gtmPath}/.claude/agents/service-${metadata.name}.md`)}\n` +
    `  ${chalk.gray(`${gtmPath}/.claude/skills/${metadata.name}/`)}\n\n` +
    `Next steps:\n` +
    `  1. Fill in service knowledge docs:\n` +
    `     ${chalk.cyan(`cd ${servicePath}`)}\n` +
    `     ${chalk.gray(`# Edit knowledge/SERVICE_SPEC.md`)}\n` +
    `     ${chalk.gray(`# Edit knowledge/ARCHITECTURE.md`)}\n` +
    `     ${chalk.gray(`# Edit knowledge/DEPLOYMENT.md`)}\n` +
    `     ${chalk.gray(`# Edit knowledge/RUNBOOK.md`)}\n\n` +
    `  2. Test the service agent:\n` +
    `     ${chalk.cyan(`cd ${servicePath}`)}\n` +
    `     ${chalk.cyan(`claude`)}\n` +
    `     ${chalk.gray(`# Should greet you as service agent`)}\n\n` +
    `  3. Test @-mention from GTM:\n` +
    `     ${chalk.cyan(`cd ${gtmPath}`)}\n` +
    `     ${chalk.cyan(`claude`)}\n` +
    `     ${chalk.cyan(`> @${metadata.name} what's your status?`)}`,
    chalk.hex("#00FF88")("✅ Service Onboarded Successfully")
  )

  p.outro(chalk.hex("#FFA500")("Happy shipping! 🚀"))
}
