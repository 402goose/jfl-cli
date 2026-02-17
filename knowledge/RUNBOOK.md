# JFL CLI - Runbook

## Development Setup

```bash
# Clone the repo
git clone https://github.com/402goose/jfl-cli.git
cd jfl-cli

# Install dependencies
npm install

# Build
npm run build

# Link globally for testing
npm link

# Verify
jfl --version
```

### Dev Mode (watch)

```bash
npm run dev
```

Uses `tsx --watch` to auto-rebuild on changes. Note: this runs `src/index.ts` directly, not the compiled output.

## Common Tasks

### Adding a New Command

1. **Create the command file** at `src/commands/<command-name>.ts`:

```typescript
/**
 * Description of command
 *
 * @purpose One-line purpose
 */

import chalk from "chalk"

export async function myCommand(options?: { flag?: boolean }): Promise<void> {
  console.log(chalk.bold("\nMy Command\n"))
  // Implementation
}
```

2. **Register in `src/index.ts`**:

```typescript
import { myCommand } from "./commands/my-command.js"

program
  .command("my-command")
  .description("What it does")
  .option("-f, --flag", "Optional flag")
  .action(myCommand)
```

For lazy-loaded commands (large dependencies), use dynamic import:

```typescript
program
  .command("my-command")
  .description("What it does")
  .action(async (options) => {
    const { myCommand } = await import("./commands/my-command.js")
    await myCommand(options)
  })
```

3. **Build and test**:

```bash
npm run build
jfl my-command
```

### Adding a New MCP Tool

1. **Add the tool definition** to the `TOOLS` array in the relevant MCP server file (`src/mcp/context-hub-mcp.ts` or `src/mcp/service-registry-mcp.ts`):

```typescript
{
  name: "my_tool",
  description: "What this tool does",
  inputSchema: {
    type: "object",
    properties: {
      param1: {
        type: "string",
        description: "Parameter description"
      }
    },
    required: ["param1"]
  }
}
```

2. **Add the handler** in the `handleToolCall` function:

```typescript
case "my_tool": {
  const result = await doSomething(args.param1)
  return { content: [{ type: "text", text: JSON.stringify(result) }] }
}
```

3. **Rebuild** and restart Context Hub:

```bash
npm run build
jfl context-hub restart
```

### Adding a New Skill

Skills live in `template/.claude/skills/`. Each skill is a directory with at minimum a `SKILL.md` file.

1. **Create the skill directory**:

```bash
mkdir template/.claude/skills/my-skill
```

2. **Create `SKILL.md`** with instructions for the AI agent. This is the prompt that Claude Code reads when the skill is invoked.

3. **Optionally add**:
   - `config.yaml` -- Configuration
   - `metadata.json` -- Metadata for the skill registry
   - `rules/` -- Additional rule files

4. **Update skill registry** if using the catalog system (in `src/utils/skill-registry.ts`).

5. **Test**: Run `jfl init` in a test directory and invoke the skill in Claude Code.

### Updating the Template

When CLAUDE.md, skills, or settings change:

1. Edit files in `template/` directory
2. Test with `jfl init test-project` (creates workspace from template)
3. Test with `jfl update` in an existing workspace (syncs changes)
4. Commit and push to jfl-cli
5. Push same changes to jfl-template repo for `jfl init` to pick up

### Adding a Memory Search Feature

The memory system has three layers:

1. **memory-db.ts** -- Database operations (add/query/stats)
2. **memory-indexer.ts** -- Scan and index journal entries
3. **memory-search.ts** -- Hybrid search (TF-IDF + embeddings)

To modify search behavior, edit `src/lib/memory-search.ts`. The scoring formula is:
- TF-IDF score * 0.4 + Embedding score * 0.6
- Recency boost: 1.3x if < 7 days old
- Type boost: decisions 1.4x, features 1.2x

### Onboarding a New Service

```bash
# From a GTM workspace
jfl onboard /path/to/service-repo

# Or with git URL
jfl onboard git@github.com:user/repo.git

# With overrides
jfl onboard /path/to/repo --name my-service --type api
```

This:
1. Detects service metadata (type, port, commands)
2. Generates CLAUDE.md for the service agent
3. Generates skill files
4. Registers the service in the GTM parent
5. Syncs peer agent definitions

## Troubleshooting

### Context Hub won't start

```bash
# Check if port is in use
lsof -i :4242

# Check PID file
cat .jfl/context-hub.pid

# Kill stale process
kill $(cat .jfl/context-hub.pid)
rm .jfl/context-hub.pid

# Restart
jfl context-hub start
```

### Memory system "no such table" error

The SQLite database hasn't been initialized:

```bash
jfl memory init
```

This creates `.jfl/memory.db` and runs initial indexing.

### "Not in a JFL project" error

The CLI looks for `CLAUDE.md` or `knowledge/` directory. Ensure you're in a JFL workspace:

```bash
# Check
ls CLAUDE.md knowledge/

# If missing, repair or reinitialize
jfl repair
```

### Auto-update not working

Check the update cache:

```bash
# See when last check happened
cat ~/.cache/jfl/last-update-check

# Force check
jfl update

# Skip auto-update
jfl --no-update
```

### XDG migration issues

JFL migrates from `~/.jfl/` to XDG paths on startup. If migration fails:

```bash
# Check migration status
ls ~/.config/jfl/
ls ~/.local/share/jfl/
ls ~/.cache/jfl/

# Legacy directory (should be gone after migration)
ls ~/.jfl/
```

### Service Manager not running

```bash
# Check status
jfl service-manager status

# Start it
jfl service-manager start

# Check port
lsof -i :3402
```

### Build errors

```bash
# Clean build
rm -rf dist/
npm run build

# Check TypeScript errors
npx tsc --noEmit
```

### Session worktree issues

```bash
# List active sessions/worktrees
git worktree list

# Clean up stale worktrees
git worktree prune

# Run doctor check
./scripts/session/jfl-doctor.sh
```

### Skill not appearing in Claude Code

1. Check skills are installed:
   ```bash
   jfl skills list
   ```

2. Verify skill files exist:
   ```bash
   ls .claude/skills/
   ```

3. Pull latest:
   ```bash
   jfl update
   ```

## Useful Commands

### Testing

```bash
# Run all tests
npm test

# Run specific test
npm test -- --testPathPattern=memory

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

### Debugging

```bash
# Check project config
cat .jfl/config.json

# Check global config
cat ~/.config/jfl/config.json

# Check Context Hub logs
cat .jfl/logs/context-hub.log

# Check service status
jfl services list

# Validate settings
jfl validate-settings
jfl validate-settings --fix

# Doctor check
./scripts/session/jfl-doctor.sh
```

### Service Management

```bash
# List all services
jfl services list

# Check service health
jfl services status <name>

# Start/stop
jfl services start <name>
jfl services stop <name>

# Dependency graph
jfl services deps

# Validate service config
jfl services validate
jfl services validate --fix

# Scan for services in a directory
jfl services scan --path /path/to/code

# Interactive TUI
jfl services
```

### Context and Memory

```bash
# Start Context Hub
jfl context-hub start

# Query context
jfl context-hub query

# Check memory stats
jfl memory status

# Search memories
jfl memory search "pricing decision"
jfl ask "what did we decide about X?"

# Reindex
jfl memory index --force

# Work summary
jfl synopsis 24
jfl synopsis 48 hathbanger
```

### Session Scripts

```bash
# Initialize session
./scripts/session/session-init.sh

# Sync repos
./scripts/session/session-sync.sh

# Doctor check
./scripts/session/jfl-doctor.sh

# Auto-commit (runs in background)
./scripts/session/auto-commit.sh start
./scripts/session/auto-commit.sh start 60  # 60-second interval

# End session
./scripts/session/session-end.sh

# Context preservation test
./scripts/session/test-context-preservation.sh
```

## Ports Used

| Port | Service | Notes |
|------|---------|-------|
| 4242 | Context Hub | Configurable with `-p` flag |
| 3402 | Service Manager | Default, configurable in config |
| 3401 | Service Manager (legacy) | Older references may use this |

## Key File Locations

| File | Purpose |
|------|---------|
| `.jfl/config.json` | Project config |
| `.jfl/journal/*.jsonl` | Session journals |
| `.jfl/memory.db` | Memory SQLite database |
| `.jfl/context-hub.pid` | Context Hub PID |
| `.jfl/context-hub.token` | Context Hub auth token |
| `~/.config/jfl/config.json` | Global JFL config |
| `~/.config/jfl/auth.json` | Auth tokens |
| `~/.local/share/jfl/services.json` | Global services registry |
| `~/.cache/jfl/last-update-check` | Update check timestamp |
