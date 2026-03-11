import { WorkspaceStatus, api, HubEvent, ContextItem, EvalAgent, SynopsisData } from "@/api"
import { MetricCard, StatusDot, Sparkline, FlowLog, AlertsBubble } from "@/components"
import { usePolling, timeAgo, cn } from "@/lib/hooks"
import { useState } from "preact/hooks"

interface OverviewProps {
  status: WorkspaceStatus | null
}

export function OverviewPage({ status }: OverviewProps) {
  const events = usePolling(() => api.events(100), 10000)
  const leaderboard = usePolling(() => api.leaderboard(), 15000)
  const journal = usePolling(() => api.journal(), 15000)
  const synopsis = usePolling(() => api.synopsis(24), 30000)
  const memory = usePolling(() => api.memoryStatus(), 30000)
  const flowExecs = usePolling(() => api.flowExecutions(), 15000)

  const mode = status?.type || "standalone"
  const config = status?.config
  const children = status?.children || []
  const eventList = events.data?.events || []
  const agents = leaderboard.data || []
  const journalItems = journal.data || []
  const sources = status?.sources || {}
  const sourcesOk = Object.values(sources).filter(Boolean).length
  const sourcesTotal = Object.keys(sources).length
  const mem = memory.data
  const rawExecs = flowExecs.data
  const execs = Array.isArray(rawExecs) ? rawExecs : (rawExecs as any)?.executions || []
  const pendingActions = execs.filter((e: any) => e.gated)

  const bestAgent = agents.length > 0
    ? [...agents].sort((a, b) => (b.composite || 0) - (a.composite || 0))[0]
    : null

  const recentJournal = journalItems.filter((j: any) => j.type !== "file").slice(0, 5)
  const recentEvents = eventList
    .filter((e: HubEvent) => !e.type.startsWith("session:") && !e.type.startsWith("hook:"))
    .slice(0, 10)

  const [flowLogCollapsed, setFlowLogCollapsed] = useState(false)

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold">{config?.name || "Dashboard"}</h1>
          {config?.description && (
            <p class="text-sm text-muted-foreground mt-1">{config.description}</p>
          )}
        </div>
        <QuickActions />
      </div>

      {/* Alerts Bubble - significant cross-service events */}
      <AlertsBubble maxAlerts={3} />

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Sources"
          value={`${sourcesOk}/${sourcesTotal}`}
          sub="connected"
          trend={sourcesOk === sourcesTotal ? "up" : "down"}
        />
        <MetricCard
          label="Items"
          value={status?.itemCount || 0}
          sub="indexed"
        />
        <MetricCard
          label="Agents"
          value={agents.length}
          sub={bestAgent ? `best: ${bestAgent.composite?.toFixed(2)}` : "none"}
          trend={bestAgent?.delta != null && bestAgent.delta > 0 ? "up" : undefined}
        />
        <MetricCard
          label="Memories"
          value={mem?.total_memories || 0}
          sub={mem?.embeddings?.available ? "with embeddings" : "keyword only"}
        />
      </div>

      {pendingActions.length > 0 && (
        <div class="bg-warning/5 border border-warning/30 rounded-lg p-4">
          <h3 class="text-xs text-warning uppercase tracking-wider font-medium mb-2">
            Actions Needed ({pendingActions.length})
          </h3>
          <div class="space-y-1.5">
            {pendingActions.map((exec: any, i: number) => (
              <div key={i} class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
                  <span class="text-sm font-medium">{exec.flow}</span>
                  <span class="text-[10px] mono text-muted-foreground">{timeAgo(exec.started_at)}</span>
                </div>
                <button
                  onClick={() => api.approveFlow(exec.flow, exec.trigger_event_id)}
                  class="text-[10px] mono px-2 py-0.5 rounded bg-success/15 text-success hover:bg-success/25 transition-colors"
                >
                  approve
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {bestAgent && (
        <div class="bg-card rounded-lg border border-border p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-xs text-muted-foreground uppercase tracking-wider">Top Agent</h3>
            <span class="text-[10px] mono text-muted-foreground">{agents.length} total</span>
          </div>
          <div class="flex items-center gap-4">
            <div>
              <div class="text-sm font-medium">{bestAgent.agent}</div>
              <div class="flex items-center gap-2 mt-1">
                <span class="text-2xl font-bold tabular-nums">{bestAgent.composite?.toFixed(4)}</span>
                {bestAgent.delta != null && (
                  <span class={cn("text-sm mono", bestAgent.delta >= 0 ? "text-success" : "text-destructive")}>
                    {bestAgent.delta >= 0 ? "+" : ""}{bestAgent.delta.toFixed(4)}
                  </span>
                )}
              </div>
            </div>
            {bestAgent.trajectory && bestAgent.trajectory.length > 1 && (
              <Sparkline
                data={bestAgent.trajectory}
                width={160}
                height={36}
                color={bestAgent.delta != null && bestAgent.delta > 0 ? "var(--success)" : "var(--info)"}
              />
            )}
          </div>
        </div>
      )}

      {synopsis.data && <SynopsisSection data={synopsis.data} />}

      {mode === "portfolio" && children.length > 0 && (
        <div class="bg-card rounded-lg border border-border p-4">
          <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-3">
            Products ({children.length})
          </h3>
          <div class="space-y-2">
            {children.map((child) => (
              <div key={child.name} class="flex items-center gap-3 text-sm">
                <StatusDot status={child.status === "ok" ? "ok" : "error"} />
                <span class="font-medium">{child.name}</span>
                <span class="text-[10px] mono text-muted-foreground">:{child.port}</span>
                {child.status === "ok" && (
                  <a
                    href={`http://localhost:${child.port}/dashboard/`}
                    target="_blank"
                    rel="noopener"
                    class="text-[10px] text-info hover:underline ml-auto"
                  >
                    Open
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="bg-card rounded-lg border border-border p-4">
          <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-3">Recent Journal</h3>
          {recentJournal.length > 0 ? (
            <div class="space-y-2">
              {recentJournal.map((j: ContextItem, i: number) => (
                <div key={i} class="flex items-start gap-2 text-sm">
                  <span class="text-[10px] mono text-muted-foreground whitespace-nowrap mt-0.5 w-12 shrink-0">
                    {timeAgo(j.timestamp || (j as any).ts)}
                  </span>
                  <div class="min-w-0">
                    <div class="truncate">{j.title}</div>
                    {j.type && (
                      <span class="text-[10px] mono text-info">{j.type}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div class="text-sm text-muted-foreground">No journal entries</div>
          )}
        </div>

        <div class="bg-card rounded-lg border border-border p-4">
          <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-3">Recent Events</h3>
          {recentEvents.length > 0 ? (
            <div class="space-y-2">
              {recentEvents.map((ev: HubEvent) => {
                const d = ev.data || {}
                const label = ev.type.startsWith("hook:")
                  ? `${(d.tool_name as string) || "tool"} ${(d.file_paths as string[])?.length ? `on ${(d.file_paths as string[])[0]}` : ""}`
                  : (d.title as string) || (d.agent as string) || ev.source || ev.type
                return (
                  <div key={ev.id} class="flex items-start gap-2 text-sm">
                    <span class="text-[10px] mono text-muted-foreground whitespace-nowrap mt-0.5 w-12 shrink-0">
                      {timeAgo(ev.ts)}
                    </span>
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-[10px] mono text-info whitespace-nowrap">{ev.type}</span>
                        <span class="truncate text-muted-foreground">{label}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div class="text-sm text-muted-foreground">No events</div>
          )}
        </div>
      </div>

      <div class="bg-card rounded-lg border border-border p-4">
        <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-3">Context Sources</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(sources).map(([name, connected]) => (
            <div key={name} class="flex items-center gap-2">
              <span class={cn("w-1.5 h-1.5 rounded-full", connected ? "bg-success" : "bg-destructive")} />
              <span class="text-sm capitalize">{name}</span>
              <span class="text-[10px] text-muted-foreground">{connected ? "ok" : "disconnected"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Flow Log - live cross-service event feed */}
      <FlowLog
        events={eventList}
        collapsed={flowLogCollapsed}
        onToggleCollapse={setFlowLogCollapsed}
      />
    </div>
  )
}

function QuickActions() {
  const [feedback, setFeedback] = useState<string | null>(null)

  const actions: { label: string; event?: string; data?: Record<string, unknown>; spawn?: boolean; command?: string; args?: string[] }[] = [
    { label: "run eval", event: "eval:run-requested", data: { source: "dashboard" } },
    { label: "run peter", spawn: true, command: "jfl", args: ["peter", "run"] },
  ]

  const handleAction = async (action: typeof actions[0]) => {
    try {
      if (action.spawn) {
        await api.spawnAction(action.command!, action.args!, action.event)
      } else {
        await api.publishEvent(action.event!, action.data || {})
      }
      setFeedback(action.label)
      setTimeout(() => setFeedback(null), 2000)
    } catch (err) {
      console.error("Action failed:", err)
    }
  }

  return (
    <div class="flex items-center gap-2">
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={() => handleAction(a)}
          class={cn(
            "text-[10px] mono px-2 py-1 rounded transition-colors",
            feedback === a.label
              ? "bg-success/15 text-success"
              : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80",
          )}
        >
          {feedback === a.label ? "done" : a.label}
        </button>
      ))}
    </div>
  )
}

function SynopsisSection({ data }: { data: SynopsisData }) {
  const s = data.summary
  const hasContent = s.features + s.fixes + s.decisions + s.discoveries > 0 || data.commits.length > 0

  if (!hasContent) return null

  return (
    <div class="bg-card rounded-lg border border-border p-4">
      <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-3">
        Work Summary <span class="text-[10px] font-normal">last {data.hours}h</span>
      </h3>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
        {s.features > 0 && (
          <div>
            <div class="text-lg font-semibold mono text-success">{s.features}</div>
            <div class="text-[10px] text-muted-foreground uppercase">Features</div>
          </div>
        )}
        {s.fixes > 0 && (
          <div>
            <div class="text-lg font-semibold mono text-warning">{s.fixes}</div>
            <div class="text-[10px] text-muted-foreground uppercase">Fixes</div>
          </div>
        )}
        {s.decisions > 0 && (
          <div>
            <div class="text-lg font-semibold mono text-info">{s.decisions}</div>
            <div class="text-[10px] text-muted-foreground uppercase">Decisions</div>
          </div>
        )}
        {s.discoveries > 0 && (
          <div>
            <div class="text-lg font-semibold mono text-purple-400">{s.discoveries}</div>
            <div class="text-[10px] text-muted-foreground uppercase">Discoveries</div>
          </div>
        )}
        {data.commits.length > 0 && (
          <div>
            <div class="text-lg font-semibold mono">{data.commits.length}</div>
            <div class="text-[10px] text-muted-foreground uppercase">Commits</div>
          </div>
        )}
      </div>

      {data.commits.length > 0 && (
        <div class="border-t border-border pt-3">
          <div class="space-y-1">
            {data.commits.slice(0, 5).map((c) => (
              <div key={c.hash} class="flex items-center gap-2 text-xs">
                <span class="mono text-muted-foreground text-[10px]">{c.hash.slice(0, 7)}</span>
                <span class="truncate">{c.message}</span>
                <span class="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">{timeAgo(c.date)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {s.incompleteItems.length > 0 && (
        <div class="border-t border-border pt-3 mt-3">
          <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Incomplete</div>
          <div class="space-y-1">
            {s.incompleteItems.slice(0, 5).map((item, i) => (
              <div key={i} class="text-xs text-warning/80 flex items-center gap-1.5">
                <span class="w-1 h-1 rounded-full bg-warning/60 shrink-0" />
                {item}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
