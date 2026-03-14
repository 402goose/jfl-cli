# Pi in the Sky — JFL × Pi RPC Integration

> Turn JFL agents from interactive chat sessions into **programmable, composable processes**.

Pi's RPC protocol exposes a full JSON-over-stdin/stdout control plane for AI agents. JFL already has the event bus (MAP), eval framework, RL infrastructure, Stratus prediction, and session management. Wiring them together via RPC is the missing link that makes the self-driving loop truly autonomous — agents that steer each other, react to system events, and optimize themselves without human prompts.

---

## The 10 Unlocks

### 1. Real-Time Agent Swarm Dashboard

Keep every spawned agent's Pi RPC connection alive and pipe all `message_update` and `tool_execution_*` events into Context Hub's MAP event bus. A live multiplexed terminal view shows all agents streaming simultaneously — mission control with per-agent columns. Use `steer` to redirect any agent mid-run from the dashboard.

### 2. Event-Driven Agent Steering (MAP → Pi `steer`)

Wire the MAP event bus directly to Pi's `steer` command. When `eval:scored` fires showing a regression, the flow engine sends a `steer` message to the active agent: *"Stop. Eval regression detected. Investigate and fix before continuing."* Agents become **reactive to the system's nervous system** in real-time.

### 3. Stratus-Gated Prompt Filtering

Before every prompt hits the LLM, call Stratus rollout API (~1.6s, ~$0.001) to predict whether the proposed action improves or regresses the eval score. If Stratus predicts regression, swap the prompt for a steering message. A **world-model firewall** — bad ideas get filtered before burning tokens.

### 4. Self-Healing Session Chains with `follow_up` Queues

Use `follow_up` to build autonomous multi-step pipelines. After Peter Parker creates a PR, queue: *"Wait for CI. If eval improves, merge. If regression, analyze and fix."* Chain follow-ups dynamically based on MAP events. The agent becomes a **state machine** driven by external signals.

### 5. Cross-Agent Memory Injection

One agent finishes research. Extract results via `get_last_assistant_text`, search related decisions via `jfl memory`, inject combined context into a different agent via `bash`. A **relay race pattern** — agents hand off knowledge without sharing token budgets.

### 6. Portfolio-Wide Parallel Eval Sweeps

Spawn one Pi RPC agent per service in a portfolio. Each runs evals in parallel. Aggregate into a portfolio-level snapshot. What takes serial `jfl eval` runs becomes a **parallel eval blast** scoring the entire portfolio at once.

### 7. Voice → Steer Pipeline (Live Copilot Mode)

Connect `jfl voice` (Whisper transcription) directly to Pi's `steer` command. Speak while the agent works. Voice daemon transcribes and sends `{"type": "steer"}` over stdin. **Real-time voice copiloting.**

### 8. Extension UI as a Service Approval Gate

Use the extension UI sub-protocol (`select`, `confirm`) to build human-in-the-loop gates. When a flow triggers `peter:pr-proposed`, emit a `confirm` request to a connected client (Slack, web, mobile). The human approves or rejects. Pi becomes a **human-gated autonomous system**.

### 9. Dynamic Model Hot-Swapping on Cost Budget

Monitor cost via `get_session_stats` after each `agent_end`. Cross a threshold → `set_model` to Haiku + `set_thinking_level` low. Critical path detected → swap to Opus + high thinking. **Adaptive cost management** — self-tuning intelligence budgets.

### 10. Fork-Based A/B Experimentation

Use `fork` to branch sessions at decision points. Send divergent prompts to each fork. Let both complete, score with eval agent, log winner as training tuple. **Branching experiment trees** — counterfactual trajectories for the RL replay buffer.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     JFL Orchestrator                      │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Pi Agent 1  │  │  Pi Agent 2  │  │  Pi Agent N  │     │
│  │  (RPC stdin/ │  │  (RPC stdin/ │  │  (RPC stdin/ │     │
│  │   stdout)    │  │   stdout)    │  │   stdout)    │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                 │                 │              │
│         └────────┬────────┴────────┬────────┘              │
│                  │                 │                       │
│         ┌───────▼────────┐ ┌──────▼───────┐              │
│         │  Event Router   │ │ Cost Monitor  │              │
│         │  (MAP → steer)  │ │ (auto-swap)   │              │
│         └───────┬────────┘ └──────┬───────┘              │
│                 │                 │                       │
│         ┌───────▼─────────────────▼───────┐              │
│         │         MAP Event Bus            │              │
│         │  (eval:scored, agent:health,     │              │
│         │   telemetry:insight, ...)        │              │
│         └───────┬─────────────────────────┘              │
│                 │                                         │
│         ┌───────▼───────┐                                │
│         │  Context Hub   │                                │
│         │  + Dashboard   │                                │
│         └───────────────┘                                │
└──────────────────────────────────────────────────────────┘
```

---

## Implementation: `PiRpcBridge`

The core primitive is `PiRpcBridge` — a typed client that manages a single Pi subprocess over RPC. It handles JSONL framing, request/response correlation, event streaming, and extension UI forwarding.

```typescript
const bridge = new PiRpcBridge({ extensionPath, skillsPath, yolo: true });
await bridge.start();

// Send a prompt
await bridge.prompt("Fix the auth timeout bug");

// Listen to events
bridge.on("message_update", (event) => {
  // stream text deltas
});

// Steer mid-run
await bridge.steer("Actually, also add retry logic");

// Check cost
const stats = await bridge.getSessionStats();

// Switch model dynamically
await bridge.setModel("anthropic", "claude-haiku-4-5-20251001");

// Clean shutdown
await bridge.shutdown();
```

### `PiSwarm` — Multi-Agent Orchestration

Built on top of `PiRpcBridge`. Manages N agents, routes MAP events to them, and provides a unified event stream.

```typescript
const swarm = new PiSwarm({
  agents: [
    { name: "scout", role: "Research", model: "claude-sonnet-4-6" },
    { name: "builder", role: "Implementation", model: "claude-sonnet-4-6" },
  ],
  extensionPath,
  costBudget: 5.00,
});

await swarm.start();

// Prompt a specific agent
await swarm.prompt("scout", "Research auth timeout patterns in Express");

// Relay results between agents
swarm.on("agent_end", async (agentName, event) => {
  if (agentName === "scout") {
    const text = await swarm.getLastAssistantText("scout");
    await swarm.prompt("builder", `Implement based on this research:\n${text}`);
  }
});

// MAP event steering
swarm.onMapEvent("eval:scored", async (event) => {
  if (event.data.delta < 0) {
    await swarm.steerAll("Eval regression detected. Stop and reassess.");
  }
});
```

---

## CLI: `jfl pi-sky`

```bash
# Launch a single managed Pi agent with MAP integration
jfl pi-sky run --task "Fix the auth bug"

# Launch a swarm from a team definition
jfl pi-sky swarm --team teams/gtm-team.yaml

# Launch with cost budget
jfl pi-sky swarm --team teams/dev-team.yaml --budget 5.00

# Live dashboard of all running agents
jfl pi-sky dashboard

# Voice copilot mode — speak to steer the active agent
jfl pi-sky voice

# Parallel eval sweep across all services
jfl pi-sky eval-sweep

# A/B experiment: fork and compare two approaches
jfl pi-sky experiment --prompt "Implement caching" --variants "Redis,Memcached"
```

---

## Files

```
packages/pi-sky/
├── src/
│   ├── bridge.ts           # PiRpcBridge — single agent RPC client
│   ├── swarm.ts            # PiSwarm — multi-agent orchestration
│   ├── event-router.ts     # MAP → Pi steer/follow_up routing
│   ├── cost-monitor.ts     # Dynamic model swapping on budget
│   ├── stratus-gate.ts     # Stratus prediction filtering
│   ├── voice-bridge.ts     # Voice → steer pipeline
│   ├── experiment.ts       # Fork-based A/B experiments
│   ├── eval-sweep.ts       # Portfolio-wide parallel eval
│   └── types.ts            # Shared types
├── package.json
└── tsconfig.json

src/commands/
└── pi-sky.ts               # CLI command handler
```
