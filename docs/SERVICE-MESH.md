# Service Mesh Architecture

**Complete service-to-AI and service-to-service communication framework**

## Overview

JFL Service Mesh enables:
1. **Service-Local MCP Servers** - Each service owns its AI interface
2. **Service Discovery** - Service Manager maintains registry
3. **Inter-Service Communication** - Services can call each other via Service Manager
4. **Claude Code Integration** - @mention services in conversations

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Claude Code (AI Orchestrator)                          │
│  - Can @mention services                                │
│  - Queries Service Manager registry                     │
└─────────────────────────────────────────────────────────┘
                           │
                           │ MCP Protocol
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Service Manager (Hub & Registry)                       │
│  - Port 3402                                            │
│  - Maintains service registry                           │
│  - Routes inter-service calls                           │
│  - Provides discovery API                               │
└─────────────────────────────────────────────────────────┘
         │                 │                 │
         │ MCP             │ MCP             │ MCP
         ▼                 ▼                 ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ Frontend    │   │ API         │   │ Database    │
│ MCP Server  │   │ MCP Server  │   │ MCP Server  │
│ (.jfl-mcp.js)   │ (.jfl-mcp.js)   │ (.jfl-mcp.js)
└─────────────┘   └─────────────┘   └─────────────┘
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ Next.js     │   │ Node.js     │   │ PostgreSQL  │
│ Service     │   │ Service     │   │ Service     │
└─────────────┘   └─────────────┘   └─────────────┘
```

## Quick Start

### 1. Initialize MCP Server in Service Repo

```bash
cd /path/to/your-service
jfl service-agent init

# Creates:
# - .jfl-mcp.js (MCP server)
# - .jfl-mcp.config.json (configuration)
```

### 2. Customize Tools

Edit `.jfl-mcp.js` to add service-specific tools:

```javascript
const TOOLS = [
  {
    name: "status",
    description: "Get service status",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "deploy",
    description: "Deploy to production",
    inputSchema: {
      type: "object",
      properties: {
        environment: {
          type: "string",
          enum: ["staging", "production"]
        }
      }
    }
  },
  // Add more custom tools...
]

async function handleToolCall(toolName, args) {
  switch (toolName) {
    case "deploy":
      return await handleDeploy(args)
    // Handle custom tools...
  }
}
```

### 3. Register with GTM Project

```bash
jfl onboard /path/to/your-service
```

This adds the service to `.jfl/services.json` in your GTM project.

### 4. Start Service Manager

```bash
jfl service-manager start
```

Service Manager runs on port 3402 and maintains the registry.

## Service Registry API

### List All Services
```
GET http://localhost:3402/registry

Response:
{
  "services": [
    {
      "name": "frontend",
      "status": "running",
      "description": "Next.js frontend",
      "port": 3000,
      ...
    }
  ]
}
```

### Get Service Info
```
GET http://localhost:3402/registry/:serviceName

Response:
{
  "service": {
    "name": "api",
    "status": "running",
    ...
  }
}
```

### Call Service Tool
```
POST http://localhost:3402/registry/:serviceName/call
Content-Type: application/json

{
  "tool": "deploy",
  "args": {
    "environment": "production"
  }
}

Response:
{
  "result": "Deployment started: deploy-abc123"
}
```

### Register Service
```
POST http://localhost:3402/registry/register
Content-Type: application/json

{
  "name": "my-service",
  "description": "My API service",
  "version": "1.0.0",
  "path": "/path/to/service",
  "mcpServerPath": "/path/to/service/.jfl-mcp.js"
}
```

## Inter-Service Communication

Services can call each other using the Service Mesh Client:

```javascript
// In your service's .jfl-mcp.js:

const meshClient = new ServiceMeshClient()

async function handleDeploy(args) {
  // Call the frontend service to get current version
  const frontendInfo = await meshClient.callService(
    'frontend',
    'get_version',
    {}
  )

  // Call the database service to run migrations
  await meshClient.callService(
    'database',
    'migrate',
    { version: args.version }
  )

  // Deploy this service
  return `Deployed ${SERVICE_NAME} v${args.version}`
}
```

## Claude Code Integration

### @Mentions (Coming Soon)

Once integrated with Claude Code, you can mention services:

```
User: @frontend what's the current deployment status?
Claude: *calls frontend_status()*

User: @api deploy to production
Claude: *calls api_deploy(environment="production")*

User: @database run migrations
Claude: *calls database_migrate()*
```

### Service Discovery

Claude Code can query the registry to:
1. List available services
2. Discover service tools
3. Route commands to the right service
4. Orchestrate multi-service operations

## Project Structure

### GTM Project with Services

```
my-gtm-project/
├── .jfl/
│   └── services.json          # Service definitions
├── frontend/                  # Service repo
│   ├── src/
│   ├── .jfl-mcp.js           # Service MCP server
│   └── .jfl-mcp.config.json  # Service config
├── api/                       # Service repo
│   ├── src/
│   ├── .jfl-mcp.js
│   └── .jfl-mcp.config.json
└── database/                  # Service repo
    ├── migrations/
    ├── .jfl-mcp.js
    └── .jfl-mcp.config.json
```

### Global Services

```
~/.jfl/
├── services.json              # Global service registry
└── service-agents/            # Global MCP servers (deprecated in favor of service-local)
```

## Commands

### Service Agent Commands

```bash
# Initialize MCP server in current directory
jfl service-agent init

# Initialize MCP server in specific directory
jfl service-agent init /path/to/service

# List all services and their MCP status
jfl service-agent list

# Generate centralized MCP server (legacy)
jfl service-agent generate <service-name>

# Generate all centralized MCP servers
jfl service-agent generate-all

# Register services with Claude Code
jfl service-agent register

# Clean up generated agents
jfl service-agent clean
```

### Service Manager Commands

```bash
# Start Service Manager daemon
jfl service-manager start

# Stop Service Manager daemon
jfl service-manager stop

# Restart Service Manager daemon
jfl service-manager restart

# Check Service Manager status
jfl service-manager status

# Run Service Manager in foreground
jfl service-manager serve
```

### Onboarding Services

```bash
# Onboard a service repo
jfl onboard /path/to/service

# Onboard with custom name
jfl onboard /path/to/service --name my-api

# Onboard with type
jfl onboard /path/to/service --type api
```

## Example: stratus.run Service

### Service Configuration (`.jfl/services.json`)

```json
{
  "stratus.run": {
    "type": "server",
    "description": "Next.js website for stratus.run",
    "port": 3000,
    "start_command": "cd /path/to/stratus.run && npm run dev",
    "stop_command": "lsof -ti:3000 | xargs kill -9",
    "detection_command": "lsof -ti:3000 -sTCP:LISTEN",
    "health_url": "http://localhost:3000/api/health",
    "mcp": {
      "enabled": true,
      "tools": [
        {
          "name": "deploy_develop",
          "description": "Deploy to preview (develop branch)",
          "command": "cd ${SERVICE_PATH} && git push origin develop"
        },
        {
          "name": "deploy_production",
          "description": "Deploy to production (main branch)",
          "command": "cd ${SERVICE_PATH} && git push origin main"
        }
      ]
    }
  }
}
```

### Service MCP Server (`stratus.run/.jfl-mcp.js`)

```javascript
#!/usr/bin/env node

const SERVICE_NAME = "stratus.run"
const SERVICE_MANAGER_URL = "http://localhost:3402"

// Service Mesh Client for inter-service calls
class ServiceMeshClient {
  async callService(serviceName, toolName, args = {}) {
    const response = await fetch(
      `${SERVICE_MANAGER_URL}/registry/${serviceName}/call`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: toolName, args }),
      }
    )
    return await response.json()
  }
}

const meshClient = new ServiceMeshClient()

// Custom tools for stratus.run
const TOOLS = [
  {
    name: "status",
    description: "Get status of stratus.run",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "deploy_preview",
    description: "Deploy to preview environment",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "deploy_production",
    description: "Deploy to production",
    inputSchema: { type: "object", properties: {} },
  },
]

async function handleToolCall(toolName, args) {
  switch (toolName) {
    case "deploy_preview":
      return await deployPreview()
    case "deploy_production":
      return await deployProduction()
    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

async function deployPreview() {
  // Push to develop branch → triggers Vercel preview
  const { exec } = require('child_process')
  const { promisify } = require('util')
  const execAsync = promisify(exec)

  await execAsync('git push origin develop', { cwd: __dirname })
  return "Pushed to develop branch. Vercel preview deployment triggered."
}

async function deployProduction() {
  // Push to main branch → triggers Vercel production
  const { exec } = require('child_process')
  const { promisify } = require('util')
  const execAsync = promisify(exec)

  await execAsync('git push origin main', { cwd: __dirname })
  return "Pushed to main branch. Vercel production deployment triggered."
}

// MCP protocol handler...
```

## Advanced Patterns

### Multi-Service Orchestration

```javascript
// In a "deployment" service that orchestrates others:

async function handleFullDeploy(args) {
  const { version, environment } = args

  // 1. Run database migrations
  await meshClient.callService('database', 'migrate', { version })

  // 2. Deploy API
  await meshClient.callService('api', 'deploy', { environment, version })

  // 3. Deploy frontend
  await meshClient.callService('frontend', 'deploy', { environment, version })

  // 4. Run smoke tests
  await meshClient.callService('test-suite', 'smoke_test', { environment })

  return `Full deployment to ${environment} completed: v${version}`
}
```

### Service Dependencies

```javascript
// In an API service that depends on database:

async function handleStart(args) {
  // Check if database is running
  const dbInfo = await meshClient.getServiceInfo('database')

  if (dbInfo.status !== 'running') {
    // Start database first
    await meshClient.callService('database', 'start', {})

    // Wait for it to be healthy
    await new Promise(resolve => setTimeout(resolve, 5000))
  }

  // Now start this service
  return startAPI()
}
```

### Health Aggregation

```javascript
// In a monitoring service:

async function handleHealthCheck(args) {
  const services = await meshClient.listServices()

  const healthChecks = await Promise.all(
    services.map(async (service) => {
      try {
        const health = await meshClient.callService(service.name, 'health', {})
        return { service: service.name, status: 'healthy', health }
      } catch (error) {
        return { service: service.name, status: 'unhealthy', error: error.message }
      }
    })
  )

  return {
    overall: healthChecks.every(h => h.status === 'healthy') ? 'healthy' : 'degraded',
    services: healthChecks
  }
}
```

## Best Practices

### 1. Service MCP Servers Should Be Idempotent
```javascript
// Good: Check state before acting
async function handleStart() {
  const status = await getStatus()
  if (status === 'running') {
    return 'Already running'
  }
  return await actuallyStart()
}

// Bad: Always try to start
async function handleStart() {
  return await actuallyStart() // May fail if already running
}
```

### 2. Include Health Checks
```javascript
async function handleHealth() {
  // Check all critical dependencies
  const checks = {
    database: await checkDatabaseConnection(),
    redis: await checkRedisConnection(),
    disk: await checkDiskSpace(),
    memory: await checkMemoryUsage(),
  }

  const allHealthy = Object.values(checks).every(c => c.healthy)

  return {
    status: allHealthy ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString()
  }
}
```

### 3. Provide Meaningful Status Info
```javascript
async function handleStatus() {
  return {
    service: SERVICE_NAME,
    status: 'running',
    version: require('./package.json').version,
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    connections: {
      active: getActiveConnections(),
      total: getTotalConnections()
    },
    lastDeploy: getLastDeployTime(),
    commitHash: getGitCommit()
  }
}
```

### 4. Error Handling
```javascript
async function handleToolCall(toolName, args) {
  try {
    // Validate args
    if (toolName === 'deploy' && !args.environment) {
      throw new Error('environment is required')
    }

    // Execute tool
    const result = await executeTool(toolName, args)

    return result
  } catch (error) {
    // Return structured error
    return {
      error: true,
      message: error.message,
      tool: toolName,
      timestamp: new Date().toISOString()
    }
  }
}
```

## Troubleshooting

### Service Not Showing in Registry

**Problem:** Service doesn't appear in `jfl service-agent list`

**Solution:**
```bash
# 1. Check if service is in services.json
cat ~/.jfl/services.json

# 2. If not, register it:
jfl onboard /path/to/service

# 3. Restart Service Manager
jfl service-manager restart
```

### MCP Server Not Responding

**Problem:** Tools aren't working when called

**Solution:**
```bash
# 1. Test MCP server directly
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | /path/to/.jfl-mcp.js

# 2. Check Service Manager logs
tail -f ~/.jfl/logs/service-manager.log

# 3. Enable debug mode
DEBUG=1 /path/to/.jfl-mcp.js
```

### Inter-Service Calls Failing

**Problem:** `meshClient.callService()` returns errors

**Solution:**
```bash
# 1. Verify Service Manager is running
jfl service-manager status

# 2. Test registry endpoint
curl http://localhost:3402/registry

# 3. Test service call
curl -X POST http://localhost:3402/registry/service-name/call \
  -H "Content-Type: application/json" \
  -d '{"tool":"status","args":{}}'
```

## Future Enhancements

- [ ] Claude Code @mention integration
- [ ] Service dependency graph visualization
- [ ] Automatic service discovery (scan directories)
- [ ] Service health monitoring dashboard
- [ ] Inter-service authentication
- [ ] Service versioning and compatibility checks
- [ ] Distributed tracing across services
- [ ] Service mesh observability (metrics, logs, traces)

## Contributing

When adding new service tools:
1. Update `.jfl-mcp.js` with tool definition
2. Implement tool handler
3. Test with `jfl service-agent list`
4. Document the tool in service README

When adding new registry endpoints:
1. Update `src/commands/service-manager.ts`
2. Add TypeScript types
3. Update this documentation
4. Add integration tests
