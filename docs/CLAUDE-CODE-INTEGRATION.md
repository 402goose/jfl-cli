# Claude Code @Mention Integration

**How Claude Code can integrate with JFL Service Mesh for @mention support**

## Overview

JFL Service Mesh provides a complete registry API that Claude Code can use to discover services and execute tools via @mentions.

```
User: @stratus-v2 status
Claude: *queries registry* → *calls tool* → Returns status

User: @formation-gtm start
Claude: *starts service* → Confirms started

User: @stratus-llm-proxy deploy to production
Claude: *executes custom tool* → Shows deployment progress
```

---

## Integration Architecture

```
Claude Code
    ↓
Service Registry Discovery
    ↓
Service Manager API (localhost:3402)
    ↓
Auto-Generated MCP Servers
    ↓
Actual Services
```

---

## Step 1: Service Discovery

### GET /registry - List All Services

```bash
curl http://localhost:3402/registry

Response:
{
  "services": [
    {
      "name": "stratus-v2",
      "status": "running",
      "port": 3000,
      "description": "Next.js website for stratus.run",
      "health_url": "http://localhost:3000/health"
    },
    {
      "name": "formation-gtm",
      "status": "stopped",
      "port": 4000,
      "description": "Formation GTM toolkit",
      "health_url": "http://localhost:4000/health"
    }
  ]
}
```

**Claude Code Implementation:**
```typescript
async function discoverServices(): Promise<Service[]> {
  const response = await fetch('http://localhost:3402/registry')
  const data = await response.json()
  return data.services
}

// On startup, populate @mention autocomplete
const services = await discoverServices()
// Register @stratus-v2, @formation-gtm, etc. for autocomplete
```

---

## Step 2: Service Tool Discovery

### GET /registry/:serviceName - Get Service Info

```bash
curl http://localhost:3402/registry/stratus-v2

Response:
{
  "service": {
    "name": "stratus-v2",
    "status": "running",
    "description": "Next.js website for stratus.run",
    "tools": [
      "status", "start", "stop", "restart",
      "logs", "health", "deploy", "build"
    ]
  }
}
```

**Note:** The `tools` field is not currently in the response but should be added. Available tools are:
- Standard: `status`, `start`, `stop`, `restart`, `logs`, `health`
- Custom: defined in `services.json` under `mcp.tools`

---

## Step 3: Execute Service Tools

### POST /registry/:serviceName/call - Call Service Tool

```bash
curl -X POST http://localhost:3402/registry/stratus-v2/call \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "status",
    "args": {}
  }'

Response:
{
  "result": "Service: stratus-v2\nStatus: running\nPort: 3000\nPID: 54814"
}
```

**Claude Code Implementation:**
```typescript
async function callServiceTool(
  serviceName: string,
  tool: string,
  args: Record<string, any> = {}
): Promise<string> {
  const response = await fetch(
    `http://localhost:3402/registry/${serviceName}/call`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args })
    }
  )

  const data = await response.json()
  return data.result
}

// When user types: @stratus-v2 status
const result = await callServiceTool('stratus-v2', 'status')
// Display result to user
```

---

## @Mention Parsing

### Simple Commands
```
@service-name tool-name
→ callServiceTool('service-name', 'tool-name', {})

Examples:
@stratus-v2 status
@formation-gtm start
@stratus-llm-proxy health
```

### Commands with Arguments
```
@service-name tool-name arg1=value1 arg2=value2
→ callServiceTool('service-name', 'tool-name', {arg1: 'value1', arg2: 'value2'})

Examples:
@stratus-v2 logs lines=50
@stratus-api deploy environment=production
```

### Natural Language (Advanced)
```
@stratus-v2 show me the last 20 lines of logs
→ Extract intent: tool=logs, args={lines: 20}
→ callServiceTool('stratus-v2', 'logs', {lines: 20})

@formation-gtm what's the current status?
→ Extract intent: tool=status
→ callServiceTool('formation-gtm', 'status', {})
```

---

## Available Tools

### Standard Tools (All Services)

| Tool | Description | Args |
|------|-------------|------|
| `status` | Get service status | none |
| `start` | Start service | none |
| `stop` | Stop service | none |
| `restart` | Restart service | none |
| `logs` | Get service logs | `lines?: number` |
| `health` | Check service health | none |

### Custom Tools

Custom tools are defined in `~/.jfl/services.json`:

```json
{
  "services": {
    "stratus-v2": {
      "mcp": {
        "enabled": true,
        "tools": [
          {
            "name": "deploy",
            "description": "Deploy to production",
            "inputSchema": {
              "type": "object",
              "properties": {
                "environment": {
                  "type": "string",
                  "enum": ["staging", "production"]
                }
              }
            },
            "command": "cd ${SERVICE_PATH} && ./deploy.sh ${environment}"
          }
        ]
      }
    }
  }
}
```

---

## Integration Checklist

### Phase 1: Basic Integration
- [ ] Discover services from registry on startup
- [ ] Populate @mention autocomplete with service names
- [ ] Parse @mention commands (@service-name tool-name)
- [ ] Call Service Manager API to execute tools
- [ ] Display results to user

### Phase 2: Enhanced Features
- [ ] Show service status in @mention dropdown (running/stopped)
- [ ] Add tool autocomplete (@service-name → shows available tools)
- [ ] Support arguments (@service-name tool arg1=val1)
- [ ] Show real-time execution progress
- [ ] Handle errors gracefully

### Phase 3: Advanced Features
- [ ] Natural language parsing for @mentions
- [ ] Multi-service orchestration (@deploy-all)
- [ ] Dependency-aware operations (auto-start dependencies)
- [ ] Service health monitoring in sidebar
- [ ] Log streaming for running operations

---

## Error Handling

### Service Not Found
```json
{
  "error": "Service not found: unknown-service"
}
```

**Claude Code Response:**
```
I couldn't find a service named "unknown-service".

Available services:
- stratus-v2 (running)
- formation-gtm (stopped)
- stratus-llm-proxy (stopped)
```

### Tool Not Found
```json
{
  "error": "Unknown tool: invalid-tool"
}
```

**Claude Code Response:**
```
The tool "invalid-tool" is not available for stratus-v2.

Available tools:
- status, start, stop, restart, logs, health
- deploy, build (custom)
```

### Service Manager Not Running
```
Connection refused: http://localhost:3402
```

**Claude Code Response:**
```
Service Manager is not running.

To start it:
  jfl service-manager start
```

---

## Example Integration Code

```typescript
// service-registry.ts
export class ServiceRegistry {
  private baseUrl = 'http://localhost:3402'
  private services: Map<string, Service> = new Map()

  async initialize() {
    try {
      const services = await this.discoverServices()
      services.forEach(service => {
        this.services.set(service.name, service)
      })
      console.log(`Discovered ${services.length} services`)
    } catch (error) {
      console.warn('Service Manager not available:', error)
    }
  }

  async discoverServices(): Promise<Service[]> {
    const response = await fetch(`${this.baseUrl}/registry`)
    const data = await response.json()
    return data.services
  }

  async callTool(
    serviceName: string,
    tool: string,
    args: Record<string, any> = {}
  ): Promise<string> {
    const response = await fetch(
      `${this.baseUrl}/registry/${serviceName}/call`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, args })
      }
    )

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Service call failed')
    }

    const data = await response.json()
    return data.result
  }

  getServiceNames(): string[] {
    return Array.from(this.services.keys())
  }

  getService(name: string): Service | undefined {
    return this.services.get(name)
  }
}

// mention-handler.ts
export class MentionHandler {
  constructor(private registry: ServiceRegistry) {}

  async handleMention(mention: string): Promise<string> {
    // Parse @mention
    // Format: @service-name tool-name [args]
    const match = mention.match(/@([\w-]+)\s+([\w-]+)(.*)/)

    if (!match) {
      return 'Invalid @mention format. Use: @service-name tool-name'
    }

    const [_, serviceName, toolName, argsStr] = match

    // Check if service exists
    const service = this.registry.getService(serviceName)
    if (!service) {
      const available = this.registry.getServiceNames().join(', ')
      return `Service "${serviceName}" not found. Available: ${available}`
    }

    // Parse args (simple key=value parsing)
    const args: Record<string, any> = {}
    const argMatches = argsStr.matchAll(/(\w+)=(\w+)/g)
    for (const [_, key, value] of argMatches) {
      args[key] = value
    }

    // Execute tool
    try {
      const result = await this.registry.callTool(serviceName, toolName, args)
      return result
    } catch (error) {
      return `Error calling ${serviceName}.${toolName}: ${error}`
    }
  }
}

// Usage in Claude Code
const registry = new ServiceRegistry()
await registry.initialize()

const mentionHandler = new MentionHandler(registry)

// When user types @mention:
const result = await mentionHandler.handleMention('@stratus-v2 status')
console.log(result)
// → "Service: stratus-v2\nStatus: running\nPort: 3000"
```

---

## Auto-Refresh

Services can be added/removed dynamically. Claude Code should periodically refresh the registry:

```typescript
// Refresh every 30 seconds
setInterval(async () => {
  await registry.initialize()
}, 30000)

// Or watch for changes
const watcher = new ServiceRegistryWatcher()
watcher.on('change', async () => {
  await registry.initialize()
  updateMentionAutocomplete()
})
```

---

## Security Considerations

1. **Local Only** - Service Manager runs on localhost:3402, not exposed externally
2. **No Authentication** - Currently no auth (local trust model)
3. **Command Injection** - Service Manager sanitizes shell commands
4. **Tool Validation** - Only registered tools can be executed

**For Production:**
- Add authentication token
- Rate limiting per service
- Audit logging of all tool calls
- Sandboxed command execution

---

## Testing

```typescript
// test/service-integration.test.ts
describe('Service Integration', () => {
  let registry: ServiceRegistry

  beforeAll(async () => {
    registry = new ServiceRegistry()
    await registry.initialize()
  })

  it('discovers services', () => {
    const services = registry.getServiceNames()
    expect(services.length).toBeGreaterThan(0)
  })

  it('calls service tool', async () => {
    const result = await registry.callTool('stratus-v2', 'status')
    expect(result).toContain('stratus-v2')
  })

  it('handles @mention', async () => {
    const handler = new MentionHandler(registry)
    const result = await handler.handleMention('@stratus-v2 status')
    expect(result).toContain('Status: ')
  })
})
```

---

## Next Steps

1. **Add to .mcp.json** - Register service registry as MCP server
2. **Add Tools Endpoint** - `GET /registry/:name/tools` to list available tools
3. **Add Streaming** - Support streaming logs and long-running operations
4. **Add Webhooks** - Notify Claude Code when services change state
5. **Add Context** - Include service context (recent logs, errors) in @mention responses

---

## Contact

Questions about integration? Open an issue at:
https://github.com/402goose/jfl-cli/issues
