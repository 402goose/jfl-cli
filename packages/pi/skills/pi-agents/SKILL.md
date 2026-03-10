---
name: pi-agents
description: Manage Pi multi-agent sessions — spawn, monitor, and coordinate agent teams
triggers:
  - pi agents
  - spawn agents
  - agent grid
  - /pi-agents
  - /grid
---

# /pi-agents - Pi Agent Management

Spawn, monitor, and coordinate teams of Pi AI agents via the MAP event bus.

## Usage

```
/pi-agents                              # Show agent status grid
/pi-agents run --team gtm-team         # Spawn GTM team
/pi-agents run --team dev-team         # Spawn dev team
/pi-agents status                      # Show health of all agents
/pi-agents stop                        # Stop all running agents
```

## Agent Grid (/grid)

Full-screen overlay showing all active agents:

```
┌─────────────────────┬─────────────────────┬─────────────────────┐
│ ● scout             │ ● planner            │ ○ builder           │
│ Research            │ Architecture         │ Implementation      │
│ "Researching X..."  │ "Writing spec..."    │ idle                │
│ 2m 34s              │ 45s                  │ -                   │
├─────────────────────┼─────────────────────┼─────────────────────┤
│ ● gtm               │ ○ content            │ ● eval              │
│ Go-to-market        │ Content gen          │ Quality             │
│ "Drafting pitch..." │ idle                 │ "Scoring turn..."   │
│ 1m 12s              │ -                   │ 18s                 │
└─────────────────────┴─────────────────────┴─────────────────────┘
```

**Legend:** ● running, ○ idle, ◆ blocked

**Navigation:** `j/k` navigate, `Enter` detail view, `q` close

## How Agents Communicate

Each Pi RPC subprocess:
1. Loads `@jfl/pi` extension (context, journal, MAP bridge)
2. Emits `agent:health` every 5s with status, task, and metrics
3. Subscribes to MAP events matching its role
4. Journals work automatically after each turn

The grid polls `GET /api/events?pattern=agent:health` from Context Hub every 2s.

## Peter Parker Orchestration

When Peter Parker is enabled (default), agents work in a review loop:
- PP monitors eval scores and review findings
- Dispatches appropriate agents based on Stratus predictions
- Tracks iterations (max 5 per task, configurable)

## Spawning via CLI

```bash
# From project root:
jfl pi agents run --team teams/gtm-team.yaml

# Each agent runs as:
pi --mode rpc --extension @jfl/pi/extensions/index.js --yolo
```

## Team Files

- `teams/gtm-team.yaml` — Scout, Planner, Builder, GTM, Content, Eval
- `teams/dev-team.yaml` — Scout, Planner, Builder, Reviewer, Tester
