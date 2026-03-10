# @jfl/pi — Multi-Agent Coordination

This document describes how multiple Pi sessions coordinate within a JFL project.

## Session Isolation

Each Pi session gets its own branch (via JFL session management):
```
session-goose-20260125-xxxx
session-hath-20260126-xxxx
```

Agents write to their own journal files:
```
.jfl/journal/session-goose-20260125-xxxx.jsonl
.jfl/journal/session-hath-20260126-xxxx.jsonl
```

Context Hub aggregates all journals — each agent can see what others did via `jfl_context`.

## Event Bus Coordination

All agents connect to the same Context Hub (port 4242) via the MAP event bus.

Key events agents emit and consume:

| Event | Emitter | Consumers |
|-------|---------|-----------|
| `agent:health` | All agents | Grid overlay, PP |
| `eval:scored` | Eval agent | PP, Stratus bridge |
| `review:findings` | Reviewer agent | PP |
| `task:requested` | PP, human | Builder agent |
| `journal:entry` | Any agent | Footer, context |
| `peter:dispatched` | PP | Status display |
| `peter:completed` | PP | Status display |

## Scope Enforcement

Each GTM can declare a context scope in `.jfl/config.json`:

```json
{
  "context_scope": {
    "produces": ["discovery:*", "eval:*"],
    "consumes": ["strategy:*", "seo:serp-data"],
    "denied": ["portfolio:financial-*"]
  }
}
```

The `map-bridge` extension reads this and filters subscriptions accordingly.
Cross-GTM leakage is blocked at the subscription level.

## Portfolio Hierarchy

```
portfolio-hub (runs Context Hub on port 4242)
├── productrank-gtm (port 4243)
│   └── agents: scout, builder, eval
├── seo-agent (port 4244)
│   └── agents: crawler, ranker
└── visaclaw (port 4245)
    └── agents: mcp-registry, payment
```

Each GTM's `portfolio-bridge` extension phones home to parent on session end,
syncing journals and eval scores for cross-GTM RL training.

## Peter Parker Loop

PP runs in the primary session and orchestrates others via Pi RPC:

```
task:requested → PP queries Stratus → pick best action
              → spawn Pi RPC agent
              → monitor → eval:scored
              → if findings: spawn reviewer
              → max 5 iterations
              → peter:completed
```

## Running Multiple Sessions

```bash
# Terminal 1: Your interactive session
jfl pi

# Terminal 2: Spawn agent team
jfl pi agents run --team teams/gtm-team.yaml

# Inside Pi session: monitor agents
/grid

# Inside Pi session: trigger PP task
/peter Fix the failing evals in src/lib/eval.ts
```

## Debugging

```bash
# Watch all MAP events
jfl flows watch

# Check agent health
curl http://localhost:4242/api/events?pattern=agent:health

# View training buffer
tail -f ~/.jfl/training-buffer.jsonl

# View journal across all sessions
cat .jfl/journal/*.jsonl | sort -t'"' -k4 | tail -20
```
