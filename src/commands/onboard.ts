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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { execSync } from "child_process"
import { join, resolve, basename } from "path"
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
import { syncPeerAgents, getRegisteredServices } from "../lib/peer-agent-generator.js"
import type { ServiceConfig, GTMConfig } from "../lib/service-gtm.js"

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
async function cloneRepository(url: string, targetDir?: string): Promise<string> {
  // Extract repo name from URL
  const match = url.match(/\/([^\/]+?)(\.git)?$/)
  if (!match) {
    throw new Error(`Could not extract repo name from URL: ${url}`)
  }

  const repoName = match[1]

  // Default clone directory - use user's code directory preference
  let cloneDir: string
  if (targetDir) {
    cloneDir = targetDir
  } else {
    const { getCodeDirectory } = await import("../utils/jfl-config.js")
    const codeDir = await getCodeDirectory()
    cloneDir = join(codeDir, "repos")
  }

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
 * Run GTM onboard-service.sh script (optional - continue if it fails)
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
    console.log(chalk.yellow("⚠️  GTM onboard script not found, skipping"))
    return
  }

  console.log(chalk.cyan("Setting up service agent infrastructure..."))

  try {
    execSync(
      `bash ${scriptPath} "${servicePath}" "${serviceName}" "${serviceType}" "${description}"`,
      {
        cwd: gtmPath,
        stdio: "inherit",
      }
    )
    console.log(chalk.green("✓ Service agent infrastructure created"))
  } catch (err: any) {
    console.log(chalk.yellow("⚠️  GTM onboard script failed (Service Manager may not be running)"))
    console.log(chalk.gray("   Continuing with basic setup..."))
    // Don't throw - continue with our own setup
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
 * Create basic service directory structure
 */
function createServiceStructure(
  servicePath: string,
  serviceName: string
): void {
  // Create .jfl directory
  const jflDir = join(servicePath, ".jfl")
  mkdirSync(join(jflDir, "journal"), { recursive: true })
  mkdirSync(join(jflDir, "logs"), { recursive: true })

  // Create .claude directory
  const claudeDir = join(servicePath, ".claude")
  mkdirSync(join(claudeDir, "skills"), { recursive: true })
  mkdirSync(join(claudeDir, "agents"), { recursive: true })

  // Create knowledge directory
  mkdirSync(join(servicePath, "knowledge"), { recursive: true })

  console.log(chalk.green("✓ Created service directory structure"))
}

/**
 * Set up service-GTM link
 */
function setupServiceGTMLink(
  servicePath: string,
  serviceName: string,
  serviceType: ServiceMetadata["type"],
  description: string,
  gtmPath: string,
  workingBranch: string,
  metadata?: ServiceMetadata
): void {
  // 1. Create/update service's .jfl/config.json
  const serviceJflDir = join(servicePath, ".jfl")
  mkdirSync(serviceJflDir, { recursive: true })

  const serviceConfigPath = join(serviceJflDir, "config.json")
  let serviceConfig: ServiceConfig

  if (existsSync(serviceConfigPath)) {
    serviceConfig = JSON.parse(readFileSync(serviceConfigPath, "utf-8"))
  } else {
    serviceConfig = {
      name: serviceName,
      type: "service",
      description,
    }
  }

  // Set service-specific fields
  serviceConfig.type = "service"
  serviceConfig.service_type = serviceType
  serviceConfig.gtm_parent = gtmPath
  serviceConfig.working_branch = workingBranch
  serviceConfig.sync_to_parent = {
    journal: true,
    knowledge: false,
    content: false,
  }

  // Add environments config with detected commands
  if (metadata) {
    serviceConfig.environments = {
      development: {
        code_path: servicePath,
        start_command: metadata.commands?.start || "echo 'No start command configured'",
        port: metadata.port || null,
        env: { NODE_ENV: "development" },
        health_check: metadata.healthcheck ? {
          enabled: true,
          url: metadata.healthcheck,
          interval: 30000,
          timeout: 5000
        } : null
      }
    }
  }

  writeFileSync(serviceConfigPath, JSON.stringify(serviceConfig, null, 2) + "\n")
  console.log(chalk.green(`✓ Created service config at ${servicePath}/.jfl/config.json`))

  // 2. Update GTM's .jfl/config.json to register this service
  const gtmConfigPath = join(gtmPath, ".jfl", "config.json")

  if (existsSync(gtmConfigPath)) {
    const gtmConfig: GTMConfig = JSON.parse(readFileSync(gtmConfigPath, "utf-8"))

    // Initialize registered_services if needed
    if (!gtmConfig.registered_services) {
      gtmConfig.registered_services = []
    }

    // Check if already registered
    const existing = gtmConfig.registered_services.find((s) => s.name === serviceName)

    if (existing) {
      // Update existing
      existing.status = "active"
      existing.type = serviceType
    } else {
      // Add new
      const relativePath = resolve(servicePath).replace(resolve(gtmPath) + "/", "")
      gtmConfig.registered_services.push({
        name: serviceName,
        path: relativePath,
        type: serviceType,
        registered_at: new Date().toISOString(),
        status: "active",
      })
    }

    writeFileSync(gtmConfigPath, JSON.stringify(gtmConfig, null, 2) + "\n")
    console.log(chalk.green(`✓ Registered service in GTM config`))
  }
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
    servicePath = await cloneRepository(pathOrUrl)
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

  // Auto-detect service metadata (but will ask user to confirm/override)
  const spinner = ora("Auto-detecting service metadata...").start()

  let detectedMetadata: ServiceMetadata

  try {
    detectedMetadata = extractServiceMetadata(servicePath)
    spinner.succeed("Service metadata detected")
  } catch (err: any) {
    spinner.fail("Auto-detection failed, will ask for details")
    // Create empty metadata
    detectedMetadata = {
      name: basename(servicePath),
      type: "api",
      description: "",
      version: "0.1.0",
      dependencies: [],
      commands: {},
      port: null
    }
  }

  console.log()
  p.note(
    `Auto-detected:\n` +
    `  Name: ${chalk.cyan(detectedMetadata.name)}\n` +
    `  Type: ${chalk.cyan(detectedMetadata.type)}\n` +
    `  Description: ${chalk.gray(detectedMetadata.description || "N/A")}\n` +
    `  Port: ${detectedMetadata.port ? chalk.cyan(detectedMetadata.port) : chalk.gray("N/A")}`,
    "🔍 Detection Results"
  )

  console.log(chalk.cyan("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
  console.log(chalk.cyan("  Service Configuration Wizard"))
  console.log(chalk.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"))

  // Interactive wizard
  const serviceName = options.name || await p.text({
    message: "Service name?",
    placeholder: detectedMetadata.name,
    initialValue: detectedMetadata.name,
    validate: (value) => {
      if (!value) return "Service name is required"
      if (!/^[a-z0-9-]+$/.test(value)) return "Use lowercase, numbers, and hyphens only"
      return undefined
    }
  })

  if (p.isCancel(serviceName)) {
    p.cancel("Onboarding cancelled")
    return
  }

  const serviceType = options.type || await p.select({
    message: "Service type?",
    options: [
      { value: "api", label: "API - REST/GraphQL service", hint: detectedMetadata.type === "api" ? "detected" : "" },
      { value: "web", label: "Web - Frontend application", hint: detectedMetadata.type === "web" ? "detected" : "" },
      { value: "worker", label: "Worker - Background jobs/queue", hint: detectedMetadata.type === "worker" ? "detected" : "" },
      { value: "cli", label: "CLI - Command-line tool", hint: detectedMetadata.type === "cli" ? "detected" : "" },
      { value: "library", label: "Library - Plugin, package, or shared code", hint: detectedMetadata.type === "library" ? "detected" : "" },
      { value: "infrastructure", label: "Infrastructure - Database, cache, etc.", hint: detectedMetadata.type === "infrastructure" ? "detected" : "" },
      { value: "container", label: "Container - Docker service", hint: detectedMetadata.type === "container" ? "detected" : "" },
    ],
    initialValue: detectedMetadata.type
  }) as ServiceMetadata["type"]

  if (p.isCancel(serviceType)) {
    p.cancel("Onboarding cancelled")
    return
  }

  const description = options.description || await p.text({
    message: "Service description?",
    placeholder: detectedMetadata.description || "What does this service do?",
    initialValue: detectedMetadata.description,
    validate: (value) => {
      if (!value) return "Description is required"
      return undefined
    }
  })

  if (p.isCancel(description)) {
    p.cancel("Onboarding cancelled")
    return
  }

  const hasPort = await p.confirm({
    message: "Does this service expose a port?",
    initialValue: !!detectedMetadata.port
  })

  if (p.isCancel(hasPort)) {
    p.cancel("Onboarding cancelled")
    return
  }

  let port: number | undefined
  if (hasPort) {
    const portInput = await p.text({
      message: "Port number?",
      placeholder: detectedMetadata.port?.toString() || "3000",
      initialValue: detectedMetadata.port?.toString() || "",
      validate: (value) => {
        const num = parseInt(value, 10)
        if (isNaN(num) || num < 1 || num > 65535) return "Enter a valid port (1-65535)"
        return undefined
      }
    })

    if (p.isCancel(portInput)) {
      p.cancel("Onboarding cancelled")
      return
    }

    port = parseInt(portInput as string, 10)
  }

  // If no start command detected, prompt user (skip for library types)
  if (!detectedMetadata.commands?.start && serviceType !== "library") {
    console.log()
    p.note(
      `Could not auto-detect start command.\n\n` +
      `Examples:\n` +
      `  • npm run dev\n` +
      `  • yarn start\n` +
      `  • make run\n` +
      `  • docker-compose up\n` +
      `  • python manage.py runserver\n` +
      `  • go run main.go\n` +
      `  • mint dev`,
      "⚠️  Manual Input Required"
    )

    const startCommand = await p.text({
      message: "How do you start this service in development?",
      placeholder: "npm run dev",
      validate: (value) => {
        if (!value) return "Start command is required"
        return undefined
      }
    })

    if (p.isCancel(startCommand)) {
      p.cancel("Onboarding cancelled")
      return
    }

    detectedMetadata.commands = { ...detectedMetadata.commands, start: startCommand as string }
    console.log(chalk.green(`✓ Using: ${startCommand}`))
  } else if (serviceType === "library" && !detectedMetadata.commands?.start) {
    // For libraries, start command is optional - use build if available, otherwise skip
    console.log(chalk.gray("ℹ  Libraries don't require a start command (not standalone services)"))
  }

  const enableMCP = await p.confirm({
    message: "Enable MCP (Model Context Protocol) for AI agent coordination?",
    initialValue: false
  })

  if (p.isCancel(enableMCP)) {
    p.cancel("Onboarding cancelled")
    return
  }

  // Ask for working branch
  const workingBranch = await p.text({
    message: "Working branch? (session branches will be created from this)",
    placeholder: "main",
    initialValue: "main",
    validate: (value) => {
      if (!value) return "Working branch is required"
      if (!/^[a-zA-Z0-9/_-]+$/.test(value)) return "Invalid branch name"
      return undefined
    }
  })

  if (p.isCancel(workingBranch)) {
    p.cancel("Onboarding cancelled")
    return
  }

  // Build final metadata
  const metadata: ServiceMetadata = {
    name: serviceName as string,
    type: serviceType,
    description: description as string,
    version: detectedMetadata.version,
    dependencies: detectedMetadata.dependencies,
    commands: detectedMetadata.commands,
    port: port || null
  }

  console.log()
  p.note(
    `Name:           ${chalk.cyan(metadata.name)}\n` +
    `Type:           ${chalk.cyan(metadata.type)}\n` +
    `Description:    ${chalk.gray(metadata.description)}\n` +
    `Port:           ${metadata.port ? chalk.cyan(metadata.port) : chalk.gray("None")}\n` +
    `Working Branch: ${chalk.cyan(workingBranch as string)}\n` +
    `MCP:            ${enableMCP ? chalk.green("Enabled") : chalk.gray("Disabled")}\n` +
    `Version:        ${chalk.gray(metadata.version)}`,
    chalk.hex("#00FF88")("📋 Final Configuration")
  )

  const confirmed = await p.confirm({
    message: "Proceed with onboarding?",
    initialValue: true,
  })

  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Onboarding cancelled")
    return
  }

  // Write service.json with MCP config if enabled
  if (enableMCP) {
    const serviceJsonPath = join(servicePath, "service.json")
    const serviceJson = {
      name: metadata.name,
      version: metadata.version,
      type: metadata.type,
      description: metadata.description,
      mcp: {
        enabled: true,
        transport: "stdio",
        capabilities: {
          tools: true,
          resources: true
        }
      }
    }

    if (existsSync(serviceJsonPath)) {
      const existing = JSON.parse(readFileSync(serviceJsonPath, "utf-8"))
      Object.assign(existing, serviceJson)
      writeFileSync(serviceJsonPath, JSON.stringify(existing, null, 2) + "\n")
    } else {
      writeFileSync(serviceJsonPath, JSON.stringify(serviceJson, null, 2) + "\n")
    }

    console.log(chalk.green("✓ Created service.json with MCP config"))
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

  // Ensure basic service structure exists (in case script failed)
  createServiceStructure(servicePath, metadata.name)

  // Set up service-GTM link (for sync)
  setupServiceGTMLink(
    servicePath,
    metadata.name,
    metadata.type,
    metadata.description,
    gtmPath,
    workingBranch as string,
    metadata
  )

  console.log()

  // Step 2: Generate agent definition
  console.log(chalk.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
  console.log(chalk.cyan("  Step 2: GTM Agent Integration"))
  console.log(chalk.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"))

  const agentDef = generateAgentDefinition(metadata, servicePath, gtmPath)
  const agentFile = writeAgentDefinition(agentDef, gtmPath)
  console.log(chalk.green(`✓ Created agent definition: ${agentFile}`))

  // Step 2.5: Sync peer agents
  console.log(chalk.cyan("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
  console.log(chalk.cyan("  Peer Agent Synchronization"))
  console.log(chalk.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"))

  try {
    // Sync peer agents for this new service
    const peerSyncResult = syncPeerAgents(servicePath, gtmPath)
    console.log(
      chalk.green(
        `✓ Synced ${peerSyncResult.added} peer agent(s) to this service`
      )
    )

    // Also sync TO other services (add this new service as a peer)
    const registeredServices = getRegisteredServices(gtmPath)
    let peersUpdated = 0

    for (const peer of registeredServices) {
      if (peer.name !== metadata.name) {
        const peerPath = resolve(peer.path.startsWith("/") ? peer.path : join(gtmPath, peer.path))

        if (existsSync(peerPath)) {
          try {
            const peerResult = syncPeerAgents(peerPath, gtmPath)
            if (peerResult.added > 0 || peerResult.updated > 0) {
              peersUpdated++
            }
          } catch (err: any) {
            // Non-fatal - peer sync can fail if peer service isn't fully set up
            console.log(chalk.yellow(`⚠️  Could not sync to peer ${peer.name}: ${err.message}`))
          }
        }
      }
    }

    if (peersUpdated > 0) {
      console.log(chalk.green(`✓ Updated ${peersUpdated} peer service(s) with this service`))
    }
  } catch (error: any) {
    console.log(chalk.yellow(`⚠️  Peer sync failed: ${error.message}`))
    console.log(chalk.gray("   Run 'jfl services sync-agents' later to sync peer agents"))
  }

  console.log()

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
