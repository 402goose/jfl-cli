---
name: orchestrate
description: AI agent loop orchestrator for autonomous task execution via Pi RPC mode
triggers:
  - orchestrate
  - run agents
  - multi-agent
  - spawn agents
  - /orchestrate
---

# /orchestrate - Multi-Agent Orchestration

Runs autonomous multi-agent task execution using Pi's RPC mode. Peter Parker
orchestrates the loop; agents communicate via the MAP event bus.

## Usage

```
/orchestrate                              # Start with gtm-team (default)
/orchestrate --team teams/dev-team.yaml  # Use dev team
/orchestrate --task "Fix bug in X"       # Direct task injection
```

## How It Works

Pi's `--mode rpc` launches each agent as a headless subprocess. Each agent:
1. Loads the `@jfl/pi` extension (context injection, journal, MAP bridge)
2. Receives a task from the orchestrator
3. Executes and emits `agent:health` every 5s to the MAP bus
4. Peter Parker monitors: propose → predict (Stratus) → execute → eval → review

## Team Configuration

Teams are defined in `teams/gtm-team.yaml` and `teams/dev-team.yaml`.
Each agent has a role, model, and set of skills.

## Starting Agents via CLI

```bash
jfl pi agents run --team teams/gtm-team.yaml
```

This spawns each agent as a Pi RPC subprocess.
Use `/grid` in a Pi session to see live agent status.

## Grid View

The `/grid` command shows a 2×3 agent grid with:
- Agent name and role
- Status: ● running, ○ idle, ◆ blocked
- Last task (truncated)
- Duration

Navigation: `j/k` to move, `Enter` for detail, `q` to close.

## Peter Parker Review Loop

Peter Parker (via `extensions/peter-parker.ts`) handles:
1. Subscribe to `eval:scored`, `review:findings`, `task:requested` MAP events
2. Query Stratus predictor for optimal action
3. Spawn Pi RPC agent for the selected action
4. Monitor loop: propose → predict → execute → eval → review
5. Max 5 iterations (configurable in `.jfl/config.json` → `pi.max_peter_iterations`)

## vs. ralph-tui

Pi RPC mode replaces ralph-tui + WebSocket bridge:
- No separate ralph-tui process needed
- MAP event bus replaces WebSocket events
- Stratus predictions guide agent selection
- Peter Parker extension handles review loop natively

For backward compatibility, ralph-tui workflows still work — use the separate `jfl peter` command.
