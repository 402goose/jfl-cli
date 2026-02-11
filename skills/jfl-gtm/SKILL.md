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

## Commands

### Configuration

```bash
# Add workspace
jfl-gtm-config add /path/to/workspace

# List workspaces
jfl-gtm-config list

# Set default
jfl-gtm-config default /path/to/workspace

# Remove workspace
jfl-gtm-config remove /path/to/workspace
```

Configuration stored in `~/.openclaw/openclaw.json`

### Start GTM Session

```bash
# Discover and select workspace
jfl-gtm-session

# Or specify directly
jfl-gtm-session /path/to/workspace
```

This will:
1. Verify it's a GTM workspace (has `.jfl/` and `CLAUDE.md`)
2. Read CLAUDE.md for instructions
3. Execute SessionStart protocol (sync, doctor, context loading)
4. Start Context Hub if needed
5. Load unified context
6. Show project dashboard
7. Enter GTM mode

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

## Helper Scripts

Actual implementation in:
- `~/.openclaw/skills/jfl-gtm/bin/config` - Configuration management
- `~/.openclaw/skills/jfl-gtm/bin/session` - Session initialization
- `~/.openclaw/skills/jfl-gtm/bin/journal` - Journal entry helpers
- `~/.openclaw/skills/jfl-gtm/bin/agents` - Agent spawning

These are bash scripts you can call directly. The skill just provides the instructions.

---

## Resources

- **Full documentation**: `~/.openclaw/skills/jfl-gtm/README.md`
- **Configuration guide**: `~/.openclaw/skills/jfl-gtm/CONFIGURATION.md`
- **JFL CLI**: https://github.com/402goose/just-fucking-launch
- **Context Hub**: http://localhost:4242 (when running)

---

## Quick Start

1. **Add workspace:**
   ```bash
   jfl-gtm-config add ~/code/my-project
   ```

2. **Start session:**
   ```bash
   jfl-gtm-session
   ```

3. **Follow CLAUDE.md protocols** in the workspace

4. **End gracefully:**
   - Ensure journal entry written
   - User says "done"
   - Commit and push

That's it. The workspace's CLAUDE.md has the detailed instructions.
