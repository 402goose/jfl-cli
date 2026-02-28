/**
 * MAP Event Bus Dashboard
 *
 * Real-time TUI showing live event stream, agent status, and event breakdown.
 * Connects to Context Hub via SSE for instant updates.
 *
 * @purpose Live MAP event bus monitoring dashboard with SSE streaming
 */

import blessed from "blessed"
import contrib from "blessed-contrib"
import * as fs from "fs"
import * as path from "path"
import { getProjectHubUrl } from "../utils/context-hub-port.js"

const FILTER_PATTERNS = ["*", "peter:*", "task:*", "session:*"]
const AGENT_TIMEOUT_MS = 60_000

interface DashboardEvent {
  id: string
  type: string
  source: string
  ts: string
  data?: Record<string, unknown>
}

interface AgentInfo {
  name: string
  model: string
  source: "peter" | "fly" | "local"
  lastSeen: number
}

function getAuthToken(projectRoot: string): string | null {
  const tokenPath = path.join(projectRoot, ".jfl", "context-hub.token")
  if (fs.existsSync(tokenPath)) {
    return fs.readFileSync(tokenPath, "utf-8").trim()
  }
  return null
}

function loadAgents(projectRoot: string): AgentInfo[] {
  const agents: AgentInfo[] = []

  const configPath = path.join(projectRoot, ".ralph-tui", "config.toml")
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, "utf-8")
    const agentMatches = content.matchAll(/\[\[agents\]\]\nname = "([^"]+)"[\s\S]*?model = "([^"]+)"/g)
    for (const match of agentMatches) {
      const name = match[1]
      if (name.endsWith("-fallback")) continue
      agents.push({ name, model: match[2], source: "peter", lastSeen: 0 })
    }
  }

  const servicesPath = path.join(projectRoot, ".jfl", "services.json")
  if (fs.existsSync(servicesPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(servicesPath, "utf-8"))
      const services = config.services || {}
      for (const [name, svc] of Object.entries(services) as [string, any][]) {
        if (!agents.find((a) => a.name === name)) {
          agents.push({ name, model: svc.type || "svc", source: "fly", lastSeen: 0 })
        }
      }
    } catch {}
  }

  return agents
}

function colorForType(type: string): string {
  if (type.startsWith("peter:")) return "{cyan-fg}"
  if (type.startsWith("task:")) return "{green-fg}"
  if (type.startsWith("session:")) return "{yellow-fg}"
  if (type.startsWith("decision:")) return "{magenta-fg}"
  if (type === "discovery" || type === "custom") return "{red-fg}"
  return "{white-fg}"
}

function formatTime(ts: string): string {
  const d = new Date(ts)
  return d.toTimeString().slice(0, 8)
}

function formatEventLine(event: DashboardEvent): string {
  const time = formatTime(event.ts)
  const color = colorForType(event.type)
  let detail = ""
  if (event.data) {
    if (event.data.title) detail = ` ${event.data.title}`
    else if (event.data.file) detail = ` ${event.data.file}`
    else if (event.data.profile) detail = ` ${event.data.profile}`
  }
  return `{gray-fg}${time}{/} ${color}[${event.type}]{/} ${event.source}${detail}`
}

export async function startEventDashboard(options?: { pattern?: string }): Promise<void> {
  const projectRoot = process.cwd()
  const hubUrl = getProjectHubUrl(projectRoot)
  const token = getAuthToken(projectRoot)

  if (!token) {
    console.error("No auth token found at .jfl/context-hub.token")
    console.error("Start Context Hub first: jfl context-hub ensure")
    process.exit(1)
  }

  const screen = blessed.screen({
    smartCSR: true,
    title: "MAP Event Bus Dashboard",
  })

  const grid = new contrib.grid({ rows: 12, cols: 12, screen })

  const eventStream = grid.set(0, 0, 8, 8, blessed.log, {
    label: " Event Stream ",
    tags: true,
    mouse: true,
    keys: true,
    vi: true,
    scrollable: true,
    scrollbar: { ch: "█", inverse: true },
    style: { border: { fg: "cyan" } },
    border: { type: "line" },
  })

  const agentsBox = grid.set(0, 8, 8, 4, blessed.box, {
    label: " Agents ",
    tags: true,
    content: "{gray-fg}Loading...{/}",
    scrollable: true,
    mouse: true,
    style: { border: { fg: "cyan" } },
    border: { type: "line" },
  })

  const breakdownBox = grid.set(8, 0, 4, 8, blessed.box, {
    label: " Event Breakdown ",
    tags: true,
    content: "{gray-fg}No events yet{/}",
    style: { border: { fg: "cyan" } },
    border: { type: "line" },
  })

  const commandsBox = grid.set(8, 8, 4, 4, blessed.box, {
    label: " Commands ",
    tags: true,
    content:
      "{cyan-fg}[p]{/} Publish test  {cyan-fg}[f]{/} Filter\n" +
      "{cyan-fg}[c]{/} Clear         {cyan-fg}[q]{/} Quit\n\n" +
      `Pattern: {cyan-fg}${options?.pattern || "*"}{/}`,
    style: { border: { fg: "cyan" } },
    border: { type: "line" },
  })

  let agents = loadAgents(projectRoot)
  const agentLastSeen = new Map<string, number>()
  const typeCounts = new Map<string, number>()
  let currentFilterIndex = FILTER_PATTERNS.indexOf(options?.pattern || "*")
  if (currentFilterIndex === -1) currentFilterIndex = 0
  let currentPattern = FILTER_PATTERNS[currentFilterIndex]
  let sseAbort: AbortController | null = null

  function updateAgentsPanel() {
    const now = Date.now()
    const lines = agents.map((agent) => {
      const seen = agentLastSeen.get(agent.name) || 0
      const alive = now - seen < AGENT_TIMEOUT_MS && seen > 0
      const indicator = alive ? "{green-fg}●{/}" : "{gray-fg}○{/}"
      const model = agent.model.padEnd(6)
      return ` ${agent.name.padEnd(12)} ${model} ${indicator}`
    })

    if (lines.length === 0) {
      agentsBox.setContent("{gray-fg}No agents configured{/}")
    } else {
      agentsBox.setContent(lines.join("\n"))
    }
    screen.render()
  }

  function updateBreakdown() {
    if (typeCounts.size === 0) {
      breakdownBox.setContent("{gray-fg}No events yet{/}")
      screen.render()
      return
    }

    const sorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])
    const maxCount = sorted[0][1]
    const barWidth = 40

    const lines = sorted.slice(0, 6).map(([type, count]) => {
      const filled = Math.max(1, Math.round((count / maxCount) * barWidth))
      const empty = barWidth - filled
      const prefix = typePrefix(type)
      const color = colorForType(type).replace("{", "").replace("}", "")
      return ` {${color}}${"█".repeat(filled)}{/}{gray-fg}${"░".repeat(empty)}{/} ${prefix.padEnd(14)} ${count}`
    })

    breakdownBox.setContent(lines.join("\n"))
    screen.render()
  }

  function typePrefix(type: string): string {
    const colon = type.indexOf(":")
    if (colon > 0) return type.slice(0, colon) + ":*"
    return type
  }

  function handleEvent(event: DashboardEvent) {
    eventStream.log(formatEventLine(event))
    agentLastSeen.set(event.source, Date.now())
    if (!agents.find((a) => a.name === event.source)) {
      agents.push({ name: event.source, model: "?", source: "local", lastSeen: Date.now() })
    }

    const prefix = typePrefix(event.type)
    typeCounts.set(prefix, (typeCounts.get(prefix) || 0) + 1)

    updateAgentsPanel()
    updateBreakdown()
  }

  async function fetchInitialEvents() {
    try {
      const params = new URLSearchParams({ limit: "50" })
      if (currentPattern !== "*") params.set("pattern", currentPattern)

      const response = await fetch(`${hubUrl}/api/events?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        eventStream.log(`{red-fg}Failed to fetch events: HTTP ${response.status}{/}`)
        return
      }

      const data = (await response.json()) as { events: DashboardEvent[]; count: number }
      if (data.events && data.events.length > 0) {
        const reversed = [...data.events].reverse()
        for (const event of reversed) {
          handleEvent(event)
        }
        eventStream.log(`{gray-fg}── loaded ${data.events.length} historical events ──{/}`)
      }
    } catch (err: any) {
      eventStream.log(`{red-fg}Event fetch failed: ${err.message}{/}`)
    }
  }

  async function connectSSE() {
    if (sseAbort) sseAbort.abort()
    sseAbort = new AbortController()

    const params = new URLSearchParams()
    if (currentPattern !== "*") params.set("patterns", currentPattern)
    const url = `${hubUrl}/api/events/stream?${params}`

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
        },
        signal: sseAbort.signal,
      })

      if (!response.ok || !response.body) {
        eventStream.log(`{red-fg}SSE connection failed: HTTP ${response.status}{/}`)
        setTimeout(connectSSE, 5000)
        return
      }

      eventStream.log("{green-fg}Connected to event stream{/}")
      screen.render()

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const blocks = buffer.split("\n\n")
        buffer = blocks.pop() || ""

        for (const block of blocks) {
          const lines = block.split("\n")
          let data = ""
          for (const line of lines) {
            if (line.startsWith("data:")) {
              data += line.slice(5).trim()
            }
          }
          if (!data) continue

          try {
            const event = JSON.parse(data) as DashboardEvent
            if (event.type && event.source) {
              handleEvent(event)
            }
          } catch {}
        }
      }

      eventStream.log("{yellow-fg}Stream disconnected, reconnecting...{/}")
      screen.render()
      setTimeout(connectSSE, 3000)
    } catch (err: any) {
      if (err.name === "AbortError") return
      eventStream.log(`{red-fg}SSE error: ${err.message}{/}`)
      screen.render()
      setTimeout(connectSSE, 5000)
    }
  }

  screen.key(["p"], async () => {
    try {
      await fetch(`${hubUrl}/api/events`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "dashboard:test",
          source: "event-dashboard",
          data: { message: "Test event from dashboard" },
        }),
      })
    } catch (err: any) {
      eventStream.log(`{red-fg}Publish failed: ${err.message}{/}`)
      screen.render()
    }
  })

  screen.key(["f"], () => {
    currentFilterIndex = (currentFilterIndex + 1) % FILTER_PATTERNS.length
    currentPattern = FILTER_PATTERNS[currentFilterIndex]

    commandsBox.setContent(
      "{cyan-fg}[p]{/} Publish test  {cyan-fg}[f]{/} Filter\n" +
        "{cyan-fg}[c]{/} Clear         {cyan-fg}[q]{/} Quit\n\n" +
        `Pattern: {cyan-fg}${currentPattern}{/}`
    )
    screen.render()

    eventStream.log(`{yellow-fg}Filter changed to: ${currentPattern}{/}`)
    typeCounts.clear()
    connectSSE()
  })

  screen.key(["c"], () => {
    eventStream.setContent("")
    typeCounts.clear()
    updateBreakdown()
    screen.render()
  })

  screen.key(["q", "escape", "C-c"], () => {
    if (sseAbort) sseAbort.abort()
    process.exit(0)
  })

  eventStream.log("{cyan-fg}MAP Event Bus Dashboard{/}")
  eventStream.log(`{gray-fg}Hub: ${hubUrl}{/}`)
  eventStream.log(`{gray-fg}Pattern: ${currentPattern}{/}`)
  eventStream.log("")

  updateAgentsPanel()
  screen.render()

  await fetchInitialEvents()
  connectSSE()

  const agentRefresh = setInterval(() => {
    updateAgentsPanel()
  }, 10_000)

  screen.on("destroy", () => {
    clearInterval(agentRefresh)
    if (sseAbort) sseAbort.abort()
  })
}
