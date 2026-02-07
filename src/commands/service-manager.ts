/**
 * Service Manager API Server
 *
 * HTTP API for managing services across all JFL projects.
 * Provides unified service status and control interface.
 *
 * @purpose Service Manager API daemon for TUI and external integration
 */

import chalk from "chalk"
import ora from "ora"
import { execSync, spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as http from "http"
import { homedir } from "os"
import { promisify } from "util"
import { exec } from "child_process"

const execAsync = promisify(exec)

const DEFAULT_PORT = 3402
const PID_FILE = ".jfl/service-manager.pid"
const LOG_FILE = ".jfl/logs/service-manager.log"
const CONFIG_FILE = path.join(homedir(), ".jfl", "service-manager.json")
const GLOBAL_SERVICES_FILE = path.join(homedir(), ".jfl", "services.json")

// ============================================================================
// Types
// ============================================================================

interface ServiceManagerConfig {
  port: number
}

interface Service {
  name: string
  type: "daemon" | "server" | "process"
  description: string
  port?: number
  start_command: string
  stop_command: string
  detection_command: string
  pid_file?: string
  log_file?: string
  token_file?: string
  health_url?: string
}

interface ServiceStatus {
  name: string
  status: "running" | "stopped" | "error"
  pid?: number
  port?: number
  uptime?: string
  started_at?: string
  description: string
  log_path?: string
  health_url?: string
}

interface ServicesConfig {
  version: string
  services: Record<string, Service>
}

// ============================================================================
// Config Management
// ============================================================================

function loadConfig(): ServiceManagerConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaultConfig: ServiceManagerConfig = { port: DEFAULT_PORT }
    saveConfig(defaultConfig)
    return defaultConfig
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf-8")
    return JSON.parse(content)
  } catch {
    return { port: DEFAULT_PORT }
  }
}

function saveConfig(config: ServiceManagerConfig): void {
  const dir = path.dirname(CONFIG_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

function getPort(): number {
  if (process.env.JFL_SERVICE_MANAGER_PORT) {
    return parseInt(process.env.JFL_SERVICE_MANAGER_PORT, 10)
  }
  return loadConfig().port
}

// ============================================================================
// Service Detection
// ============================================================================

function loadGlobalServices(): ServicesConfig {
  if (!fs.existsSync(GLOBAL_SERVICES_FILE)) {
    return { version: "1.0", services: {} }
  }

  const content = fs.readFileSync(GLOBAL_SERVICES_FILE, "utf-8")
  return JSON.parse(content)
}

function loadProjectServices(projectRoot: string): ServicesConfig {
  const projectServicesFile = path.join(projectRoot, ".jfl", "services.json")

  if (!fs.existsSync(projectServicesFile)) {
    return { version: "1.0", services: {} }
  }

  const content = fs.readFileSync(projectServicesFile, "utf-8")
  return JSON.parse(content)
}

function substituteVariables(str: string, vars: Record<string, string>): string {
  let result = str
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\$\\{${key}\\}`, "g"), value)
  }
  return result
}

async function isServiceRunning(service: Service): Promise<{ running: boolean; pid?: number }> {
  try {
    const vars: Record<string, string> = {
      PORT: service.port?.toString() || "",
      HOME: homedir(),
    }

    const detectionCmd = substituteVariables(service.detection_command, vars)
    const { stdout } = await execAsync(detectionCmd)
    const pidStr = stdout.trim()

    if (pidStr) {
      const pid = parseInt(pidStr.split('\n')[0], 10)
      if (!isNaN(pid)) {
        return { running: true, pid }
      }
      return { running: true }
    }
    return { running: false }
  } catch (error) {
    return { running: false }
  }
}

function getServiceStartTime(service: Service): Date | null {
  if (!service.pid_file) return null

  const vars: Record<string, string> = {
    HOME: homedir(),
  }

  const pidFile = substituteVariables(service.pid_file, vars)
  if (!fs.existsSync(pidFile)) return null

  try {
    const stats = fs.statSync(pidFile)
    return stats.mtime
  } catch {
    return null
  }
}

async function getServiceStatus(name: string, service: Service): Promise<ServiceStatus> {
  const running = await isServiceRunning(service)
  const startTime = getServiceStartTime(service)

  let uptime: string | undefined
  let started_at: string | undefined

  if (running.running && startTime) {
    const now = new Date()
    const diffMs = now.getTime() - startTime.getTime()
    const hours = Math.floor(diffMs / (1000 * 60 * 60))
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
    uptime = hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`
    started_at = startTime.toISOString()
  }

  const vars: Record<string, string> = {
    HOME: homedir(),
    PORT: service.port?.toString() || "",
  }

  return {
    name,
    status: running.running ? "running" : "stopped",
    pid: running.pid,
    port: service.port,
    uptime,
    started_at,
    description: service.description,
    log_path: service.log_file ? substituteVariables(service.log_file, vars) : undefined,
    health_url: service.health_url ? substituteVariables(service.health_url, vars) : undefined
  }
}

async function getAllServiceStatuses(): Promise<ServiceStatus[]> {
  const globalServices = loadGlobalServices()
  const projectRoot = process.cwd()
  const projectServices = loadProjectServices(projectRoot)

  const statuses: ServiceStatus[] = []

  // Get global services
  for (const [name, service] of Object.entries(globalServices.services)) {
    const status = await getServiceStatus(name, service)
    statuses.push(status)
  }

  // Get project services
  for (const [name, service] of Object.entries(projectServices.services)) {
    const status = await getServiceStatus(name, service)
    statuses.push(status)
  }

  return statuses
}

// ============================================================================
// Service Control
// ============================================================================

async function startServiceByName(serviceName: string): Promise<{ success: boolean; message: string }> {
  const globalServices = loadGlobalServices()
  const projectRoot = process.cwd()
  const projectServices = loadProjectServices(projectRoot)

  let service: Service | undefined = globalServices.services[serviceName] || projectServices.services[serviceName]

  if (!service) {
    return { success: false, message: `Service not found: ${serviceName}` }
  }

  // Check if already running
  const running = await isServiceRunning(service)
  if (running.running) {
    return { success: true, message: `Service already running (PID: ${running.pid})` }
  }

  const vars: Record<string, string> = {
    PORT: service.port?.toString() || "",
    HOME: homedir(),
    WORKSPACE: projectRoot,
  }

  const startCmd = substituteVariables(service.start_command, vars)

  try {
    await execAsync(startCmd, { cwd: projectRoot })
    return { success: true, message: `Started ${serviceName}` }
  } catch (error: any) {
    return { success: false, message: `Failed to start: ${error.message}` }
  }
}

async function stopServiceByName(serviceName: string): Promise<{ success: boolean; message: string }> {
  const globalServices = loadGlobalServices()
  const projectRoot = process.cwd()
  const projectServices = loadProjectServices(projectRoot)

  let service: Service | undefined = globalServices.services[serviceName] || projectServices.services[serviceName]

  if (!service) {
    return { success: false, message: `Service not found: ${serviceName}` }
  }

  const vars: Record<string, string> = {
    PORT: service.port?.toString() || "",
    HOME: homedir(),
  }

  const stopCmd = substituteVariables(service.stop_command, vars)

  try {
    await execAsync(stopCmd)
    return { success: true, message: `Stopped ${serviceName}` }
  } catch (error: any) {
    return { success: false, message: `Failed to stop: ${error.message}` }
  }
}

async function restartServiceByName(serviceName: string): Promise<{ success: boolean; message: string }> {
  await stopServiceByName(serviceName)
  await new Promise(resolve => setTimeout(resolve, 500))
  return startServiceByName(serviceName)
}

async function removeServiceByName(serviceName: string): Promise<{ success: boolean; message: string }> {
  const globalServices = loadGlobalServices()
  const projectRoot = process.cwd()
  const projectServices = loadProjectServices(projectRoot)

  // Check global services
  if (globalServices.services[serviceName]) {
    delete globalServices.services[serviceName]
    fs.writeFileSync(GLOBAL_SERVICES_FILE, JSON.stringify(globalServices, null, 2))
    return { success: true, message: `Removed ${serviceName} from global services` }
  }

  // Check project services
  const projectServicesFile = path.join(projectRoot, ".jfl", "services.json")
  if (projectServices.services[serviceName]) {
    delete projectServices.services[serviceName]
    fs.writeFileSync(projectServicesFile, JSON.stringify(projectServices, null, 2))
    return { success: true, message: `Removed ${serviceName} from project services` }
  }

  return { success: false, message: `Service not found: ${serviceName}` }
}

// ============================================================================
// HTTP Server
// ============================================================================

function createServer(port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")

    if (req.method === "OPTIONS") {
      res.writeHead(200)
      res.end()
      return
    }

    const url = new URL(req.url || "/", `http://localhost:${port}`)

    // Health check
    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok", port }))
      return
    }

    // List all services
    if (url.pathname === "/services" && req.method === "GET") {
      try {
        const services = await getAllServiceStatuses()
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ services }))
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: err.message }))
      }
      return
    }

    // Start service
    const startMatch = url.pathname.match(/^\/services\/([^/]+)\/start$/)
    if (startMatch && req.method === "POST") {
      const serviceName = startMatch[1]
      const result = await startServiceByName(serviceName)
      res.writeHead(result.success ? 200 : 500, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
      return
    }

    // Stop service
    const stopMatch = url.pathname.match(/^\/services\/([^/]+)\/stop$/)
    if (stopMatch && req.method === "POST") {
      const serviceName = stopMatch[1]
      const result = await stopServiceByName(serviceName)
      res.writeHead(result.success ? 200 : 500, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
      return
    }

    // Restart service
    const restartMatch = url.pathname.match(/^\/services\/([^/]+)\/restart$/)
    if (restartMatch && req.method === "POST") {
      const serviceName = restartMatch[1]
      const result = await restartServiceByName(serviceName)
      res.writeHead(result.success ? 200 : 500, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
      return
    }

    // Remove service
    const removeMatch = url.pathname.match(/^\/services\/([^/]+)$/)
    if (removeMatch && req.method === "DELETE") {
      const serviceName = removeMatch[1]
      const result = await removeServiceByName(serviceName)
      res.writeHead(result.success ? 200 : 500, { "Content-Type": "application/json" })
      res.end(JSON.stringify(result))
      return
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Not found" }))
  })

  return server
}

// ============================================================================
// Daemon Management
// ============================================================================

function getPidFile(): string {
  const globalDir = path.join(homedir(), ".jfl")
  if (!fs.existsSync(globalDir)) {
    fs.mkdirSync(globalDir, { recursive: true })
  }
  return path.join(globalDir, "service-manager.pid")
}

function getLogFile(): string {
  const logDir = path.join(homedir(), ".jfl", "logs")
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  return path.join(logDir, "service-manager.log")
}

function isRunning(): { running: boolean; pid?: number } {
  const pidFile = getPidFile()

  if (!fs.existsSync(pidFile)) {
    return { running: false }
  }

  const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10)

  try {
    process.kill(pid, 0) // Check if process exists
    return { running: true, pid }
  } catch {
    // Process doesn't exist, clean up stale PID file
    fs.unlinkSync(pidFile)
    return { running: false }
  }
}

async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = http.createServer()
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true)
      } else {
        resolve(false)
      }
    })
    server.once('listening', () => {
      server.close()
      resolve(false)
    })
    server.listen(port)
  })
}

async function startDaemon(port: number): Promise<{ success: boolean; message: string }> {
  const status = isRunning()
  if (status.running) {
    return { success: true, message: `Service Manager already running (PID: ${status.pid})` }
  }

  // Check if port is in use
  const portInUse = await isPortInUse(port)
  if (portInUse) {
    return { success: false, message: `Port ${port} is already in use` }
  }

  const logFile = getLogFile()
  const pidFile = getPidFile()

  // Find jfl command
  let jflCmd = "jfl"
  try {
    execSync("which jfl", { encoding: "utf-8" }).trim()
  } catch {
    jflCmd = process.argv[1]
  }

  // Start as detached process
  const child = spawn(jflCmd, ["service-manager", "serve", "--port", String(port)], {
    detached: true,
    stdio: ["ignore", fs.openSync(logFile, "a"), fs.openSync(logFile, "a")],
    env: { ...process.env, NODE_ENV: "production" }
  })

  child.unref()

  // Wait for startup
  await new Promise(resolve => setTimeout(resolve, 500))

  // Write PID file
  if (child.pid) {
    try {
      process.kill(child.pid, 0)
      fs.writeFileSync(pidFile, String(child.pid))
      return { success: true, message: `Started (PID: ${child.pid})` }
    } catch {
      return { success: false, message: "Process started but immediately exited" }
    }
  }

  return { success: false, message: "Failed to spawn daemon process" }
}

async function stopDaemon(): Promise<{ success: boolean; message: string }> {
  const status = isRunning()
  if (!status.running || !status.pid) {
    return { success: true, message: "Service Manager is not running" }
  }

  const pidFile = getPidFile()

  try {
    // Send SIGTERM first
    process.kill(status.pid, "SIGTERM")

    // Wait up to 3 seconds for graceful shutdown
    let attempts = 0
    while (attempts < 6) {
      await new Promise(resolve => setTimeout(resolve, 500))
      try {
        process.kill(status.pid, 0)
        attempts++
      } catch {
        break
      }
    }

    // If still running, force kill
    try {
      process.kill(status.pid, 0)
      process.kill(status.pid, "SIGKILL")
      await new Promise(resolve => setTimeout(resolve, 100))
    } catch {
      // Process is gone
    }

    // Clean up PID file
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile)
    }

    return { success: true, message: "Service Manager stopped" }
  } catch (err) {
    return { success: false, message: `Failed to stop: ${err}` }
  }
}

// ============================================================================
// CLI Command
// ============================================================================

export async function serviceManagerCommand(
  action?: string,
  options: { port?: number } = {}
) {
  const port = options.port || getPort()

  switch (action) {
    case "start": {
      const spinner = ora("Starting Service Manager...").start()
      const result = await startDaemon(port)
      if (result.success) {
        if (result.message.includes("already running")) {
          spinner.info(result.message)
        } else {
          spinner.succeed(`Service Manager started on port ${port}`)
        }
      } else {
        spinner.fail(result.message)
      }
      break
    }

    case "stop": {
      const spinner = ora("Stopping Service Manager...").start()
      const result = await stopDaemon()
      if (result.success) {
        spinner.succeed(result.message)
      } else {
        spinner.fail(result.message)
      }
      break
    }

    case "restart": {
      await serviceManagerCommand("stop", options)
      await new Promise(resolve => setTimeout(resolve, 500))
      await serviceManagerCommand("start", options)
      break
    }

    case "status": {
      const status = isRunning()
      if (status.running) {
        console.log(chalk.green(`\n  Service Manager is running`))
        console.log(chalk.gray(`  PID: ${status.pid}`))
        console.log(chalk.gray(`  Port: ${port}`))
        console.log()
      } else {
        console.log(chalk.yellow("\n  Service Manager is not running"))
        console.log(chalk.gray("  Run: jfl service-manager start\n"))
      }
      break
    }

    case "serve": {
      // Run server in foreground (used by daemon)
      const server = createServer(port)
      let isListening = false

      process.on("uncaughtException", (err) => {
        console.error(`Uncaught exception: ${err.message}`)
        console.error(err.stack)
      })

      process.on("unhandledRejection", (reason, promise) => {
        console.error(`Unhandled rejection at ${promise}: ${reason}`)
      })

      server.on("error", (err: any) => {
        console.error(`Server error: ${err.message}`)
        if (err.code === "EADDRINUSE") {
          console.error(`Port ${port} is already in use. Exiting.`)
          process.exit(1)
        }
      })

      server.listen(port, () => {
        isListening = true
        console.log(`Service Manager listening on port ${port}`)
        console.log(`PID: ${process.pid}`)
        console.log(`Ready to serve requests`)
      })

      const shutdown = () => {
        if (!isListening) {
          process.exit(0)
          return
        }
        console.log("Shutting down...")
        server.close(() => {
          console.log("Server closed")
          process.exit(0)
        })
        setTimeout(() => {
          console.log("Force exit after timeout")
          process.exit(1)
        }, 5000)
      }

      process.on("SIGTERM", shutdown)
      process.on("SIGINT", shutdown)

      const heartbeat = setInterval(() => {
        if (isListening && Date.now() % 300000 < 60000) {
          console.log(`Heartbeat: Still running (PID: ${process.pid})`)
        }
      }, 60000)

      process.on("exit", () => {
        clearInterval(heartbeat)
      })

      break
    }

    default: {
      console.log(chalk.bold("\n  Service Manager - API for JFL services\n"))
      console.log(chalk.gray("  Commands:"))
      console.log("    jfl service-manager start     Start the daemon")
      console.log("    jfl service-manager stop      Stop the daemon")
      console.log("    jfl service-manager restart   Restart the daemon")
      console.log("    jfl service-manager status    Check if running")
      console.log()
      console.log(chalk.gray("  Options:"))
      console.log("    --port <port>   Port to run on (default: 3401)")
      console.log()
    }
  }
}
