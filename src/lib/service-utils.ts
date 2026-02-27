/**
 * Service Management Utilities
 *
 * Shared utilities for service lifecycle management across commands.
 * Provides version tracking, health checks, and restart logic.
 *
 * @purpose Shared service management utilities for update flow
 */

import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"
import chalk from "chalk"
import ora, { Ora } from "ora"
import { JFL_PATHS } from "../utils/jfl-paths.js"
import { getProjectPort } from "../utils/context-hub-port.js"

// ============================================================================
// Types
// ============================================================================

export interface RestartOpts {
  stopCommand: string
  startCommand: string
  healthCheck?: string
  timeout?: number
  promptMultipleSessions?: () => Promise<boolean>
}

export interface ServiceHealth {
  healthy: boolean
  message: string
  port?: number
}

export interface CliVersionInfo {
  version: string
  updated_at: string
  services: {
    [serviceName: string]: {
      version: string
      port?: number
    }
  }
}

// ============================================================================
// Version Tracking
// ============================================================================

const CLI_VERSION_FILE = path.join(JFL_PATHS.data, "cli-version.json")

/**
 * Get current CLI version from package.json
 */
export function getCurrentCliVersion(): string {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../package.json"), "utf-8")
    )
    return packageJson.version
  } catch {
    return "0.0.0"
  }
}

/**
 * Read stored CLI version info
 */
export function readCliVersion(): CliVersionInfo | null {
  if (!fs.existsSync(CLI_VERSION_FILE)) {
    return null
  }

  try {
    const content = fs.readFileSync(CLI_VERSION_FILE, "utf-8")
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Write CLI version info
 */
export function writeCliVersion(version: string, services?: Record<string, { version: string; port?: number }>): void {
  const dir = path.dirname(CLI_VERSION_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const versionInfo: CliVersionInfo = {
    version,
    updated_at: new Date().toISOString(),
    services: services || {
      "context-hub": { version, port: getProjectPort() },
      "service-manager": { version, port: 3402 }
    }
  }

  fs.writeFileSync(CLI_VERSION_FILE, JSON.stringify(versionInfo, null, 2))
}

/**
 * Detect if services have changed (CLI version bump)
 */
export async function detectServiceChanges(): Promise<{ changed: boolean; oldVersion?: string; newVersion: string }> {
  const currentVersion = getCurrentCliVersion()
  const storedInfo = readCliVersion()

  if (!storedInfo) {
    // First time - no stored version yet
    return { changed: false, newVersion: currentVersion }
  }

  const changed = storedInfo.version !== currentVersion

  return {
    changed,
    oldVersion: storedInfo.version,
    newVersion: currentVersion
  }
}

// ============================================================================
// Service Health Checks
// ============================================================================

/**
 * Check if a service is running via health endpoint
 */
export async function waitForHealthy(url: string, timeout: number = 5000): Promise<boolean> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 2000)

      const response = await fetch(url, {
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        return true
      }
    } catch {
      // Health check failed, retry
    }

    // Wait 500ms before retry
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  return false
}

/**
 * Check if a service is running via PID file
 */
export function isServiceRunningViaPid(pidFile: string): { running: boolean; pid?: number } {
  if (!fs.existsSync(pidFile)) {
    return { running: false }
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10)
    process.kill(pid, 0) // Check if process exists
    return { running: true, pid }
  } catch {
    // Process doesn't exist, clean up stale PID file
    try {
      fs.unlinkSync(pidFile)
    } catch {
      // Ignore cleanup errors
    }
    return { running: false }
  }
}

/**
 * Check health of a service
 */
export async function checkServiceHealth(
  serviceName: string,
  healthUrl?: string,
  pidFile?: string
): Promise<ServiceHealth> {
  // If health URL provided, check that
  if (healthUrl) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)

      const response = await fetch(healthUrl, {
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        const data: any = await response.json().catch(() => ({}))
        return {
          healthy: true,
          message: `${serviceName} is healthy`,
          port: data.port
        }
      }

      return {
        healthy: false,
        message: `${serviceName} health check failed: HTTP ${response.status}`
      }
    } catch (err: any) {
      return {
        healthy: false,
        message: `${serviceName} health check failed: ${err.message}`
      }
    }
  }

  // Fallback to PID file check
  if (pidFile) {
    const status = isServiceRunningViaPid(pidFile)
    return {
      healthy: status.running,
      message: status.running
        ? `${serviceName} is running (PID: ${status.pid})`
        : `${serviceName} is not running`
    }
  }

  return {
    healthy: false,
    message: `Cannot determine health for ${serviceName} (no health URL or PID file)`
  }
}

// ============================================================================
// Service Control
// ============================================================================

/**
 * Wait for a service to stop
 */
async function waitForStop(pidFile: string, timeout: number): Promise<boolean> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    if (!fs.existsSync(pidFile)) {
      return true
    }

    try {
      const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10)
      process.kill(pid, 0) // Check if process exists
    } catch {
      // Process is gone
      return true
    }

    await new Promise(resolve => setTimeout(resolve, 200))
  }

  return false
}

/**
 * Execute a command silently
 */
function execSilent(command: string): { success: boolean; error?: string } {
  try {
    execSync(command, { stdio: "pipe" })
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

/**
 * Restart a service with health validation
 */
export async function restartService(
  serviceName: string,
  opts: RestartOpts
): Promise<{ success: boolean; message: string }> {
  const spinner = ora(`Restarting ${serviceName}...`).start()

  try {
    // 1. Stop the service
    const stopResult = execSilent(opts.stopCommand)

    if (stopResult.success) {
      spinner.text = `${serviceName} stopped, starting...`
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // 2. Start the service
    const startResult = execSilent(opts.startCommand)

    if (!startResult.success) {
      spinner.fail(`${serviceName} failed to start`)
      return {
        success: false,
        message: `Failed to start: ${startResult.error}`
      }
    }

    // 3. Wait a moment for startup
    await new Promise(resolve => setTimeout(resolve, 800))

    // 4. Health check if URL provided
    if (opts.healthCheck) {
      spinner.text = `Checking ${serviceName} health...`
      const healthy = await waitForHealthy(opts.healthCheck, opts.timeout || 5000)

      if (healthy) {
        spinner.succeed(`${serviceName} restarted`)
        return { success: true, message: "Service restarted and healthy" }
      } else {
        spinner.warn(`${serviceName} started but health check failed`)
        return {
          success: false,
          message: "Service started but not responding to health checks"
        }
      }
    }

    spinner.succeed(`${serviceName} restarted`)
    return { success: true, message: "Service restarted" }

  } catch (error: any) {
    spinner.fail(`${serviceName} restart failed`)
    return {
      success: false,
      message: error.message
    }
  }
}

/**
 * Ensure a service is running (start if not, validate if running)
 */
export async function ensureServiceRunning(
  serviceName: string,
  startCommand: string,
  healthCheck?: string,
  pidFile?: string
): Promise<{ success: boolean; message: string }> {
  // Check if already running
  if (pidFile) {
    const status = isServiceRunningViaPid(pidFile)
    if (status.running && healthCheck) {
      // Verify health
      const healthy = await waitForHealthy(healthCheck, 2000)
      if (healthy) {
        return { success: true, message: `${serviceName} already running` }
      }
      // Process exists but not healthy - fall through to restart
    } else if (status.running) {
      return { success: true, message: `${serviceName} already running` }
    }
  }

  // Start the service
  const result = execSilent(startCommand)

  if (!result.success) {
    return {
      success: false,
      message: `Failed to start: ${result.error}`
    }
  }

  // Wait for startup
  await new Promise(resolve => setTimeout(resolve, 800))

  // Validate health if URL provided
  if (healthCheck) {
    const healthy = await waitForHealthy(healthCheck, 5000)
    if (healthy) {
      return { success: true, message: `${serviceName} started successfully` }
    } else {
      return {
        success: false,
        message: `${serviceName} started but health check failed`
      }
    }
  }

  return { success: true, message: `${serviceName} started` }
}

// ============================================================================
// Multi-Service Operations
// ============================================================================

/**
 * Restart all core services (Context Hub + Service Manager)
 */
export async function restartCoreServices(
  options: { skipPrompt?: boolean } = {}
): Promise<{ contextHub: boolean; serviceManager: boolean }> {
  const results = {
    contextHub: false,
    serviceManager: false
  }

  console.log(chalk.cyan("\n📦 Checking services...\n"))

  // Context Hub: only restart if not healthy (avoid killing a working hub)
  const hubPort = getProjectPort()
  const hubHealthy = await waitForHealthy(`http://localhost:${hubPort}/health`, 2000)

  if (hubHealthy) {
    console.log(chalk.green(`  ✓ context-hub already healthy on port ${hubPort}`))
    results.contextHub = true
  } else {
    console.log(chalk.yellow(`  → context-hub not responding, restarting...`))
    const contextHubResult = await restartService("context-hub", {
      stopCommand: "jfl context-hub stop",
      startCommand: "jfl context-hub ensure",
      healthCheck: `http://localhost:${hubPort}/health`,
      timeout: 5000
    })
    results.contextHub = contextHubResult.success
  }

  // Service Manager: only restart if not healthy
  const smHealthy = await waitForHealthy("http://localhost:3402/health", 2000)

  if (smHealthy) {
    console.log(chalk.green(`  ✓ service-manager already healthy`))
    results.serviceManager = true
  } else {
    const serviceManagerResult = await restartService("service-manager", {
      stopCommand: "jfl service-manager stop",
      startCommand: "jfl service-manager ensure",
      healthCheck: "http://localhost:3402/health",
      timeout: 5000
    })
    results.serviceManager = serviceManagerResult.success
  }

  return results
}

/**
 * Validate all core services are healthy
 */
export async function validateCoreServices(): Promise<{
  healthy: boolean
  issues: Array<{ service: string; message: string; remedy: string }>
}> {
  const issues: Array<{ service: string; message: string; remedy: string }> = []

  // Check Context Hub
  const contextHubHealth = await checkServiceHealth(
    "context-hub",
    `http://localhost:${getProjectPort()}/health`,
    ".jfl/context-hub.pid"
  )

  if (!contextHubHealth.healthy) {
    issues.push({
      service: "context-hub",
      message: contextHubHealth.message,
      remedy: "Run: jfl context-hub restart"
    })
  }

  // Check Service Manager
  const serviceManagerHealth = await checkServiceHealth(
    "service-manager",
    "http://localhost:3402/health",
    path.join(JFL_PATHS.data, "services", "pids", "service-manager.pid")
  )

  if (!serviceManagerHealth.healthy) {
    issues.push({
      service: "service-manager",
      message: serviceManagerHealth.message,
      remedy: "Run: jfl service-manager restart"
    })
  }

  return {
    healthy: issues.length === 0,
    issues
  }
}
