import { WorkspaceStatus, api, HubEvent, DiscoveredService, ProjectHealth, ContextItem } from "@/api"
import { MetricCard, EventFeed, StatusDot, Sparkline, ActivityChart } from "@/components"
import { usePolling, timeAgo } from "@/lib/hooks"

interface OverviewProps {
  status: WorkspaceStatus | null
}

export function OverviewPage({ status }: OverviewProps) {
  const events = usePolling(() => api.events(200), 5000)
  const leaderboard = usePolling(() => api.leaderboard(), 15000)
  const services = usePolling(() => api.services(), 15000)
  const projects = usePolling(() => api.projects(), 15000)
  const journal = usePolling(() => api.journal(), 15000)

  const mode = status?.type || "standalone"
  const config = status?.config
  const children = status?.children || []
  const eventList = events.data?.events || []
  const agents = leaderboard.data || []
  const discoveredServices = services.data || {}
  const projectList = projects.data || []
  const journalItems = journal.data || []

  const healthyChildren = children.filter((c) => c.status === "ok").length
  const topAgent = agents.length > 0 ? agents[0] : null
  const serviceCount = Object.keys(discoveredServices).length
  const projectsUp = projectList.filter((p) => p.status === "OK").length

  return (
    <div class="space-y-6">
      <div>
        <h1 class="text-xl font-semibold">{config?.name || "Dashboard"}</h1>
        {config?.description && (
          <p class="text-sm text-muted-foreground mt-1">{config.description}</p>
        )}
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {mode === "portfolio" && (
          <MetricCard
            label="Products"
            value={children.length}
            sub={`${healthyChildren}/${children.length} healthy`}
            trend={healthyChildren === children.length ? "up" : "down"}
          />
        )}
        <MetricCard
          label="Services"
          value={serviceCount}
          sub={serviceCount > 0 ? "discovered" : "none"}
        />
        <MetricCard
          label="Agents"
          value={agents.length}
          sub={topAgent ? `Top: ${topAgent.agent}` : undefined}
        />
        {topAgent && topAgent.composite != null && (
          <MetricCard
            label="Best Score"
            value={topAgent.composite.toFixed(4)}
            sub={
              topAgent.delta != null
                ? `${topAgent.delta >= 0 ? "+" : ""}${topAgent.delta.toFixed(4)}`
                : undefined
            }
            trend={
              topAgent.delta != null
                ? topAgent.delta > 0 ? "up" : topAgent.delta < 0 ? "down" : "neutral"
                : undefined
            }
          />
        )}
        {projectList.length > 0 && (
          <MetricCard
            label="Projects"
            value={`${projectsUp}/${projectList.length}`}
            sub="hubs running"
            trend={projectsUp === projectList.length ? "up" : "down"}
          />
        )}
      </div>

      <ActivityChart events={eventList} journalItems={journalItems} />

      {mode === "portfolio" && children.length > 0 && (
        <section>
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Product Hubs
          </h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            {children.map((child) => (
              <div key={child.name} class="bg-card rounded-lg border border-border p-4 animate-fade-in">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-2">
                    <StatusDot status={child.status} />
                    <span class="font-medium text-sm">{child.name}</span>
                  </div>
                  <span class="text-xs mono text-muted-foreground">:{child.port}</span>
                </div>
                <ChildServices parentName={child.name} allServices={discoveredServices} />
              </div>
            ))}
          </div>
        </section>
      )}

      {serviceCount > 0 && mode !== "portfolio" && (
        <section>
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Services
          </h2>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.values(discoveredServices).map((svc) => (
              <div key={svc.name} class="bg-card rounded-lg border border-border p-4 animate-fade-in">
                <div class="flex items-center justify-between mb-1">
                  <div class="flex items-center gap-2">
                    <StatusDot status={svc.status === "active" ? "ok" : "idle"} />
                    <span class="font-medium text-sm">{svc.name}</span>
                  </div>
                  {svc.type && (
                    <span class="text-[10px] mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded uppercase">
                      {svc.type}
                    </span>
                  )}
                </div>
                {svc.description && (
                  <p class="text-xs text-muted-foreground mt-1">{svc.description}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {agents.length > 0 && (
        <section>
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Leaderboard
          </h2>
          <div class="bg-card rounded-lg border border-border overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-border text-xs text-muted-foreground">
                  <th class="text-left py-2 px-3 font-medium">#</th>
                  <th class="text-left py-2 px-3 font-medium">Agent</th>
                  <th class="text-right py-2 px-3 font-medium">Score</th>
                  <th class="text-right py-2 px-3 font-medium">Delta</th>
                  <th class="text-right py-2 px-3 font-medium">Trend</th>
                  <th class="text-right py-2 px-3 font-medium">Model</th>
                </tr>
              </thead>
              <tbody>
                {agents.slice(0, 8).map((agent, i) => {
                  const delta = agent.delta
                  const deltaColor = delta != null
                    ? delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground"
                    : "text-muted-foreground"
                  return (
                    <tr key={agent.agent} class="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td class="py-2 px-3 mono text-muted-foreground">{i + 1}</td>
                      <td class="py-2 px-3 font-medium">{agent.agent}</td>
                      <td class="py-2 px-3 mono text-right">
                        {agent.composite != null ? agent.composite.toFixed(4) : "—"}
                      </td>
                      <td class={`py-2 px-3 mono text-right ${deltaColor}`}>
                        {delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(4)}` : "—"}
                      </td>
                      <td class="py-2 px-3 text-right">
                        {agent.trajectory.length > 1 && (
                          <Sparkline
                            data={agent.trajectory}
                            width={80}
                            height={20}
                            color={
                              delta != null && delta > 0
                                ? "var(--success)"
                                : delta != null && delta < 0
                                  ? "var(--destructive)"
                                  : "var(--info)"
                            }
                          />
                        )}
                      </td>
                      <td class="py-2 px-3 mono text-right text-xs text-muted-foreground">
                        {agent.model_version || "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {projectList.length > 0 && (
        <section>
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            All Hubs
          </h2>
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {projectList.map((proj) => (
              <div key={proj.name} class="bg-card rounded-lg border border-border px-3 py-2 animate-fade-in">
                <div class="flex items-center gap-1.5">
                  <StatusDot status={proj.status === "OK" ? "ok" : "down"} pulse={proj.status === "OK"} />
                  <span class="text-xs font-medium truncate">{proj.name}</span>
                  <span class="text-[10px] mono text-muted-foreground ml-auto">:{proj.port}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Recent Activity
        </h2>
        <div class="bg-card rounded-lg border border-border">
          {events.loading ? (
            <div class="p-4 text-sm text-muted-foreground">Loading events...</div>
          ) : (
            <EventFeed events={eventList} maxItems={20} />
          )}
        </div>
      </section>
    </div>
  )
}

function ChildServices({
  parentName,
  allServices,
}: {
  parentName: string
  allServices: Record<string, DiscoveredService>
}) {
  const childServices = Object.values(allServices).filter(
    (svc) => svc.name.startsWith(parentName.replace("-gtm", ""))
  )

  if (childServices.length === 0) {
    return <div class="text-xs text-muted-foreground">No services discovered</div>
  }

  return (
    <div class="flex flex-wrap gap-1.5 mt-1">
      {childServices.map((svc) => (
        <span
          key={svc.name}
          class="inline-flex items-center gap-1 text-[10px] mono bg-muted px-1.5 py-0.5 rounded"
        >
          <StatusDot status={svc.status === "active" ? "ok" : "idle"} pulse={false} />
          {svc.name.replace(`${parentName.replace("-gtm", "")}-`, "")}
        </span>
      ))}
    </div>
  )
}
