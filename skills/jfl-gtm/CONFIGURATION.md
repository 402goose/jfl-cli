# JFL GTM Skill Configuration Guide

Complete reference for configuring the jfl-gtm skill in OpenClaw.

---

## Configuration File Location

The configuration lives in `~/.openclaw/openclaw.json`.

Copy the example configuration:

```bash
cp ~/.openclaw/skills/jfl-gtm/config/example.openclaw.json ~/.openclaw/openclaw.json
```

Or merge with existing configuration.

---

## Configuration Structure

```json
{
  "skills": {
    "entries": {
      "jfl-gtm": {
        "enabled": true,
        "config": { ... },
        "env": { ... },
        "permissions": { ... }
      }
    }
  },
  "mcpServers": { ... }
}
```

---

## Skill Configuration Options

### `enabled` (boolean)

**Default:** `true`

Enable or disable the skill.

```json
{
  "enabled": true
}
```

Set to `false` to temporarily disable without removing configuration.

---

### `config` Object

#### `workspace_paths` (array of strings)

**Default:** `[]`

Custom directories to search for GTM workspaces.

```json
{
  "workspace_paths": [
    "/Users/you/code/my-gtm-workspace",
    "/Users/you/Projects",
    "~/Dropbox/GTM",
    "/mnt/external/workspaces"
  ]
}
```

**Behavior:**
- Skill searches these paths in addition to defaults
- Default paths: `~/code`, `~/Projects`, `~/Documents`, `~/workspace`, `~/dev`
- Paths can use `~` for home directory
- Relative paths not supported (use absolute paths)

**Why use this:**
- Workspaces in non-standard locations
- Multiple workspace directories
- External drives or network mounts

---

#### `default_workspace` (string or null)

**Default:** `null`

Auto-select this workspace without prompting.

```json
{
  "default_workspace": "/Users/you/code/my-primary-project"
}
```

**Behavior:**
- If set, skill skips workspace selection prompt
- Workspace must exist and be valid GTM workspace
- If workspace not found, falls back to discovery

**Why use this:**
- Single primary workspace
- Automation scripts
- Faster session startup

---

#### `auto_start_context_hub` (boolean)

**Default:** `true`

Automatically ensure Context Hub is running on session start.

```json
{
  "auto_start_context_hub": true
}
```

**Behavior:**
- If `true`, runs `jfl context-hub ensure` on session init
- If `false`, expects Context Hub already running
- Health check performed either way

**Why disable:**
- Context Hub already managed externally
- Running on non-standard port
- Custom Context Hub setup

---

#### `agent_timeout` (number)

**Default:** `300` (5 minutes)

Maximum seconds to wait for agent completion.

```json
{
  "agent_timeout": 300
}
```

**Behavior:**
- Agents must complete within this time
- After timeout, agent marked as failed
- Does not kill agent process (may continue in background)

**Recommended values:**
- Simple tasks: `120` (2 minutes)
- Complex features: `600` (10 minutes)
- CI/CD tasks: `900` (15 minutes)

---

#### `auto_commit_interval` (number)

**Default:** `120` (2 minutes)

Interval in seconds for background auto-commit.

```json
{
  "auto_commit_interval": 120
}
```

**Behavior:**
- Background process commits work every N seconds
- Prevents data loss if session crashes
- Commits to current branch

**Recommended values:**
- Fast iteration: `60` (1 minute)
- Normal work: `120` (2 minutes)
- Cautious: `180` (3 minutes)

**Set to `0` to disable auto-commit.**

---

### `env` Object

Environment variables for the skill.

#### `CONTEXT_HUB_URL` (string)

**Default:** `http://localhost:4242`

Context Hub API endpoint.

```json
{
  "CONTEXT_HUB_URL": "http://localhost:4242"
}
```

**Behavior:**
- All Context Hub API calls use this URL
- Health check: `${CONTEXT_HUB_URL}/health`
- Context API: `${CONTEXT_HUB_URL}/api/context`
- Task API: `${CONTEXT_HUB_URL}/api/tasks`

**Custom values:**
- Non-standard port: `http://localhost:8080`
- Remote hub: `https://context-hub.example.com`
- Docker: `http://host.docker.internal:4242`

---

#### `WORKSPACE` (string or null)

**Default:** `null`

Override workspace path (advanced).

```json
{
  "WORKSPACE": null
}
```

**Behavior:**
- If set, overrides workspace discovery
- Skill uses this path directly
- Must be valid GTM workspace

**Why use this:**
- Testing and debugging
- CI/CD pipelines
- Automation scripts

**Most users should leave this `null`** and use `default_workspace` instead.

---

### `permissions` Object

Permission grants for the skill.

```json
{
  "permissions": {
    "bash": "allow",
    "fileWrite": "allow",
    "fileRead": "allow",
    "network": "allow"
  }
}
```

#### `bash` (string)

**Default:** `"allow"`

Execute bash commands.

**Values:**
- `"allow"` - Execute without prompting
- `"prompt"` - Ask user before each command
- `"deny"` - Block all commands

**Required for:**
- Git operations (commit, push, branch)
- JFL CLI commands (synopsis, context-hub, session)
- CRM CLI (`./crm`)
- Agent spawning (tmux sessions)

**Recommended:** `"allow"` (GTM workflows require frequent command execution)

---

#### `fileWrite` (string)

**Default:** `"allow"`

Write files to disk.

**Values:**
- `"allow"` - Write without prompting
- `"prompt"` - Ask user before each write
- `"deny"` - Block all writes

**Required for:**
- Journal entries (`.jfl/journal/*.jsonl`)
- Knowledge docs (`knowledge/*.md`)
- Content (`content/`)
- Suggestions (`suggestions/`)

**Recommended:** `"allow"` (journal protocol requires real-time writes)

---

#### `fileRead` (string)

**Default:** `"allow"`

Read files from disk.

**Values:**
- `"allow"` - Read without prompting
- `"prompt"` - Ask user before each read
- `"deny"` - Block all reads

**Required for:**
- CLAUDE.md (instruction set)
- Foundation docs (VISION, ROADMAP, etc.)
- Product specs
- Journal entries
- Agent definitions (`.jfl/agents/*.yaml`)

**Recommended:** `"allow"` (essential for all operations)

---

#### `network` (string)

**Default:** `"allow"`

Make network requests.

**Values:**
- `"allow"` - Request without prompting
- `"prompt"` - Ask user before each request
- `"deny"` - Block all requests

**Required for:**
- Context Hub API (`http://localhost:4242`)
- Git operations (push, pull, fetch)
- Fly.io deployments
- External APIs (if used in agents)

**Recommended:** `"allow"` (Context Hub integration requires network access)

---

## MCP Server Configuration

Optional MCP server integration for Context Hub.

```json
{
  "mcpServers": {
    "jfl-context": {
      "command": "jfl",
      "args": ["context-hub", "mcp"],
      "env": {
        "CONTEXT_HUB_URL": "http://localhost:4242"
      }
    }
  }
}
```

**When to use:**
- OpenClaw supports MCP clients
- Want structured MCP tools (context_get, context_search, context_status)
- Prefer MCP over direct HTTP API calls

**Available tools:**
- `mcp__jfl-context__context_get` - Get unified context
- `mcp__jfl-context__context_search` - Semantic search
- `mcp__jfl-context__context_status` - Hub status
- `mcp__jfl-context__context_sessions` - Active sessions

**Not required** - Skill works with HTTP API if MCP not available.

---

## Complete Example Configuration

```json
{
  "skills": {
    "entries": {
      "jfl-gtm": {
        "enabled": true,
        "description": "GTM workspace runtime",
        "config": {
          "workspace_paths": [
            "/Users/hath/code/jfl-gtm",
            "/Users/hath/Projects"
          ],
          "default_workspace": "/Users/hath/code/jfl-gtm",
          "auto_start_context_hub": true,
          "agent_timeout": 300,
          "auto_commit_interval": 120
        },
        "env": {
          "CONTEXT_HUB_URL": "http://localhost:4242",
          "WORKSPACE": null
        },
        "permissions": {
          "bash": "allow",
          "fileWrite": "allow",
          "fileRead": "allow",
          "network": "allow"
        }
      }
    }
  },
  "mcpServers": {
    "jfl-context": {
      "command": "jfl",
      "args": ["context-hub", "mcp"],
      "env": {
        "CONTEXT_HUB_URL": "http://localhost:4242"
      }
    }
  }
}
```

---

## Minimal Configuration

Bare minimum configuration (uses all defaults):

```json
{
  "skills": {
    "entries": {
      "jfl-gtm": {
        "enabled": true,
        "permissions": {
          "bash": "allow",
          "fileWrite": "allow",
          "fileRead": "allow",
          "network": "allow"
        }
      }
    }
  }
}
```

This is sufficient if:
- Workspaces in standard locations
- Context Hub on default port (4242)
- Okay with workspace selection prompt
- Using default timeouts

---

## Configuration Validation

### Check Configuration

```bash
# View current configuration
cat ~/.openclaw/openclaw.json | jq '.skills.entries["jfl-gtm"]'
```

### Verify Skill Enabled

```bash
openclaw skill list | grep jfl-gtm
```

Should show:
```
jfl-gtm - GTM workspace runtime
```

### Test Workspace Discovery

```bash
# Run skill discovery manually
cd ~/.openclaw/skills/jfl-gtm
bash -c 'source SKILL.md; discover_gtm_workspaces'
```

Should list discovered workspaces.

### Verify Context Hub

```bash
# Check if Context Hub is accessible
curl http://localhost:4242/health

# Or custom URL
curl ${CONTEXT_HUB_URL}/health
```

Should return:
```json
{"status":"ok","uptime":12345}
```

---

## Troubleshooting Configuration

### Skill Not Appearing

**Problem:** `openclaw skill list` doesn't show jfl-gtm

**Solutions:**
1. Check `enabled: true` in configuration
2. Verify skill files exist: `ls -la ~/.openclaw/skills/jfl-gtm/`
3. Check SKILL.md has frontmatter with `name: jfl-gtm`
4. Restart OpenClaw

---

### Permission Denied Errors

**Problem:** Skill blocked from writing files or executing commands

**Solution:** Check permissions in configuration:

```json
{
  "permissions": {
    "bash": "allow",
    "fileWrite": "allow",
    "fileRead": "allow",
    "network": "allow"
  }
}
```

All four should be `"allow"` for full functionality.

---

### Workspace Not Found

**Problem:** Discovery doesn't find your workspace

**Solution:** Add to `workspace_paths`:

```json
{
  "config": {
    "workspace_paths": [
      "/full/path/to/your/workspace"
    ]
  }
}
```

**Check workspace is valid:**
```bash
# Must have both
ls -la /path/to/workspace/.jfl
ls -la /path/to/workspace/CLAUDE.md
```

---

### Context Hub Connection Failed

**Problem:** Skill can't connect to Context Hub

**Solutions:**

1. **Check Context Hub is running:**
   ```bash
   jfl context-hub status
   ```

2. **Start if needed:**
   ```bash
   jfl context-hub start
   ```

3. **Check correct URL:**
   ```bash
   curl ${CONTEXT_HUB_URL}/health
   ```

4. **Update configuration if on custom port:**
   ```json
   {
     "env": {
       "CONTEXT_HUB_URL": "http://localhost:8080"
     }
   }
   ```

---

### Agent Timeout Issues

**Problem:** Agents consistently timeout

**Solution:** Increase timeout:

```json
{
  "config": {
    "agent_timeout": 600
  }
}
```

Or investigate why agents are slow:
- Check Context Hub performance
- Review agent task complexity
- Check system resources

---

## Security Considerations

### Elevated Permissions

The skill requires `"allow"` for all permissions. This is necessary for GTM workflows but means:

- **Full file system access** in workspace directory
- **Command execution** (git, jfl, ./crm, etc.)
- **Network access** (Context Hub, external APIs)

**Mitigation:**
- Skill only operates in workspace directory
- Commands are well-defined (not arbitrary user input)
- Network access limited to known endpoints
- Trust model: Your workspace, your control

### Sensitive Data

The skill may access:
- CRM data (contacts, deals) via `./crm` CLI
- Product specs (potentially confidential)
- Journal entries (work history)

**Protection:**
- Data stays local (not sent to external services)
- Git operations use your configured credentials
- Context Hub runs locally (port 4242)

### Multi-User Workspaces

If multiple people share a workspace:
- Each session writes to separate journal file
- Git handles merge conflicts normally
- Context Hub aggregates all sessions
- No authentication between local sessions

**For true multi-tenancy, use separate workspaces.**

---

## Performance Tuning

### Fast Session Startup

```json
{
  "config": {
    "default_workspace": "/Users/you/primary-workspace",
    "auto_start_context_hub": false
  }
}
```

- Skip workspace selection
- Don't check Context Hub (assume running)

**Trade-off:** Less validation, faster startup

---

### Aggressive Auto-Commit

```json
{
  "config": {
    "auto_commit_interval": 60
  }
}
```

- Commits every minute
- Maximum context preservation
- More git history

**Trade-off:** More frequent commits, larger git log

---

### Patient Agent Timeouts

```json
{
  "config": {
    "agent_timeout": 900
  }
}
```

- 15 minutes per agent
- Handles complex tasks
- Less likely to timeout

**Trade-off:** Slower feedback if agent hangs

---

## Environment-Specific Configurations

### Development

```json
{
  "skills": {
    "entries": {
      "jfl-gtm": {
        "enabled": true,
        "config": {
          "workspace_paths": ["/Users/you/dev"],
          "auto_commit_interval": 60,
          "agent_timeout": 120
        },
        "env": {
          "CONTEXT_HUB_URL": "http://localhost:4242"
        }
      }
    }
  }
}
```

- Fast iterations
- Short timeouts
- Local Context Hub

---

### Production

```json
{
  "skills": {
    "entries": {
      "jfl-gtm": {
        "enabled": true,
        "config": {
          "workspace_paths": ["/opt/workspaces"],
          "default_workspace": "/opt/workspaces/production",
          "auto_commit_interval": 180,
          "agent_timeout": 600
        },
        "env": {
          "CONTEXT_HUB_URL": "https://context-hub.internal.example.com"
        }
      }
    }
  }
}
```

- Fixed workspace
- Conservative commits
- Longer timeouts
- Remote Context Hub

---

### CI/CD

```json
{
  "skills": {
    "entries": {
      "jfl-gtm": {
        "enabled": true,
        "config": {
          "auto_start_context_hub": false,
          "auto_commit_interval": 0,
          "agent_timeout": 900
        },
        "env": {
          "CONTEXT_HUB_URL": "http://localhost:4242",
          "WORKSPACE": "/workspace"
        }
      }
    }
  }
}
```

- No auto-commit (CI handles commits)
- Long timeouts (CI tasks vary)
- Fixed workspace path
- Context Hub managed externally

---

## Advanced: Custom Agent Configuration

Define custom agents in your workspace:

```bash
mkdir -p .jfl/agents
```

Create `.jfl/agents/custom.yaml`:

```yaml
name: custom
description: My custom agent
responsibilities:
  - Custom task 1
  - Custom task 2
context:
  files:
    - custom/path/**/*
  knowledge:
    - custom/SPEC.md
dependencies:
  - api
tools:
  - custom-cli
```

The coordinator will auto-discover and use this agent.

**Agent configuration is per-workspace**, not in openclaw.json.

---

## Getting Help

### Configuration Issues

1. **Validate JSON syntax:**
   ```bash
   cat ~/.openclaw/openclaw.json | jq .
   ```

2. **Check OpenClaw logs:**
   ```bash
   openclaw logs
   ```

3. **Enable debug mode:**
   ```json
   {
     "debug": true
   }
   ```

### Community Support

- **Issues**: https://github.com/402goose/openclaw-jfl-gtm/issues
- **Discord**: https://discord.gg/jfl
- **Docs**: See README.md and SKILL.md

---

## Related Documentation

- **README.md** - Installation and usage guide
- **SKILL.md** - Complete skill implementation
- **JFL CLI Docs** - https://github.com/402goose/just-fucking-launch
- **OpenClaw Docs** - OpenClaw configuration reference
