import { WorkspaceStatus, api, HubEvent, DiscoveredService, ContextItem, EvalAgent } from "@/api"
import { MetricCard, EventFeed, StatusDot, Sparkline, ActivityChart } from "@/components"
import { usePolling } from "@/lib/hooks"

interface OverviewProps {
  status: WorkspaceStatus | null
}

function groupAgentsByProduct(agents: EvalAgent[]): Record<string, EvalAgent[]> {
  const groups: Record<string, EvalAgent[]> = {}
  for (const agent of agents) {
    const metricKeys = Object.keys(agent.metrics).filter((k) => k !== "composite")
    let product = "other"
    if (metricKeys.some((k) => ["ndcg@10", "mrr", "precision@5"].includes(k))) {
      product = "productrank"
    } else if (metricKeys.some((k) => ["avg_rank", "keywords_ranked", "rank_rate"].includes(k))) {
      product = "seo"
    }
    if (!groups[product]) groups[product] = []
    groups[product].push(agent)
  }
  return groups
}

export function OverviewPage({ status }: OverviewProps) {
  const events = usePolling(() => api.events(200), 5000)
  const leaderboard = usePolling(() => api.leaderboard(), 15000)
  const services = usePolling(() => api.services(), 15000)
  const journal = usePolling(() => api.journal(), 15000)

  const mode = status?.type || "standalone"
  const config = status?.config
  const children = status?.children || []
  const eventList = events.data?.events || []
  const agents = leaderboard.data || []
  const discoveredServices = services.data || {}
  const journalItems = journal.data || []

  const healthyChildren = children.filter((c) => c.status === "ok").length
  const serviceCount = Object.keys(discoveredServices).length
  const agentGroups = groupAgentsByProduct(agents)

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
          sub={serviceCount > 0 ? "registered" : "none"}
        />
        <MetricCard
          label="Events"
          value={eventList.length}
          sub="recent"
        />
        <MetricCard
          label="Journal"
          value={journalItems.length}
          sub="entries"
        />
      </div>

      <ActivityChart events={eventList} journalItems={journalItems} />

      {mode === "portfolio" && children.length > 0 && (
        <section>
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Products
          </h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            {children.map((child) => {
              const childServices = Object.values(discoveredServices).filter((svc) =>
                svc.name.startsWith(child.name.replace("-gtm", ""))
              )
              const childAgents = agents.filter((a) =>
                a.agent.startsWith(child.name.replace("-gtm", ""))
              )
              const topAgent = childAgents.length > 0
                ? childAgents.reduce((best, a) =>
                    (a.composite || 0) > (best.composite || 0) ? a : best
                  )
                : null

              return (
                <div key={child.name} class="bg-card rounded-lg border border-border p-4 animate-fade-in">
                  <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2">
                      <StatusDot status={child.status} />
                      <span class="font-medium">{child.name}</span>
                    </div>
                    <span class="text-xs mono text-muted-foreground">:{child.port}</span>
                  </div>

                  <div class="grid grid-cols-3 gap-3 mt-3">
                    <div>
                      <div class="text-[10px] text-muted-foreground uppercase">Services</div>
                      <div class="text-lg font-semibold mono">{childServices.length}</div>
                    </div>
                    <div>
                      <div class="text-[10px] text-muted-foreground uppercase">Agents</div>
                      <div class="text-lg font-semibold mono">{childAgents.length}</div>
                    </div>
                    <div>
                      <div class="text-[10px] text-muted-foreground uppercase">Top Score</div>
                      <div class="text-lg font-semibold mono">
                        {topAgent?.composite != null ? topAgent.composite.toFixed(2) : "—"}
                      </div>
                    </div>
                  </div>

                  {childServices.length > 0 && (
                    <div class="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border">
                      {childServices.map((svc) => (
                        <span key={svc.name} class="inline-flex items-center gap-1 text-[10px] mono bg-muted px-1.5 py-0.5 rounded">
                          <StatusDot status={svc.status === "active" ? "ok" : "idle"} pulse={false} />
                          {svc.name.replace(`${child.name.replace("-gtm", "")}-`, "")}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {Object.keys(agentGroups).length > 0 && (
        <section>
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Eval Leaderboards
          </h2>
          <div class="space-y-4">
            {Object.entries(agentGroups).map(([product, groupAgents]) => (
              <LeaderboardTable
                key={product}
                title={product === "productrank" ? "ProductRank" : product === "seo" ? "SEO" : "Other"}
                agents={groupAgents}
              />
            ))}
          </div>
        </section>
      )}

      {mode !== "portfolio" && serviceCount > 0 && (
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

function LeaderboardTable({ title, agents }: { title: string; agents: EvalAgent[] }) {
  const sorted = [...agents].sort((a, b) => (b.composite || 0) - (a.composite || 0))
  const metricKeys = new Set<string>()
  for (const a of sorted) {
    for (const k of Object.keys(a.metrics)) {
      if (k !== "composite") metricKeys.add(k)
    }
  }
  const metrics = [...metricKeys].slice(0, 4)

  return (
    <div class="bg-card rounded-lg border border-border overflow-hidden">
      <div class="px-3 py-2 border-b border-border bg-muted/30">
        <span class="text-xs font-medium uppercase tracking-wider">{title}</span>
        <span class="text-[10px] text-muted-foreground ml-2">{sorted.length} agents</span>
      </div>
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-border text-xs text-muted-foreground">
            <th class="text-left py-2 px-3 font-medium w-8">#</th>
            <th class="text-left py-2 px-3 font-medium">Agent</th>
            <th class="text-right py-2 px-3 font-medium">Score</th>
            {metrics.map((m) => (
              <th key={m} class="text-right py-2 px-3 font-medium hidden lg:table-cell">{m}</th>
            ))}
            <th class="text-right py-2 px-3 font-medium w-20">Trend</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((agent, i) => {
            const delta = agent.delta
            const deltaColor = delta != null
              ? delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground"
              : "text-muted-foreground"
            return (
              <tr key={agent.agent} class="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td class="py-2 px-3 mono text-muted-foreground">{i + 1}</td>
                <td class="py-2 px-3">
                  <div class="font-medium">{agent.agent}</div>
                  <div class="flex items-center gap-2">
                    {agent.model_version && (
                      <span class="text-[10px] mono text-muted-foreground">{agent.model_version}</span>
                    )}
                    {delta != null && (
                      <span class={`text-[10px] mono ${deltaColor}`}>
                        {delta >= 0 ? "+" : ""}{delta.toFixed(4)}
                      </span>
                    )}
                  </div>
                </td>
                <td class="py-2 px-3 mono text-right text-lg font-semibold">
                  {agent.composite != null ? agent.composite.toFixed(4) : "—"}
                </td>
                {metrics.map((m) => (
                  <td key={m} class="py-2 px-3 mono text-right text-muted-foreground hidden lg:table-cell">
                    {agent.metrics[m] != null ? agent.metrics[m].toFixed(4) : "—"}
                  </td>
                ))}
                <td class="py-2 px-3 text-right">
                  {agent.trajectory.length > 1 && (
                    <Sparkline
                      data={agent.trajectory}
                      width={80}
                      height={24}
                      color={
                        delta != null && delta > 0 ? "var(--success)"
                          : delta != null && delta < 0 ? "var(--destructive)"
                          : "var(--info)"
                      }
                    />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
