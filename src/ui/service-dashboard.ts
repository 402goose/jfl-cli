#!/usr/bin/env node
/**
 * Service Health Monitoring Dashboard
 *
 * Real-time TUI showing all services, health status, logs, and controls.
 * Interactive dashboard with keyboard navigation and live updates.
 *
 * @purpose Interactive service monitoring and management dashboard
 */

import blessed from "blessed"
import contrib from "blessed-contrib"
import * as fs from "fs"
import * as path from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"

const GLOBAL_SERVICES_FILE = path.join(homedir(), ".jfl", "services.json")
const SERVICE_MANAGER_URL = "http://localhost:3402"
const REFRESH_INTERVAL = 2000 // 2 seconds

// ============================================================================
// Types
// ============================================================================

interface ServiceStatus {
  name: string
  status: "running" | "stopped" | "error"
  pid?: number
  port?: number
  uptime?: string
  description: string
  health_url?: string
  depends_on?: string[]
}

interface ServicesConfig {
  version: string
  services: Record<string, any>
}

// ============================================================================
// Service Manager API
// ============================================================================

async function getAllServices(): Promise<ServiceStatus[]> {
  try {
    const response = await fetch(`${SERVICE_MANAGER_URL}/registry`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const data = await response.json()
    return data.services || []
  } catch (error) {
    return []
  }
}

async function callService(serviceName: string, tool: string, args: any = {}): Promise<string> {
  try {
    const response = await fetch(`${SERVICE_MANAGER_URL}/registry/${serviceName}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, args }),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json()
    return data.result || "No output"
  } catch (error) {
    return `Error: ${error}`
  }
}

// ============================================================================
// Dashboard UI
// ============================================================================

export async function startDashboard(): Promise<void> {
  // Create screen
  const screen = blessed.screen({
    smartCSR: true,
    title: "JFL Service Dashboard",
  })

  // Create grid layout
  const grid = new contrib.grid({ rows: 12, cols: 12, screen })

  // Service list (left side)
  const serviceList = grid.set(0, 0, 8, 4, contrib.table, {
    label: " Services ",
    tags: true,
    keys: true,
    vi: true,
    mouse: true,
    interactive: true,
    columnSpacing: 2,
    columnWidth: [20, 15, 8, 12],
    style: {
      header: {
        fg: "cyan",
        bold: true,
      },
      cell: {
        selected: {
          bg: "blue",
        },
      },
      border: {
        fg: "cyan",
      },
    },
    border: {
      type: "line",
    },
  })

  // Service details (right side top)
  const serviceDetails = grid.set(0, 4, 4, 8, blessed.box, {
    label: " Service Details ",
    tags: true,
    content: "Select a service to view details",
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
    vi: true,
    scrollbar: {
      ch: "█",
      inverse: true,
    },
    style: {
      border: {
        fg: "cyan",
      },
    },
    border: {
      type: "line",
    },
  })

  // Logs (right side bottom)
  const logsBox = grid.set(4, 4, 4, 8, blessed.log, {
    label: " Logs ",
    tags: true,
    mouse: true,
    keys: true,
    vi: true,
    scrollable: true,
    scrollbar: {
      ch: "█",
      inverse: true,
    },
    style: {
      border: {
        fg: "cyan",
      },
    },
    border: {
      type: "line",
    },
  })

  // Dependency graph (bottom left)
  const depsBox = grid.set(8, 0, 4, 4, blessed.box, {
    label: " Dependencies ",
    tags: true,
    content: "Select a service to view dependencies",
    scrollable: true,
    mouse: true,
    keys: true,
    vi: true,
    style: {
      border: {
        fg: "cyan",
      },
    },
    border: {
      type: "line",
    },
  })

  // Help box (bottom right)
  const helpBox = grid.set(8, 4, 4, 8, blessed.box, {
    label: " Commands ",
    tags: true,
    content:
      "{cyan-fg}[↑/↓]{/}  Navigate    " +
      "{cyan-fg}[s]{/}  Start        " +
      "{cyan-fg}[t]{/}  Stop         " +
      "{cyan-fg}[r]{/}  Restart\n" +
      "{cyan-fg}[h]{/}  Health       " +
      "{cyan-fg}[l]{/}  Logs         " +
      "{cyan-fg}[d]{/}  Dependencies " +
      "{cyan-fg}[q]{/}  Quit",
    style: {
      border: {
        fg: "cyan",
      },
    },
    border: {
      type: "line",
    },
  })

  // State
  let services: ServiceStatus[] = []
  let selectedService: string | null = null
  let refreshTimer: NodeJS.Timeout | null = null

  // Update service list
  async function updateServiceList() {
    services = await getAllServices()

    const headers = [
      ["Name", "Status", "Port", "Uptime"],
    ]

    const rows = services.map((service) => {
      const statusColor =
        service.status === "running" ? "{green-fg}" : service.status === "stopped" ? "{yellow-fg}" : "{red-fg}"
      const statusText = service.status === "running" ? "●" : service.status === "stopped" ? "○" : "✗"

      return [
        (service.name || "unknown").substring(0, 20),
        `${statusColor}${statusText}{/} ${service.status || "unknown"}`,
        service.port?.toString() || "-",
        service.uptime || "-",
      ]
    })

    // If no services, show a placeholder row
    if (rows.length === 0) {
      rows.push(["{gray-fg}No services found{/}", "{gray-fg}Start Service Manager{/}", "-", "-"])
    }

    serviceList.setData({
      headers: headers[0],
      data: rows,
    })
    screen.render()
  }

  // Update service details
  async function updateServiceDetails(serviceName: string) {
    const service = services.find((s) => s.name === serviceName)
    if (!service) return

    let content = `{bold}Name:{/bold} ${service.name}\n`
    content += `{bold}Status:{/bold} ${service.status}\n`
    content += `{bold}Description:{/bold} ${service.description}\n`

    if (service.port) {
      content += `{bold}Port:{/bold} ${service.port}\n`
    }

    if (service.pid) {
      content += `{bold}PID:{/bold} ${service.pid}\n`
    }

    if (service.uptime) {
      content += `{bold}Uptime:{/bold} ${service.uptime}\n`
    }

    if (service.health_url) {
      content += `{bold}Health URL:{/bold} ${service.health_url}\n`

      // Check health
      try {
        const healthResult = await callService(serviceName, "health", {})
        const healthStatus = healthResult.includes("passed")
          ? "{green-fg}✓ Healthy{/}"
          : "{red-fg}✗ Unhealthy{/}"
        content += `{bold}Health:{/bold} ${healthStatus}\n`
      } catch {
        content += `{bold}Health:{/bold} {gray-fg}Unknown{/}\n`
      }
    }

    serviceDetails.setContent(content)
    screen.render()
  }

  // Update dependencies
  function updateDependencies(serviceName: string) {
    const config: ServicesConfig = JSON.parse(fs.readFileSync(GLOBAL_SERVICES_FILE, "utf-8"))
    const service = config.services[serviceName]

    if (!service) return

    let content = `{bold}${serviceName}{/bold}\n\n`

    if (service.depends_on && service.depends_on.length > 0) {
      content += "{cyan-fg}Depends on:{/}\n"
      service.depends_on.forEach((dep: string) => {
        content += `  └─ ${dep}\n`
      })
    } else {
      content += "{gray-fg}No dependencies{/}\n"
    }

    content += "\n"

    // Find dependents
    const dependents = Object.entries(config.services)
      .filter(([_, svc]: [string, any]) => svc.depends_on?.includes(serviceName))
      .map(([name]) => name)

    if (dependents.length > 0) {
      content += "{cyan-fg}Required by:{/}\n"
      dependents.forEach((dep) => {
        content += `  └─ ${dep}\n`
      })
    } else {
      content += "{gray-fg}No dependents{/}\n"
    }

    depsBox.setContent(content)
    screen.render()
  }

  // Handle service selection
  serviceList.rows.on("select", async (item: any, index: number) => {
    if (index < 0 || index >= services.length) return

    selectedService = services[index].name
    await updateServiceDetails(selectedService)
    updateDependencies(selectedService)
  })

  // Keyboard shortcuts
  screen.key(["s"], async () => {
    if (!selectedService) return
    logsBox.log(`{cyan-fg}Starting ${selectedService}...{/}`)
    const result = await callService(selectedService, "start", {})
    logsBox.log(result)
    await updateServiceList()
    await updateServiceDetails(selectedService)
  })

  screen.key(["t"], async () => {
    if (!selectedService) return
    logsBox.log(`{cyan-fg}Stopping ${selectedService}...{/}`)
    const result = await callService(selectedService, "stop", {})
    logsBox.log(result)
    await updateServiceList()
    await updateServiceDetails(selectedService)
  })

  screen.key(["r"], async () => {
    if (!selectedService) return
    logsBox.log(`{cyan-fg}Restarting ${selectedService}...{/}`)
    const result = await callService(selectedService, "restart", {})
    logsBox.log(result)
    await updateServiceList()
    await updateServiceDetails(selectedService)
  })

  screen.key(["h"], async () => {
    if (!selectedService) return
    logsBox.log(`{cyan-fg}Checking health of ${selectedService}...{/}`)
    const result = await callService(selectedService, "health", {})
    logsBox.log(result)
  })

  screen.key(["l"], async () => {
    if (!selectedService) return
    logsBox.log(`{cyan-fg}Fetching logs for ${selectedService}...{/}`)
    const result = await callService(selectedService, "logs", { lines: 20 })
    logsBox.log(result)
  })

  screen.key(["d"], () => {
    if (!selectedService) return
    updateDependencies(selectedService)
  })

  screen.key(["q", "C-c"], () => {
    if (refreshTimer) {
      clearInterval(refreshTimer)
    }
    process.exit(0)
  })

  // Initial load
  logsBox.log("{cyan-fg}JFL Service Dashboard Started{/}")
  logsBox.log("{gray-fg}Press 'h' for help{/}")
  await updateServiceList()

  // Auto-refresh
  refreshTimer = setInterval(async () => {
    await updateServiceList()
    if (selectedService) {
      await updateServiceDetails(selectedService)
    }
  }, REFRESH_INTERVAL)

  // Focus service list
  serviceList.focus()

  // Render
  screen.render()
}

// ============================================================================
// Main
// ============================================================================

// ESM compatibility: Check if this module is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startDashboard().catch((error) => {
    console.error("Failed to start dashboard:", error)
    process.exit(1)
  })
}
