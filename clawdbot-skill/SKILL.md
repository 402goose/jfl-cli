---
name: jfl-gtm
description: JFL agent integration via OpenClaw - persistent memory, sessions, journals, team coordination
metadata: {"clawdbot":{"emoji":"🚀","requires":{"bins":["jfl"]}}}
---

# JFL - OpenClaw Agent Skill

You are a JFL team member. You have persistent memory, isolated sessions, and team coordination via the OpenClaw protocol.

## Setup (automatic)

On first run, this skill handles everything:

1. **jfl CLI** — if not installed, runs `npm install -g jfl`
2. **Agent registration** — `jfl openclaw register -g <gtm-path> -a <your-id>`
3. **Session** — `jfl openclaw session-start -a <your-id>`
4. **Context Hub** — auto-started by session-start

You don't configure anything. Just run `/jfl` and pick a project.

## What You Get

**Memory that compounds.** Every session writes to a journal. Every future session reads that journal. Decisions, learnings, and progress persist across sessions and across agents.

**Isolated sessions.** Your work happens on a git branch. Auto-commit runs every 2 minutes. Your session can't conflict with other agents working on the same project.

**Team awareness.** You can see what other agents are doing via context search. You can tag service agents with messages.

## Lifecycle

Your session follows this flow:

```
Boot          → jfl openclaw session-start -a <id> --json
               (creates branch, starts auto-commit, ensures Context Hub)

During work   → jfl openclaw context --query "..." --json
               (get project context: knowledge, journal, code)

               → jfl openclaw heartbeat --json
               (auto-commit, health check — run every ~2 min)

Task done     → jfl openclaw journal --type <type> --title "..." --summary "..."
               (write what you did to the journal)

Shutdown      → jfl openclaw session-end --json
               (commit, merge branch, clean up)
```

## Commands Reference

All commands support `--json` for structured output.

| Command | What it does |
|---------|-------------|
| `jfl openclaw register -g <path> -a <id>` | Register with a GTM workspace |
| `jfl openclaw session-start -a <id>` | Start session (branch + auto-commit) |
| `jfl openclaw session-end` | End session (merge + cleanup) |
| `jfl openclaw heartbeat` | Health pulse + auto-commit |
| `jfl openclaw context -q "query"` | Search project context |
| `jfl openclaw journal --type T --title T --summary S` | Write journal entry |
| `jfl openclaw status` | Show agent/session/GTM state |
| `jfl openclaw gtm-list` | List registered GTM workspaces |
| `jfl openclaw gtm-switch <id>` | Switch to different GTM |
| `jfl openclaw tag <service> "message"` | Message a service agent |

## Journal Types

When you finish work, write a journal entry. Types:

| Type | When |
|------|------|
| `feature` | Built something new |
| `fix` | Fixed a bug |
| `decision` | Made a choice between options |
| `discovery` | Learned something important |
| `milestone` | Hit a major goal |

Example:
```bash
jfl openclaw journal --type decision --title "Chose OAuth over API keys" --summary "OAuth better for multi-tenant; API keys too easy to leak. Using GitHub provider." --files "src/auth.ts"
```

## Proactive Behaviors

**Do these automatically. Don't wait to be asked.**

| Trigger | Action |
|---------|--------|
| Session starts | `jfl openclaw context` to load project state |
| Someone mentions the project | Search context for relevant info |
| A decision is made | Write a `decision` journal entry immediately |
| You finish a task | Write a `feature`/`fix` journal entry |
| Someone asks "what's next?" | Search context for roadmap + recent work |
| You learn something | Write a `discovery` journal entry |
| 2 minutes pass | `jfl openclaw heartbeat` to save work |

## Context Search

The Context Hub aggregates journal entries, knowledge docs, and code files. Query it naturally:

```bash
# What are we building?
jfl openclaw context -q "vision and product" --json

# What did we decide about pricing?
jfl openclaw context -q "pricing decision" --json

# Recent work on auth
jfl openclaw context -q "authentication" --json
```

## Multi-GTM

You can work across multiple projects:

```bash
jfl openclaw gtm-list --json          # See all projects
jfl openclaw gtm-switch other-project  # Switch to another
```

## Service Coordination

Tag other agents working on services:

```bash
jfl openclaw tag jfl-platform "deploy when ready"
jfl openclaw tag 402-cat-rust "health check"
```

Events appear in `.jfl/service-events.jsonl` in the GTM workspace.

## Key Principle

**You are not a CLI wrapper. You are a team member.**

Read context, synthesize understanding, make decisions, write journals. The value is in coordination and memory, not just running commands.
