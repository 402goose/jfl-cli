# JFL GTM Runtime for OpenClaw

Run your entire GTM workspace from OpenClaw, exactly as you would in Claude Code.

## What is GTM?

GTM (Go-To-Market) is a structured workspace for building and launching products:

- **Context layer** - Knowledge docs, product specs, brand guidelines
- **Journal system** - Work log for handoff between sessions and people
- **CRM integration** - Google Sheets pipeline via CLI
- **Content workflows** - Brand-aware content generation
- **Deployment tooling** - Fly.io integration, service management
- **Team coordination** - Multi-session awareness, role-based access
- **Agent orchestration** - Coordinator spawns specialized service agents (API, Frontend, Docs, etc.)

**GTM is fundamentally a Claude Code operating protocol defined in `CLAUDE.md`.**

This skill makes OpenClaw behave like Claude Code in a GTM workspace.

---

## Installation

### 1. Install JFL CLI

```bash
npm install -g just-fucking-launch
```

### 2. Install OpenClaw Skill

#### Option A: Clone directly

```bash
cd ~/.openclaw/skills/
git clone https://github.com/402goose/openclaw-jfl-gtm jfl-gtm
```

#### Option B: Copy manually

```bash
# If you have the skill files locally
cp -r /path/to/jfl-gtm ~/.openclaw/skills/
```

### 3. Add Your Workspace (Natural Language)

**You don't need to edit any JSON files!** Use natural language:

```bash
openclaw
> Hey, let's add a new GTM: /Users/you/code/your-project
✅ Added workspace: /Users/you/code/your-project
   Project: your-project

# Or shorter
> /jfl-gtm add ~/code/my-gtm-workspace
✅ Added workspace: /Users/you/code/my-gtm-workspace
```

**List your workspaces:**

```
> Show me my GTM workspaces
Configured GTM workspaces:

  ✅ your-project
     /Users/you/code/your-project

  ✅ my-gtm-workspace
     /Users/you/code/my-gtm-workspace
```

**Set a default (skip selection prompt):**

```
> Make your-project the default workspace
✅ Default workspace: your-project
   /Users/you/code/your-project
```

**Advanced: Manual configuration (optional)**

If you prefer, you can manually edit `~/.openclaw/openclaw.json`:

```json
{
  "skills": {
    "entries": {
      "jfl-gtm": {
        "enabled": true,
        "config": {
          "workspace_paths": ["/Users/you/code/your-project"],
          "default_workspace": "/Users/you/code/your-project"
        }
      }
    }
  }
}
```

But natural language is easier!

### 4. Verify Installation

```bash
openclaw skill list | grep jfl-gtm
```

Should show:
```
jfl-gtm - GTM workspace runtime - run go-to-market as Claude Code does
```

---

## Configuration (Natural Language)

**You never need to edit JSON files!** Configure everything through natural language.

### Add Workspaces

```
> Hey, let's add a new GTM: ~/code/my-project
✅ Added workspace: /Users/you/code/my-project
   Project: my-project
```

### List Workspaces

```
> Show me my GTM workspaces

Configured GTM workspaces:

  ✅ my-project
     /Users/you/code/my-project

  ✅ other-project
     /Users/you/Projects/other-project
```

### Set Default (Skip Selection)

```
> Make my-project the default workspace
✅ Default workspace: my-project
   /Users/you/code/my-project
```

Now `/jfl-gtm` will immediately load my-project.

### Remove Workspaces

```
> Remove workspace ~/old-project
✅ Removed workspace: /Users/you/old-project
```

### All Configuration Commands

| Command | What It Does |
|---------|--------------|
| `add workspace /path` | Add workspace to list |
| `add GTM /path` | Same as above |
| `list workspaces` | Show all configured workspaces |
| `show my GTM workspaces` | Same as above |
| `set default workspace /path` | Auto-select this workspace |
| `make X the default` | Same as above |
| `clear default workspace` | Remove default (show selection prompt) |
| `remove workspace /path` | Remove from list |

**Behind the scenes:** These commands edit `~/.openclaw/openclaw.json` automatically. You never have to touch JSON.

---

## Usage

### Starting a GTM Session

```bash
openclaw
> /jfl-gtm
```

**What happens:**

1. **Discovers GTM workspaces** on your system (searches ~/code, ~/Projects, etc.)
2. **Prompts you to select** workspace (or auto-selects if configured)
3. **Reads CLAUDE.md** (the instruction set for GTM operation)
4. **Executes SessionStart protocol:**
   - Syncs repositories (jfl-gtm, jfl-platform, submodules)
   - Runs health check (jfl-doctor) for existing projects
   - Ensures Context Hub is running (port 4242)
   - Loads unified context (journal + knowledge + code)
5. **Discovers service agents** (.jfl/agents/*.yaml)
6. **Shows project dashboard** (ship date, phase, recent work)
7. **Ready to work** - Full GTM capabilities available

### Working in GTM

Once in session, you have full access to GTM capabilities:

#### Context & Status

```
> What did we work on yesterday?
```

Runs: `jfl synopsis 24`
Shows: Journal entries + commits from last 24 hours

```
> Show me the project status
```

Shows: Dashboard with ship date, current phase, tasks, pipeline

#### Content Creation

```
> Create a Twitter thread about our product
```

1. Reads brand guidelines (BRAND_DECISIONS.md, NARRATIVE.md)
2. Generates thread following brand voice
3. Writes to content/threads/product-thread.md
4. Writes journal entry
5. Commits and pushes

#### CRM & Pipeline

```
> Show me the CRM pipeline
```

Runs: `./crm list`
Shows: Hot deals, recent contacts, next actions

```
> Prep me for call with Jane
```

Runs: `./crm prep "Jane"`
Shows: Full context - past conversations, deal status, notes

#### Knowledge Management

```
> Update VISION.md with new insight
```

1. Edits knowledge/VISION.md (NO CONFIRMATION)
2. Writes journal entry capturing decision
3. Commits and pushes

```
> Add pricing decision
```

Uses `capture_decision` helper to update knowledge doc + journal atomically

#### Multi-Agent Orchestration

```
> Add a login endpoint with email and password
```

**Coordinator analyzes:**
- Type: feature
- Domains: api, auth, frontend, docs

**Task plan:**
- Task 1: API agent creates POST /auth/login
- Task 2: Frontend agent creates login form (depends on Task 1)
- Task 3: Docs agent documents endpoint (depends on Task 1)

**Execution:**
- Spawns API agent → Creates endpoint, runs tests, writes journal
- API completes → Signals Context Hub
- Spawns Frontend + Docs agents in parallel
- Frontend reads API schema from Context Hub
- Docs reads API schema from Context Hub
- All agents complete → Coordinator synthesizes result

**Output:**
```
✅ Login endpoint ready!

- API: POST /auth/login created (2min 34s)
- Frontend: Login form at /login (1min 45s)
- Docs: API reference updated (1min 45s)

Total time: 4min 19s
Files changed: 5
Journal entries: 3 (one per agent)

Test it: http://localhost:3000/login
```

#### Service Management

```
> Launch ralph-tui
```

Spawns tmux session with agent orchestrator TUI

```
> Restart Context Hub
```

Runs: `jfl context-hub stop && jfl context-hub start`
Verifies: Health check passes

### Ending a Session

```
> done
```

**What happens:**

1. **Verifies journal entry exists** (blocks if missing)
2. **Commits outstanding changes** (knowledge/, content/, journal/)
3. **Shows session summary:**
   - Work done (from journal)
   - Files changed (from git)
   - Next steps (from journal)
4. **Pushes to origin**
5. **Preserves context** for next session

**NEVER stops Context Hub** (shared across sessions).

---

## Permission Model

The GTM skill operates with **elevated permissions**:

- ✅ **File writes** (knowledge/, journal/, content/) without confirmation
- ✅ **Command execution** (jfl, ./crm, git) without prompts
- ✅ **Network access** (Context Hub, Fly, external APIs) without blocks

**Why this is necessary:**

- Journal entries written in real-time (after every feature/decision/fix)
- Knowledge docs updated immediately (no user friction)
- Context preserved automatically (no data loss)
- Multi-agent coordination (agents communicate freely)

**Trust model:** Your workspace, your control, your protocols.

---

## Architecture

### How It Works

```
User Request
    ↓
OpenClaw (jfl-gtm skill)
    ↓
Reads CLAUDE.md (instruction set)
    ↓
Executes GTM Protocols:
    ├── Journal entries (JSONL)
    ├── Context loading (Context Hub MCP)
    ├── Decision capture (knowledge docs)
    ├── File headers (@purpose)
    ├── Multi-agent orchestration
    └── Session lifecycle (start/end)
    ↓
Access JFL CLI Tools:
    ├── jfl synopsis (work summary)
    ├── ./crm (Google Sheets CRM)
    ├── jfl context-hub (unified context)
    ├── jfl session (session management)
    └── jfl agent (multi-agent control)
    ↓
Manage Services:
    ├── Context Hub (port 4242)
    ├── Auto-commit (background)
    ├── Deployments (Fly.io)
    ├── TUI interfaces (ralph-tui, campaign-hud)
    └── Service agents (API, Frontend, Docs, etc.)
```

### Multi-Agent Architecture

```
Coordinator Agent (OpenClaw)
    ↓
Analyzes user request
    ↓
Builds task graph with dependencies
    ↓
┌─────────────┬──────────────┬──────────────┐
│ API Agent   │ Frontend     │ Docs Agent   │
│             │ Agent        │              │
└─────────────┴──────────────┴──────────────┘
    ↓               ↓               ↓
    └───────────────┴───────────────┘
                    ↓
         Context Hub (shared state)
                    ↓
         Completion signals + Results
                    ↓
         Coordinator synthesizes
```

### Agent Definitions

Agents are defined in `.jfl/agents/*.yaml`:

```yaml
# .jfl/agents/api.yaml
name: api
description: Manages API endpoints, routes, and server code
responsibilities:
  - Create new API endpoints
  - Update existing endpoints
  - Add middleware
  - Handle API errors
context:
  files:
    - product/src/api/**/*
    - product/src/lib/server/**/*
  knowledge:
    - product/API_SPEC.md
dependencies:
  - database  # May need database agent for schema changes
tools:
  - jfl
  - curl
  - httpie
```

The coordinator auto-discovers agents on session start.

### What Makes This Different

| Traditional CLI Wrapper | GTM Runtime (This Skill) |
|------------------------|--------------------------|
| Executes commands | Follows protocols |
| Simple I/O | Structured workflows |
| Stateless | Session-aware |
| Tool-centric | Context-centric |
| Single purpose | Complete environment |
| Single agent | Multi-agent orchestration |

**GTM is not a tool - it's a way of working.**

---

## Examples

### Example 1: Content Generation Pipeline

**Request:**
```
> Generate a launch thread
```

**What happens:**

1. **Reads context:**
   - knowledge/BRAND_DECISIONS.md (voice, colors, logo)
   - knowledge/NARRATIVE.md (how we tell the story)
   - knowledge/VISION.md (what we're building)
   - product/SPEC.md (product details)

2. **Generates content:**
   - Thread with brand voice
   - Preview in content/threads/launch.md

3. **Captures work:**
   - Journal entry with type: feature
   - Commits and pushes

**Output:**
```
✅ Thread saved to content/threads/launch.md

Preview:
---
1/ We're launching [Product] next week.

Here's why it matters: [hook from NARRATIVE.md]

[Thread continues in brand voice...]
---

Want to generate images for it?
```

### Example 2: CRM Pipeline Management

**Request:**
```
> Show me who I need to follow up with
```

**What happens:**

1. **Runs:** `./crm list`

2. **Parses:**
   - Deals with status IN_CONVO or REACHED_OUT
   - Last contact date > 5 days ago

3. **Presents:**
   - Top 3 hot prospects
   - Recommended action for each
   - Context for each (prep command)

**Output:**
```
📊 Follow-up needed:

1. Jane Doe (Acme Corp) - Last contact 6 days ago
   Status: IN_CONVO
   Action: Schedule demo call
   Prep: ./crm prep "Jane Doe"

2. John Smith (Tech Inc) - Last contact 7 days ago
   Status: REACHED_OUT
   Action: Send follow-up email
   Prep: ./crm prep "John Smith"

3. Sarah Johnson (StartupXYZ) - Last contact 5 days ago
   Status: HOT
   Action: Send pricing proposal
   Prep: ./crm prep "Sarah Johnson"

Want me to prep you for any of these?
```

### Example 3: Multi-Agent Feature Development

**Request:**
```
> Add user profile page with avatar upload
```

**What happens:**

1. **Coordinator analyzes:**
   - Type: feature
   - Domains: api, frontend, database, docs

2. **Task plan:**
   ```
   Task 1: Database agent - Add avatar_url column to users table
   Task 2: API agent - Add POST /api/user/avatar endpoint (depends on Task 1)
   Task 3: Frontend agent - Create profile page with upload (depends on Task 2)
   Task 4: Docs agent - Document API and user guide (depends on Task 2)
   ```

3. **Execution:**
   - Database agent spawns → Adds column, runs migration, writes journal
   - Database completes (23s) → Signals Context Hub
   - API agent spawns → Reads schema, creates endpoint, writes tests, writes journal
   - API completes (2min 12s) → Signals Context Hub
   - Frontend + Docs agents spawn in parallel
   - Frontend reads API schema from Context Hub, creates UI components
   - Docs reads API schema from Context Hub, writes documentation
   - Frontend completes (3min 45s), Docs completes (1min 30s)
   - All journal entries committed

4. **Coordinator synthesizes:**
   ```
   ✅ User profile with avatar upload complete!

   What was built:
   - Database: Added avatar_url column (23s)
   - API: POST /api/user/avatar endpoint (2min 12s)
   - Frontend: Profile page at /profile with upload (3min 45s)
   - Docs: User guide and API reference (1min 30s)

   Total time: 4min 8s
   Files changed: 8
   Journal entries: 4 (one per agent)

   Test it: http://localhost:3000/profile
   ```

---

## Troubleshooting

### Context Hub Not Running

```bash
# Check health
curl http://localhost:4242/health

# If not responding
jfl context-hub start

# Check logs
jfl context-hub logs
```

**Solution in skill:**
The skill automatically runs `jfl context-hub ensure` on session start.

### Workspace Not Found

**Check if it's a valid GTM workspace:**

```bash
# Verify .jfl directory exists
ls -la /path/to/workspace/.jfl

# Verify CLAUDE.md exists
ls -la /path/to/workspace/CLAUDE.md
```

**Add it using natural language:**

```
> Add workspace /path/to/your/workspace
✅ Added workspace: /path/to/your/workspace
```

Or if it's not a GTM workspace yet:

```bash
cd /path/to/your/workspace
jfl init
# Follow onboarding to set up foundation docs
```

### Journal Entry Blocked

```
Error: STOP - JOURNAL ENTRY REQUIRED
```

**Solution:** Write a journal entry before ending session:

```bash
cd /path/to/workspace

# Get session ID
SESSION=$(git branch --show-current)

# Write entry
cat >> .jfl/journal/${SESSION}.jsonl << 'EOF'
{"v":1,"ts":"2026-02-10T12:00:00.000Z","session":"SESSION_ID","type":"session-end","status":"complete","title":"Session work summary","summary":"What I worked on","detail":"Full description of work done"}
EOF

# Commit
git add .jfl/journal/
git commit -m "journal: session summary"
git push origin
```

Or use the helper in OpenClaw:

```
> Write a session summary journal entry
```

The skill will use `write_journal_entry` function.

### Permission Denied

Check openclaw.json permissions configuration:

```json
{
  "skills": {
    "entries": {
      "jfl-gtm": {
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

The skill needs all four permission types.

### CRM Commands Failing

```bash
# Verify CRM CLI exists
ls -la /path/to/workspace/crm

# Make executable
chmod +x /path/to/workspace/crm

# Check CRM config (should show Google Sheets sync status)
cd /path/to/workspace
./crm
```

If CRM not set up, follow JFL docs to configure Google Sheets integration.

### Agent Not Spawning

Check agent definition exists:

```bash
ls -la .jfl/agents/

# Should show:
# api.yaml
# frontend.yaml
# docs.yaml
# etc.
```

If no agents defined, create them:

```yaml
# .jfl/agents/api.yaml
name: api
description: Manages API endpoints and server code
responsibilities:
  - Create new API endpoints
  - Update existing endpoints
context:
  files:
    - product/src/api/**/*
  knowledge:
    - product/API_SPEC.md
dependencies: []
tools:
  - jfl
  - curl
```

### Agent Communication Failing

Check Context Hub is accepting task messages:

```bash
# Test task creation
curl -X POST http://localhost:4242/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"task_id":"test-1","agent":"test","status":"pending"}'

# Check task queue
curl http://localhost:4242/api/tasks
```

If failing, restart Context Hub:

```bash
jfl context-hub stop
jfl context-hub start
```

---

## Advanced

### Custom Workspace Discovery

**Add workspaces naturally:**

```
> Add workspace /custom/path/workspace1
✅ Added workspace: /custom/path/workspace1

> Add GTM /another/path/workspace2
✅ Added workspace: /another/path/workspace2

> Add workspace ~/Dropbox/Projects/my-gtm
✅ Added workspace: /Users/you/Dropbox/Projects/my-gtm
```

The skill will search these paths in addition to defaults (~/code, ~/Projects, etc.).

**List all configured workspaces:**

```
> Show me my GTM workspaces
```

### Auto-Select Workspace

**Set a default workspace naturally:**

```
> Make my-project the default GTM workspace
✅ Default workspace: my-project
   /Users/you/code/my-project
```

Or:

```
> Set default workspace ~/code/my-project
✅ Default workspace: my-project
```

The skill will immediately load this workspace on `/jfl-gtm` without prompting.

**Clear default:**

```
> Clear default workspace
✅ Default workspace cleared
```

### Multi-Session Coordination

See other active sessions:

```bash
jfl session list
```

Share context via Context Hub (automatic).

When multiple OpenClaw instances run with jfl-gtm:
- Each has its own session
- All share Context Hub (port 4242)
- Journal entries from all sessions visible
- Multi-agent coordination works across sessions

### Custom Agent Definitions

Create specialized agents for your workflow:

```yaml
# .jfl/agents/email-writer.yaml
name: email-writer
description: Writes marketing emails with brand voice
responsibilities:
  - Draft email campaigns
  - Generate subject lines
  - Write CTAs
context:
  knowledge:
    - knowledge/BRAND_DECISIONS.md
    - knowledge/VOICE_AND_TONE.md
    - knowledge/NARRATIVE.md
dependencies: []
tools:
  - jfl
```

Coordinator will auto-discover and use when appropriate.

### Context Hub MCP Integration

If OpenClaw supports MCP clients, the Context Hub can be accessed via MCP:

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

This provides:
- `context_get` - Get unified context
- `context_search` - Semantic search
- `context_status` - Hub status

### Task Queue Monitoring

Monitor agent tasks in real-time:

```bash
# Watch task queue
watch -n 2 'curl -s http://localhost:4242/api/tasks | jq .'

# Or use TUI
jfl campaign-hud
```

Shows:
- Active agents
- Task status (pending/in_progress/complete)
- Agent dependencies
- Completion times

---

## Resources

- **JFL CLI**: https://github.com/402goose/just-fucking-launch
- **GTM Docs**: See CLAUDE.md in your workspace
- **Context Hub**: http://localhost:4242 (when running)
- **OpenClaw Skill Issues**: https://github.com/402goose/openclaw-jfl-gtm/issues
- **JFL Community**: https://discord.gg/jfl (Discord server)

---

## FAQ

### Q: What's the difference between JFL CLI and this skill?

**A:** JFL CLI provides the supporting tools (context-hub, crm, synopsis, session management). This skill makes OpenClaw follow the GTM operating protocols defined in CLAUDE.md.

Think of it like:
- **JFL CLI** = Operating system utilities
- **GTM workspace** = Application (structured markdown)
- **This skill** = Runtime that executes the application

### Q: Can I use this without Claude Code?

**A:** Yes! That's the point. This skill lets you run GTM workspaces from OpenClaw, without needing Claude Code.

### Q: Do I need OpenClaw?

**A:** To use this skill, yes. If you want to run GTM workspaces from Claude Code instead, you don't need this skill—Claude Code reads CLAUDE.md natively.

### Q: What if I don't have a GTM workspace yet?

**A:** Create one:

```bash
jfl init my-project
```

Follow the onboarding to set up foundation docs (VISION, ROADMAP, etc.).

### Q: Can multiple people work on the same workspace?

**A:** Yes! Each person:
1. Runs their own OpenClaw session
2. Connects to the same Context Hub
3. Writes their own journal entries
4. Git handles merge conflicts normally

The journal system prevents context loss across sessions.

### Q: What if Context Hub goes down?

**A:** The skill will try to start it automatically. If that fails:

```bash
jfl context-hub start
```

If Context Hub is unavailable, the skill continues without context loading but warns you.

### Q: How do I update the skill?

**A:** If installed via git clone:

```bash
cd ~/.openclaw/skills/jfl-gtm
git pull origin main
```

If copied manually, replace the files.

### Q: Can I customize the protocols?

**A:** Yes! Edit CLAUDE.md in your workspace. The skill reads and follows whatever is in CLAUDE.md.

### Q: What happens if I force-quit OpenClaw mid-session?

**A:** If auto-commit is running (recommended), your work is saved every 2 minutes. Otherwise, uncommitted changes may be lost.

Always use `> done` to end sessions gracefully.

---

## Contributing

Found a bug or have a feature request?

1. **Issues**: https://github.com/402goose/openclaw-jfl-gtm/issues
2. **Pull Requests**: https://github.com/402goose/openclaw-jfl-gtm/pulls

When reporting issues, include:
- OpenClaw version
- JFL CLI version (`jfl --version`)
- Workspace structure (does .jfl/ exist? CLAUDE.md?)
- Context Hub status (`curl http://localhost:4242/health`)
- Error messages

---

## License

MIT License - see LICENSE file

---

## Acknowledgments

- **JFL Team** - For the GTM framework and CLI tools
- **OpenClaw** - For the extensible skill system
- **Claude Code** - For inspiring the protocol-driven architecture
