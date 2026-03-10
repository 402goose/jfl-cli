import { api, EvalAgent, HubEvent } from "@/api"
import { AgentCard } from "@/components"
import { usePolling, cn, timeAgo } from "@/lib/hooks"
import { useState } from "preact/hooks"

type AgentRole = "scout" | "planner" | "builder" | "reviewer" | "tester"
type ModelTier = "haiku" | "sonnet" | "opus"
type CostProfile = "cost-optimized" | "balanced" | "quality-first"

const ROLES: AgentRole[] = ["scout", "planner", "builder", "reviewer", "tester"]

const MODEL_ROUTING_TABLE: Record<CostProfile, Record<AgentRole, ModelTier>> = {
  "cost-optimized": {
    scout: "haiku", planner: "sonnet", builder: "sonnet", reviewer: "sonnet", tester: "haiku",
  },
  "balanced": {
    scout: "haiku", planner: "sonnet", builder: "sonnet", reviewer: "opus", tester: "sonnet",
  },
  "quality-first": {
    scout: "sonnet", planner: "opus", builder: "sonnet", reviewer: "opus", tester: "sonnet",
  },
}

const FALLBACK_ROUTING: Record<AgentRole, ModelTier> = {
  scout: "sonnet", planner: "opus", builder: "opus", reviewer: "opus", tester: "sonnet",
}

const TIER_COLORS: Record<ModelTier, string> = {
  haiku: "bg-success/15 text-success",
  sonnet: "bg-info/15 text-info",
  opus: "bg-purple-500/15 text-purple-400",
}

const ROLE_DESCRIPTIONS: Record<AgentRole, string> = {
  scout: "Explores codebase, gathers context",
  planner: "Designs approach, breaks down tasks",
  builder: "Writes code, implements features",
  reviewer: "Reviews output, catches issues",
  tester: "Validates correctness, runs checks",
}

function groupAgentsByProduct(agents: EvalAgent[]): Record<string, EvalAgent[]> {
  const groups: Record<string, EvalAgent[]> = {}
  for (const agent of agents) {
    const metricKeys = Object.keys(agent.metrics).filter((k) => k !== "composite")
    let product = "other"
    if (metricKeys.some((k) => ["ndcg@10", "mrr", "precision@5"].includes(k))) {
      product = "ProductRank"
    } else if (metricKeys.some((k) => ["avg_rank", "keywords_ranked", "rank_rate"].includes(k))) {
      product = "SEO"
    }
    if (!groups[product]) groups[product] = []
    groups[product].push(agent)
  }
  return groups
}

export function AgentsPage() {
  const leaderboard = usePolling(() => api.leaderboard(), 15000)
  const [selected, setSelected] = useState<string | null>(null)

  const agents = leaderboard.data || []
  const groups = groupAgentsByProduct(agents)

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Agents</h1>
        <span class="text-sm text-muted-foreground">{agents.length} tracked</span>
      </div>

      <PeterParkerSection />

      {leaderboard.loading ? (
        <div class="text-sm text-muted-foreground">Loading...</div>
      ) : agents.length === 0 ? (
        <div class="bg-card rounded-lg border border-border p-8 text-center">
          <div class="text-muted-foreground text-sm">No eval data yet</div>
          <div class="text-muted-foreground text-xs mt-1">
            Run evaluations to see agent performance here
          </div>
        </div>
      ) : (
        Object.entries(groups).map(([product, groupAgents]) => (
          <section key={product}>
            <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {product}
              <span class="text-[10px] ml-2 normal-case">({groupAgents.length} agents)</span>
            </h2>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {groupAgents
                .sort((a, b) => (b.composite || 0) - (a.composite || 0))
                .map((agent) => (
                  <AgentCard
                    key={agent.agent}
                    agent={agent}
                    onClick={() => setSelected(agent.agent === selected ? null : agent.agent)}
                  />
                ))}
            </div>

            {selected && groupAgents.some((a) => a.agent === selected) && (
              <AgentDetail agentName={selected} />
            )}
          </section>
        ))
      )}
    </div>
  )
}

function PeterParkerSection() {
  const [activeProfile, setActiveProfile] = useState<CostProfile>("balanced")
  const [showRouting, setShowRouting] = useState(false)
  const [justSpawned, setJustSpawned] = useState(false)
  const peterEvents = usePolling(
    () => api.events(50, "peter:*").then((r) => {
      const evts = r?.events || []
      return evts.filter((e) => e.type.startsWith("peter:"))
    }),
    15000,
  )

  const events = peterEvents.data || []
  const latestRun = events.find((e) => e.type === "peter:started")
  const tasksCompleted = events.filter((e) => e.type === "peter:task-completed").length
  const isRunning = latestRun && !events.some(
    (e) => e.type === "peter:all-complete" && e.ts > latestRun.ts
  )

  return (
    <section>
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Peter Parker
          <span class="text-[10px] ml-2 normal-case">RL Orchestrator</span>
        </h2>
        {isRunning && (
          <span class="text-[10px] mono px-1.5 py-0.5 rounded bg-success/10 text-success uppercase animate-pulse-dot">
            running
          </span>
        )}
      </div>

      <div class="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
        {ROLES.map((role) => {
          const tier = MODEL_ROUTING_TABLE[activeProfile][role]
          const fallback = FALLBACK_ROUTING[role]
          const roleEvents = events.filter(
            (e) => (e.data as Record<string, unknown>)?.agent_role === role ||
                   (e.data as Record<string, unknown>)?.role === role
          )
          const lastEvent = roleEvents[0]

          return (
            <div key={role} class="bg-card rounded-lg border border-border p-3 animate-fade-in">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-medium capitalize">{role}</span>
                <span class={cn(
                  "text-[10px] mono px-1.5 py-0.5 rounded uppercase",
                  TIER_COLORS[tier],
                )}>
                  {tier}
                </span>
              </div>
              <div class="text-[10px] text-muted-foreground mb-2">
                {ROLE_DESCRIPTIONS[role]}
              </div>
              <div class="flex items-center justify-between pt-2 border-t border-border">
                <span class="text-[10px] mono text-muted-foreground">
                  fallback: {fallback}
                </span>
                {lastEvent && (
                  <span class="text-[10px] mono text-muted-foreground">
                    {timeAgo(lastEvent.ts)}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div class="flex items-center gap-2 mb-4">
        <span class="text-xs text-muted-foreground">Profile:</span>
        {(["cost-optimized", "balanced", "quality-first"] as CostProfile[]).map((p) => (
          <button
            key={p}
            onClick={() => setActiveProfile(p)}
            class={cn(
              "text-[10px] mono px-2 py-1 rounded transition-colors",
              activeProfile === p
                ? "bg-info/15 text-info"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {p}
          </button>
        ))}
        <button
          onClick={async () => {
            try {
              await api.spawnAction("jfl", ["peter", "run", "--profile", activeProfile], "peter:started")
              setJustSpawned(true)
              setTimeout(() => setJustSpawned(false), 3000)
            } catch (err) {
              console.error("Failed to spawn:", err)
            }
          }}
          class={cn(
            "text-[10px] mono px-2 py-1 rounded transition-colors",
            justSpawned
              ? "bg-success/15 text-success"
              : "bg-info/15 text-info hover:bg-info/25",
          )}
        >
          {justSpawned ? "spawned" : "run peter"}
        </button>
        <button
          onClick={() => setShowRouting(!showRouting)}
          class="ml-auto text-[10px] mono text-muted-foreground hover:text-foreground transition-colors"
        >
          {showRouting ? "hide" : "show"} full table
        </button>
      </div>

      {showRouting && <RoutingTable activeProfile={activeProfile} />}

      {events.length > 0 ? (
        <div class="bg-card rounded-lg border border-border overflow-hidden">
          <div class="px-3 py-2 border-b border-border flex items-center justify-between">
            <span class="text-xs font-medium">Event Log</span>
            <span class="text-[10px] mono text-muted-foreground">{tasksCompleted} tasks completed</span>
          </div>
          <div class="max-h-64 overflow-y-auto">
            <table class="w-full text-xs">
              <tbody>
                {events.slice(0, 20).map((ev, i) => (
                  <PeterEventRow key={i} event={ev} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div class="bg-card rounded-lg border border-border/50 p-6 text-center">
          <div class="text-muted-foreground text-sm">No orchestrator activity yet</div>
          <div class="text-muted-foreground text-[10px] mt-1 mono">
            jfl peter start --profile {activeProfile}
          </div>
        </div>
      )}
    </section>
  )
}

function RoutingTable({ activeProfile }: { activeProfile: CostProfile }) {
  const profiles: CostProfile[] = ["cost-optimized", "balanced", "quality-first"]

  return (
    <div class="bg-card rounded-lg border border-border overflow-hidden mb-4 animate-fade-in">
      <table class="w-full text-xs">
        <thead>
          <tr class="border-b border-border text-muted-foreground">
            <th class="text-left py-2 px-3 font-medium">Role</th>
            {profiles.map((p) => (
              <th key={p} class={cn(
                "text-center py-2 px-3 font-medium",
                p === activeProfile && "text-info",
              )}>
                {p.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
              </th>
            ))}
            <th class="text-center py-2 px-3 font-medium">Fallback</th>
          </tr>
        </thead>
        <tbody>
          {ROLES.map((role) => (
            <tr key={role} class="border-b border-border/50">
              <td class="py-2 px-3 font-medium capitalize">{role}</td>
              {profiles.map((p) => {
                const tier = MODEL_ROUTING_TABLE[p][role]
                return (
                  <td key={p} class="py-2 px-3 text-center">
                    <span class={cn(
                      "text-[10px] mono px-1.5 py-0.5 rounded inline-block",
                      TIER_COLORS[tier],
                      p === activeProfile && "ring-1 ring-info/30",
                    )}>
                      {tier}
                    </span>
                  </td>
                )
              })}
              <td class="py-2 px-3 text-center">
                <span class={cn(
                  "text-[10px] mono px-1.5 py-0.5 rounded inline-block",
                  TIER_COLORS[FALLBACK_ROUTING[role]],
                )}>
                  {FALLBACK_ROUTING[role]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const PETER_EVENT_STYLE: Record<string, { color: string; label: string }> = {
  "peter:started": { color: "text-info", label: "RUN STARTED" },
  "peter:task-selected": { color: "text-warning", label: "TASK SELECTED" },
  "peter:task-completed": { color: "text-success", label: "TASK DONE" },
  "peter:all-complete": { color: "text-success", label: "ALL COMPLETE" },
}

function PeterEventRow({ event }: { event: HubEvent }) {
  const style = PETER_EVENT_STYLE[event.type] || { color: "text-muted-foreground", label: event.type }
  const data = event.data as Record<string, unknown>
  const task = data.task_name || data.bead_title || data.title || ""
  const role = data.agent_role || data.role || ""
  const model = data.model || data.execution_llm || ""

  return (
    <tr class="border-b border-border/50 hover:bg-muted/20 transition-colors">
      <td class={cn("py-1.5 px-3 mono whitespace-nowrap", style.color)}>
        {style.label}
      </td>
      <td class="py-1.5 px-3 truncate max-w-48">
        {task as string}
      </td>
      <td class="py-1.5 px-3 mono text-muted-foreground">
        {role && (
          <span class="capitalize">{role as string}</span>
        )}
        {model && (
          <span class="ml-2 text-[10px]">({model as string})</span>
        )}
      </td>
      <td class="py-1.5 px-3 mono text-muted-foreground text-right whitespace-nowrap">
        {timeAgo(event.ts)}
      </td>
    </tr>
  )
}

function AgentDetail({ agentName }: { agentName: string }) {
  const trajectory = usePolling(
    () => api.trajectory(agentName),
    30000,
    [agentName],
  )

  const points = trajectory.data?.points || []

  return (
    <div class="bg-card rounded-lg border border-border p-4 mt-4 animate-fade-in">
      <h3 class="text-sm font-medium mb-3">{agentName} — Trajectory</h3>
      {trajectory.loading ? (
        <div class="text-sm text-muted-foreground">Loading...</div>
      ) : points.length === 0 ? (
        <div class="text-sm text-muted-foreground">No trajectory data</div>
      ) : (
        <div class="max-h-48 overflow-y-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="text-muted-foreground border-b border-border">
                <th class="text-left py-1 font-medium">Time</th>
                <th class="text-right py-1 font-medium">Score</th>
                <th class="text-right py-1 font-medium">Model</th>
              </tr>
            </thead>
            <tbody>
              {points
                .slice()
                .reverse()
                .slice(0, 20)
                .map((p, i) => (
                  <tr key={i} class="border-b border-border/50">
                    <td class="py-1 mono text-muted-foreground">
                      {new Date(p.ts).toLocaleString()}
                    </td>
                    <td class="py-1 mono text-right">{p.value.toFixed(4)}</td>
                    <td class="py-1 mono text-right text-muted-foreground">
                      {p.model_version || "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
