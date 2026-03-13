import { api, RLAgentConfig, RLSession } from "@/api"
import { usePolling, timeAgo, cn } from "@/lib/hooks"

export function ExperimentsPage() {
  const agentsResult = usePolling(() => api.rlAgents().then(r => r.agents), 15000)
  const sessionsResult = usePolling(() => api.rlSessions().then(r => r.sessions), 10000)
  const contextResult = usePolling(() => api.productContext(), 30000)

  const agents: RLAgentConfig[] = agentsResult.data || []
  const sessions: RLSession[] = sessionsResult.data || []
  const context = contextResult.data || { context: null, updatedAt: null }

  // Group sessions by agent
  const sessionsByAgent: Record<string, RLSession[]> = {}
  for (const s of sessions) {
    if (!sessionsByAgent[s.agent]) sessionsByAgent[s.agent] = []
    sessionsByAgent[s.agent].push(s)
  }

  // Summary stats
  const totalRounds = sessions.reduce((sum, s) => sum + s.rounds.length, 0)
  const totalKept = sessions.reduce((sum, s) => sum + s.rounds.filter(r => r.kept).length, 0)
  const activeAgents = agents.filter(a => (sessionsByAgent[a.name] || []).length > 0).length

  return (
    <div class="space-y-6">
      {/* Header */}
      <div>
        <h1 class="text-xl font-semibold">Autoresearch</h1>
        <p class="text-sm text-muted-foreground mt-1">
          Scoped agents optimizing your services. Branches grow overnight, you review in the morning.
        </p>
      </div>

      {/* Summary Row */}
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Agents" value={agents.length} sub={`${activeAgents} active`} />
        <SummaryCard label="Sessions" value={sessions.length} sub="completed" />
        <SummaryCard label="Rounds" value={totalRounds} sub={`${totalKept} kept`} accent={totalKept > 0} />
        <SummaryCard label="Hit Rate" value={totalRounds > 0 ? `${Math.round(totalKept / totalRounds * 100)}%` : "—"} sub="improvements" accent={totalKept > 0} />
      </div>

      {/* Agent Cards */}
      <div>
        <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Agents</h2>
        <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map((agent: RLAgentConfig) => (
            <AgentCard
              key={agent.name}
              agent={agent}
              sessions={sessionsByAgent[agent.name] || []}
            />
          ))}
        </div>
      </div>

      {/* Product Context */}
      {context.context && (
        <ProductContextCard context={context.context} updatedAt={context.updatedAt} />
      )}

      {/* Session History */}
      {sessions.length > 0 && (
        <SessionTable sessions={sessions} />
      )}
    </div>
  )
}

/* ─── Sub-Components ─── */

function SummaryCard({ label, value, sub, accent }: { label: string; value: string | number; sub: string; accent?: boolean }) {
  return (
    <div class="card p-4">
      <div class="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
      <div class={cn("text-2xl font-bold tabular-nums", accent ? "text-green-400" : "")}>
        {value}
      </div>
      <div class="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </div>
  )
}

function AgentCard({ agent, sessions }: { agent: RLAgentConfig; sessions: RLSession[] }) {
  const allRounds = sessions.flatMap(s => s.rounds)
  const keptRounds = allRounds.filter(r => r.kept)
  const lastSession = sessions[sessions.length - 1]
  const lastRound = lastSession?.rounds[lastSession.rounds.length - 1]
  const bestDelta = keptRounds.length > 0
    ? Math.max(...keptRounds.map(r => Math.abs(r.delta)))
    : 0
  const hasImproved = keptRounds.length > 0
  const scopeCount = (agent.context_scope?.produces?.length || 0) + (agent.context_scope?.consumes?.length || 0)

  return (
    <div class={cn("card p-4 border-l-2", hasImproved ? "border-l-green-500" : "border-l-border")}>
      {/* Header */}
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-semibold">{agent.name}</h3>
        <span class={cn(
          "text-[10px] px-2 py-0.5 rounded font-mono",
          agent.direction === "minimize"
            ? "bg-green-500/10 text-green-400"
            : "bg-purple-500/10 text-purple-400"
        )}>
          {agent.direction === "minimize" ? "↓" : "↑"} {agent.metric}
        </span>
      </div>

      {/* Meta */}
      <div class="text-xs text-muted-foreground mb-3">
        {agent.target_repo ? `→ ${agent.target_repo}` : "self"} · {scopeCount} scope patterns
      </div>

      {/* Stats Grid */}
      <div class="grid grid-cols-3 gap-2 mb-3">
        <StatCell label="rounds" value={allRounds.length} />
        <StatCell label="kept" value={keptRounds.length} accent={hasImproved} />
        <StatCell label="best Δ" value={bestDelta > 0 ? bestDelta.toFixed(0) : "—"} accent={hasImproved} />
      </div>

      {/* Round History Bar */}
      {allRounds.length > 0 && (
        <div class="flex gap-px h-5 items-end mb-2">
          {allRounds.slice(-15).map((r, i) => (
            <div
              key={i}
              class={cn(
                "flex-1 min-w-1 rounded-sm transition-all",
                r.kept ? "bg-green-500/70 h-full" : "bg-red-500/50 h-2/5"
              )}
              title={`R${r.round}: ${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)} ${r.kept ? "KEPT" : "REVERTED"}`}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      {lastRound ? (
        <div class="text-[11px] text-muted-foreground border-t border-border pt-2 mt-1 tabular-nums">
          Last: {lastRound.metric.toFixed(1)} ({lastRound.delta > 0 ? "+" : ""}{lastRound.delta.toFixed(1)})
          <span class={lastRound.kept ? "text-green-400" : "text-red-400"}> {lastRound.kept ? "✓" : "✗"}</span>
          {lastRound.timestamp && <span class="ml-1">· {timeAgo(lastRound.timestamp)}</span>}
        </div>
      ) : (
        <div class="text-xs text-muted-foreground italic">No experiments yet</div>
      )}
    </div>
  )
}

function StatCell({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div class="text-center">
      <div class={cn("text-lg font-bold tabular-nums", accent ? "text-green-400" : "text-foreground")}>
        {value}
      </div>
      <div class="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}

function ProductContextCard({ context, updatedAt }: { context: string; updatedAt: string | null }) {
  // Parse the markdown into structured sections
  const cleaned = context.replace(/^# Product Context\n\n_Synthesized.*?\n\n/, "")
  const sections = cleaned.split(/^## /m).filter(Boolean).map(s => {
    const lines = s.split("\n")
    const title = lines[0].trim()
    const body = lines.slice(1).join("\n").trim()
    return { title, body }
  })

  return (
    <div class="card p-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider">Product Context</h2>
        {updatedAt && (
          <span class="text-[11px] text-muted-foreground">{timeAgo(updatedAt)}</span>
        )}
      </div>

      {sections.length > 0 ? (
        <div class="space-y-3">
          {sections.map((s, i) => (
            <div key={i}>
              <h3 class="text-xs font-semibold text-foreground mb-1">{s.title}</h3>
              <div class="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                {s.body.split("\n").map((line, j) => {
                  // Bold markers
                  const parsed = line.replace(/\*\*(.*?)\*\*/g, "$1")
                  if (line.startsWith("- ")) {
                    return <div key={j} class="ml-2">· {parsed.replace(/^- /, "")}</div>
                  }
                  return parsed ? <div key={j}>{parsed}</div> : null
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div class="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">
          {cleaned}
        </div>
      )}
    </div>
  )
}

function SessionTable({ sessions }: { sessions: RLSession[] }) {
  return (
    <div class="card p-4">
      <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Recent Sessions</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-border text-muted-foreground">
              <th class="text-left py-2 px-2 font-medium">Agent</th>
              <th class="text-center py-2 px-2 font-medium">Rounds</th>
              <th class="text-center py-2 px-2 font-medium">Kept</th>
              <th class="text-right py-2 px-2 font-medium">Best Δ</th>
              <th class="text-left py-2 px-2 font-medium">Results</th>
            </tr>
          </thead>
          <tbody>
            {sessions.slice(-10).reverse().map((s: RLSession) => {
              const kept = s.rounds.filter(r => r.kept)
              const best = kept.length > 0 ? Math.max(...kept.map(r => Math.abs(r.delta))) : 0
              return (
                <tr key={s.id} class="border-b border-border/50 hover:bg-muted/20">
                  <td class="py-2 px-2 font-medium">{s.agent}</td>
                  <td class="py-2 px-2 text-center text-muted-foreground tabular-nums">{s.rounds.length}</td>
                  <td class={cn("py-2 px-2 text-center tabular-nums", kept.length > 0 ? "text-green-400" : "text-muted-foreground")}>
                    {kept.length}
                  </td>
                  <td class={cn("py-2 px-2 text-right tabular-nums", best > 0 ? "text-green-400" : "text-muted-foreground")}>
                    {best > 0 ? best.toFixed(1) : "—"}
                  </td>
                  <td class="py-2 px-2">
                    <div class="flex gap-1">
                      {s.rounds.map((r, i) => (
                        <span
                          key={i}
                          class={cn(
                            "inline-block w-2 h-2 rounded-full",
                            r.kept ? "bg-green-500" : "bg-red-500"
                          )}
                          title={`R${r.round}: ${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)}`}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
