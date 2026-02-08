# Claude Code @Mention Setup

How to enable service @mentions in Claude Code using the JFL Service Registry MCP server.

## Prerequisites

1. **Service Manager running:**
   ```bash
   jfl service-manager start
   ```

2. **Services discovered:**
   ```bash
   jfl services scan
   ```

3. **JFL CLI installed globally:**
   ```bash
   npm link
   # or
   npm install -g jfl
   ```

## Setup in Claude Code

### 1. Locate your `.mcp.json` file

Claude Code looks for `.mcp.json` in your project root or home directory.

**Recommended location for GTM projects:**
```
~/your-gtm-project/.mcp.json
```

**Alternative (global):**
```
~/.mcp.json
```

### 2. Add the Service Registry MCP server

Edit `.mcp.json`:

```json
{
  "mcpServers": {
    "jfl-context": {
      "command": "jfl-context-hub-mcp",
      "args": [],
      "description": "JFL Context Hub - journal, knowledge, code context"
    },
    "jfl-services": {
      "command": "jfl-service-registry-mcp",
      "args": [],
      "description": "JFL Service Registry - discover and control services",
      "env": {
        "SERVICE_MANAGER_URL": "http://localhost:3402"
      }
    }
  }
}
```

### 3. Restart Claude Code

The MCP servers are loaded when Claude Code starts, so restart it:
- Close all Claude Code windows
- Reopen your project

### 4. Verify it's working

In Claude Code, you should now have access to service tools:

**List all services:**
```
Can you show me all available services?
```

Claude will call `service_list` tool automatically.

**Get service info:**
```
What's the status of stratus-v2?
```

Claude will call `service_info` with serviceName="stratus-v2".

**Control services:**
```
Start the stratus-v2 service
```

Claude will call `service_call` with serviceName="stratus-v2", tool="start".

## Available MCP Tools

The Service Registry MCP server provides these tools:

### 1. `service_list`

Lists all available services.

**Parameters:**
- `status` (optional): Filter by "running", "stopped", or "all" (default)

**Example:**
```
Show me all running services
```

### 2. `service_info`

Get detailed information about a specific service.

**Parameters:**
- `serviceName` (required): Name of the service

**Example:**
```
What tools are available for stratus-v2?
```

### 3. `service_call`

Execute a tool on a service.

**Parameters:**
- `serviceName` (required): Service name
- `tool` (required): Tool name (status, start, stop, restart, logs, health, deploy, etc.)
- `args` (optional): Tool arguments (e.g., {lines: 50} for logs)

**Examples:**
```
Check the status of formation-gtm
Get the last 20 lines of logs from stratus-v2
Restart the stratus-llm-proxy service
Deploy stratus-v2 to production
```

### 4. `service_discover`

Re-scan for services.

**Parameters:**
- `path` (optional): Path to scan

**Example:**
```
Scan for new services
```

## Natural Language Examples

Claude Code will understand natural language and map it to the right tool calls:

| You say | Claude does |
|---------|-------------|
| "Show me all services" | `service_list()` |
| "What's running?" | `service_list(status="running")` |
| "Is stratus-v2 up?" | `service_info("stratus-v2")` → `service_call("stratus-v2", "status")` |
| "Start the API" | `service_call("stratus-api", "start")` |
| "Tail logs for frontend" | `service_call("stratus-frontend", "logs", {lines: 50})` |
| "Deploy to production" | `service_call("stratus-v2", "deploy", {environment: "production"})` |
| "Check health of all services" | `service_list()` → loops calling `service_call(name, "health")` |

## Troubleshooting

### "Service Manager not running"

**Error:**
```
Error: Service Manager not running. Start it with: jfl service-manager start
```

**Fix:**
```bash
jfl service-manager start
```

### "No services found"

**Error:**
```
No services found. Run 'jfl services scan' to discover services.
```

**Fix:**
```bash
cd /path/to/your/project
jfl services scan
```

### MCP server not loading

**Check Claude Code logs:**

Look for errors related to `jfl-service-registry-mcp` in Claude Code's debug logs.

**Verify the command works:**
```bash
which jfl-service-registry-mcp
```

Should return the path to the executable. If not, run:
```bash
npm link
```

### Service Manager on different port

If your Service Manager is on a different port, update `.mcp.json`:

```json
{
  "mcpServers": {
    "jfl-services": {
      "command": "jfl-service-registry-mcp",
      "env": {
        "SERVICE_MANAGER_URL": "http://localhost:9999"
      }
    }
  }
}
```

## Advanced: @Mention Shortcuts

While the MCP tools work automatically when you ask in natural language, you can also think of services as @mentionable entities:

Instead of:
```
Can you check the status of stratus-v2?
```

Think:
```
@stratus-v2 status
```

Claude will understand this pattern and call `service_call("stratus-v2", "status")`.

**More examples:**
```
@stratus-v2 logs lines=50
@formation-gtm start
@stratus-llm-proxy deploy environment=staging
@stratus-api health
```

This makes it feel like you're directly commanding services!

## Integration with Other MCP Servers

The Service Registry MCP server works alongside other JFL MCP servers:

```json
{
  "mcpServers": {
    "jfl-context": {
      "command": "jfl-context-hub-mcp",
      "description": "Context (journal, knowledge, code)"
    },
    "jfl-services": {
      "command": "jfl-service-registry-mcp",
      "description": "Service discovery and control"
    },
    "jfl-memory": {
      "command": "jfl-memory-mcp",
      "description": "Semantic memory search"
    }
  }
}
```

Claude Code loads all of them and uses the right one for each task.

## Next Steps

1. ✅ Setup complete
2. Try controlling services via natural language
3. Add custom tools to your services (see `~/.jfl/services.json`)
4. Create orchestrations for multi-service workflows
5. Use the dashboard: `jfl dashboard`

---

**Questions?** Open an issue: https://github.com/402goose/jfl-cli/issues
