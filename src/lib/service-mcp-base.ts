/**
 * Service MCP Base
 *
 * Shared code for service-local MCP servers.
 * Provides MCP protocol handling and inter-service communication.
 *
 * @purpose Base library for service MCP servers with service mesh support
 */

import * as readline from "readline"

// ============================================================================
// Types
// ============================================================================

export interface MCPRequest {
  jsonrpc: "2.0"
  id: number | string
  method: string
  params?: any
}

export interface MCPResponse {
  jsonrpc: "2.0"
  id: number | string
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: any
}

export interface ServiceInfo {
  name: string
  description: string
  version: string
  path: string
}

export interface ServiceMeshConfig {
  serviceManagerUrl?: string
  serviceName: string
  serviceInfo: ServiceInfo
  tools: MCPTool[]
  toolHandler: (toolName: string, args: any) => Promise<any>
}

// ============================================================================
// Service Mesh Client
// ============================================================================

export class ServiceMeshClient {
  private serviceManagerUrl: string
  private currentServiceName?: string

  constructor(serviceManagerUrl: string = "http://localhost:3402", currentServiceName?: string) {
    this.serviceManagerUrl = serviceManagerUrl
    this.currentServiceName = currentServiceName
  }

  /**
   * Call another service's tool via Service Manager
   */
  async callService(serviceName: string, toolName: string, args?: any): Promise<any> {
    try {
      const response = await fetch(
        `${this.serviceManagerUrl}/registry/${serviceName}/call`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: toolName, args: args || {} }),
        }
      )

      if (!response.ok) {
        throw new Error(`Service call failed: ${response.status} ${response.statusText}`)
      }

      const result = await response.json()
      return result
    } catch (error) {
      throw new Error(`Failed to call ${serviceName}.${toolName}: ${error}`)
    }
  }

  /**
   * Discover available services
   */
  async listServices(): Promise<any[]> {
    const response = await fetch(`${this.serviceManagerUrl}/registry`)
    const data = await response.json()
    return data.services || []
  }

  /**
   * Get info about a specific service
   */
  async getServiceInfo(serviceName: string): Promise<any> {
    const response = await fetch(`${this.serviceManagerUrl}/registry/${serviceName}`)
    return await response.json()
  }

  /**
   * List peer services (excludes self)
   */
  async listPeers(): Promise<ServiceInfo[]> {
    const allServices = await this.listServices()
    return allServices.filter(
      (s: any) => !this.currentServiceName || s.name !== this.currentServiceName
    )
  }

  /**
   * Call peer service (security: prevents self-calls)
   */
  async callPeer(peerName: string, toolName: string, args?: any): Promise<any> {
    const serviceName = peerName.replace(/^peer-service-/, "")

    if (serviceName === this.currentServiceName) {
      throw new Error("Cannot call self as peer. Use local methods.")
    }

    return this.callService(serviceName, toolName, args)
  }

  /**
   * Register this service with Service Manager
   */
  async register(serviceInfo: ServiceInfo, mcpServerPath: string): Promise<void> {
    await fetch(`${this.serviceManagerUrl}/registry/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: serviceInfo.name,
        description: serviceInfo.description,
        version: serviceInfo.version,
        path: serviceInfo.path,
        mcpServerPath,
      }),
    })
  }
}

// ============================================================================
// MCP Server
// ============================================================================

export class ServiceMCPServer {
  private config: ServiceMeshConfig
  private meshClient: ServiceMeshClient

  constructor(config: ServiceMeshConfig) {
    this.config = config
    this.meshClient = new ServiceMeshClient(config.serviceManagerUrl)
  }

  /**
   * Start the MCP server (stdin/stdout JSON-RPC)
   */
  start(): void {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    })

    rl.on("line", async (line) => {
      try {
        const request: MCPRequest = JSON.parse(line)
        const response = await this.handleRequest(request)
        console.log(JSON.stringify(response))
      } catch (error) {
        this.logError(`Failed to parse or handle request: ${error}`)
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
      this.logDebug("MCP server shutting down")
      process.exit(0)
    })

    this.logDebug(`MCP server started for ${this.config.serviceName}`)
  }

  /**
   * Handle MCP protocol requests
   */
  private async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    this.logDebug(`Received request: ${request.method}`)

    try {
      switch (request.method) {
        case "initialize":
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: `${this.config.serviceName}-mcp`,
                version: this.config.serviceInfo.version,
              },
            },
          }

        case "tools/list":
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              tools: this.config.tools,
            },
          }

        case "tools/call": {
          const { name: toolName, arguments: args } = request.params
          const result = await this.config.toolHandler(toolName, args)

          return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              content: [
                {
                  type: "text",
                  text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
                },
              ],
            },
          }
        }

        default:
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`,
            },
          }
      }
    } catch (error) {
      this.logError(`Error handling request: ${error}`)
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

  /**
   * Get the service mesh client for inter-service calls
   */
  getMeshClient(): ServiceMeshClient {
    return this.meshClient
  }

  private logError(message: string): void {
    console.error(`[${this.config.serviceName}-mcp] ERROR: ${message}`)
  }

  private logDebug(message: string): void {
    if (process.env.DEBUG) {
      console.error(`[${this.config.serviceName}-mcp] DEBUG: ${message}`)
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a standard tool for service status
 */
export function createStatusTool(serviceName: string): MCPTool {
  return {
    name: "status",
    description: `Get status of ${serviceName} service`,
    inputSchema: {
      type: "object",
      properties: {},
    },
  }
}

/**
 * Create a standard tool for service logs
 */
export function createLogsTool(serviceName: string): MCPTool {
  return {
    name: "logs",
    description: `Get logs from ${serviceName} service`,
    inputSchema: {
      type: "object",
      properties: {
        lines: {
          type: "number",
          description: "Number of log lines to return (default: 50)",
        },
      },
    },
  }
}

/**
 * Create a standard tool for service health check
 */
export function createHealthTool(serviceName: string): MCPTool {
  return {
    name: "health",
    description: `Check health of ${serviceName} service`,
    inputSchema: {
      type: "object",
      properties: {},
    },
  }
}
