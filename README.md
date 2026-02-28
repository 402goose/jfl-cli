# JFL - Just Fucking Launch

**The context layer for AI-native teams.**

JFL provides persistent context for AI workflows. Agents read what happened in previous sessions, understand decisions made, and access project knowledge — eliminating the cold-start problem where each AI interaction begins from zero.

Context lives in git as structured files (markdown, JSONL). Any AI tool can integrate via MCP.

**Quick Links:** [GitHub](https://github.com/402goose/jfl-cli) | [npm](https://www.npmjs.com/package/jfl)

---

## What Problem Does This Solve?

AI agents are stateless. Each session starts from scratch:
- Previous decisions aren't remembered
- Work from other sessions isn't visible
- Context has to be re-explained every time

JFL provides a shared context layer that accumulates over time and is accessible to any AI tool.

---

## Installation

```bash
npm install -g jfl
```

**Requirements:** Node >= 18

**Also installs:**
- `jfl-context-hub-mcp` — MCP server binary for Context Hub
- `jfl-service-registry-mcp` — MCP server binary for Service Registry

---

## Quick Start

```bash
# Create a GTM workspace
jfl init -n my-project

# Start working
cd my-project
claude                        # Claude Code — hooks fire automatically

# Inside Claude Code:
/hud                          # Project dashboard — start here
```

That's it. SessionStart hooks handle repo sync, session branching, Context Hub startup, and auto-commit. You just work.

---

## Architecture

JFL workspaces are **context layers**, not code repos. Product code lives in separate service repos that register with the GTM.

```
my-project/                    <- GTM workspace (strategy, context, orchestration)
├── .jfl/
│   ├── config.json           <- Project config (team, services, ports)
│   ├── journal/              <- Session journals (JSONL, one file per session)
│   ├── memory.db             <- Indexed memory (TF-IDF + embeddings)
│   ├── service-events.jsonl  <- Event bus file-drop
│   └── services.json         <- Registered services
├── knowledge/                <- Strategy docs (VISION, ROADMAP, THESIS, etc.)
├── content/                  <- Generated content
├── suggestions/              <- Per-contributor workspaces
├── .claude/
│   ├── settings.json         <- Claude Code hooks (SessionStart, Stop, etc.)
│   ├── agents/               <- Service agent definitions
│   └── skills/               <- Slash commands (/hud, /content, etc.)
├── scripts/session/          <- Session management (init, sync, cleanup)
├── CLAUDE.md                 <- AI instructions
└── .mcp.json                 <- MCP server config (Context Hub)

my-api/                        <- Service repo (registered in GTM)
├── src/
├── .jfl/config.json          <- type: "service", gtm_parent: "/path/to/gtm"
└── .jfl/journal/             <- Service journals (synced to GTM on session end)
```

**Why separate?**
- Clean separation of concerns
- Services work independently
- Multiple services register to one GTM
- `jfl update` updates tooling without touching service code
- Journal entries sync from services to parent GTM

---

## Core Systems

### Context Hub

A per-project daemon that aggregates journal entries, knowledge docs, code headers, and events into a unified context layer. Any AI can query it via MCP.

```bash
jfl context-hub ensure        # Start if not running (idempotent)
jfl context-hub status        # Check health
jfl context-hub stop          # Stop daemon
jfl context-hub restart       # Restart daemon
jfl context-hub doctor        # Diagnose all projects (OK/ZOMBIE/DOWN/STALE)
jfl context-hub ensure-all    # Start for all GTM projects
jfl context-hub dashboard     # Live event + context dashboard
jfl context-hub install-daemon  # Auto-start on boot (launchd/systemd)
jfl context-hub uninstall-daemon  # Remove auto-start
jfl context-hub query         # Query context from CLI
jfl context-hub serve         # Run in foreground (daemon mode)
```

**Per-project ports** assigned automatically (or set in `.jfl/config.json` → `contextHub.port`).

**MCP Tools** (available to Claude Code and any MCP client):

| Tool | What It Does |
|------|-------------|
| `context_get` | Unified context (journal + knowledge + code headers) |
| `context_search` | Semantic search across all sources |
| `context_status` | Daemon health check |
| `context_sessions` | Activity from other sessions |
| `memory_search` | Search indexed journal memories |
| `memory_status` | Memory system statistics |
| `memory_add` | Add manual memory entry |

**Resilience:** 5-layer system — MCP auto-recovery on ECONNREFUSED, health-check-before-ensure hooks, `ensure-all` for batch startup, `doctor` diagnostics, launchd/systemd daemon with keepalive.

### MAP Event Bus

Metrics, Agents, Pipeline — an in-process event bus inside Context Hub.

- **Ring buffer** (1000 events) with JSONL persistence
- **Service event bridge** — watches `.jfl/service-events.jsonl`, converts to events
- **Journal bridge** — watches `.jfl/journal/`, emits events on new entries
- **Pattern-matching subscriptions** (glob support)
- **Transports:** SSE, WebSocket, HTTP polling
- **Event types:** `session:started`, `session:ended`, `task:completed`, `journal:entry`, `service:healthy`, `custom`, and more

Services emit events by appending to `.jfl/service-events.jsonl` — no auth needed, Context Hub watches the file automatically.

### Memory System

Hybrid search over all journal entries with TF-IDF (40%) + semantic embeddings (60%).

```bash
jfl memory init               # Initialize database
jfl memory search "pricing"   # Search memories
jfl memory status             # Stats and health
jfl memory index [--force]    # Reindex journal entries
jfl ask "what did we decide about auth?"  # Shorthand
```

Auto-indexes every 60 seconds. Boosts recent entries (1.3x), decisions (1.4x), features (1.2x). Works with or without OpenAI embeddings — TF-IDF alone provides solid keyword search.

### Session Management

Automatic session isolation for parallel work:

- **Single session:** Works directly on a session branch (no worktree overhead)
- **Multiple concurrent sessions:** Isolated git worktrees prevent conflicts
- **Auto-commit:** Saves work every 2 minutes (knowledge, journal, suggestions)
- **Crash recovery:** Detects uncommitted work in stale sessions, auto-commits on next start

```bash
# Hooks handle everything automatically. Manual control:
jfl session create            # Create session
jfl session list              # List active sessions
jfl session end               # End and merge
./scripts/session/auto-commit.sh start  # Background auto-commit
```

**SessionStart hook flow:**
1. Sync repos (prevent context loss)
2. Check for stale sessions, auto-cleanup if > 5
3. Recover uncommitted work from crashed sessions
4. Create session branch (or worktree if concurrent)
5. Start auto-commit
6. Health-check Context Hub (start only if down)

---

## Service Agents

Register external repos as services in your GTM. Each service gets an agent definition, skill wrapper, and journal sync.

```bash
# Onboard a service repo
jfl onboard /path/to/my-api --name my-api --type api

# Or create from scratch
jfl services create

# Manage services
jfl services list             # All registered services
jfl services status my-api    # Health check
jfl services start my-api     # Start a service
jfl services stop my-api      # Stop a service
jfl services validate --fix   # Validate and auto-repair
jfl services sync-agents      # Sync peer agent definitions
jfl services scan             # Discover services in directory
jfl services deps             # Show dependency graph
jfl services                  # Interactive TUI (no args)
```

**What onboarding creates:**
- Agent definition (`.claude/agents/service-{name}.md`)
- Skill wrapper (`.claude/skills/{name}/SKILL.md` + `handler.sh`)
- Service entry in `.jfl/services.json`
- Config in service repo (`.jfl/config.json` with `gtm_parent`)

**Phone-home on session end:** When a service session ends, it syncs to the parent GTM:
- Journal entries copied to `GTM/.jfl/journal/service-{name}-*.jsonl`
- Comprehensive sync payload (git stats, health, environment)
- GTM agent notified via event bus
- Never blocks session end

**Invoke from GTM:**
```
/my-api status               # Check service health
/my-api recent               # Recent changes
```

---

## Commands

### Core

| Command | Description |
|---------|-------------|
| `jfl init -n <name>` | Create new GTM workspace |
| `jfl status` | Project status and auth |
| `jfl hud [-c\|--compact]` | Campaign dashboard (ship date, phases, pipeline) |
| `jfl update [--dry]` | Pull latest skills, scripts, templates (preserves CLAUDE.md, .mcp.json) |
| `jfl synopsis [hours] [author]` | Work summary (journal + commits + file headers) |
| `jfl repair` | Fix corrupted .jfl/config.json |
| `jfl validate-settings [--fix] [--json]` | Validate and repair .claude/settings.json |
| `jfl preferences [--clear-ai] [--show]` | Manage JFL preferences |
| `jfl profile [action]` | Manage profile (show, edit, export, import, generate) |
| `jfl test` | Test onboarding flow (isolated environment) |

### Context Hub

| Command | Description |
|---------|-------------|
| `jfl context-hub ensure` | Start daemon if not running |
| `jfl context-hub stop [--purge]` | Stop daemon |
| `jfl context-hub restart` | Restart daemon |
| `jfl context-hub status` | Health check |
| `jfl context-hub doctor [--clean]` | Diagnose all projects |
| `jfl context-hub ensure-all` | Start for all GTM projects |
| `jfl context-hub dashboard` | Live event/context dashboard |
| `jfl context-hub query` | Query context from CLI |
| `jfl context-hub serve` | Run in foreground (daemon mode) |
| `jfl context-hub install-daemon` | Auto-start on boot |
| `jfl context-hub uninstall-daemon` | Remove auto-start |

### Memory

| Command | Description |
|---------|-------------|
| `jfl memory init` | Initialize memory database |
| `jfl memory search <query> [-t type] [-n max]` | Search indexed memories |
| `jfl memory status` | Stats and health |
| `jfl memory index [--force]` | Reindex journal entries |
| `jfl ask <question> [-t type]` | Shorthand for memory search |

### Services

| Command | Description |
|---------|-------------|
| `jfl onboard <path> [-n name] [-t type]` | Register service in GTM |
| `jfl services` | Interactive service manager TUI |
| `jfl services create [--skip-ai]` | Create new service (wizard) |
| `jfl services list` | List all services |
| `jfl services status [name]` | Health check |
| `jfl services start <name>` | Start a service |
| `jfl services stop <name> [--force]` | Stop a service |
| `jfl services scan [--path <p>] [--dry-run]` | Discover services in directory |
| `jfl services deps [validate]` | Show/validate dependency graph |
| `jfl services validate [--fix] [--json]` | Validate configs, auto-repair |
| `jfl services sync-agents [--dry-run] [--current]` | Sync peer agent definitions |
| `jfl service-agent <action> [name]` | Manage MCP agents (init, generate, generate-all, register, unregister, list, clean) |
| `jfl service-manager <action>` | Service Manager daemon (start, stop, restart, status, serve) |
| `jfl migrate-services [gtm-path]` | Migrate from references/ to service manager |

### Agent Orchestration

| Command | Description |
|---------|-------------|
| `jfl ralph [args]` | Ralph-tui agent loop orchestrator |
| `jfl peter [action]` | Peter Parker model-routed orchestrator (setup, run, status) |
| `jfl orchestrate [name] [--list] [--create <n>]` | Multi-service orchestration workflows |
| `jfl dashboard` | Interactive service monitoring TUI |
| `jfl events [-p pattern]` | Live MAP event bus dashboard |

### Platform

| Command | Description |
|---------|-------------|
| `jfl login [--platform\|--x402\|--solo\|--team\|--free]` | Authenticate |
| `jfl logout` | Logout from platform |
| `jfl wallet` | Wallet and day pass status |
| `jfl deploy [-f]` | Deploy to JFL platform |
| `jfl agents [action]` | Manage parallel agents (list, create, start, stop, destroy) |
| `jfl feedback [action]` | Rate session (0-5), view or sync |

### Telemetry & Intelligence

| Command | Description |
|---------|-------------|
| `jfl telemetry status` | Show telemetry status |
| `jfl telemetry show` | Show queued events |
| `jfl telemetry digest [--hours N] [--format json] [--platform]` | Cost breakdown, health analysis, suggestions |
| `jfl telemetry reset` | Reset install ID |
| `jfl telemetry track --category <c> --event <e>` | Emit event from shell scripts |
| `jfl improve [--dry-run] [--auto] [--hours N]` | Self-improvement loop: analyze, suggest, create issues |
| `jfl preferences --no-telemetry` | Opt out of telemetry |

**Model cost tracking:** Every Stratus API call emits token counts and estimated cost. Covers claude-opus-4-6, claude-sonnet-4-6, claude-sonnet-4-5, claude-haiku-3-5, gpt-4o.

**`jfl telemetry digest`** analyzes local events: per-model cost tables, command stats, error rates, hub/memory/session health. Flags issues like high MCP latency, cost concentration, crash rates.

**`jfl improve`** generates actionable suggestions from the digest. `--dry-run` previews, `--auto` creates GitHub issues tagged `[jfl-improve]`.

### Voice Input

Local voice-to-text using Whisper models.

| Command | Description |
|---------|-------------|
| `jfl voice` | Start voice recording with VAD |
| `jfl voice setup` | First-time setup wizard |
| `jfl voice devices` | List audio input devices |
| `jfl voice test [-d device]` | Test record + transcribe (3s) |
| `jfl voice recording [-d device] [-t seconds]` | Test recording only |
| `jfl voice record [-d device]` | Record with VAD |
| `jfl voice hotkey [-d device] [-m mode]` | Global hotkey listener (macOS) |
| `jfl voice daemon start\|stop\|status` | Background hotkey daemon (macOS) |
| `jfl voice model list\|download\|default [name]` | Manage whisper models |
| `jfl voice help` | Voice command help |

### Skills

| Command | Description |
|---------|-------------|
| `jfl skills list [-a\|--available] [-c category] [-t tag]` | List installed or available skills |
| `jfl skills install <skills...>` | Install skill(s) |
| `jfl skills remove <skills...>` | Remove skill(s) |
| `jfl skills update [skill] [--dry]` | Update installed skill(s) |
| `jfl skills search <query>` | Search for skills |
| `jfl brand [subcommand]` | Brand architect shortcut |
| `jfl content <type> [topic]` | Content creator shortcut |

### OpenClaw Protocol

Runtime-agnostic agent integration. All commands support `--json`.

| Command | Description |
|---------|-------------|
| `jfl openclaw session-start -a <agent>` | Start agent session |
| `jfl openclaw session-end [-s]` | End session (merge, sync) |
| `jfl openclaw context [-q query] [-t type]` | Query project context |
| `jfl openclaw journal --type <t> --title <t> --summary <s>` | Write journal entry |
| `jfl openclaw heartbeat` | Health pulse (auto-commit, check hub) |
| `jfl openclaw status` | Agent session state |
| `jfl openclaw register -g <gtm>` | Register agent with GTM |
| `jfl openclaw gtm-list` | List registered GTM workspaces |
| `jfl openclaw gtm-switch <id>` | Switch active GTM workspace |
| `jfl openclaw gtm-create <name> [-p path]` | Create and register new GTM |
| `jfl openclaw tag <service> <message>` | Send message to service agent |

### Clawdbot

Telegram-based agent with context injection.

| Command | Description |
|---------|-------------|
| `jfl clawdbot setup` | Install JFL plugin into Clawdbot |
| `jfl clawdbot status` | Plugin installation status |

### GTM

| Command | Description |
|---------|-------------|
| `jfl gtm process-service-update [file]` | Process service sync notification (hook) |

---

## Skills

Pre-installed slash commands for Claude Code:

| Skill | Description |
|-------|-------------|
| `/hud` | Project dashboard — guided workflow, progress tracking |
| `/brand-architect` | Generate brand identity (marks, colors, typography) |
| `/web-architect` | Implement brand assets, audit code |
| `/content` | Create content (threads, posts, articles, one-pagers) |
| `/founder-video` | Viral short-form video scripts |
| `/startup` | Startup guidance (idea to scale) |
| `/spec` | Multi-agent adversarial spec refinement |
| `/fly-deploy` | Fly.io deployment management |
| `/search` | Semantic search across knowledge base |
| `/end` | End session gracefully (merge, cleanup) |
| `/ralph-tui` | AI agent loop orchestrator |
| `/x-algorithm` | X/Twitter For You feed optimization |
| `/agent-browser` | Headless browser automation |
| `/react-best-practices` | React/Next.js performance patterns |
| `/remotion-best-practices` | Remotion video creation in React |
| `/geo` | GEO-first SEO analysis for AI search engines |
| `/geo-audit` | Full website GEO+SEO audit with parallel agents |

```bash
# Install more skills
jfl skills list --available
jfl skills install geo-audit
```

---

## Knowledge Layer

Strategy docs filled through conversation, not forms:

```
knowledge/
├── VISION.md              # What you're building, who it's for
├── NARRATIVE.md           # How you tell the story
├── THESIS.md              # Why you'll win
├── ROADMAP.md             # What ships when
├── BRAND_BRIEF.md         # Brand inputs
├── BRAND_DECISIONS.md     # Finalized brand choices
└── VOICE_AND_TONE.md      # How the brand speaks
```

**Philosophy:** Vision emerges from doing, not declaring. Start building immediately. Claude captures context into docs as you work.

---

## Journal Protocol

Every session MUST write journal entries. Hooks enforce this.

```json
{
  "v": 1,
  "ts": "2026-02-27T10:00:00.000Z",
  "session": "session-goose-20260227-1014-abc123",
  "type": "feature",
  "status": "complete",
  "title": "Add service agent onboarding",
  "summary": "Built jfl onboard command that registers service repos in GTM",
  "detail": "Creates agent definition, skill wrapper, services.json entry...",
  "files": ["src/commands/onboard.ts"],
  "incomplete": ["peer sync not wired"],
  "next": "Wire phone-home on session end"
}
```

**Write entries when:** Feature completed, decision made, bug fixed, milestone reached, session ending.

Entries become searchable via `jfl memory search` and MCP `memory_search` tool.

---

## How It Works

```
Session Start                    During Session                   Session End
─────────────                    ──────────────                   ───────────
SessionStart hook fires          You work normally                Stop hook fires
├─ Sync repos                    ├─ Code, content, strategy       ├─ Warn if no journal
├─ Create session branch         ├─ Journal entries auto-tracked  ├─ Auto-commit changes
├─ Recover crashed sessions      ├─ Auto-commit every 2 min       ├─ Merge to main
├─ Health-check Context Hub      ├─ Events flow to MAP bus        └─ Cleanup branch
└─ Start auto-commit             └─ Memory indexes continuously

                    Context Hub (always running)
                    ├─ Serves MCP tools to Claude Code
                    ├─ Aggregates journal + knowledge + code
                    ├─ Bridges service events from file-drop
                    └─ Watches journal/ for live entries
```

**Everything is files.** No proprietary database. No lock-in. Context is git-native — version controlled, portable, model-agnostic.

---

## Auto-Update

JFL checks for npm updates on session start (24-hour cache):

- **Minor/patch:** Auto-updates silently
- **Major:** Prompts for approval

```bash
jfl update                    # Pull latest skills and scripts
jfl update --dry              # Preview changes first
jfl --no-update               # Skip auto-update check
```

**What gets updated:** `.claude/skills/`, `scripts/`, `templates/`, `context-hub`
**What's preserved:** `knowledge/`, `content/`, `suggestions/`, `CLAUDE.md`, `.mcp.json`, `.jfl/config.json`

---

## Authentication

```bash
jfl login                     # Platform Account (recommended)
jfl login --x402              # x402 Day Pass ($5/day, crypto)
jfl login --solo              # Solo plan ($49/mo)
jfl login --team              # Team plan ($199/mo)
jfl login --free              # Stay on trial
jfl logout                    # Logout
jfl status                    # Check auth status
jfl wallet                    # Wallet and day pass status
```

---

## What's New

**0.2.4**
- Feat: `jfl telemetry digest` — per-model cost tables, command stats, health analysis, improvement suggestions
- Feat: `jfl improve` — self-improvement loop with GitHub issue creation (`--auto`)
- Feat: Model cost tracking on every Stratus API call (token counts, estimated USD, confidence, timing)
- Feat: Peter Parker agent cost tracking (per-role, per-model cost events)
- Feat: Model pricing table (claude-opus-4-6, claude-sonnet-4-6, claude-sonnet-4-5, claude-haiku-3-5, gpt-4o)

**0.2.3**
- Fix: Context Hub race condition — SessionStart hook checks health before ensure
- Fix: `jfl update` no longer clobbers project-specific CLAUDE.md and .mcp.json
- Fix: `restartCoreServices` checks health before stop+restart cycle
- Feat: Context Hub dashboard with live event stream
- Feat: Journal bridge — journal entries appear in MAP event bus in real-time
- Feat: Auth supports query param tokens for SSE/EventSource connections

**0.2.2**
- Feat: Context Hub always-on — MCP auto-recovery, ensure-all, doctor, launchd daemon
- Fix: Context Hub survives SIGTERM during daemon startup (5s grace period)
- Feat: MAP event bus with ring buffer, SSE/WS, pattern matching, file-drop bridging
- Feat: Per-project Context Hub ports (no more collisions)

**0.2.1**
- Feat: Service agent system — onboard, create, validate, phone-home
- Feat: Peter Parker model-routed orchestrator (cost/balanced/quality profiles)
- Feat: Peer agent sync across services
- Fix: `jfl init` no longer creates nested directories

**0.2.0**
- OpenClaw protocol — runtime-agnostic agent integration
- Clawdbot plugin — Telegram-based agent with context injection
- Memory system — TF-IDF + embeddings, hybrid search, auto-indexing

**0.1.0**
- Auto-update on session start
- Synopsis command
- Context Hub productization

---

## Environment Variables

```bash
OPENAI_API_KEY=sk-...         # Optional: enables semantic embeddings for memory search
CONTEXT_HUB_PORT=4242         # Override per-project port
CRM_SHEET_ID=your-sheet-id    # Google Sheets CRM integration
JFL_PLATFORM_URL=...          # JFL platform URL (default: jfl.run)
```

---

## License

MIT License - see LICENSE file.

---

## Credits

Built by [@tagga](https://x.com/taggaoyl) (Alec Taggart)

Powered by [Claude](https://claude.ai) (Anthropic), [x402](https://x402.org) (crypto micropayments), Commander.js, sql.js, and more.
