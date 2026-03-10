import { api, WorkspaceStatus, FlowDef, FlowExecution, TelemetryDigest } from "@/api"
import { StatusDot, MetricCard } from "@/components"
import { usePolling, timeAgo, cn } from "@/lib/hooks"
import { useState } from "preact/hooks"

interface SystemPageProps {
  status: WorkspaceStatus | null
}

function execStatus(e: FlowExecution): string {
  if (e.gated) return "pending"
  if (e.error || (e.actions_failed && e.actions_failed > 0)) return "failed"
  if (e.completed_at) return "completed"
  return "running"
}

export function SystemPage({ status }: SystemPageProps) {
  const [hours, setHours] = useState(24)
  const projects = usePolling(() => api.projects(), 15000)
  const memory = usePolling(() => api.memoryStatus(), 30000)
  const flows = usePolling(() => api.flows(), 15000)
  const executions = usePolling(() => api.flowExecutions(), 15000)
  const digest = usePolling(() => api.telemetryDigest(hours), 30000, [hours])
  const agentStatus = usePolling(() => api.telemetryAgentStatus(), 15000)

  const sources = status?.sources || {}
  const sourcesOk = Object.values(sources).filter(Boolean).length
  const sourcesTotal = Object.keys(sources).length
  const mem = memory.data
  const flowDefs: FlowDef[] = flows.data || []
  const rawExecs = executions.data
  const execs: FlowExecution[] = Array.isArray(rawExecs)
    ? rawExecs
    : ((rawExecs as unknown as Record<string, unknown>)?.executions as FlowExecution[]) || []
  const pending = execs.filter(e => execStatus(e) === "pending")
  const d = digest.data

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">System</h1>
        <span class={cn(
          "text-xs mono px-2 py-0.5 rounded",
          status?.status === "running" || status?.status === "ok"
            ? "bg-success/10 text-success"
            : "bg-destructive/10 text-destructive",
        )}>
          {status?.status || "unknown"}
        </span>
      </div>

      {/* Hub metrics */}
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Hub"
          value={status?.status === "running" || status?.status === "ok" ? "OK" : status?.status || "--"}
          sub={`port :${status?.port || "--"}`}
          trend={status?.status === "running" || status?.status === "ok" ? "up" : "down"}
        />
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
          label="Memories"
          value={mem?.total_memories || 0}
          sub={mem?.embeddings?.available ? "with embeddings" : "keyword only"}
        />
      </div>

      {/* Costs */}
      <div class="bg-card rounded-lg border border-border p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-xs text-muted-foreground uppercase tracking-wider">Costs</h3>
          <div class="flex gap-1">
            {[24, 72, 168].map(h => (
              <button
                key={h}
                onClick={() => setHours(h)}
                class={cn(
                  "text-[10px] mono px-2 py-0.5 rounded transition-colors",
                  hours === h ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {h === 24 ? "24h" : h === 72 ? "3d" : "7d"}
              </button>
            ))}
          </div>
        </div>
        {d ? (
          <>
            <div class="text-2xl font-bold tabular-nums mb-3">${d.totalCostUsd.toFixed(2)}</div>
            <div class="space-y-1.5">
              {d.costs.sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd).map(cost => {
                const pct = d.totalCostUsd > 0 ? (cost.estimatedCostUsd / d.totalCostUsd) * 100 : 0
                return (
                  <div key={cost.model} class="flex items-center gap-3 text-xs">
                    <span class="w-32 truncate mono text-muted-foreground">{cost.model}</span>
                    <div class="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div class="h-full bg-info rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span class="mono text-muted-foreground w-16 text-right">${cost.estimatedCostUsd.toFixed(2)}</span>
                    <span class="text-muted-foreground/60 w-10 text-right">{pct.toFixed(0)}%</span>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div class="text-sm text-muted-foreground">No cost data</div>
        )}
      </div>

      {/* Flows + pending */}
      <div class="bg-card rounded-lg border border-border p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-xs text-muted-foreground uppercase tracking-wider">
            Flows ({flowDefs.length} defined, {flowDefs.filter(f => f.enabled !== false).length} enabled)
          </h3>
          {pending.length > 0 && (
            <span class="text-[10px] mono text-warning">{pending.length} pending</span>
          )}
        </div>

        {pending.length > 0 && (
          <div class="mb-3 space-y-1.5">
            {pending.map((exec, i) => (
              <div key={i} class="flex items-center justify-between p-2 rounded border border-warning/30 bg-warning/5">
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
        )}

        <div class="space-y-1">
          {flowDefs.map(flow => {
            const trigger = typeof flow.trigger === "string" ? flow.trigger : flow.trigger?.pattern || ""
            const enabled = flow.enabled !== false
            const runs = execs.filter(e => e.flow === flow.name).length
            return (
              <div key={flow.name} class={cn(
                "flex items-center gap-3 py-1.5 text-sm",
                !enabled && "opacity-40",
              )}>
                <span class={cn("w-1.5 h-1.5 rounded-full", enabled ? "bg-success" : "bg-muted-foreground/50")} />
                <span class="font-medium flex-1 truncate">{flow.name}</span>
                <span class="text-[10px] mono text-info">{trigger}</span>
                {runs > 0 && <span class="text-[10px] text-muted-foreground">{runs} runs</span>}
                <button
                  onClick={() => api.toggleFlow(flow.name, !enabled)}
                  class={cn(
                    "text-[10px] mono px-1.5 py-0.5 rounded transition-colors",
                    enabled ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
                  )}
                >
                  {enabled ? "on" : "off"}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Sessions + Errors */}
      {d && (
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-card rounded-lg border border-border p-4">
            <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-2">Sessions</h3>
            <div class="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span class="text-muted-foreground">Started:</span>
                <span class="ml-1 font-medium">{d.sessions.started}</span>
              </div>
              <div>
                <span class="text-muted-foreground">Ended:</span>
                <span class="ml-1 font-medium">{d.sessions.ended}</span>
              </div>
              <div>
                <span class="text-muted-foreground">Crashed:</span>
                <span class={cn("ml-1 font-medium", d.sessions.crashed > 0 ? "text-destructive" : "")}>
                  {d.sessions.crashed}
                </span>
              </div>
              <div>
                <span class="text-muted-foreground">Avg:</span>
                <span class="ml-1 font-medium">{Math.round(d.sessions.avgDurationS / 60)}m</span>
              </div>
            </div>
          </div>
          <div class="bg-card rounded-lg border border-border p-4">
            <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-2">Errors</h3>
            {d.errors.total > 0 ? (
              <div class="space-y-1">
                {Object.entries(d.errors.byType).map(([type, count]) => (
                  <div key={type} class="flex items-center justify-between text-sm">
                    <span class="text-muted-foreground truncate">{type}</span>
                    <span class="text-destructive mono">{count as number}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div class="text-sm text-success">No errors</div>
            )}
          </div>
        </div>
      )}

      {/* Context sources */}
      <div class="bg-card rounded-lg border border-border p-4">
        <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-3">Context Sources</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(sources).map(([name, connected]) => (
            <div key={name} class="flex items-center gap-2">
              <span class={cn("w-1.5 h-1.5 rounded-full", connected ? "bg-success" : "bg-destructive")} />
              <span class="text-sm capitalize">{name}</span>
              <span class="text-[10px] text-muted-foreground">{connected ? "ok" : "down"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tracked Projects */}
      {projects.data && projects.data.length > 0 && (
        <div class="bg-card rounded-lg border border-border p-4">
          <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-3">
            Tracked Projects ({projects.data.length})
          </h3>
          <div class="space-y-2">
            {projects.data.map(proj => (
              <div key={proj.name} class="flex items-center gap-3 text-sm">
                <StatusDot status={proj.status === "OK" ? "ok" : "error"} />
                <span class="font-medium">{proj.name}</span>
                <span class="text-[10px] mono text-muted-foreground">:{proj.port}</span>
                {proj.status === "OK" && (
                  <a
                    href={`http://localhost:${proj.port}/dashboard/`}
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
    </div>
  )
}
