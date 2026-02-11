---
name: jfl-gtm
description: GTM workspace runtime - run go-to-market as Claude Code does
version: 1.0.0
user-invocable: true
---

# JFL GTM Runtime

Run GTM workspaces from OpenClaw with full protocol compliance.

---

## What This Does

Makes OpenClaw operate like Claude Code in a GTM (Go-To-Market) workspace:

- Reads CLAUDE.md (GTM instruction set)
- Executes GTM protocols (journal entries, context loading, decision capture)
- Accesses JFL CLI tools (context-hub, crm, synopsis)
- Manages services and agents
- Operates with elevated permissions

**GTM is a Claude Code operating protocol defined in structured markdown.**

---

## Configuration Management

**Use inline bash to manage workspace configuration.**

### Add Workspace

```bash
CONFIG_FILE="$HOME/.openclaw/openclaw.json"
WORKSPACE_PATH="/path/to/workspace"

# Verify it's a GTM workspace
if [[ -d "$WORKSPACE_PATH/.jfl" ]] && [[ -f "$WORKSPACE_PATH/CLAUDE.md" ]]; then
  # Add to config
  jq ".skills.entries[\"jfl-gtm\"].config.workspace_paths += [\"$WORKSPACE_PATH\"]" "$CONFIG_FILE" > /tmp/config.json
  mv /tmp/config.json "$CONFIG_FILE"
  echo "✅ Added workspace: $WORKSPACE_PATH"
else
  echo "❌ Not a GTM workspace (missing .jfl/ or CLAUDE.md)"
fi
```

### List Workspaces

```bash
jq -r '.skills.entries["jfl-gtm"].config.workspace_paths[]?' "$HOME/.openclaw/openclaw.json" 2>/dev/null || echo "No workspaces configured"
```

### Set Default

```bash
WORKSPACE_PATH="/path/to/workspace"
jq ".skills.entries[\"jfl-gtm\"].config.default_workspace = \"$WORKSPACE_PATH\"" "$HOME/.openclaw/openclaw.json" > /tmp/config.json
mv /tmp/config.json "$HOME/.openclaw/openclaw.json"
echo "✅ Default workspace: $WORKSPACE_PATH"
```

### Remove Workspace

```bash
WORKSPACE_PATH="/path/to/workspace"
jq ".skills.entries[\"jfl-gtm\"].config.workspace_paths -= [\"$WORKSPACE_PATH\"]" "$HOME/.openclaw/openclaw.json" > /tmp/config.json
mv /tmp/config.json "$HOME/.openclaw/openclaw.json"
echo "✅ Removed workspace: $WORKSPACE_PATH"
```

---

## Starting a GTM Session

**Once workspace is configured, start a session by reading the workspace's CLAUDE.md:**

```bash
WORKSPACE="/path/to/workspace"

# Verify it's a GTM workspace
if [[ ! -d "$WORKSPACE/.jfl" ]] || [[ ! -f "$WORKSPACE/CLAUDE.md" ]]; then
  echo "❌ Not a GTM workspace"
  exit 1
fi

cd "$WORKSPACE"

echo "📖 Reading CLAUDE.md for GTM instructions..."

# Execute SessionStart protocol from CLAUDE.md:
# 1. Sync repos
if [[ -f "./scripts/session/session-sync.sh" ]]; then
  ./scripts/session/session-sync.sh
fi

# 2. Run doctor check (for existing projects)
COMMIT_COUNT=$(git rev-list --count HEAD 2>/dev/null || echo "0")
if [[ "$COMMIT_COUNT" -gt "5" ]] && [[ -f "./scripts/session/jfl-doctor.sh" ]]; then
  ./scripts/session/jfl-doctor.sh
fi

# 3. Ensure Context Hub running
jfl context-hub ensure
curl -sf http://localhost:4242/health || echo "⚠️  Context Hub not responding"

# 4. Load context
curl -s http://localhost:4242/api/context | jq .

# 5. Show dashboard
echo ""
echo "📊 $(jq -r '.name' .jfl/config.json) Dashboard"
echo "🚀 Ship Date: $(grep -E "Ship:|Launch:" knowledge/ROADMAP.md | head -1 || echo 'Not set')"
echo "📍 Phase: $(grep -E "Phase:|Stage:" knowledge/ROADMAP.md | head -1 || echo 'Foundation')"
echo ""
echo "Recent work:"
jfl synopsis 24 | tail -10
echo ""
echo "✅ GTM session active - following CLAUDE.md protocols"
```

---

## GTM Session Behavior

Once in GTM session, you operate following CLAUDE.md protocols:

### Journal Protocol (Mandatory)

Write journal entries immediately after:
- Features completed
- Decisions made
- Bugs fixed
- Milestones reached
- Session ending

Format: JSONL in `.jfl/journal/<session-id>.jsonl`

**The Stop hook will block session end if no journal entry exists.**

### Context Loading

Uses Context Hub (http://localhost:4242) for unified context:
- Recent journal entries (all sessions)
- Knowledge docs (VISION, ROADMAP, NARRATIVE, THESIS)
- Code file headers (@purpose tags)
- Active sessions

### JFL CLI Tools

Available in session:

```bash
# Work summary
jfl synopsis 24              # Last 24 hours
jfl synopsis 8 username      # Specific author

# CRM (Google Sheets)
./crm list                   # Pipeline
./crm prep "Contact"         # Call prep
./crm touch "Contact"        # Log activity

# Context Hub
jfl context-hub ensure       # Start if needed
jfl context-hub status       # Check health

# Sessions
jfl session list             # Active sessions
```

### Decision Capture

When user makes a decision, update relevant doc + journal immediately:

1. Update knowledge doc (BRAND_DECISIONS.md, product/SPEC.md, etc.)
2. Write journal entry with type: "decision"
3. Commit both atomically

### File Headers

All code files need @purpose headers:

```typescript
/**
 * Component Name
 *
 * @purpose One-line purpose statement
 * @spec Optional: link to spec
 * @decision Optional: decision slug
 */
```

### Session End

When user says "done" or "/end":

1. Verify journal entry exists (block if missing)
2. Commit outstanding changes
3. Show session summary
4. Push to origin
5. **Don't stop Context Hub** (shared service)

---

## Multi-Agent Orchestration

GTM workspaces can define service agents in `.jfl/agents/*.yaml`:

```yaml
name: api
description: Manages API endpoints
responsibilities:
  - Create new endpoints
  - Update existing endpoints
context:
  files:
    - product/src/api/**/*
  knowledge:
    - product/API_SPEC.md
dependencies:
  - database
tools:
  - jfl
  - curl
```

When user requests complex work (e.g., "add login endpoint"), coordinate:

1. Analyze request → identify needed agents (API, Frontend, Docs)
2. Build task graph with dependencies
3. Spawn agents in correct order
4. Agents communicate via Context Hub
5. Synthesize results

Agents write their own journal entries.

---

## Key Concepts

**GTM = Structured markdown workspace** with:
- `CLAUDE.md` - Operating instructions
- `knowledge/` - Foundation docs (VISION, ROADMAP, etc.)
- `content/` - Marketing content
- `product/` - Product specs
- `.jfl/journal/` - Work log (JSONL)
- `.jfl/agents/` - Service agent definitions

**Context Hub = Unified context API** (port 4242):
- Aggregates journal + knowledge + code
- Shared across sessions
- Enables agent coordination
- Runs persistently

**JFL CLI = Supporting tools**:
- context-hub (start/stop/status)
- synopsis (work summary)
- crm (Google Sheets CRM)
- session (management)

**Protocols > Tools**:
- GTM is about following structured workflows
- CLAUDE.md defines the protocols
- JFL CLI provides supporting infrastructure
- The value is in protocol compliance

---

## Permissions Required

```yaml
permissions:
  bash: allow      # Git, jfl commands, ./crm
  fileWrite: allow # Journal, knowledge docs, content
  fileRead: allow  # CLAUDE.md, foundation docs
  network: allow   # Context Hub, git push, Fly.io
```

All permissions needed for frictionless GTM workflows.

---

## Implementation Approach

This skill provides **inline bash snippets** that Claude executes directly:
- Configuration management (add/remove/list workspaces)
- Session initialization (read CLAUDE.md, run protocols)
- Journal entry helpers (write JSONL entries)
- Agent spawning (via Context Hub)

No external scripts needed - all code is inline in this skill file.

---

## Resources

- **Full documentation**: `~/.openclaw/skills/jfl-gtm/README.md`
- **Configuration guide**: `~/.openclaw/skills/jfl-gtm/CONFIGURATION.md`
- **JFL CLI**: https://github.com/402goose/just-fucking-launch
- **Context Hub**: http://localhost:4242 (when running)

---

## Quick Start

1. **Add workspace (use the inline bash from "Add Workspace" section above):**
   ```bash
   WORKSPACE_PATH="$HOME/code/my-project"
   # ... use the inline bash ...
   ```

2. **Start session (use the inline bash from "Starting a GTM Session" section above):**
   ```bash
   WORKSPACE="/path/to/workspace"
   cd "$WORKSPACE"
   # ... follow the SessionStart protocol ...
   ```

3. **Follow CLAUDE.md protocols** in the workspace:
   - Journal entries after features/decisions/fixes
   - Decision capture to knowledge docs
   - Context loading via Context Hub
   - File headers with @purpose

4. **End gracefully:**
   - Ensure journal entry written
   - User says "done"
   - Commit and push

That's it. The workspace's CLAUDE.md has the detailed instructions.
