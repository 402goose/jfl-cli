import { WorkspaceStatus, api, HubEvent, DiscoveredService, ContextItem, EvalAgent, SynopsisData } from "@/api"
import { MetricCard, StatusDot, Sparkline, ActivityChart } from "@/components"
import { usePolling, timeAgo, cn } from "@/lib/hooks"
import { useState } from "preact/hooks"

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
  const synopsis = usePolling(() => api.synopsis(24), 30000)

  const mode = status?.type || "standalone"
  const config = status?.config
  const children = status?.children || []
  const eventList = events.data?.events || []
  const agents = leaderboard.data || []
  const discoveredServices = services.data || {}
  const journalItems = journal.data || []

  const healthyChildren = children.filter((c) => c.status === "ok").length
  const registeredCount = config?.registered_services?.length || 0
  const discoveredCount = Object.keys(discoveredServices).length
  const serviceCount = Math.max(registeredCount, discoveredCount)
  const openclawCount = config?.openclaw_agents?.length || 0
  const agentGroups = groupAgentsByProduct(agents)

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
          sub={`${registeredCount} registered`}
        />
        <MetricCard
          label="Agents"
          value={agents.length + openclawCount}
          sub={`${agents.length} eval · ${openclawCount} openclaw`}
        />
        <MetricCard
          label="Events"
          value={eventList.length}
          sub="recent"
        />
      </div>

      <ActivityChart events={eventList} journalItems={journalItems} />

      <LoopPipeline events={eventList} />

      {synopsis.data && <SynopsisSection data={synopsis.data} />}

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
          <RecentActivity events={eventList} journal={journalItems} />
        </div>
      </section>
    </div>
  )
}

function QuickActions() {
  const [feedback, setFeedback] = useState<string | null>(null)

  const actions: { label: string; event?: string; data?: Record<string, unknown>; spawn?: boolean; command?: string; args?: string[] }[] = [
    { label: "run eval", event: "eval:run-requested", data: { source: "dashboard" } },
    { label: "health check", event: "custom", data: { title: "Manual health check", source: "dashboard" } },
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
      <span class="text-xs text-muted-foreground">Actions:</span>
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

interface ActivityItem {
  kind: "event" | "journal"
  ts: string
  type: string
  label: string
  detail?: string
  source?: string
}

const eventTypeColors: Record<string, string> = {
  "eval:scored": "text-info",
  "flow:triggered": "text-warning",
  "journal:entry": "text-success",
  "onboard": "text-purple-400",
  "error": "text-destructive",
}

function RecentActivity({ events, journal }: { events: HubEvent[]; journal: ContextItem[] }) {
  const items: ActivityItem[] = []

  const nonSessionEvents = events.filter((e) => !e.type.startsWith("session:"))
  for (const ev of nonSessionEvents.slice(0, 30)) {
    const d = ev.data || {}
    items.push({
      kind: "event",
      ts: ev.ts,
      type: ev.type,
      label: (d.title || d.message || d.agent || d.service || ev.source || ev.type) as string,
      detail: d.composite != null
        ? `score: ${Number(d.composite).toFixed(4)}`
        : d.description as string || undefined,
      source: ev.source,
    })
  }

  for (const j of journal.slice(0, 20)) {
    items.push({
      kind: "journal",
      ts: j.timestamp || j.ts,
      type: j.type || "entry",
      label: j.title,
      detail: j.summary || j.content?.slice(0, 100),
      source: j.source,
    })
  }

  items.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
  const shown = items.slice(0, 25)

  if (!shown.length) {
    return <div class="text-sm text-muted-foreground py-8 text-center">No activity yet</div>
  }

  return (
    <div class="space-y-0.5">
      {shown.map((item, i) => (
        <div
          key={i}
          class="flex items-start gap-3 py-2 px-3 rounded hover:bg-muted/30 transition-colors text-sm"
        >
          <span class="text-[10px] text-muted-foreground mono whitespace-nowrap mt-0.5 min-w-[4rem]">
            {timeAgo(item.ts)}
          </span>
          {item.kind === "journal" ? (
            <span class="w-1.5 h-1.5 rounded-full bg-success mt-1.5 shrink-0" />
          ) : (
            <span class="w-1.5 h-1.5 rounded-full bg-info mt-1.5 shrink-0" />
          )}
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class={cn(
                "text-xs mono font-medium whitespace-nowrap",
                eventTypeColors[item.type] || (item.kind === "journal" ? "text-success" : "text-foreground"),
              )}>
                {item.type}
              </span>
              <span class="text-xs text-foreground truncate">{item.label}</span>
            </div>
            {item.detail && (
              <div class="text-[10px] text-muted-foreground mt-0.5 truncate">{item.detail}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

interface LoopCycle {
  pr: string
  branch?: string
  agent: string
  stages: { stage: string; status: "done" | "active" | "pending"; ts?: string; detail?: string }[]
}

function extractLoopCycles(events: HubEvent[]): LoopCycle[] {
  const evalEvents = events.filter((e) => e.type === "eval:scored")
  const flowEvents = events.filter((e) => e.type === "flow:completed" || e.type === "flow:triggered")

  if (evalEvents.length === 0) return []

  const evalById = new Map<string, HubEvent>()
  for (const ev of evalEvents) evalById.set(ev.id, ev)

  const flowsByTrigger = new Map<string, HubEvent[]>()
  for (const fev of flowEvents) {
    const tid = fev.data?.trigger_event_id as string
    if (!tid) continue
    if (!flowsByTrigger.has(tid)) flowsByTrigger.set(tid, [])
    flowsByTrigger.get(tid)!.push(fev)
  }

  const cycles: LoopCycle[] = []

  for (const ev of evalEvents) {
    const d = ev.data || {}
    const prId = (d.pr_number || d.pr) as string | undefined
    const agent = (d.agent as string) || "peter-parker"
    const branch = d.branch as string | undefined
    const score = d.composite != null ? Number(d.composite).toFixed(4) : "?"
    const delta = d.delta != null ? Number(d.delta) : null
    const improved = d.improved as boolean | undefined

    const relatedFlows = flowsByTrigger.get(ev.id) || []
    const flowNames = relatedFlows.map((f) => (f.data?.flow_name as string) || f.source || "")
    const hasMerge = flowNames.some((n) => n.includes("auto-merge"))
    const hasFlag = flowNames.some((n) => n.includes("flag-regression") || n.includes("regression"))
    const hasTraining = flowNames.some((n) => n.includes("training"))

    const stages: LoopCycle["stages"] = [
      { stage: "PR Created", status: "done", ts: ev.ts },
      { stage: "Eval", status: "done", detail: `${score} (${delta != null ? (delta >= 0 ? "+" : "") + delta.toFixed(4) : "?"})` },
    ]

    if (improved === true || (delta != null && delta > 0)) {
      if (hasMerge) {
        stages.push({ stage: "Auto-Merged", status: "done", detail: "improved" })
      } else {
        stages.push({ stage: "Merge", status: "active", detail: "pending" })
      }
    } else if (improved === false || (delta != null && delta < 0)) {
      if (hasFlag) {
        stages.push({ stage: "Flagged", status: "done", detail: "regression" })
      } else {
        stages.push({ stage: "Review", status: "active", detail: "regressed" })
      }
    }

    if (hasTraining) {
      stages.push({ stage: "Training Tuple", status: "done" })
    }

    cycles.push({
      pr: prId ? `#${prId}` : `eval`,
      branch,
      agent,
      stages,
    })
  }

  return cycles.slice(0, 5)
}

function stageStyle(stage: string, status: string): string {
  if (stage === "Flagged") return "bg-destructive/15 text-destructive border-destructive/30"
  if (stage === "Auto-Merged") return "bg-success/15 text-success border-success/30"
  if (stage === "Training Tuple") return "bg-purple-500/15 text-purple-400 border-purple-500/30"
  if (stage === "Eval" && status === "done") return "bg-info/15 text-info border-info/30"
  if (status === "active") return "bg-warning/15 text-warning border-warning/30 animate-pulse-dot"
  if (status === "done") return "bg-success/15 text-success border-success/30"
  return "bg-muted text-muted-foreground border-border"
}

function LoopPipeline({ events }: { events: HubEvent[] }) {
  const cycles = extractLoopCycles(events)
  if (cycles.length === 0) return null

  const improved = cycles.filter(c => c.stages.some(s => s.stage === "Auto-Merged")).length
  const flagged = cycles.filter(c => c.stages.some(s => s.stage === "Flagged")).length

  return (
    <section>
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Self-Driving Loop
        </h2>
        <div class="flex items-center gap-3 text-[10px] mono">
          {improved > 0 && <span class="text-success">{improved} merged</span>}
          {flagged > 0 && <span class="text-destructive">{flagged} flagged</span>}
          <span class="text-muted-foreground">{cycles.length} PRs</span>
        </div>
      </div>
      <div class="space-y-2">
        {cycles.map((cycle, ci) => {
          const isFlagged = cycle.stages.some(s => s.stage === "Flagged")
          return (
            <div key={ci} class={cn(
              "bg-card rounded-lg border p-3 animate-fade-in",
              isFlagged ? "border-destructive/20" : "border-border",
            )}>
              <div class="flex items-center gap-2 mb-2.5">
                <span class={cn(
                  "text-xs font-semibold mono",
                  isFlagged ? "text-destructive" : "text-foreground",
                )}>{cycle.pr}</span>
                {cycle.branch && (
                  <span class="text-[10px] mono text-muted-foreground/70 truncate max-w-56">{cycle.branch}</span>
                )}
                <span class="text-[10px] mono text-muted-foreground ml-auto">{cycle.agent}</span>
              </div>
              <div class="flex items-center gap-1.5">
                {cycle.stages.map((stage, si) => (
                  <div key={si} class="flex items-center gap-1.5">
                    {si > 0 && (
                      <svg width="16" height="8" viewBox="0 0 16 8" class="shrink-0 text-muted-foreground/30">
                        <path d="M0 4h12M10 1l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.5" />
                      </svg>
                    )}
                    <div class={cn(
                      "text-[10px] mono px-2.5 py-1.5 rounded-md border",
                      stageStyle(stage.stage, stage.status),
                    )}>
                      <div class="font-medium">{stage.stage}</div>
                      {stage.detail && (
                        <div class="text-[9px] opacity-60 mt-0.5">{stage.detail}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function SynopsisSection({ data }: { data: SynopsisData }) {
  const s = data.summary
  const hasContent = s.features + s.fixes + s.decisions + s.discoveries > 0 || data.commits.length > 0

  if (!hasContent) return null

  return (
    <section>
      <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
        Work Summary <span class="text-[10px] font-normal">last {data.hours}h</span>
      </h2>
      <div class="bg-card rounded-lg border border-border p-4">
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
            <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Recent Commits</div>
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
    </section>
  )
}
