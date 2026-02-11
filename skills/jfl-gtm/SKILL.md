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

## Available Scripts

All scripts are in `~/.openclaw/skills/jfl-gtm/bin/`:

### Configuration Management

```bash
# Add workspace
~/.openclaw/skills/jfl-gtm/bin/config add /path/to/workspace

# List workspaces
~/.openclaw/skills/jfl-gtm/bin/config list

# Set default
~/.openclaw/skills/jfl-gtm/bin/config default /path/to/workspace

# Remove workspace
~/.openclaw/skills/jfl-gtm/bin/config remove /path/to/workspace

# Clear default
~/.openclaw/skills/jfl-gtm/bin/config clear-default
```

### Workspace Discovery

```bash
# Simple list (paths only)
~/.openclaw/skills/jfl-gtm/bin/discover simple

# Detailed (with project names and activity)
~/.openclaw/skills/jfl-gtm/bin/discover detailed

# JSON output
~/.openclaw/skills/jfl-gtm/bin/discover json
```

### Session Management

```bash
# Start session (auto-selects if default set)
~/.openclaw/skills/jfl-gtm/bin/session start

# Start specific workspace
~/.openclaw/skills/jfl-gtm/bin/session start /path/to/workspace
```

**What `session start` does:**
1. Verifies GTM workspace (has `.jfl/` and `CLAUDE.md`)
2. Reads CLAUDE.md for instructions
3. Executes SessionStart protocol:
   - Syncs repositories
   - Runs health check (jfl-doctor)
   - Ensures Context Hub running
   - Loads unified context
4. Shows project dashboard
5. Enters GTM mode

### Journal Entries

```bash
# Write full entry
~/.openclaw/skills/jfl-gtm/bin/journal write feature "Title" "Summary" "Detail" '["file1.ts"]'

# Quick shortcuts
~/.openclaw/skills/jfl-gtm/bin/journal feature "Add login endpoint"
~/.openclaw/skills/jfl-gtm/bin/journal decision "Use React for UI"
~/.openclaw/skills/jfl-gtm/bin/journal fix "Fixed auth bug"

# List recent entries
~/.openclaw/skills/jfl-gtm/bin/journal list

# Verify entry exists (for session end)
~/.openclaw/skills/jfl-gtm/bin/journal verify
```

---

## GTM Session Behavior

Once in GTM session, follow CLAUDE.md protocols:

### Journal Protocol (Mandatory)

Write journal entries immediately after:
- Features completed → `journal feature "Title"`
- Decisions made → `journal decision "Title"`
- Bugs fixed → `journal fix "Title"`
- Milestones reached → `journal write milestone "Title" "Summary"`
- Session ending → `journal write session-end "Summary" "What I worked on"`

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
cd /path/to/workspace
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

When user makes a decision:

1. Update knowledge doc (BRAND_DECISIONS.md, product/SPEC.md, etc.)
2. Write journal entry: `journal decision "Decision title" "Why this choice"`
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

1. Verify journal entry: `journal verify`
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

## Quick Start

### 1. Add Workspace

```bash
~/.openclaw/skills/jfl-gtm/bin/config add ~/code/my-project
```

### 2. Start Session

```bash
~/.openclaw/skills/jfl-gtm/bin/session start
```

### 3. Follow CLAUDE.md Protocols

The workspace's CLAUDE.md has detailed instructions.

### 4. End Gracefully

```bash
# Ensure journal entry written
~/.openclaw/skills/jfl-gtm/bin/journal verify

# Commit and push
git add . && git commit -m "session: end $(date +%Y-%m-%d)" && git push
```

---

## Resources

- **Full documentation**: `~/.openclaw/skills/jfl-gtm/README.md`
- **Configuration guide**: `~/.openclaw/skills/jfl-gtm/CONFIGURATION.md`
- **JFL CLI**: https://github.com/402goose/just-fucking-launch
- **Context Hub**: http://localhost:4242 (when running)

---

## Script Implementation

All scripts are bash, located in `bin/`:
- `config` - Configuration management (add/remove/list workspaces)
- `discover` - Workspace discovery
- `session` - Session initialization and management
- `journal` - Journal entry helpers

These are actual executables Claude can invoke directly - no inline bash needed.
