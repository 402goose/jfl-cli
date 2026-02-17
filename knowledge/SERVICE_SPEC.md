# JFL CLI - Service Specification

## Identity

- **Package name:** `jfl`
- **npm:** https://www.npmjs.com/package/jfl
- **Repository:** https://github.com/402goose/jfl-cli
- **Version:** 0.1.1
- **License:** MIT
- **Author:** Alec Taggart <402goose@users.noreply.github.com>
- **Node requirement:** >= 18.0.0

## What JFL Does

JFL (Just Fucking Launch) is a CLI that provides a persistent context layer for AI-native teams. It solves the cold-start problem where each AI session begins from zero by storing context as git-native files (markdown, JSONL) that any AI tool can read and contribute to via MCP.

Three core systems:

1. **Context Hub** -- A local daemon (port 4242) that aggregates journal entries, knowledge docs, and code headers. Any AI queries it via MCP.
2. **Synopsis** -- Generates work summaries by rolling up journal entries, git commits, and file headers.
3. **Session Management** -- Automatic session isolation via git worktrees, auto-commit, auto-merge on session end.

## npm Binaries

The package registers three binaries:

| Binary | Entry Point | Purpose |
|--------|-------------|---------|
| `jfl` | `dist/index.js` | Main CLI |
| `jfl-context-hub-mcp` | `dist/mcp/context-hub-mcp.js` | MCP server for Context Hub |
| `jfl-service-registry-mcp` | `dist/mcp/service-registry-mcp.js` | MCP server for Service Registry |

## Published Files

Only these are included in the npm package:

- `dist/` -- Compiled JavaScript
- `scripts/` -- Session management and utility scripts
- `template/` -- GTM workspace template (CLAUDE.md, skills, settings, knowledge)
- `clawdbot-skill/` -- Clawdbot integration skill
- `README.md`
- `LICENSE`

## Command Reference

### Free Tier Commands (work offline)

| Command | Description |
|---------|-------------|
| `jfl` | Interactive session (auto-updates npm package + GTM template) |
| `jfl init [--name <name>]` | Initialize new GTM workspace from template repo |
| `jfl repair` | Repair project missing `.jfl` directory |
| `jfl validate-settings [--fix] [--json]` | Validate and repair `.claude/settings.json` |
| `jfl status` | Show project status (auth, knowledge, Context Hub, skills) |
| `jfl hud [-c/--compact]` | Campaign dashboard (countdown, phases, tasks) |
| `jfl update [--dry]` | Pull latest JFL skills, CLAUDE.md, templates, scripts |
| `jfl context-hub <action> [-p port] [-g]` | Manage Context Hub daemon (start/stop/restart/status/ensure/query/serve) |
| `jfl synopsis [hours] [author]` | Work summary (journal + commits + code headers) |
| `jfl session` | Session management (create/list/end) |
| `jfl preferences [--clear-ai] [--show]` | Manage JFL preferences |

### Service Management Commands

| Command | Description |
|---------|-------------|
| `jfl services [action] [service]` | Manage services (create/scan/list/status/start/stop/deps/validate/sync-agents). No action launches interactive TUI. |
| `jfl service-manager [action] [-p port]` | Manage Service Manager API daemon (start/stop/restart/status/serve) |
| `jfl onboard <path-or-url>` | Onboard a service repo as a service agent |
| `jfl service-agent <action> [name]` | Manage service MCP agents (init/generate/generate-all/register/unregister/list/clean) |
| `jfl orchestrate [name]` | Execute multi-service orchestration workflows |
| `jfl dashboard` | Launch interactive service monitoring dashboard (blessed TUI) |
| `jfl migrate-services [gtm-path]` | Migrate services from references/ to service manager |

### Platform Commands (require login)

| Command | Description |
|---------|-------------|
| `jfl login` | Authenticate (--platform, --x402, --solo, --team, --free, --force) |
| `jfl logout` | Log out from JFL platform |
| `jfl wallet` | Show wallet and day pass status |
| `jfl deploy [-f/--force]` | Deploy project to JFL platform |
| `jfl agents [action]` | Manage parallel agents (list/create/start/stop/destroy) |
| `jfl feedback [action]` | Rate session or sync/view feedback |

### Skill Management Commands

| Command | Description |
|---------|-------------|
| `jfl skills list [-a] [-c category] [-t tag]` | List installed or available skills |
| `jfl skills install <skills...>` | Install skill(s) |
| `jfl skills remove <skills...>` | Remove skill(s) |
| `jfl skills update [skill] [--dry]` | Update installed skill(s) |
| `jfl skills search <query>` | Search for skills |

### Memory System Commands

| Command | Description |
|---------|-------------|
| `jfl memory init` | Initialize SQLite memory database |
| `jfl memory status` | Show memory statistics |
| `jfl memory search <query> [-t type] [-n max]` | Search indexed memories |
| `jfl memory index [-f/--force]` | Reindex journal entries |
| `jfl ask <question> [-t type] [-n max]` | Alias for memory search |

### Voice Input Commands

| Command | Description |
|---------|-------------|
| `jfl voice` | Start voice recording with VAD |
| `jfl voice setup` | First-time setup wizard |
| `jfl voice model [action] [name]` | Manage whisper models |
| `jfl voice devices` | List audio input devices |
| `jfl voice test [-d device]` | Test voice input |
| `jfl voice recording [-d device] [-t seconds]` | Test recording only |
| `jfl voice record [-d device]` | Record with VAD |
| `jfl voice hotkey [-d device] [-m mode]` | Start global hotkey listener (macOS) |
| `jfl voice daemon start/stop/status` | Background hotkey daemon |

### Other Commands

| Command | Description |
|---------|-------------|
| `jfl profile [action] [-f file]` | Manage JFL profile (show/edit/export/import/generate) |
| `jfl ralph [command...]` | AI agent loop orchestrator (ralph-tui) |
| `jfl brand [subcommand]` | Shortcut for brand-architect skill |
| `jfl content <type> [topic]` | Shortcut for content creator skill |
| `jfl clawdbot` | Install JFL skill for Clawdbot |
| `jfl test` | Test onboarding flow in isolated environment |
| `jfl gtm process-service-update [event-file]` | Process service sync notification (called by hooks) |
| `jfl help` | Show help |

## MCP Tools Exposed

### Context Hub MCP (`jfl-context-hub-mcp`)

| Tool | Description |
|------|-------------|
| `context_get` | Get unified context (journal + knowledge + code). Has optional `query`, `taskType`, and `maxItems` params. |
| `context_search` | Search across all context sources |
| `context_status` | Check Context Hub daemon status |
| `context_sessions` | See activity from other sessions |
| `memory_search` | Search indexed journal entries (query, type, maxItems, since) |
| `memory_add` | Manually add a memory/note |
| `memory_status` | Get memory system statistics |

### Service Registry MCP (`jfl-service-registry-mcp`)

| Tool | Description |
|------|-------------|
| `service_list` | List all services in the mesh (filter by status) |
| `service_info` | Get detailed info about a specific service |
| `service_start` | Start a service |
| `service_stop` | Stop a service |
| `service_health` | Check health of a service |
| `service_call` | Call a service's MCP tool |

### Service Peer MCP (`service-peer-mcp`)

| Tool | Description |
|------|-------------|
| `service_peer_list` | List peer services available for collaboration |
| `service_peer_call` | Call a peer service's MCP tool |

## Dependencies

### Runtime Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI argument parsing and command structure |
| `chalk` | Terminal output coloring |
| `inquirer` | Interactive prompts |
| `@clack/prompts` | Modern CLI prompts (used in init flow) |
| `ora` | Terminal spinners |
| `conf` | Configuration management |
| `axios` | HTTP client (platform API, health checks) |
| `sql.js` | SQLite for memory database (WASM-based, no native deps) |
| `openai` | OpenAI API for embeddings in memory system |
| `@anthropic-ai/sdk` | Anthropic API (agent generation, profile CLAUDE.md generation) |
| `ws` | WebSocket support |
| `open` | Open URLs in default browser |
| `viem` | Ethereum interactions (wallet, USDC transfers) |
| `@scure/bip32`, `@scure/bip39` | HD wallet derivation from seed phrases |
| `@x402/core`, `@x402/evm` | x402 micropayment protocol |
| `httpcat-cli` | x402 payment CLI tool |
| `blessed`, `blessed-contrib` | Terminal UI for dashboards |
| `node-global-key-listener` | Global hotkey listener for voice (macOS) |

### Dev Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | TypeScript compiler |
| `tsx` | TypeScript execution (dev mode) |
| `jest`, `ts-jest`, `@types/jest` | Testing framework |
| Various `@types/*` | TypeScript type definitions |

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `JFL_PLATFORM_URL` | `https://jfl.run` | Platform API URL |
| `X402_URL` | `https://agent-main.402.cat` | x402 payment API |
| `JFL_GITHUB_CLIENT_ID` | -- | GitHub OAuth client ID |
| `STRATUS_API_URL` | -- | Stratus X1 reasoning API endpoint |
| `STRATUS_API_KEY` | -- | Stratus X1 API key |
| `OPENAI_API_KEY` | -- | OpenAI API for memory embeddings |
| `CRM_SHEET_ID` | -- | Google Sheets CRM integration |
| `CONTEXT_HUB_URL` | `http://localhost:4242` | Context Hub daemon URL |
| `SERVICE_MANAGER_URL` | `http://localhost:3402` | Service Manager API URL |

## Pricing Tiers

| Tier | Price | Access |
|------|-------|--------|
| Trial | $0 | Full toolkit until foundation + brand complete |
| Day Pass | $5/day | Pay-as-you-go via USDC (gasless) |
| Solo | $49/mo | Individual, fixed monthly |
| Team | $199/mo | Up to 5 seats (+$25/seat) |
