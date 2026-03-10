---
name: viz
description: Terminal data visualization via kuva — inline plots for agents and humans
---

# /viz — Terminal Visualization

Pipe JFL data to kuva for inline terminal plots. Agents see results without leaving flow.

## Prerequisites

```bash
cargo install kuva --features cli
```

If kuva is not installed, falls back to ASCII bar/sparkline rendering.

## Commands

```
/viz events      # Event bus activity (bar chart by type, sankey of service flows)
/viz sessions    # Session activity (line chart over time, duration box plot)
/viz costs       # API costs (bar by model, pie by provider)
/viz tools       # Tool usage frequency (bar chart)
/viz flows       # Flow trigger rates (bar chart, sankey of trigger→action)
/viz arena       # Arena leaderboard (composite bar chart, score trajectory)
/viz learning    # Pattern confidence trends (line chart)
/viz health      # Service health dashboard (cost sparklines, error bars, latency box)
/viz <custom>    # Describe what you want to visualize
```

## How It Works

Each `/viz` command:
1. Reads the relevant data source (events, journals, telemetry, arena results)
2. Transforms to TSV format
3. Pipes to `kuva [plot-type] --terminal`
4. Renders inline in the terminal

## Implementation

### /viz events

Read `.jfl/service-events.jsonl` and `.jfl/map-events.jsonl`:

```bash
# Event type distribution
cat .jfl/service-events.jsonl | \
  jq -r '.type' | sort | uniq -c | sort -rn | \
  awk '{print $2"\t"$1}' | \
  kuva bar --label-col 0 --value-col 1 --title "Events by Type" --terminal

# Service-to-service flow (sankey)
cat .jfl/service-events.jsonl | \
  jq -r '[.source // "unknown", .type, 1] | @tsv' | \
  kuva sankey --source-col 0 --target-col 1 --value-col 2 --title "Event Flows" --terminal
```

Or use the programmatic API from `jfl-cli/src/lib/kuva.ts`:

```typescript
import { barChart, linePlot, sparkline } from 'jfl-cli/src/lib/kuva.js'

const events = loadEvents()
const byType = countBy(events, 'type')
const chart = barChart(
  Object.entries(byType).map(([label, value]) => ({ label, value })),
  'Events by Type'
)
console.log(chart)
```

### /viz sessions

```bash
# Sessions over time (line)
cat .jfl/journal/*.jsonl | \
  jq -r 'select(.type == "session-end") | [.ts[:10], 1] | @tsv' | \
  sort | uniq -c | awk '{print $2"\t"$1}' | \
  kuva line --x 0 --y 1 --title "Sessions per Day" --terminal
```

### /viz costs

```bash
# Cost by model (bar)
cat .jfl/telemetry-queue.jsonl | \
  jq -r 'select(.event == "stratus:api_call") | [(.model_name // "unknown"), .estimated_cost_usd] | @tsv' | \
  kuva bar --label-col 0 --value-col 1 --title "Cost by Model" --terminal
```

### /viz arena

```bash
# Run from arena directory
cd /path/to/productrank-arena
npm run arena -- leaderboard --all --plots
```

Or programmatically — arena's `formatLeaderboardPlots()` renders composite scores as kuva bar chart.

### /viz flows

```bash
# Flow triggers (bar)
cat .jfl/service-events.jsonl | \
  jq -r 'select(.type == "flow:triggered") | .data.flow_name' | \
  sort | uniq -c | sort -rn | awk '{print $2"\t"$1}' | \
  kuva bar --label-col 0 --value-col 1 --title "Flow Triggers" --terminal

# Flow trigger→action sankey
cat .jfl/service-events.jsonl | \
  jq -r 'select(.type == "flow:completed") | [.data.flow_name, .data.action_type, 1] | @tsv' | \
  kuva sankey --source-col 0 --target-col 1 --value-col 2 --title "Flow Actions" --terminal
```

### /viz health

Composite dashboard — renders multiple charts:

```
  Health Dashboard
  ━━━━━━━━━━━━━━━━

  API Costs (last 24h)
  [kuva bar: cost by model]

  Error Rate ▁▂▁▁▃▅▂▁▁▁  (sparkline)

  Latency Distribution
  [kuva box: latency by endpoint]

  Session Duration
  [kuva box: duration by session]
```

### /viz learning (RL / Training)

For agents with reinforcement learning loops:

```typescript
// After each training epoch
const rewards = epochs.map((e, i) => ({ ts: `epoch-${i}`, value: e.reward }))
const chart = linePlot(rewards, 'Reward per Epoch')
console.log(chart)

// Action distribution
const actions = countBy(episodes, 'action')
const actionChart = barChart(
  Object.entries(actions).map(([label, value]) => ({ label, value })),
  'Action Frequency'
)
console.log(actionChart)
```

### /viz custom

When user describes what they want to visualize, the agent:
1. Identifies the data source
2. Extracts/transforms to TSV
3. Picks the right kuva plot type
4. Renders with `--terminal`

## Available Plot Types

| kuva command | Best for | Key flags |
|-------------|----------|-----------|
| `bar` | Categorical comparisons | `--label-col`, `--value-col` |
| `line` | Time series, trends | `--x`, `--y`, `--color-by` |
| `scatter` | Correlations, clustering | `--x`, `--y`, `--color-by` |
| `box` | Distributions, outliers | `--group-col`, `--value-col` |
| `histogram` | Value distributions | `--value-col`, `--bins` |
| `pie` | Proportions | `--label-col`, `--value-col`, `--donut` |
| `sankey` | Flow routing, transitions | `--source-col`, `--target-col`, `--value-col` |
| `heatmap` | Matrix data, correlations | First col = row labels |
| `violin` | Distribution shape | `--group-col`, `--value-col` |

## Design Principles

1. **TSV is the universal interface** — any data source that can produce rows can generate kuva plots
2. **Graceful degradation** — ASCII fallback (bars, sparklines) when kuva isn't installed
3. **Agent-native** — inline terminal output, no browser needed, no context-switching
4. **Composable** — pipe any JSONL through `jq -r @tsv` into kuva. Unix philosophy.
5. **Zero coupling** — kuva is a standalone Rust binary. kuva.ts is a standalone module. Neither needs the other's internals.

## Examples

```
User: "show me event activity"
Agent: *runs /viz events*
→ Bar chart of event types + sankey of service flows

User: "what's our cost breakdown?"
Agent: *runs /viz costs*
→ Bar chart by model + pie chart by provider

User: "how is the arena looking?"
Agent: *runs /viz arena*
→ Leaderboard table + composite score bar chart

User: "plot my training rewards"
Agent: *runs /viz learning with user's data*
→ Line chart of reward per epoch + action frequency bars
```
