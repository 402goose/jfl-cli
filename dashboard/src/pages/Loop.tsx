import { api, HubEvent, EvalAgent } from "@/api"
import { Sparkline } from "@/components"
import { usePolling, timeAgo, cn } from "@/lib/hooks"

interface LoopCycle {
  ts: string
  branch?: string
  prNumber?: number
  delta?: number
  improved?: boolean
  agent?: string
  source?: string
}

function extractCycles(events: HubEvent[]): LoopCycle[] {
  return events
    .filter(e => e.type === "eval:scored")
    .map(ev => {
      const d = ev.data || {}
      return {
        ts: ev.ts,
        branch: d.branch as string | undefined,
        prNumber: d.pr_number as number | undefined,
        delta: d.delta as number | undefined,
        improved: d.improved === "true" || d.improved === true,
        agent: d.agent as string | undefined,
        source: ev.source,
      }
    })
    .sort((a, b) => b.ts.localeCompare(a.ts))
}

export function LoopPage() {
  const events = usePolling(() => api.events(500), 15000)
  const leaderboard = usePolling(() => api.leaderboard(), 15000)
  const flowExecs = usePolling(() => api.flowExecutions(), 15000)

  const allEvents = events.data?.events || []
  const agents = leaderboard.data || []
  const executions = flowExecs.data || []

  const cycles = extractCycles(allEvents)
  const detectCount = allEvents.filter(e => e.type === "telemetry:insight").length
  const proposeCount = allEvents.filter(e => e.type.startsWith("peter:")).length
  const evalCount = allEvents.filter(e => e.type === "eval:scored").length
  const mergeCount = cycles.filter(c => c.improved).length
  const rejectCount = cycles.filter(c => c.improved === false).length
  const flowRuns = executions.length

  const bestAgent = [...agents].sort((a, b) => (b.composite || 0) - (a.composite || 0))[0]
  const scoreStart = bestAgent?.trajectory?.[0]
  const scoreEnd = bestAgent?.composite

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Self-Driving Loop</h1>
        <span class="text-sm text-muted-foreground">{cycles.length} cycles</span>
      </div>

      {/* Score */}
      {scoreStart != null && scoreEnd != null && (
        <div class="bg-card rounded-lg border border-border p-4">
          <div class="flex items-center gap-4">
            <div>
              <div class="text-xs text-muted-foreground uppercase tracking-wider mb-1">Score</div>
              <div class="flex items-center gap-2">
                <span class="text-2xl font-bold tabular-nums">{scoreEnd.toFixed(2)}</span>
                {(() => {
                  const d = scoreEnd - scoreStart
                  return (
                    <span class={cn("text-sm mono", d >= 0 ? "text-success" : "text-destructive")}>
                      {d >= 0 ? "\u25b2" : "\u25bc"}{d >= 0 ? "+" : ""}{d.toFixed(3)}
                    </span>
                  )
                })()}
              </div>
            </div>
            {bestAgent?.trajectory && bestAgent.trajectory.length > 1 && (
              <Sparkline
                data={bestAgent.trajectory}
                width={200}
                height={40}
                color={scoreEnd >= scoreStart ? "var(--success)" : "var(--destructive)"}
              />
            )}
            <div class="ml-auto">
              <div class="w-40 h-3 bg-muted rounded-full overflow-hidden">
                <div
                  class="h-full bg-success rounded-full transition-all"
                  style={{ width: `${Math.round(scoreEnd * 100)}%` }}
                />
              </div>
              <div class="text-[10px] text-muted-foreground text-right mt-0.5">{Math.round(scoreEnd * 100)}%</div>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline */}
      <div class="bg-card rounded-lg border border-border p-4">
        <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-4">Pipeline</h3>
        <div class="flex items-center justify-between text-center">
          {[
            { label: "DETECT", count: detectCount, color: "text-accent-foreground", detail: "insights" },
            { label: "PROPOSE", count: proposeCount, color: "text-warning", detail: "PRs" },
            { label: "EVAL", count: evalCount, color: "text-info", detail: "runs" },
            { label: "MERGE", count: mergeCount, color: "text-success", detail: "merged" },
            { label: "LEARN", count: flowRuns, color: "text-info/70", detail: "flows" },
          ].map((stage, i) => (
            <div key={stage.label} class="flex items-center">
              {i > 0 && (
                <svg width="24" height="16" class="text-muted-foreground/30 mx-1 shrink-0">
                  <path d="M2 8h16M14 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" />
                </svg>
              )}
              <div>
                <div class={cn("text-2xl font-bold tabular-nums", stage.color)}>{stage.count}</div>
                <div class="text-[10px] mono text-muted-foreground uppercase tracking-wider">{stage.label}</div>
                <div class="text-[10px] text-muted-foreground">{stage.detail}</div>
              </div>
            </div>
          ))}
        </div>
        {rejectCount > 0 && (
          <div class="flex items-center gap-2 mt-3 text-xs text-destructive">
            <span class="mono">{rejectCount} rejected</span>
          </div>
        )}
      </div>

      {/* Agents */}
      {agents.length > 0 && (
        <div class="bg-card rounded-lg border border-border p-4">
          <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-3">Agents</h3>
          <div class="space-y-2">
            {agents
              .sort((a, b) => (b.composite || 0) - (a.composite || 0))
              .map(agent => (
                <div key={agent.agent} class="flex items-center gap-3">
                  <span class={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    agent.delta != null && agent.delta > 0 ? "bg-success" : "bg-muted-foreground/50",
                  )} />
                  <span class="text-sm font-medium flex-1 truncate">{agent.agent}</span>
                  <span class="text-sm mono tabular-nums text-muted-foreground">
                    {agent.composite != null ? agent.composite.toFixed(4) : "\u2014"}
                  </span>
                  {agent.trajectory && agent.trajectory.length > 1 && (
                    <Sparkline data={agent.trajectory} width={80} height={24} />
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Recent Cycles */}
      {cycles.length > 0 && (
        <div class="bg-card rounded-lg border border-border p-4">
          <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-3">Recent Cycles</h3>
          <div class="space-y-1">
            {cycles.slice(0, 20).map((c, i) => (
              <div key={`${c.ts}-${i}`} class="flex items-center gap-3 py-1.5 text-sm">
                <span class="text-[10px] text-muted-foreground mono w-14 shrink-0">{timeAgo(c.ts)}</span>
                <span class={cn("w-2 h-2 rounded-full shrink-0", c.improved ? "bg-success" : "bg-destructive")} />
                <span class="truncate flex-1 text-muted-foreground">{c.branch || c.agent || "\u2014"}</span>
                {c.prNumber && <span class="text-xs mono text-muted-foreground">#{c.prNumber}</span>}
                {c.delta != null && (
                  <span class={cn(
                    "text-xs mono tabular-nums",
                    c.improved ? "text-success" : "text-destructive",
                  )}>
                    {c.delta >= 0 ? "+" : ""}{c.delta.toFixed(4)}
                  </span>
                )}
                <span class={cn(
                  "text-[10px] mono",
                  c.improved ? "text-success" : "text-destructive",
                )}>
                  {c.improved ? "merged" : "rejected"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {cycles.length === 0 && (
        <div class="bg-card rounded-lg border border-border p-8 text-center">
          <div class="text-sm text-muted-foreground">No eval cycles yet</div>
          <div class="text-xs text-muted-foreground/70 mt-1">
            Run <span class="mono">jfl peter pr --task "add tests"</span> to start the loop
          </div>
        </div>
      )}
    </div>
  )
}
