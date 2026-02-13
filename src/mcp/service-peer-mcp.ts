/**
 * Service Peer MCP Server
 *
 * MCP server providing peer service discovery and invocation (fallback mechanism).
 * This is a runtime fallback when peer agent files are missing or stale.
 *
 * @purpose MCP tools for discovering and calling peer services
 */

import {
  ServiceMCPServer,
  ServiceMeshClient,
  type MCPTool,
  type ServiceInfo,
  type ServiceMeshConfig,
} from "../lib/service-mcp-base.js"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

// ============================================================================
// Types
// ============================================================================

interface ServiceConfig {
  name: string
  type: string
  gtm_parent?: string
}

interface GTMConfig {
  registered_services?: Array<{
    name: string
    path: string
    type: string
    status: string
  }>
}

// ============================================================================
// MCP Tools
// ============================================================================

const TOOLS: MCPTool[] = [
  {
    name: "service_peer_list",
    description: "List all peer services available for collaboration",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "service_peer_call",
    description: "Call a peer service tool (routes through Service Manager)",
    inputSchema: {
      type: "object",
      properties: {
        peer_name: {
          type: "string",
          description: "Peer service name (with or without 'peer-service-' prefix)",
        },
        tool_name: {
          type: "string",
          description: "Tool name to invoke on peer service",
        },
        args: {
          type: "object",
          description: "Arguments to pass to the tool",
        },
      },
      required: ["peer_name", "tool_name"],
    },
  },
  {
    name: "service_peer_status",
    description: "Get status of a peer service",
    inputSchema: {
      type: "object",
      properties: {
        peer_name: {
          type: "string",
          description: "Peer service name (with or without 'peer-service-' prefix)",
        },
      },
      required: ["peer_name"],
    },
  },
]

// ============================================================================
// Service Peer MCP Server
// ============================================================================

export class ServicePeerMCPServer {
  private server: ServiceMCPServer
  private meshClient: ServiceMeshClient
  private serviceConfig: ServiceConfig
  private gtmPath: string

  constructor() {
    // Load service config
    const configPath = join(process.cwd(), ".jfl/config.json")

    if (!existsSync(configPath)) {
      throw new Error("Service config not found - run from service directory")
    }

    this.serviceConfig = JSON.parse(readFileSync(configPath, "utf-8"))

    if (this.serviceConfig.type !== "service") {
      throw new Error("Not a service directory")
    }

    if (!this.serviceConfig.gtm_parent) {
      throw new Error("Service has no GTM parent configured")
    }

    this.gtmPath = this.serviceConfig.gtm_parent

    // Create mesh client with current service name
    this.meshClient = new ServiceMeshClient("http://localhost:3402", this.serviceConfig.name)

    // Create service info
    const serviceInfo: ServiceInfo = {
      name: `${this.serviceConfig.name}-peer-mcp`,
      description: `Peer service discovery and invocation for ${this.serviceConfig.name}`,
      version: "1.0.0",
      path: process.cwd(),
    }

    // Create MCP server config
    const config: ServiceMeshConfig = {
      serviceManagerUrl: "http://localhost:3402",
      serviceName: this.serviceConfig.name,
      serviceInfo,
      tools: TOOLS,
      toolHandler: this.handleTool.bind(this),
    }

    this.server = new ServiceMCPServer(config)
  }

  /**
   * Start the MCP server
   */
  start(): void {
    this.server.start()
  }

  /**
   * Handle MCP tool invocations
   */
  private async handleTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case "service_peer_list":
        return await this.listPeers()

      case "service_peer_call":
        return await this.callPeer(args.peer_name, args.tool_name, args.args)

      case "service_peer_status":
        return await this.getPeerStatus(args.peer_name)

      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  /**
   * List all peer services (excludes self)
   */
  private async listPeers(): Promise<any> {
    // Read GTM config for registered services
    const gtmConfigPath = join(this.gtmPath, ".jfl/config.json")

    if (!existsSync(gtmConfigPath)) {
      return {
        peers: [],
        message: "GTM config not found",
      }
    }

    const gtmConfig: GTMConfig = JSON.parse(readFileSync(gtmConfigPath, "utf-8"))
    const registeredServices = gtmConfig.registered_services || []

    // Filter out self
    const peers = registeredServices
      .filter((s) => s.name !== this.serviceConfig.name && s.status === "active")
      .map((s) => ({
        name: s.name,
        peer_agent_name: `peer-service-${s.name}`,
        type: s.type,
        path: s.path,
      }))

    return {
      current_service: this.serviceConfig.name,
      peers,
      count: peers.length,
    }
  }

  /**
   * Call a peer service tool
   */
  private async callPeer(peerName: string, toolName: string, args?: any): Promise<any> {
    // Strip 'peer-service-' prefix if present
    const serviceName = peerName.replace(/^peer-service-/, "")

    // Security: prevent self-calls
    if (serviceName === this.serviceConfig.name) {
      throw new Error("Cannot call self as peer. Use local methods instead.")
    }

    try {
      const result = await this.meshClient.callPeer(serviceName, toolName, args)

      return {
        peer: serviceName,
        tool: toolName,
        result,
        status: "success",
      }
    } catch (error: any) {
      return {
        peer: serviceName,
        tool: toolName,
        error: error.message,
        status: "error",
      }
    }
  }

  /**
   * Get peer service status
   */
  private async getPeerStatus(peerName: string): Promise<any> {
    // Strip 'peer-service-' prefix if present
    const serviceName = peerName.replace(/^peer-service-/, "")

    // Security: prevent self-calls
    if (serviceName === this.serviceConfig.name) {
      throw new Error("Cannot query self as peer. Check local status.")
    }

    try {
      const serviceInfo = await this.meshClient.getServiceInfo(serviceName)

      return {
        peer: serviceName,
        status: "available",
        info: serviceInfo,
      }
    } catch (error: any) {
      return {
        peer: serviceName,
        status: "unavailable",
        error: error.message,
      }
    }
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const server = new ServicePeerMCPServer()
    server.start()
  } catch (error: any) {
    console.error(`Failed to start service peer MCP server: ${error.message}`)
    process.exit(1)
  }
}
