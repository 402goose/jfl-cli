import { api, FlowDef, FlowExecution } from "@/api"
import { usePolling, timeAgo, cn } from "@/lib/hooks"

export function FlowsPage() {
  const flows = usePolling(() => api.flows(), 10000)
  const executions = usePolling(() => api.flowExecutions(), 10000)

  const flowDefs: FlowDef[] = flows.data || []
  const rawExecs = executions.data
  const execs: FlowExecution[] = Array.isArray(rawExecs)
    ? rawExecs
    : (rawExecs as Record<string, unknown>)?.executions as FlowExecution[] || []

  const pendingApprovals = execs.filter((e) => e.status === "pending_approval")

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Flows</h1>
        <span class="text-sm text-muted-foreground">{flowDefs.length} defined</span>
      </div>

      {pendingApprovals.length > 0 && (
        <section>
          <h2 class="text-sm font-medium text-warning uppercase tracking-wider mb-3">
            Pending Approval ({pendingApprovals.length})
          </h2>
          <div class="space-y-2">
            {pendingApprovals.map((exec, i) => (
              <PendingApprovalCard key={i} exec={exec} />
            ))}
          </div>
        </section>
      )}

      {flows.loading ? (
        <div class="text-sm text-muted-foreground animate-pulse-dot">Loading flows...</div>
      ) : flowDefs.length === 0 ? (
        <div class="bg-card rounded-lg border border-border p-8 text-center">
          <div class="text-muted-foreground text-sm">No flows configured</div>
          <div class="text-muted-foreground text-xs mt-1 mono">
            jfl flows add
          </div>
        </div>
      ) : (
        <section>
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Flow Definitions
          </h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            {flowDefs.map((flow) => (
              <FlowCard key={flow.name} flow={flow} execCount={execs.filter((e) => e.flow === flow.name).length} />
            ))}
          </div>
        </section>
      )}

      {execs.length > 0 && (
        <section>
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Execution History ({execs.length})
          </h2>
          <div class="bg-card rounded-lg border border-border overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-border text-xs text-muted-foreground">
                  <th class="text-left py-2 px-3 font-medium">Flow</th>
                  <th class="text-left py-2 px-3 font-medium">Status</th>
                  <th class="text-left py-2 px-3 font-medium hidden md:table-cell">Trigger</th>
                  <th class="text-right py-2 px-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {execs.slice(0, 25).map((exec, i) => {
                  const sc =
                    exec.status === "completed" ? "text-success"
                      : exec.status === "running" ? "text-info animate-pulse-dot"
                      : exec.status === "failed" ? "text-destructive"
                      : exec.status === "pending_approval" ? "text-warning"
                      : "text-muted-foreground"
                  return (
                    <tr key={i} class="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td class="py-2 px-3 font-medium">{exec.flow}</td>
                      <td class={`py-2 px-3 mono text-xs ${sc}`}>{exec.status}</td>
                      <td class="py-2 px-3 mono text-xs text-muted-foreground hidden md:table-cell truncate max-w-48">
                        {exec.trigger_event_id}
                      </td>
                      <td class="py-2 px-3 mono text-xs text-muted-foreground text-right">
                        {timeAgo(exec.started_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function FlowCard({ flow, execCount }: { flow: FlowDef; execCount: number }) {
  const trigger = typeof flow.trigger === "string"
    ? flow.trigger
    : flow.trigger?.pattern || "unknown"
  const triggerSource = typeof flow.trigger === "object" ? flow.trigger?.source : undefined
  const enabled = flow.enabled !== false
  const gated = flow.gate?.requires_approval

  return (
    <div class={cn(
      "bg-card rounded-lg border border-border p-4 animate-fade-in",
      !enabled && "opacity-50",
    )}>
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <span class={cn(
            "w-[6px] h-[6px] rounded-full",
            enabled ? "bg-success" : "bg-muted-foreground/50",
          )} />
          <span class="font-medium text-sm">{flow.name}</span>
        </div>
        <div class="flex items-center gap-1.5">
          {gated && (
            <span class="text-[10px] mono px-1.5 py-0.5 rounded bg-warning/10 text-warning uppercase">
              gated
            </span>
          )}
          <span class={cn(
            "text-[10px] mono px-1.5 py-0.5 rounded uppercase",
            enabled ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
          )}>
            {enabled ? "on" : "off"}
          </span>
        </div>
      </div>

      <div class="flex items-center gap-2 mb-1">
        <span class="text-xs mono text-info">{trigger}</span>
        {triggerSource && (
          <span class="text-[10px] mono text-muted-foreground">from {triggerSource}</span>
        )}
      </div>

      {flow.description && (
        <div class="text-xs text-muted-foreground mb-2">{flow.description}</div>
      )}

      <div class="flex items-center justify-between pt-2 border-t border-border">
        <div class="flex flex-wrap gap-1">
          {flow.actions.map((a, i) => (
            <span key={i} class="text-[10px] mono bg-muted px-1.5 py-0.5 rounded">
              {a.type}
            </span>
          ))}
        </div>
        {execCount > 0 && (
          <span class="text-[10px] text-muted-foreground">{execCount} runs</span>
        )}
      </div>
    </div>
  )
}

function PendingApprovalCard({ exec }: { exec: FlowExecution }) {
  const handleApprove = async () => {
    try {
      await api.approveFlow(exec.flow, exec.trigger_event_id)
    } catch (err) {
      console.error("Failed to approve:", err)
    }
  }

  return (
    <div class="bg-card rounded-lg border border-warning/30 p-4 animate-fade-in">
      <div class="flex items-center justify-between">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <span class="w-[6px] h-[6px] rounded-full bg-warning animate-pulse" />
            <span class="font-medium text-sm">{exec.flow}</span>
            <span class="text-[10px] mono text-warning uppercase">needs approval</span>
          </div>
          <div class="text-xs mono text-muted-foreground">
            trigger: {exec.trigger_event_id} — {timeAgo(exec.started_at)}
          </div>
        </div>
        <button
          onClick={handleApprove}
          class="px-3 py-1.5 text-xs font-medium rounded bg-success/15 text-success hover:bg-success/25 transition-colors"
        >
          Approve
        </button>
      </div>
    </div>
  )
}
