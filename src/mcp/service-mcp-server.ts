#!/usr/bin/env node
/**
 * Service MCP Server
 *
 * Generic MCP server for JFL services. Provides standard tools
 * (status, start, stop, restart, logs, health) for all services,
 * plus custom tools defined in service configuration.
 *
 * @purpose MCP server generator for service-to-AI communication
 */

import * as readline from "readline"
import * as fs from "fs"
import * as path from "path"
import { homedir } from "os"
import { JFL_PATHS } from "../utils/jfl-paths.js"

const SERVICE_MANAGER_URL = process.env.SERVICE_MANAGER_URL || "http://localhost:3402"
const GLOBAL_SERVICES_FILE = path.join(JFL_PATHS.data, "services.json")

// ============================================================================
// Types
// ============================================================================

interface MCPRequest {
  jsonrpc: "2.0"
  id: number | string
  method: string
  params?: any
}

interface MCPResponse {
  jsonrpc: "2.0"
  id: number | string
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

interface ServiceConfig {
  type: string
  description: string
  port?: number
  start_command: string
  stop_command: string
  detection_command: string
  pid_file?: string
  log_file?: string
  health_url?: string
  mcp?: {
    enabled: boolean
    tools?: CustomTool[]
  }
}

interface CustomTool {
  name: string
  description: string
  inputSchema?: any
  command: string
  timeout?: number
}

interface ServicesConfig {
  version: string
  services: Record<string, ServiceConfig>
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

// ============================================================================
// Config Loading
// ============================================================================

function loadServiceConfig(serviceName: string): ServiceConfig | null {
  if (!fs.existsSync(GLOBAL_SERVICES_FILE)) {
    logError(`Services file not found: ${GLOBAL_SERVICES_FILE}`)
    return null
  }

  try {
    const content = fs.readFileSync(GLOBAL_SERVICES_FILE, "utf-8")
    const config: ServicesConfig = JSON.parse(content)
    const serviceConfig = config.services[serviceName]

    if (!serviceConfig) {
      logError(`Service "${serviceName}" not found in configuration`)
      return null
    }

    // Check if service has a custom .jfl-mcp.js file
    const servicePath = (serviceConfig as any).path
    if (servicePath) {
      const customMcpPath = path.join(servicePath, '.jfl-mcp.js')
      if (fs.existsSync(customMcpPath)) {
        logDebug(`Using custom MCP server: ${customMcpPath}`)
        // Custom MCP server exists - this generic one won't be used
        // The custom one will be invoked directly
      }
    }

    return serviceConfig
  } catch (error) {
    logError(`Failed to load service config: ${error}`)
    return null
  }
}

// ============================================================================
// Service Manager API Calls
// ============================================================================

async function callServiceManager(endpoint: string, method: string = "GET", body?: any): Promise<any> {
  const url = `${SERVICE_MANAGER_URL}${endpoint}`

  try {
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`HTTP ${response.status}: ${text}`)
    }

    return await response.json()
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Service Manager request failed: ${error.message}`)
    }
    throw error
  }
}

async function getServiceStatus(serviceName: string): Promise<ServiceStatus> {
  const data = await callServiceManager("/services")
  const service = data.services.find((s: ServiceStatus) => s.name === serviceName)

  if (!service) {
    throw new Error(`Service "${serviceName}" not found`)
  }

  return service
}

async function startService(serviceName: string): Promise<string> {
  await callServiceManager(`/services/${serviceName}/start`, "POST")
  return `Started ${serviceName}`
}

async function stopService(serviceName: string): Promise<string> {
  await callServiceManager(`/services/${serviceName}/stop`, "POST")
  return `Stopped ${serviceName}`
}

async function restartService(serviceName: string): Promise<string> {
  await callServiceManager(`/services/${serviceName}/restart`, "POST")
  return `Restarted ${serviceName}`
}

async function getServiceLogs(serviceName: string, lines: number = 50): Promise<string> {
  const data = await callServiceManager(`/services/${serviceName}/logs?lines=${lines}`)
  return data.logs || "No logs available"
}

async function checkServiceHealth(serviceName: string): Promise<string> {
  const status = await getServiceStatus(serviceName)

  if (!status.health_url) {
    return `Health check not configured for ${serviceName}`
  }

  try {
    const response = await fetch(status.health_url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })

    if (response.ok) {
      const data = await response.text()
      return `Health check passed for ${serviceName}\n${data}`
    } else {
      return `Health check failed for ${serviceName}: HTTP ${response.status}`
    }
  } catch (error) {
    return `Health check failed for ${serviceName}: ${error}`
  }
}

// ============================================================================
// Custom Tool Execution
// ============================================================================

async function executeCustomTool(
  serviceName: string,
  tool: CustomTool,
  args: any
): Promise<string> {
  const { execAsync } = await import("util").then(m => ({
    execAsync: require("util").promisify(require("child_process").exec)
  }))

  // Variable substitution
  const serviceConfig = loadServiceConfig(serviceName)
  if (!serviceConfig) {
    throw new Error(`Service config not found for ${serviceName}`)
  }

  const vars: Record<string, string> = {
    SERVICE_NAME: serviceName,
    PORT: serviceConfig.port?.toString() || "",
    HOME: homedir(),
    // Extract service path from start_command if it contains "cd"
    SERVICE_PATH: serviceConfig.start_command.match(/cd\s+([^\s&;]+)/)?.[1] || process.cwd(),
  }

  // Substitute variables in command
  let command = tool.command
  for (const [key, value] of Object.entries(vars)) {
    command = command.replace(new RegExp(`\\$\\{${key}\\}`, "g"), value)
  }

  // Substitute any arguments passed to the tool
  if (args) {
    for (const [key, value] of Object.entries(args)) {
      command = command.replace(new RegExp(`\\$\\{${key}\\}`, "g"), String(value))
    }
  }

  const timeout = tool.timeout || 120000 // 2 minutes default

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    })

    let result = ""
    if (stdout) result += stdout
    if (stderr) result += `\nStderr:\n${stderr}`

    return result || "Command completed successfully (no output)"
  } catch (error: any) {
    throw new Error(`Command failed: ${error.message}\nCommand: ${command}`)
  }
}

// ============================================================================
// Standard Tool Definitions
// ============================================================================

function getStandardTools(serviceName: string) {
  return [
    {
      name: `${serviceName}_status`,
      description: `Get status of ${serviceName} service`,
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: `${serviceName}_start`,
      description: `Start ${serviceName} service`,
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: `${serviceName}_stop`,
      description: `Stop ${serviceName} service`,
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: `${serviceName}_restart`,
      description: `Restart ${serviceName} service`,
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: `${serviceName}_logs`,
      description: `Get logs from ${serviceName} service`,
      inputSchema: {
        type: "object" as const,
        properties: {
          lines: {
            type: "number",
            description: "Number of log lines to return (default: 50)",
          },
        },
      },
    },
    {
      name: `${serviceName}_health`,
      description: `Check health of ${serviceName} service`,
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ]
}

// ============================================================================
// Custom Tool Definitions
// ============================================================================

function getCustomTools(serviceName: string, serviceConfig: ServiceConfig) {
  if (!serviceConfig.mcp?.enabled || !serviceConfig.mcp?.tools) {
    return []
  }

  return serviceConfig.mcp.tools.map(tool => ({
    name: `${serviceName}_${tool.name}`,
    description: tool.description,
    inputSchema: tool.inputSchema || {
      type: "object" as const,
      properties: {},
    },
  }))
}

// ============================================================================
// Tool Handler
// ============================================================================

async function handleToolCall(
  serviceName: string,
  serviceConfig: ServiceConfig,
  toolName: string,
  args: any
): Promise<string> {
  // Extract the actual tool name (remove service prefix)
  const actualToolName = toolName.replace(`${serviceName}_`, "")

  // Handle standard tools
  switch (actualToolName) {
    case "status": {
      const status = await getServiceStatus(serviceName)
      return formatServiceStatus(status)
    }
    case "start":
      return await startService(serviceName)
    case "stop":
      return await stopService(serviceName)
    case "restart":
      return await restartService(serviceName)
    case "logs": {
      const lines = args?.lines || 50
      return await getServiceLogs(serviceName, lines)
    }
    case "health":
      return await checkServiceHealth(serviceName)
  }

  // Handle custom tools
  if (serviceConfig.mcp?.tools) {
    const customTool = serviceConfig.mcp.tools.find(t => t.name === actualToolName)
    if (customTool) {
      return await executeCustomTool(serviceName, customTool, args)
    }
  }

  throw new Error(`Unknown tool: ${toolName}`)
}

// ============================================================================
// Formatting
// ============================================================================

function formatServiceStatus(status: ServiceStatus): string {
  const lines = [
    `Service: ${status.name}`,
    `Status: ${status.status}`,
    `Description: ${status.description}`,
  ]

  if (status.port) lines.push(`Port: ${status.port}`)
  if (status.pid) lines.push(`PID: ${status.pid}`)
  if (status.uptime) lines.push(`Uptime: ${status.uptime}`)
  if (status.started_at) lines.push(`Started: ${status.started_at}`)
  if (status.log_path) lines.push(`Logs: ${status.log_path}`)
  if (status.health_url) lines.push(`Health URL: ${status.health_url}`)

  return lines.join("\n")
}

// ============================================================================
// Logging
// ============================================================================

function logError(message: string): void {
  console.error(`[service-mcp-server] ERROR: ${message}`)
}

function logDebug(message: string): void {
  if (process.env.DEBUG) {
    console.error(`[service-mcp-server] DEBUG: ${message}`)
  }
}

// ============================================================================
// MCP Protocol Handler
// ============================================================================

async function handleRequest(serviceName: string, serviceConfig: ServiceConfig, request: MCPRequest): Promise<MCPResponse> {
  logDebug(`Received request: ${request.method}`)

  try {
    switch (request.method) {
      case "initialize": {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: `${serviceName}-mcp-server`,
              version: "1.0.0",
            },
          },
        }
      }

      case "tools/list": {
        const standardTools = getStandardTools(serviceName)
        const customTools = getCustomTools(serviceName, serviceConfig)
        const allTools = [...standardTools, ...customTools]

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools: allTools,
          },
        }
      }

      case "tools/call": {
        const { name: toolName, arguments: args } = request.params
        const result = await handleToolCall(serviceName, serviceConfig, toolName, args)

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            content: [
              {
                type: "text",
                text: result,
              },
            ],
          },
        }
      }

      default: {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32601,
            message: `Method not found: ${request.method}`,
          },
        }
      }
    }
  } catch (error) {
    logError(`Error handling request: ${error}`)
    return {
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const serviceName = process.argv[2]

  if (!serviceName) {
    console.error("Usage: service-mcp-server <service-name>")
    process.exit(1)
  }

  const serviceConfig = loadServiceConfig(serviceName)
  if (!serviceConfig) {
    console.error(`Failed to load configuration for service: ${serviceName}`)
    process.exit(1)
  }

  logDebug(`Starting MCP server for service: ${serviceName}`)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

  rl.on("line", async (line) => {
    try {
      const request: MCPRequest = JSON.parse(line)
      const response = await handleRequest(serviceName, serviceConfig, request)
      console.log(JSON.stringify(response))
    } catch (error) {
      logError(`Failed to parse or handle request: ${error}`)
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: "Parse error",
          },
        })
      )
    }
  })

  rl.on("close", () => {
    logDebug("MCP server shutting down")
    process.exit(0)
  })
}

main().catch((error) => {
  logError(`Fatal error: ${error}`)
  process.exit(1)
})
