---
name: context
description: JFL context system — query project memory, journal, and knowledge base
triggers:
  - context
  - search context
  - what happened
  - find context
  - /context
---

# /context - Project Context

Query the JFL context system — journal entries, memory, knowledge docs, and decisions.

## Usage

```
/context                        # Show recent context
/context search <query>         # Semantic search
/context synopsis               # What happened in last 24h
/context synopsis 48            # What happened in last 48h
/context memory <query>         # Search persistent memory
```

## Tools Available in Pi Sessions

When running in Pi, these tools are auto-registered:

- **`jfl_context`** — Search all project context (journal, knowledge, memory)
- **`jfl_memory_search`** — Semantic search across session memories
- **`jfl_synopsis`** — Aggregated work summary across sessions

## Context Sources

1. **Journal** (`.jfl/journal/<branch>.jsonl`) — Session-level work log
2. **Knowledge docs** (`knowledge/*.md`) — Vision, narrative, thesis, roadmap
3. **SQLite memory** — Indexed journal entries via Context Hub
4. **Code headers** (`@purpose` tags) — File-level intent

## How Context is Injected

At session start, the `context` extension:
1. Ensures Context Hub is running (`jfl context-hub ensure`)
2. Before each agent turn, fetches recent context (`GET /api/context?limit=10`)
3. Injects into system prompt as a `## JFL Project Context` section

This means agents always have recent session context without manual prompting.

## Querying Context

```typescript
// In extension code:
const result = await ctx.tools.jfl_context({ query: "what did we decide about pricing?", limit: 5 })
```

## Context Hub

The Context Hub daemon (`:4242`) aggregates all sources:
- MAP event bus (ring buffer)
- Memory SQLite DB
- Journal files (file watcher)
- Knowledge docs (file watcher)

Run `jfl context-hub status` to check health.
