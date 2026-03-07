import { api, WorkspaceStatus } from "@/api"
import { StatusDot, MetricCard } from "@/components"
import { usePolling, cn } from "@/lib/hooks"

interface HealthPageProps {
  status: WorkspaceStatus | null
}

export function HealthPage({ status }: HealthPageProps) {
  const projects = usePolling(() => api.projects(), 15000)
  const memory = usePolling(() => api.memoryStatus(), 30000)

  const sources = status?.sources || {}
  const sourcesOk = Object.values(sources).filter(Boolean).length
  const sourcesTotal = Object.keys(sources).length
  const mem = memory.data

  return (
    <div class="space-y-6">
      <h1 class="text-xl font-semibold">System Health</h1>

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

      <section>
        <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Context Sources
        </h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(sources).map(([name, connected]) => (
            <div key={name} class="bg-card rounded-lg border border-border p-3 animate-fade-in">
              <div class="flex items-center gap-2">
                <span class={cn(
                  "w-[6px] h-[6px] rounded-full",
                  connected ? "bg-success" : "bg-destructive",
                )} />
                <span class="text-sm font-medium capitalize">{name}</span>
              </div>
              <div class="text-[10px] text-muted-foreground mt-1">
                {connected ? "connected" : "disconnected"}
              </div>
            </div>
          ))}
        </div>
      </section>

      {mem && Object.keys(mem.by_type || {}).length > 0 && (
        <section>
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Memory Index
          </h2>
          <div class="bg-card rounded-lg border border-border p-4">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(mem.by_type).map(([type, count]) => (
                <div key={type}>
                  <div class="text-[10px] text-muted-foreground uppercase">{type}</div>
                  <div class="text-lg font-semibold mono">{count as number}</div>
                </div>
              ))}
            </div>
            <div class="mt-3 pt-3 border-t border-border flex items-center gap-4 text-xs text-muted-foreground">
              {mem.embeddings && (
                <span>
                  Embeddings: {mem.embeddings.count} / {mem.total_memories}
                </span>
              )}
              {mem.date_range?.earliest && (
                <span>
                  Range: {new Date(mem.date_range.earliest).toLocaleDateString()} - {new Date(mem.date_range.latest).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {projects.data && projects.data.length > 0 && (
        <section>
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Tracked Projects ({projects.data.length})
          </h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            {projects.data.map((proj) => (
              <div key={proj.name} class="bg-card rounded-lg border border-border p-4 animate-fade-in">
                <div class="flex items-center justify-between mb-1">
                  <div class="flex items-center gap-2">
                    <StatusDot status={proj.status === "OK" ? "ok" : proj.status === "error" ? "error" : "idle"} />
                    <span class="font-medium text-sm">{proj.name}</span>
                  </div>
                  <span class="text-xs mono text-muted-foreground">:{proj.port}</span>
                </div>
                <div class="text-xs text-muted-foreground mono truncate">{proj.path}</div>
                {proj.pid && (
                  <div class="text-[10px] text-muted-foreground mt-1">PID {proj.pid}</div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
