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

JFL supports a three-level hierarchy: **Portfolio > GTM > Services**. Portfolios coordinate multiple products. GTMs are context layers for individual products. Services are the repos that do the actual work.

```
visa-portfolio/                <- Portfolio (strategy, cross-product RL, data flow)
├── .jfl/
│   ├── config.json           <- type: "portfolio", registered child GTMs
│   ├── eval.jsonl            <- Aggregated eval data from all children
│   ├── flows.yaml            <- Cross-product event routing
│   └── journal/              <- Portfolio-level + synced child journals
│
├── productrank-gtm/           <- GTM workspace (registered as child)
│   ├── .jfl/
│   │   ├── config.json       <- type: "gtm", portfolio_parent, registered services
│   │   ├── eval.jsonl        <- Eval entries from arena competitions
│   │   ├── journal/          <- Session journals + synced service journals
│   │   ├── agents/           <- Agent manifests + policies
│   │   ├── flows/            <- Per-agent flow definitions
│   │   └── service-events.jsonl
│   ├── knowledge/            <- Strategy docs (VISION, ROADMAP, THESIS, etc.)
│   ├── content/              <- Generated content
│   ├── suggestions/          <- Per-contributor workspaces
│   ├── .claude/
│   │   ├── settings.json     <- Claude Code hooks
│   │   ├── agents/           <- Service agent definitions
│   │   └── skills/           <- Slash commands (/hud, /content, etc.)
│   ├── scripts/session/      <- Session management
│   ├── CLAUDE.md             <- AI instructions
│   └── .mcp.json             <- MCP server config
│
└── seo-agent/                 <- Another GTM (registered as child)
    └── ...

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
- Eval data dual-writes up the chain (service > GTM > portfolio)
- Cross-product event routing at portfolio level

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
jfl context-hub dashboard     # Open web dashboard (opens browser)
jfl context-hub install-daemon  # Auto-start on boot (launchd/systemd)
jfl context-hub uninstall-daemon  # Remove auto-start
jfl context-hub query         # Query context from CLI
jfl context-hub serve         # Run in foreground (daemon mode)
```

**Per-project ports** assigned automatically (or set in `.jfl/config.json` > `contextHub.port`).

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
| `query_experiment_history` | Query RL trajectories for agent experiments |

**Resilience:** 5-layer system — MCP auto-recovery on ECONNREFUSED, health-check-before-ensure hooks, `ensure-all` for batch startup, `doctor` diagnostics, launchd/systemd daemon with keepalive.

### Dashboard V2

A pre-built Vite + Preact + Tailwind SPA served by Context Hub at `/dashboard/`. Auto-detects workspace type and adapts layout.

**Pages:**

| Page | What It Shows |
|------|--------------|
| **Overview** | Activity charts, product cards, metric cards |
| **Journal** | Searchable journal entries with type filters |
| **Events** | Live event feed with pattern filter presets (eval, session, flow, etc.) |
| **Services** | Registered services with type badges, context scope visualization, data flows |
| **Flows** | Flow definitions and execution history |
| **Health** | System metrics, context sources, memory index, tracked projects |
| **Agents** | Eval leaderboards grouped by product domain |

**Features:** Sidebar with structured sections (Workspace / Infra / Eval), inline SVG icons, agent leaderboard in sidebar, sparkline charts, real-time polling.

```bash
jfl context-hub dashboard     # Opens /dashboard/ in browser
```

### MAP Event Bus

Metrics, Agents, Pipeline — an in-process event bus inside Context Hub.

- **Ring buffer** (1000 events) with JSONL persistence
- **Service event bridge** — watches `.jfl/service-events.jsonl`, converts to events
- **Journal bridge** — watches `.jfl/journal/`, emits events on new entries
- **Pattern-matching subscriptions** (glob support)
- **Transports:** SSE, WebSocket, HTTP polling
- **Cross-product routing** — portfolio flows route events between child GTMs
- **Event types:** `session:started`, `session:ended`, `eval:scored`, `journal:entry`, `flow:triggered`, `agent:iteration-complete`, `portfolio:phone-home`, and more

Services emit events by appending to `.jfl/service-events.jsonl` — no auth needed, Context Hub watches the file automatically.

### Eval Framework

Track agent performance over time. Eval entries dual-write up the parent chain (service > GTM > portfolio) so every level has visibility.

```bash
jfl eval list                 # List recent eval entries
jfl eval list -a shadow       # Filter by agent
jfl eval trajectory -a shadow # Composite score over time (with sparkline)
jfl eval log -a shadow -m '{"composite":0.69}' # Log an eval entry
jfl eval compare              # Side-by-side agent comparison
jfl eval tuples               # Extract (state, action, reward) training tuples
```

**Eval entries** are JSONL with agent name, metrics, composite score, model version, and deltas:

```json
{
  "v": 1, "ts": "2026-03-05T15:22:47Z",
  "agent": "productrank-shadow",
  "dataset": "vibe-50-v1",
  "model_version": "shadow-0.3.1",
  "metrics": {"ndcg@10": 0.59, "mrr": 0.77, "precision@5": 0.43},
  "composite": 0.6935,
  "delta": {"composite": -0.029}
}
```

**Leaderboard:** Agents grouped by metric domain. ProductRank agents scored on ndcg@10, mrr, precision@5. SEO agents scored on avg_rank, keywords_ranked. Dashboard Agents page shows leaderboards per domain.

**Training tuples** extracted from journals for fine-tuning: `(state, action, reward)` — maps codebase state + experiment action to eval score delta.

**API endpoints** on Context Hub:
- `GET /api/eval/leaderboard` — all agents ranked by composite
- `GET /api/eval/trajectory?agent=X&metric=composite` — score trajectory with timestamps

### RL Infrastructure

JFL generalizes the Karpathy nanochat pattern: structured journals are the replay buffer, eval scores are rewards, agents learn in-context from past trajectories.

```
Agent LLM (Policy)        > reads trajectories, proposes experiments
Stratus (World Model)     > predicts outcomes, filters bad proposals
Journals (Replay Buffer)  > structured experiment history
Eval Framework (Reward)   > composite scores, score deltas
Event Bus (Nervous System) > connects everything
```

**JournalEntry type** — canonical schema with 6 RL fields: `hypothesis`, `outcome`, `score_delta`, `eval_snapshot`, `diff_hash`, `context_entries`.

**TrajectoryLoader** — query, filter, and render experiment trajectories for agent context windows. Supports filtering by session, agent, outcome, score range.

**Peter Parker** — model-routed orchestrator with cost/balanced/quality profiles. Routes tasks to haiku/sonnet/opus based on complexity. Subscribes to event bus for reactive dispatch.

**Flow Engine** — declarative trigger-action automation in `.jfl/flows.yaml`:

```yaml
- name: eval-scored-trigger-analysis
  trigger:
    pattern: "eval:scored"
  gate:
    requires_approval: true
  actions:
    - type: spawn
      command: "claude -p 'Analyze the latest eval results'"
```

Flow actions: `log`, `emit`, `journal`, `webhook`, `command`, `spawn`. Gates: `after` (time-gated), `before` (deadline), `requires_approval`.

**MCP tool:** `query_experiment_history` — agents query past experiment trajectories to inform next proposals.

### Portfolio Management

Coordinate multiple GTM workspaces under one portfolio.

```bash
jfl portfolio register /path/to/gtm   # Register a GTM in this portfolio
jfl portfolio list                     # List child GTMs with health
jfl portfolio unregister <name>        # Remove a GTM
jfl portfolio status                   # Portfolio health + eval summary
jfl portfolio phone-home               # Report GTM health to portfolio parent
```

**Portfolio Context Hub** operates in fan-out mode:
- Connects to child GTM hubs via SSE
- Bridges child events into portfolio event bus
- Fans out search queries across all child hubs
- Aggregates eval leaderboard across products
- Enforces context scope (produces/consumes/denied) between GTMs

**Cross-product flows** defined in `.jfl/flows.yaml`:

```yaml
- name: tool-trends-to-seo
  trigger:
    pattern: "discovery:tool-trend"
    source: "productrank-gtm"
  actions:
    - type: webhook
      url: "http://localhost:{{child.seo-agent.port}}/api/events"
```

Template variables: `{{child.NAME.port}}`, `{{child.NAME.token}}`

**Context scope** — each child GTM declares what events it produces and consumes. Portfolio enforces boundaries:

```json
{
  "context_scope": {
    "produces": ["discovery:tool-trend", "eval:*"],
    "consumes": ["strategy:*", "seo:serp-data"],
    "denied": []
  }
}
```

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
- **Cleanup guard:** Prevents `rm -rf` on main branch when no worktrees exist

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

**Context scoping:** Each service declares what events it produces and consumes. The GTM enforces scope — teams can't read each other's journals unless explicitly granted.

```json
{
  "context_scope": {
    "produces": ["eval:submission", "journal:my-team*"],
    "consumes": ["eval:scored", "leaderboard:updated"],
    "denied": ["journal:other-team*"]
  }
}
```

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
| `jfl doctor [--fix]` | Check project health, auto-repair fixable issues |
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
| `jfl context-hub dashboard` | Open web dashboard in browser |
| `jfl context-hub query` | Query context from CLI |
| `jfl context-hub serve` | Run in foreground (daemon mode) |
| `jfl context-hub install-daemon` | Auto-start on boot |
| `jfl context-hub uninstall-daemon` | Remove auto-start |

### Eval Framework

| Command | Description |
|---------|-------------|
| `jfl eval list [-a agent] [-l limit]` | List recent eval entries |
| `jfl eval trajectory -a <agent>` | Composite score trajectory with sparkline |
| `jfl eval log -a <agent> -m <metrics>` | Log an eval entry |
| `jfl eval compare` | Side-by-side agent comparison |
| `jfl eval tuples [--limit N] [--format json]` | Extract training tuples from journals |

### Portfolio

| Command | Description |
|---------|-------------|
| `jfl portfolio register <path>` | Register GTM workspace in portfolio |
| `jfl portfolio list` | List child GTMs with health status |
| `jfl portfolio unregister <name>` | Remove GTM from portfolio |
| `jfl portfolio status` | Portfolio health and eval summary |
| `jfl portfolio phone-home` | Report GTM health to portfolio parent |

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
| `jfl agent init <name> [-d desc]` | Scaffold agent (manifest + policy + lifecycle flows) |
| `jfl agent list` | List registered agents |
| `jfl agent status <name>` | Show agent health and config |
| `jfl ralph [args]` | Ralph-tui agent loop orchestrator |
| `jfl peter [action]` | Peter Parker model-routed orchestrator (setup, run, status) |
| `jfl orchestrate [name] [--list] [--create <n>]` | Multi-service orchestration workflows |
| `jfl dashboard` | Interactive service monitoring TUI |
| `jfl events [-p pattern]` | Live MAP event bus dashboard |

### Hooks & Flows

| Command | Description |
|---------|-------------|
| `jfl hooks init` | Generate HTTP hooks + default flows |
| `jfl hooks status` | Check hooks and hub connectivity |
| `jfl hooks remove` | Remove HTTP hooks |
| `jfl hooks deploy` | Deploy hooks to all registered services |
| `jfl flows list` | List configured event-action flows |
| `jfl flows add` | Interactive flow builder |
| `jfl flows test <name>` | Test a flow with synthetic event |
| `jfl flows enable/disable <name>` | Toggle flows |
| `jfl scope list` | View service context scopes |
| `jfl scope set` | Set scope declarations |
| `jfl scope test` | Test scope enforcement |

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
| `jfl telemetry digest [--hours N] [--format json] [--plots]` | Cost breakdown, health analysis, terminal charts |
| `jfl telemetry reset` | Reset install ID |
| `jfl telemetry track --category <c> --event <e>` | Emit event from shell scripts |
| `jfl improve [--dry-run] [--auto] [--hours N]` | Self-improvement loop: analyze, suggest, create issues |
| `jfl preferences --no-telemetry` | Opt out of telemetry |

**Model cost tracking:** Every Stratus API call emits token counts and estimated cost. Covers claude-opus-4-6, claude-sonnet-4-6, claude-sonnet-4-5, claude-haiku-3-5, gpt-4o.

**`jfl telemetry digest`** analyzes local events: per-model cost tables, command stats, error rates, hub/memory/session health. `--plots` renders bar charts via kuva (falls back to ASCII).

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
  "hypothesis": "Structured onboarding reduces setup errors",
  "outcome": "confirmed",
  "score_delta": 0.12,
  "eval_snapshot": {"composite": 0.85}
}
```

**Write entries when:** Feature completed, decision made, bug fixed, milestone reached, session ending.

Entries become searchable via `jfl memory search` and MCP `memory_search` tool. RL fields (`hypothesis`, `outcome`, `score_delta`, `eval_snapshot`, `diff_hash`, `context_entries`) enable trajectory-based learning.

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
                    ├─ Watches journal/ for live entries
                    ├─ Portfolio mode: fans out to child hubs
                    ├─ Flow engine: reactive trigger→action
                    └─ Web dashboard at /dashboard/
```

**Everything is files.** No proprietary database. No lock-in. Context is git-native — version controlled, portable, model-agnostic.

---

## CI/CD

Two GitHub Actions workflows handle quality and releases.

### CI — `.github/workflows/ci.yml`

Runs on every push and PR to `main`:

- TypeScript strict mode type checking
- Full test suite (~365 tests across 17 test files)
- Coverage report uploaded as artifact

### CD — `.github/workflows/release.yml`

Fires after CI passes on `main`. Uses [Changesets](https://github.com/changesets/changesets) for version management and npm Trusted Publisher (OIDC) for secretless publishing.

**Auto-changeset generation:** `scripts/generate-changesets.sh` converts conventional commit messages into changesets automatically:
- `feat:` = minor bump
- `fix:` = patch bump
- `feat!:` = major bump

No manual `npx changeset` needed for most changes.

**Release flow:**

```bash
# Option A: Manual changeset
npx changeset         # pick bump level, write summary

# Option B: Just use conventional commits — auto-generated on CI

# Push to main — CI runs, then release.yml fires
#   → changesets/action creates a "Version Packages" PR

# Merge the Version PR
#   → release.yml fires again → npm publish --provenance --access public
```

No `NPM_TOKEN` needed. Publishing uses OIDC provenance via npm Trusted Publisher.

**One-time setup (per package):**
> npmjs.com > `jfl` package > Settings > Publish Access > Add Provenance
> - Repository: `402goose/jfl-cli`
> - Workflow: `.github/workflows/release.yml`

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

**0.3.0**
- Feat: **Portfolio workspace type** — `jfl portfolio register/list/unregister/status/phone-home`. Portfolios contain multiple GTM workspaces with cross-product event routing via SSE, context scope enforcement (produces/consumes/denied), fan-out queries to child hubs, and portfolio-level leaderboard aggregation
- Feat: **Dashboard V2** — pre-built Vite + Preact + Tailwind SPA served at `/dashboard/`. Pages: Overview (activity charts, metric cards), Journal (search + type filters), Events (pattern filter presets), Services (type badges, context scope, data flows), Flows (definitions + execution history), Health (system metrics, memory index), Agents (eval leaderboards grouped by domain)
- Feat: **Eval framework** — `jfl eval list/trajectory/log/compare/tuples`. Track agent metrics over time with composite scores, dual-write up parent chain, extract (state, action, reward) training tuples. Agents grouped by metric domain (ProductRank: ndcg@10/mrr/precision@5, SEO: avg_rank/keywords_ranked)
- Feat: **RL infrastructure (Phase 1)** — `JournalEntry` type with 6 RL fields, `TrajectoryLoader` for querying experiment history, `query_experiment_history` MCP tool
- Feat: **Flow engine** — declarative trigger-action automation in `.jfl/flows.yaml`. Actions: log, emit, journal, webhook, command, spawn. Gates: time-gated, deadline, requires_approval. Template interpolation with `{{child.NAME.port}}`
- Feat: **HTTP hooks** — Claude Code lifecycle hooks (PostToolUse, Stop, PreCompact, SubagentStart/Stop) POST to Context Hub. `jfl hooks init/status/remove/deploy`
- Feat: **Context scope enforcement** — produces/consumes/denied patterns. Event bus filters by scope declarations. `jfl scope list/set/test`
- Feat: CI/CD pipeline — GitHub Actions CI (strict TypeScript + Jest gate) + CD via Changesets with auto-generation from conventional commits. npm Trusted Publisher with OIDC provenance
- Feat: Service agent templates (CLAUDE.md, settings.json, knowledge docs)
- Feat: Session cleanup guard — prevents `rm -rf` on main when no worktrees exist
- Fix: TypeScript strict mode build errors resolved
- Test: ~365 tests across 17 test files (up from 237)

**0.2.5**
- Feat: Docker-style grouped `jfl --help` — 5 groups (Getting Started, Daily Use, Management, Platform, Advanced), ~30 lines down from 52
- Feat: `jfl doctor [--fix]` — unified project health checker (9 checks: .jfl dir, config, Context Hub, hooks, memory, journal, agents, flows, git). Auto-repairs hooks, config, and journal with `--fix`
- Feat: `jfl agent init|list|status` — scaffold narrowly-scoped agents with manifest, policy, and lifecycle flows
- Feat: Flow engine scans `.jfl/flows/*.yaml` for per-agent flow definitions
- Feat: Kuva terminal plots + spawn action type in flow engine
- Fix: Stop committing JFL runtime files (.jfl/logs/, memory.db, *.pid) — gitignore + untrack ([@hathbanger](https://github.com/hathbanger) [#5](https://github.com/402goose/jfl-cli/pull/5))
- Fix: Enforce `jfl update --auto` on session start with 24h cache ([@hathbanger](https://github.com/hathbanger) [#5](https://github.com/402goose/jfl-cli/pull/5))
- Test: 31 new tests (agent-manifest, doctor, agent command, flow-engine directory scan)

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
