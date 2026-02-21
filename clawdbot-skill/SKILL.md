---
name: jfl
description: Project context layer — persistent memory, sessions, journals, team coordination. Activates with /jfl.
metadata: {"clawdbot":{"emoji":"🚀","requires":{"bins":["jfl"]},"install":[{"kind":"node","package":"jfl","label":"JFL CLI","bins":["jfl"]}]}}
---

# JFL - Just Fucking Launch

Project context layer for AI agents. Persistent memory, isolated sessions, automatic journaling, and team coordination.

## First-Time Setup

If the JFL Clawdbot plugin is not installed yet, run this command:

```bash
jfl clawdbot setup
```

This copies the JFL plugin to Clawdbot and configures it. After that, the gateway needs a restart (`clawdbot gateway`). Then /jfl will appear in Telegram.

**Check if already set up:**
```bash
jfl clawdbot status
```

## What JFL Does

When activated (via /jfl in Telegram):

- **Context injection** — searches project knowledge before every response
- **Decision capture** — automatically journals decisions you make
- **Auto-commit** — saves work to git every ~2 minutes
- **Session isolation** — your work happens on a separate branch

## Telegram Commands (after plugin setup)

| Command | What it does |
|---------|-------------|
| `/jfl` | Activate JFL / show status |
| `/context <query>` | Search project knowledge |
| `/journal <type> <title> \| <summary>` | Write a journal entry |
| `/hud` | Project dashboard |

## Tools (Claude uses these automatically)

| Tool | When to use |
|------|------------|
| `jfl_context` | Someone asks about the project, past decisions, what's been done |
| `jfl_journal` | A decision is made, task completed, bug fixed, something learned |

## Creating a Project

If no GTM workspace exists:

```bash
jfl init -n "My Project"
```

This creates the workspace with knowledge docs, journal, and context hub config.
