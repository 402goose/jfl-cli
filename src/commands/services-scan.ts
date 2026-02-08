/**
 * Services Auto-Discovery
 *
 * Automatically discovers services in a project and registers them.
 * Scans for package.json, detects type, port, and configuration.
 *
 * @purpose Zero-config service discovery for GTM projects
 */

import chalk from "chalk"
import ora from "ora"
import * as fs from "fs"
import * as path from "path"
import { homedir } from "os"
import { execSync } from "child_process"

const GLOBAL_SERVICES_FILE = path.join(homedir(), ".jfl", "services.json")

// ============================================================================
// Types
// ============================================================================

interface PackageJson {
  name?: string
  version?: string
  description?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface ServiceConfig {
  name: string
  type: "server" | "api" | "web" | "worker" | "daemon" | "cli"
  description: string
  port?: number
  start_command: string
  stop_command: string
  detection_command: string
  pid_file?: string
  log_file?: string
  health_url?: string
  path: string
  mcp?: {
    enabled: boolean
    tools?: any[]
  }
}

interface ServicesConfig {
  version: string
  services: Record<string, ServiceConfig>
}

// ============================================================================
// Service Detection
// ============================================================================

function findServiceDirectories(rootPath: string, maxDepth: number = 3): string[] {
  const services: string[] = []

  function scan(dir: string, depth: number) {
    if (depth > maxDepth) return

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        // Skip common non-service directories
        if (entry.name.startsWith('.') ||
            entry.name === 'node_modules' ||
            entry.name === 'dist' ||
            entry.name === 'build' ||
            entry.name === 'out' ||
            entry.name === '__pycache__') {
          continue
        }

        const fullPath = path.join(dir, entry.name)

        // Check if this is a service (has package.json or Dockerfile)
        const hasPackageJson = fs.existsSync(path.join(fullPath, 'package.json'))
        const hasDockerfile = fs.existsSync(path.join(fullPath, 'Dockerfile'))

        if (hasPackageJson || hasDockerfile) {
          services.push(fullPath)
        } else {
          // Continue scanning subdirectories
          scan(fullPath, depth + 1)
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  scan(rootPath, 0)
  return services
}

function detectServiceConfig(servicePath: string): ServiceConfig | null {
  const packageJsonPath = path.join(servicePath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return null
  }

  try {
    const packageJson: PackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

    const serviceName = packageJson.name || path.basename(servicePath)
    const description = packageJson.description || `Service: ${serviceName}`

    // Detect type
    let type: ServiceConfig['type'] = 'server'
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }

    if (deps['next'] || deps['@remix-run/react']) {
      type = 'web'
    } else if (deps['express'] || deps['fastify'] || deps['koa']) {
      type = 'api'
    } else if (deps['bull'] || deps['agenda'] || serviceName.includes('worker')) {
      type = 'worker'
    } else if (serviceName.includes('cli')) {
      type = 'cli'
    }

    // Detect port
    let port: number | undefined
    const envPath = path.join(servicePath, '.env')
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8')
      const portMatch = envContent.match(/PORT=(\d+)/)
      if (portMatch) {
        port = parseInt(portMatch[1], 10)
      }
    }

    // Default ports by type
    if (!port) {
      switch (type) {
        case 'web':
          port = 3000
          break
        case 'api':
          port = 4000
          break
      }
    }

    // Detect start command
    let startCommand = `cd ${servicePath} && npm start`
    if (packageJson.scripts?.dev) {
      startCommand = `cd ${servicePath} && npm run dev`
    } else if (packageJson.scripts?.start) {
      startCommand = `cd ${servicePath} && npm start`
    }

    // Stop command
    const stopCommand = port
      ? `lsof -ti:${port} -sTCP:LISTEN | xargs kill -9 2>/dev/null || true`
      : `pkill -f "${serviceName}"`

    // Detection command
    const detectionCommand = port
      ? `lsof -ti:${port} -sTCP:LISTEN`
      : `pgrep -f "${serviceName}"`

    // Health URL
    const healthUrl = port ? `http://localhost:${port}/health` : undefined

    return {
      name: serviceName,
      type,
      description,
      port,
      start_command: startCommand,
      stop_command: stopCommand,
      detection_command: detectionCommand,
      pid_file: `\${HOME}/.jfl/service-manager/pids/${serviceName}.pid`,
      log_file: `\${HOME}/.jfl/service-manager/logs/${serviceName}.log`,
      health_url: healthUrl,
      path: servicePath,
      mcp: {
        enabled: true,
        tools: []
      }
    }
  } catch (error) {
    console.error(chalk.yellow(`Failed to parse package.json in ${servicePath}`))
    return null
  }
}

// ============================================================================
// Services Config Management
// ============================================================================

function loadServicesConfig(): ServicesConfig {
  if (!fs.existsSync(GLOBAL_SERVICES_FILE)) {
    return { version: "1.0", services: {} }
  }

  const content = fs.readFileSync(GLOBAL_SERVICES_FILE, 'utf-8')
  return JSON.parse(content)
}

function saveServicesConfig(config: ServicesConfig): void {
  const dir = path.dirname(GLOBAL_SERVICES_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(GLOBAL_SERVICES_FILE, JSON.stringify(config, null, 2))
}

// ============================================================================
// Main Command
// ============================================================================

export async function scanServices(options: { path?: string; dryRun?: boolean } = {}): Promise<void> {
  const scanPath = options.path || process.cwd()
  const spinner = ora(`Scanning for services in ${scanPath}...`).start()

  try {
    // Find all service directories
    const serviceDirs = findServiceDirectories(scanPath)

    if (serviceDirs.length === 0) {
      spinner.info("No services found")
      console.log(chalk.dim("\nLooking for directories with package.json or Dockerfile"))
      console.log(chalk.dim(`Scanned: ${scanPath}`))
      return
    }

    spinner.text = `Found ${serviceDirs.length} potential service(s), detecting configuration...`

    // Detect configuration for each service
    const services: ServiceConfig[] = []
    for (const dir of serviceDirs) {
      const config = detectServiceConfig(dir)
      if (config) {
        services.push(config)
      }
    }

    if (services.length === 0) {
      spinner.warn("No services could be configured")
      return
    }

    spinner.succeed(`Discovered ${services.length} service(s)`)

    // Display discovered services
    console.log()
    console.log(chalk.bold("Discovered Services:"))
    console.log()

    for (const service of services) {
      console.log(chalk.green(`✓ ${service.name}`))
      console.log(chalk.dim(`  Type: ${service.type}`))
      if (service.port) {
        console.log(chalk.dim(`  Port: ${service.port}`))
      }
      console.log(chalk.dim(`  Path: ${service.path}`))
      console.log(chalk.dim(`  Start: ${service.start_command}`))
      console.log()
    }

    // Dry run check
    if (options.dryRun) {
      console.log(chalk.yellow("Dry run - no changes made"))
      console.log(chalk.dim("Run without --dry-run to register these services"))
      return
    }

    // Load existing config
    const config = loadServicesConfig()

    // Add/update services
    let added = 0
    let updated = 0

    for (const service of services) {
      if (config.services[service.name]) {
        // Update existing
        config.services[service.name] = {
          ...config.services[service.name],
          ...service,
          name: service.name
        }
        updated++
      } else {
        // Add new
        config.services[service.name] = {
          ...service,
          name: service.name
        }
        added++
      }
    }

    // Save config
    saveServicesConfig(config)

    console.log(chalk.green(`\n✓ Registered services to ${GLOBAL_SERVICES_FILE}`))
    console.log(chalk.dim(`  Added: ${added}`))
    console.log(chalk.dim(`  Updated: ${updated}`))
    console.log()
    console.log(chalk.bold("Next steps:"))
    console.log(chalk.dim("1. Start Service Manager: jfl service-manager start"))
    console.log(chalk.dim("2. View services: jfl services list"))
    console.log(chalk.dim("3. Start a service: jfl services start <name>"))
    console.log()

  } catch (error) {
    spinner.fail("Failed to scan services")
    console.error(chalk.red(error instanceof Error ? error.message : String(error)))
    process.exit(1)
  }
}
