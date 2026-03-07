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

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Flows</h1>
        <span class="text-sm text-muted-foreground">{flowDefs.length} defined</span>
      </div>

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
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          {flowDefs.map((flow) => (
            <FlowCard key={flow.name} flow={flow} />
          ))}
        </div>
      )}

      {execs.length > 0 && (
        <section>
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Executions ({execs.length})
          </h2>
          <div class="bg-card rounded-lg border border-border overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-border text-xs text-muted-foreground">
                  <th class="text-left py-2 px-3 font-medium">Flow</th>
                  <th class="text-left py-2 px-3 font-medium">Status</th>
                  <th class="text-left py-2 px-3 font-medium hidden md:table-cell">Trigger</th>
                  <th class="text-right py-2 px-3 font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {execs.slice(0, 25).map((exec, i) => {
                  const sc =
                    exec.status === "completed" ? "text-success"
                      : exec.status === "running" ? "text-info animate-pulse-dot"
                      : exec.status === "failed" ? "text-destructive"
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

function FlowCard({ flow }: { flow: FlowDef }) {
  const trigger = typeof flow.trigger === "string"
    ? flow.trigger
    : (flow.trigger as Record<string, string>)?.pattern || "unknown"
  const enabled = (flow as Record<string, unknown>).enabled !== false
  const actions = (flow as Record<string, unknown>).actions as { type: string }[] | undefined
  const gate = (flow as Record<string, unknown>).gate as { requires_approval?: boolean } | undefined

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
          {gate?.requires_approval && (
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
      <div class="text-xs mono text-info mb-1">{trigger}</div>
      {flow.description && (
        <div class="text-xs text-muted-foreground">{flow.description}</div>
      )}
      {actions && actions.length > 0 && (
        <div class="flex flex-wrap gap-1 mt-2 pt-2 border-t border-border">
          {actions.map((a, i) => (
            <span key={i} class="text-[10px] mono bg-muted px-1.5 py-0.5 rounded">
              {a.type}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
