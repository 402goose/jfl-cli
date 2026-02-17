# JFL CLI - Architecture

## Tech Stack

- **Language:** TypeScript (ES2022 target, NodeNext modules)
- **Runtime:** Node.js >= 18
- **Build:** `tsc` (TypeScript compiler)
- **Test:** Jest with ts-jest
- **Package type:** ESM (`"type": "module"` in package.json)
- **CLI framework:** Commander.js
- **Database:** sql.js (SQLite via WASM, no native bindings)
- **UI toolkit:** blessed + blessed-contrib (terminal dashboards)

## Directory Structure

```
jfl-cli/
├── src/                          # TypeScript source
│   ├── index.ts                  # CLI entry point (commander program definition)
│   ├── commands/                 # Command implementations (one file per command)
│   │   ├── init.ts               # Project initialization
│   │   ├── login.ts              # Authentication (GitHub, x402, platform)
│   │   ├── status.ts             # Project status display
│   │   ├── hud.ts                # Campaign dashboard
│   │   ├── session.ts            # Session management / gateway dashboard
│   │   ├── update.ts             # npm + template auto-update
│   │   ├── context-hub.ts        # Context Hub daemon (HTTP server)
│   │   ├── synopsis.ts           # Work summary aggregator
│   │   ├── deploy.ts             # Platform deployment
│   │   ├── agents.ts             # Parallel agent management
│   │   ├── feedback.ts           # Session rating
│   │   ├── repair.ts             # Project repair
│   │   ├── skills.ts             # Skill management
│   │   ├── voice.ts              # Voice input (whisper)
│   │   ├── memory.ts             # Memory system CLI
│   │   ├── profile.ts            # User profile management
│   │   ├── ralph.ts              # ralph-tui agent loop launcher
│   │   ├── onboard.ts            # Service onboarding
│   │   ├── services.ts           # Global service management
│   │   ├── services-create.ts    # Service creation
│   │   ├── services-scan.ts      # Service discovery/scanning
│   │   ├── services-sync-agents.ts # Sync agent definitions
│   │   ├── service-manager.ts    # Service Manager API daemon
│   │   ├── service-agent.ts      # Service MCP agent management
│   │   ├── service-validate.ts   # Service validation
│   │   ├── validate-settings.ts  # .claude/settings.json validation
│   │   ├── orchestrate.ts        # Multi-service orchestration
│   │   ├── migrate-services.ts   # Legacy service migration
│   │   └── gtm-process-update.ts # GTM service sync hook handler
│   ├── lib/                      # Core libraries
│   │   ├── memory-db.ts          # SQLite memory database (schema, CRUD)
│   │   ├── memory-indexer.ts     # Journal entry indexer
│   │   ├── memory-search.ts      # Hybrid TF-IDF + embedding search
│   │   ├── service-detector.ts   # Auto-detect service metadata from codebase
│   │   ├── service-gtm.ts        # Service-GTM parent relationship management
│   │   ├── service-dependencies.ts # Service dependency graph
│   │   ├── service-utils.ts      # Service health checks, restart, validation
│   │   ├── service-mcp-base.ts   # Base class for service MCP servers
│   │   ├── agent-generator.ts    # Generate CLAUDE.md agent definitions
│   │   ├── peer-agent-generator.ts # Generate peer agent discovery files
│   │   ├── skill-generator.ts    # Generate skill files for services
│   │   └── stratus-client.ts     # Stratus X1 reasoning API client
│   ├── mcp/                      # MCP server implementations
│   │   ├── context-hub-mcp.ts    # Context Hub MCP (stdio JSON-RPC)
│   │   ├── service-registry-mcp.ts # Service Registry MCP
│   │   ├── service-mcp-server.ts # Per-service MCP server
│   │   └── service-peer-mcp.ts   # Peer service discovery MCP
│   ├── utils/                    # Shared utilities
│   │   ├── jfl-paths.ts          # XDG path management (config, data, cache)
│   │   ├── jfl-config.ts         # Global config read/write
│   │   ├── jfl-migration.ts      # Legacy ~/.jfl/ to XDG migration
│   │   ├── auth-guard.ts         # Auth + payment enforcement
│   │   ├── x402-client.ts        # x402 day pass client
│   │   ├── wallet.ts             # Ethereum wallet (seed phrase, USDC)
│   │   ├── github-auth.ts        # GitHub OAuth device flow
│   │   ├── github-repo.ts        # GitHub repo creation
│   │   ├── platform-auth.ts      # Platform auth (JFL.run)
│   │   ├── git.ts                # Git operations (status, commit, push)
│   │   ├── project-config.ts     # Project-local config (.jfl/config.json)
│   │   ├── skill-registry.ts     # Skill install/remove/update logic
│   │   ├── settings-validator.ts # .claude/settings.json validator
│   │   ├── ensure-context-hub.ts # Auto-start Context Hub
│   │   ├── ensure-project.ts     # Verify in a JFL project
│   │   └── claude-md-generator.ts # Generate CLAUDE.md from profile
│   ├── ui/                       # Terminal UI components
│   │   ├── services-manager.tsx  # React-based services TUI (blessed)
│   │   ├── service-dashboard.ts  # Service monitoring dashboard
│   │   ├── context-hub-logs.tsx  # Context Hub log viewer
│   │   ├── banner.ts             # ASCII art banner
│   │   ├── theme.ts              # TUI color theme
│   │   └── prompts.ts            # UI prompt helpers
│   ├── types/                    # TypeScript type definitions
│   │   └── skills.ts             # Skill registry types
│   └── telegram/                 # Telegram integration (unused/early)
├── dist/                         # Compiled JS output (mirrors src/)
├── scripts/
│   ├── postinstall.js            # npm postinstall (installs ralph-tui via bun)
│   ├── session/                  # Session management bash scripts
│   │   ├── session-init.sh       # Session initialization
│   │   ├── session-end.sh        # Session cleanup + merge
│   │   ├── session-sync.sh       # Multi-repo sync
│   │   ├── session-cleanup.sh    # Worktree/branch cleanup
│   │   ├── auto-commit.sh        # Background auto-commit daemon
│   │   ├── jfl-doctor.sh         # Health check / diagnostics
│   │   ├── test-context-preservation.sh
│   │   ├── test-critical-infrastructure.sh
│   │   ├── test-experience-level.sh
│   │   ├── test-session-cleanup.sh
│   │   └── test-session-sync.sh
│   ├── commit-gtm.sh             # Git commit helper for GTM repo
│   ├── commit-product.sh         # Git commit helper for product submodule
│   ├── context-query.sh          # Query Context Hub from shell
│   ├── voice-start.sh            # Start voice input
│   ├── voice-stop.sh             # Stop voice input
│   ├── where-am-i.sh             # Detect current project context
│   └── test-onboarding.sh        # Onboarding test script
├── template/                     # GTM workspace template (copied on `jfl init`)
│   ├── CLAUDE.md                 # AI instructions template
│   ├── CLAUDE.md.bak             # Backup of CLAUDE.md
│   ├── .claude/
│   │   ├── settings.json         # Claude Code settings with hooks
│   │   ├── service-settings.json # Service-specific Claude settings
│   │   └── skills/               # 17 bundled skills
│   ├── .jfl/                     # Project JFL config template
│   ├── .mcp.json                 # MCP config pointing to jfl-context-hub-mcp
│   ├── knowledge/                # Strategic doc templates
│   ├── content/                  # Empty content directory
│   ├── previews/                 # Empty previews directory
│   ├── suggestions/              # Empty suggestions directory
│   ├── scripts/                  # Session management scripts
│   └── templates/                # Doc templates for brand, strategic, collaboration
├── templates/                    # Document templates
│   ├── strategic/                # VISION.md, NARRATIVE.md, THESIS.md, ROADMAP.md
│   ├── brand/                    # BRAND_BRIEF.md, BRAND_DECISIONS.md, etc.
│   ├── collaboration/            # CONTRIBUTOR.md, CRM.md, TASKS.md
│   └── service-mcp-template.js   # Template for service MCP servers
├── clawdbot-skill/               # Clawdbot integration
│   ├── index.ts                  # Skill implementation
│   ├── SKILL.md                  # Skill documentation
│   ├── skill.json                # Skill metadata
│   └── package.json              # Skill package config
├── skills/
│   └── jfl-gtm/                  # JFL GTM skill (for Clawdbot)
├── docs/                         # Documentation
│   ├── CLAUDE-CODE-INTEGRATION.md
│   ├── CLAUDE-CODE-SETUP.md
│   ├── SERVICE-MESH.md
│   └── SERVICE_MIGRATION.md
└── knowledge/                    # (this directory) JFL CLI knowledge docs
```

## Key Architectural Components

### 1. CLI Entry Point (`src/index.ts`)

The main entry point uses Commander.js to define all commands. It runs `checkAndMigrate()` at startup to handle legacy `~/.jfl/` to XDG migration. Running `jfl` with no arguments auto-updates then launches a session.

Key patterns:
- Heavy use of dynamic imports (`await import(...)`) to lazy-load command modules, keeping startup fast.
- Two tiers of commands: free (offline) and platform (login required).
- Sub-command groups for `skills`, `voice`, `memory`, `gtm`.

### 2. Context Hub (`src/commands/context-hub.ts`)

A local HTTP daemon running on port 4242 that:
- Serves journal entries from `.jfl/journal/*.jsonl`
- Serves knowledge docs from `knowledge/*.md`
- Extracts `@purpose`/`@spec`/`@decision` tags from code files
- Provides REST API endpoints: `/context`, `/search`, `/status`, `/sessions`
- Token-based auth (`.jfl/context-hub.token`)
- PID file at `.jfl/context-hub.pid`
- Integrates the memory system (SQLite database, periodic indexing)

### 3. MCP Servers (`src/mcp/`)

Three MCP servers speak JSON-RPC over stdio:

- **context-hub-mcp.ts** -- Bridges MCP protocol to Context Hub HTTP daemon. Reads from `CONTEXT_HUB_URL`. Provides `context_get`, `context_search`, `context_status`, `context_sessions`, plus memory tools (`memory_search`, `memory_add`, `memory_status`).
- **service-registry-mcp.ts** -- Bridges to Service Manager API. Provides `service_list`, `service_info`, `service_start`, `service_stop`, `service_health`, `service_call`.
- **service-peer-mcp.ts** -- Peer service discovery. Reads GTM parent config to find sibling services.

All MCP servers follow the same pattern: readline-based JSON-RPC parser, handle `initialize`, `tools/list`, `tools/call`, `notifications/initialized`.

### 4. Memory System (`src/lib/memory-*.ts`)

SQLite-based memory persistence:

- **memory-db.ts** -- Schema definition, CRUD operations. Database at `.jfl/memory.db`. Tables: `memories` (with embeddings, TF-IDF tokens), `tags`, `links`, `index_metadata`.
- **memory-indexer.ts** -- Scans `.jfl/journal/*.jsonl` and indexes entries. Generates TF-IDF tokens. Optionally generates OpenAI embeddings. Periodic indexing (every 60 seconds when Context Hub runs).
- **memory-search.ts** -- Hybrid search combining TF-IDF (40% weight) and embeddings (60% weight). Relevance scoring with boosts for recency (1.3x if < 7 days), decisions (1.4x), features (1.2x).

### 5. Service Mesh (`src/commands/services*.ts`, `src/lib/service-*.ts`)

Multi-service orchestration:

- **service-detector.ts** -- Auto-detects service type (web/api/container/worker/cli/infrastructure/library) from codebase files (package.json, Dockerfile, etc.)
- **service-gtm.ts** -- Manages parent GTM relationship. Services register in GTM's `.jfl/config.json`. Handles journal sync from service to GTM parent.
- **service-dependencies.ts** -- Dependency graph for services with cycle detection.
- **service-utils.ts** -- Health checks, service restart, version tracking.
- **agent-generator.ts** -- Generates CLAUDE.md for service agents.
- **peer-agent-generator.ts** -- Generates peer agent discovery files.
- **skill-generator.ts** -- Generates Claude Code skills for services.

Global service state stored at:
- `~/.local/share/jfl/services.json` (XDG data home)
- `~/.local/share/jfl/service-ports.json` (port allocation)

### 6. Authentication (`src/utils/auth-guard.ts`, `src/commands/login.ts`)

Three auth methods:
- **GitHub OAuth** -- Device flow via `github-auth.ts`
- **x402 crypto wallet** -- Seed phrase / private key, USDC day pass ($5/day)
- **Platform auth** -- JFL.run platform token

Payment model:
- Project has one wallet (owner's) that pays
- Contributors can optionally have their own wallet
- Trial mode is free until foundation complete or teammate joins

### 7. Update System (`src/commands/update.ts`)

Two-part update:
1. **npm package update** -- Checks npm registry for new `jfl` versions. Minor/patch auto-update, major prompts. 24-hour check cache at `~/.cache/jfl/last-update-check`.
2. **GTM template sync** -- Clones `jfl-template` repo to temp, syncs CLAUDE.md, `.claude/`, `.mcp.json`, `templates/`, `scripts/`. Preserves `knowledge/`, `product/`, `suggestions/`, `content/`, `.jfl/config.json`.

## Configuration

### Global Config (XDG-compliant)

| Path | Purpose |
|------|---------|
| `~/.config/jfl/config.json` | Global JFL settings (auth, preferences, projects) |
| `~/.config/jfl/auth.json` | Auth tokens |
| `~/.config/jfl/service-manager.json` | Service Manager config |
| `~/.local/share/jfl/services.json` | Global services registry |
| `~/.local/share/jfl/services/` | Service data (registry, logs, PIDs) |
| `~/.cache/jfl/last-update-check` | Update check timestamp |

Legacy `~/.jfl/` is auto-migrated to XDG paths on startup.

### Project-Local Config

| Path | Purpose |
|------|---------|
| `.jfl/config.json` | Project settings (name, type, setup, services) |
| `.jfl/journal/*.jsonl` | Session journal entries |
| `.jfl/memory.db` | SQLite memory database |
| `.jfl/context-hub.pid` | Context Hub PID file |
| `.jfl/context-hub.token` | Context Hub auth token |
| `.jfl/services.json` | Project-local service definitions |
| `.jfl/logs/` | Daemon log files |

## Data Flow

### Session Start
1. `jfl` runs auto-update check (npm + template sync)
2. Checks if in JFL project (has CLAUDE.md or knowledge/)
3. Verifies payment (trial mode or day pass)
4. Ensures Context Hub is running (auto-starts if needed)
5. Checks Service Manager status
6. Shows Gateway Dashboard with connection info

### Context Flow (AI Session)
1. Claude Code starts, MCP connects to `jfl-context-hub-mcp`
2. Agent calls `context_get` to load project context
3. Context Hub daemon reads journal, knowledge docs, code headers
4. Memory system indexes journal entries for semantic search
5. Agent calls `memory_search` for past decisions/work
6. Agent writes journal entries to `.jfl/journal/<session>.jsonl`
7. Memory indexer picks up new entries (60s interval or manual)

### Update Flow
1. Check npm registry for latest version (24h cache)
2. Compare semver: auto-update minor/patch, prompt for major
3. Run `npm install -g jfl@latest`
4. Clone template repo to temp dir
5. Copy CLAUDE.md, skills, settings, templates, scripts
6. Preserve knowledge/, product/, content/, suggestions/
7. Detect service changes, restart if needed

## Patterns and Conventions

### Code File Headers
Every `.ts` file must have a JSDoc header with `@purpose`:
```typescript
/**
 * Module Name
 *
 * Description.
 *
 * @purpose One-line description
 * @spec Optional spec reference
 */
```

### Command Pattern
Each command exports an async function matching its name (e.g., `initCommand`, `statusCommand`). Commands handle their own output via chalk and ora.

### Error Handling
Commands use try/catch with user-friendly error messages via chalk. Spinners (ora) are used for long operations. Exits with `process.exit(1)` on fatal errors.

### Dynamic Imports
Heavy modules are loaded via `await import()` to keep CLI startup fast. This is used for service commands, orchestration, dashboard, and other less-common paths.

## Build and Dev Commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Watch mode with tsx |
| `npm start` | Run compiled CLI |
| `npm test` | Run Jest tests |
| `npm run test:watch` | Jest in watch mode |
| `npm run test:coverage` | Jest with coverage |
| `npm link` | Link globally for development |

### TypeScript Config
- Target: ES2022
- Module: NodeNext (ESM)
- Strict mode enabled
- Source maps and declarations generated
- JSX: React (for blessed-contrib TUI components)
