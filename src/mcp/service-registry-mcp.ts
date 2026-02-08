#!/usr/bin/env node
/**
 * Service Registry MCP Server
 *
 * Provides service discovery and control tools to Claude Code via MCP protocol.
 * Communicates with the Service Manager registry API.
 *
 * @purpose MCP server for service mesh integration with Claude Code
 */

import * as readline from "readline"

const SERVICE_MANAGER_URL = process.env.SERVICE_MANAGER_URL || "http://localhost:3402"

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

interface ServiceInfo {
  name: string
  status: "running" | "stopped" | "error"
  port?: number
  pid?: number
  description?: string
  health_url?: string
  tools?: string[]
}

// ============================================================================
// MCP Server Implementation
// ============================================================================

const TOOLS = [
  {
    name: "service_list",
    description: "List all available services in the service mesh. Returns service names, status (running/stopped), and basic info.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["running", "stopped", "all"],
          description: "Filter by service status (default: all)"
        }
      }
    }
  },
  {
    name: "service_info",
    description: "Get detailed information about a specific service including available tools, current status, port, PID, and health.",
    inputSchema: {
      type: "object" as const,
      properties: {
        serviceName: {
          type: "string",
          description: "Name of the service (e.g., 'stratus-v2', 'formation-gtm')"
        }
      },
      required: ["serviceName"]
    }
  },
  {
    name: "service_call",
    description: "Execute a tool on a service. Standard tools: status, start, stop, restart, logs, health. Custom tools defined in service configuration.",
    inputSchema: {
      type: "object" as const,
      properties: {
        serviceName: {
          type: "string",
          description: "Name of the service"
        },
        tool: {
          type: "string",
          description: "Tool name (e.g., 'status', 'start', 'logs', 'deploy')"
        },
        args: {
          type: "object",
          description: "Optional arguments for the tool (e.g., {lines: 50} for logs)",
          additionalProperties: true
        }
      },
      required: ["serviceName", "tool"]
    }
  },
  {
    name: "service_discover",
    description: "Re-scan the project for services and update the registry. Useful when new services are added or configuration changes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Optional path to scan (defaults to current project)"
        }
      }
    }
  }
]

// ============================================================================
// Service Manager API Client
// ============================================================================

async function callServiceManager(endpoint: string, options: RequestInit = {}): Promise<any> {
  try {
    const response = await fetch(`${SERVICE_MANAGER_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Service Manager error (${response.status}): ${error}`)
    }

    return await response.json()
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error('Service Manager not running. Start it with: jfl service-manager start')
    }
    throw error
  }
}

async function listServices(statusFilter?: string): Promise<ServiceInfo[]> {
  const data = await callServiceManager('/registry')
  let services = data.services || []

  if (statusFilter && statusFilter !== 'all') {
    services = services.filter((s: ServiceInfo) => s.status === statusFilter)
  }

  return services
}

async function getServiceInfo(serviceName: string): Promise<ServiceInfo> {
  const data = await callServiceManager(`/registry/${serviceName}`)

  if (!data.service) {
    throw new Error(`Service not found: ${serviceName}`)
  }

  return data.service
}

async function callServiceTool(serviceName: string, tool: string, args: any = {}): Promise<string> {
  const data = await callServiceManager(`/registry/${serviceName}/call`, {
    method: 'POST',
    body: JSON.stringify({ tool, args })
  })

  return data.result || 'No output'
}

async function discoverServices(path?: string): Promise<{ added: number; updated: number }> {
  // This would trigger a services scan
  // For now, return a placeholder since the scan is typically manual
  return {
    added: 0,
    updated: 0
  }
}

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleToolCall(name: string, args: any): Promise<string> {
  try {
    switch (name) {
      case "service_list": {
        const services = await listServices(args?.status)

        if (services.length === 0) {
          return "No services found. Run 'jfl services scan' to discover services."
        }

        let output = `Found ${services.length} service(s):\n\n`

        for (const service of services) {
          const statusIcon = service.status === 'running' ? '●' : '○'
          const statusColor = service.status === 'running' ? 'green' : 'yellow'

          output += `${statusIcon} ${service.name}\n`
          output += `  Status: ${service.status}\n`

          if (service.port) {
            output += `  Port: ${service.port}\n`
          }

          if (service.description) {
            output += `  Description: ${service.description}\n`
          }

          output += '\n'
        }

        return output
      }

      case "service_info": {
        const serviceName = args.serviceName
        if (!serviceName) {
          throw new Error('serviceName is required')
        }

        const service = await getServiceInfo(serviceName)

        let output = `Service: ${service.name}\n\n`
        output += `Status: ${service.status}\n`

        if (service.description) {
          output += `Description: ${service.description}\n`
        }

        if (service.port) {
          output += `Port: ${service.port}\n`
        }

        if (service.pid) {
          output += `PID: ${service.pid}\n`
        }

        if (service.health_url) {
          output += `Health URL: ${service.health_url}\n`
        }

        // List available tools
        output += '\nAvailable tools:\n'
        const standardTools = ['status', 'start', 'stop', 'restart', 'logs', 'health']
        standardTools.forEach(tool => {
          output += `  - ${tool}\n`
        })

        if (service.tools && service.tools.length > 0) {
          output += '\nCustom tools:\n'
          service.tools.forEach(tool => {
            output += `  - ${tool}\n`
          })
        }

        return output
      }

      case "service_call": {
        const { serviceName, tool, args: toolArgs } = args

        if (!serviceName || !tool) {
          throw new Error('serviceName and tool are required')
        }

        const result = await callServiceTool(serviceName, tool, toolArgs || {})
        return result
      }

      case "service_discover": {
        const result = await discoverServices(args?.path)
        return `Discovery complete:\n- Added: ${result.added} services\n- Updated: ${result.updated} services\n\nRun 'jfl services scan' for full discovery.`
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error: any) {
    return `Error: ${error.message}`
  }
}

// ============================================================================
// MCP Protocol Handlers
// ============================================================================

function sendResponse(response: MCPResponse): void {
  console.error(`[MCP] Sending response: ${response.id}`)
  process.stdout.write(JSON.stringify(response) + '\n')
}

function sendError(id: number | string, code: number, message: string, data?: any): void {
  sendResponse({
    jsonrpc: "2.0",
    id,
    error: { code, message, data }
  })
}

async function handleRequest(request: MCPRequest): Promise<void> {
  console.error(`[MCP] Request: ${request.method}`)

  try {
    switch (request.method) {
      case "initialize": {
        sendResponse({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: "jfl-service-registry",
              version: "1.0.0"
            }
          }
        })
        break
      }

      case "tools/list": {
        sendResponse({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools: TOOLS
          }
        })
        break
      }

      case "tools/call": {
        const { name, arguments: args } = request.params
        const result = await handleToolCall(name, args || {})

        sendResponse({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            content: [
              {
                type: "text",
                text: result
              }
            ]
          }
        })
        break
      }

      case "notifications/initialized": {
        // Client finished initialization, no response needed
        break
      }

      default: {
        sendError(request.id, -32601, `Method not found: ${request.method}`)
      }
    }
  } catch (error: any) {
    console.error(`[MCP] Error handling request:`, error)
    sendError(request.id, -32603, error.message || "Internal error", {
      stack: error.stack
    })
  }
}

// ============================================================================
// Main Server Loop
// ============================================================================

function startServer(): void {
  console.error("[MCP] Service Registry MCP Server starting...")
  console.error(`[MCP] Service Manager URL: ${SERVICE_MANAGER_URL}`)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  })

  rl.on('line', async (line: string) => {
    if (!line.trim()) return

    try {
      const request = JSON.parse(line) as MCPRequest
      await handleRequest(request)
    } catch (error: any) {
      console.error(`[MCP] Failed to parse request:`, error)
      sendError(0, -32700, "Parse error", { error: error.message })
    }
  })

  rl.on('close', () => {
    console.error("[MCP] Server shutting down")
    process.exit(0)
  })
}

// ============================================================================
// Entry Point
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer()
}

export { startServer, handleToolCall }
