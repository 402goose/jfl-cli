import { api, EvalAgent, TrajectoryPoint, PredictionRecord, PredictionAccuracyStats } from "@/api"
import { Sparkline } from "@/components"
import { usePolling, cn, timeAgo } from "@/lib/hooks"
import { useState } from "preact/hooks"

interface ExperimentRun {
  ts: string
  value: number
  model_version: string
  delta: number
  improved: boolean
  index: number
}

function buildRuns(points: TrajectoryPoint[]): ExperimentRun[] {
  return points.map((p, i) => {
    const prev = i > 0 ? points[i - 1].value : p.value
    const delta = p.value - prev
    return {
      ts: p.ts,
      value: p.value,
      model_version: p.model_version || "unknown",
      delta,
      improved: i === 0 || delta > 0,
      index: i,
    }
  })
}

export function ExperimentsPage() {
  const leaderboard = usePolling(() => api.leaderboard(), 15000)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)

  const agents = leaderboard.data || []
  const defaultAgent = agents.length > 0
    ? agents.reduce((best, a) => (a.composite || 0) > (best.composite || 0) ? a : best).agent
    : null
  const activeAgent = selectedAgent || defaultAgent

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold">Experiments</h1>
          <p class="text-sm text-muted-foreground mt-0.5">RL experiment loop — score trajectory over eval runs</p>
        </div>
        {agents.length > 1 && (
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted-foreground">Agent:</span>
            {agents
              .sort((a, b) => (b.composite || 0) - (a.composite || 0))
              .map((a) => (
                <button
                  key={a.agent}
                  onClick={() => setSelectedAgent(a.agent)}
                  class={cn(
                    "text-[10px] mono px-2 py-1 rounded transition-colors",
                    activeAgent === a.agent
                      ? "bg-info/15 text-info"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {a.agent}
                </button>
              ))}
          </div>
        )}
      </div>

      {activeAgent ? (
        <ExperimentDetail agentName={activeAgent} />
      ) : (
        <div class="bg-card rounded-lg border border-border p-8 text-center">
          <div class="text-muted-foreground text-sm">No eval data yet</div>
          <div class="text-muted-foreground text-[10px] mt-1 mono">
            Run evaluations to see experiment runs here
          </div>
        </div>
      )}

      <LeaderboardSummary agents={agents} />

      <PredictionAccuracy />
    </div>
  )
}

function ExperimentDetail({ agentName }: { agentName: string }) {
  const trajectory = usePolling(
    () => api.trajectory(agentName),
    15000,
    [agentName],
  )

  const points = trajectory.data?.points || []
  const runs = buildRuns(points)

  if (trajectory.loading) {
    return <div class="text-sm text-muted-foreground">Loading trajectory...</div>
  }

  if (runs.length === 0) {
    return (
      <div class="bg-card rounded-lg border border-border p-8 text-center">
        <div class="text-muted-foreground text-sm">No trajectory data for {agentName}</div>
      </div>
    )
  }

  return (
    <>
      <DotPlot runs={runs} agentName={agentName} />
      <ScoreTimeline runs={runs} />
    </>
  )
}

function DotPlot({ runs, agentName }: { runs: ExperimentRun[]; agentName: string }) {
  const values = runs.map((r) => r.value)
  const keptCount = runs.filter((r) => r.improved).length
  const discardedCount = runs.length - keptCount
  const bestRun = runs.reduce((best, r) => r.value > best.value ? r : best)
  const latestRun = runs[runs.length - 1]

  return (
    <div class="bg-card rounded-lg border border-border p-4 animate-fade-in">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-sm font-medium">{agentName} — Experiment Dot Plot</h2>
          <div class="text-[10px] text-muted-foreground mt-0.5 mono">
            {runs.length} runs — {keptCount} improved, {discardedCount} regressed
          </div>
        </div>
        <div class="flex items-center gap-4">
          <div class="text-right">
            <div class="text-[10px] text-muted-foreground uppercase">Best</div>
            <div class="text-sm font-semibold mono text-success">{bestRun.value.toFixed(4)}</div>
          </div>
          <div class="text-right">
            <div class="text-[10px] text-muted-foreground uppercase">Latest</div>
            <div class="text-sm font-semibold mono">{latestRun.value.toFixed(4)}</div>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-0.5 flex-wrap py-2">
        {runs.map((r, i) => (
          <span
            key={i}
            class={cn(
              "inline-block w-2 h-2 rounded-full mx-0.5 transition-transform hover:scale-150 cursor-default",
              r.improved ? "bg-success" : "bg-muted-foreground/30",
            )}
            title={`#${r.index + 1}: ${r.value.toFixed(4)} (${r.model_version}) ${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(4)}`}
          />
        ))}
      </div>

      <div class="mt-3 pt-3 border-t border-border">
        <Sparkline
          data={values}
          width={600}
          height={40}
          color={latestRun.delta >= 0 ? "var(--success)" : "var(--destructive)"}
          className="w-full"
        />
      </div>

      <div class="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-2 h-2 rounded-full bg-success" />
          improved
        </span>
        <span class="flex items-center gap-1.5">
          <span class="inline-block w-2 h-2 rounded-full bg-muted-foreground/30" />
          regressed
        </span>
      </div>
    </div>
  )
}

function ScoreTimeline({ runs }: { runs: ExperimentRun[] }) {
  const reversed = [...runs].reverse()
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? reversed : reversed.slice(0, 20)

  return (
    <div class="bg-card rounded-lg border border-border overflow-hidden animate-fade-in">
      <div class="px-3 py-2 border-b border-border flex items-center justify-between">
        <span class="text-xs font-medium">Score Timeline</span>
        <span class="text-[10px] mono text-muted-foreground">{runs.length} experiments</span>
      </div>
      <div class="max-h-96 overflow-y-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-muted-foreground border-b border-border sticky top-0 bg-card">
              <th class="text-left py-2 px-3 font-medium w-8">#</th>
              <th class="text-left py-2 px-3 font-medium">Time</th>
              <th class="text-right py-2 px-3 font-medium">Score</th>
              <th class="text-right py-2 px-3 font-medium">Delta</th>
              <th class="text-left py-2 px-3 font-medium">Model</th>
              <th class="text-center py-2 px-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const deltaColor = r.delta > 0
                ? "text-success"
                : r.delta < 0
                  ? "text-destructive"
                  : "text-muted-foreground"

              return (
                <tr key={r.index} class="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td class="py-1.5 px-3 mono text-muted-foreground">{r.index + 1}</td>
                  <td class="py-1.5 px-3 mono text-muted-foreground whitespace-nowrap">
                    {timeAgo(r.ts)}
                  </td>
                  <td class="py-1.5 px-3 mono text-right font-medium">{r.value.toFixed(4)}</td>
                  <td class={cn("py-1.5 px-3 mono text-right", deltaColor)}>
                    {r.index === 0 ? "—" : `${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(4)}`}
                  </td>
                  <td class="py-1.5 px-3 mono text-muted-foreground">{r.model_version}</td>
                  <td class="py-1.5 px-3 text-center">
                    <span class={cn(
                      "text-[10px] mono px-1.5 py-0.5 rounded uppercase",
                      r.improved
                        ? "bg-success/15 text-success"
                        : "bg-muted text-muted-foreground",
                    )}>
                      {r.improved ? "kept" : "discarded"}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {reversed.length > 20 && !showAll && (
        <div class="px-3 py-2 border-t border-border">
          <button
            onClick={() => setShowAll(true)}
            class="text-[10px] mono text-info hover:text-info/80 transition-colors"
          >
            show all {reversed.length} experiments
          </button>
        </div>
      )}
    </div>
  )
}

function LeaderboardSummary({ agents }: { agents: EvalAgent[] }) {
  if (agents.length === 0) return null

  const sorted = [...agents].sort((a, b) => (b.composite || 0) - (a.composite || 0))

  return (
    <div class="bg-card rounded-lg border border-border overflow-hidden animate-fade-in">
      <div class="px-3 py-2 border-b border-border bg-muted/30">
        <span class="text-xs font-medium uppercase tracking-wider">Agent Leaderboard</span>
        <span class="text-[10px] text-muted-foreground ml-2">{sorted.length} agents</span>
      </div>
      <table class="w-full text-xs">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="text-left py-2 px-3 font-medium w-8">#</th>
            <th class="text-left py-2 px-3 font-medium">Agent</th>
            <th class="text-right py-2 px-3 font-medium">Score</th>
            <th class="text-right py-2 px-3 font-medium">Delta</th>
            <th class="text-right py-2 px-3 font-medium">Experiments</th>
            <th class="text-right py-2 px-3 font-medium">Improvement Rate</th>
            <th class="text-right py-2 px-3 font-medium w-24">Trend</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((agent, i) => {
            const traj = agent.trajectory || []
            const improvements = traj.filter((v, j) => j > 0 && v > traj[j - 1]).length
            const rate = traj.length > 1 ? (improvements / (traj.length - 1)) * 100 : 0
            const deltaColor = agent.delta != null
              ? agent.delta > 0 ? "text-success" : agent.delta < 0 ? "text-destructive" : "text-muted-foreground"
              : "text-muted-foreground"

            return (
              <tr key={agent.agent} class="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td class="py-2 px-3 mono text-muted-foreground">{i + 1}</td>
                <td class="py-2 px-3">
                  <div class="font-medium">{agent.agent}</div>
                  {agent.model_version && (
                    <span class="text-[10px] mono text-muted-foreground">{agent.model_version}</span>
                  )}
                </td>
                <td class="py-2 px-3 mono text-right font-semibold">
                  {agent.composite != null ? agent.composite.toFixed(4) : "—"}
                </td>
                <td class={cn("py-2 px-3 mono text-right", deltaColor)}>
                  {agent.delta != null ? `${agent.delta >= 0 ? "+" : ""}${agent.delta.toFixed(4)}` : "—"}
                </td>
                <td class="py-2 px-3 mono text-right text-muted-foreground">{traj.length}</td>
                <td class="py-2 px-3 mono text-right">
                  {traj.length > 1 ? (
                    <span class={cn(rate >= 50 ? "text-success" : "text-warning")}>{rate.toFixed(0)}%</span>
                  ) : "—"}
                </td>
                <td class="py-2 px-3 text-right">
                  {traj.length > 1 && (
                    <Sparkline
                      data={traj}
                      width={80}
                      height={24}
                      color={
                        agent.delta != null && agent.delta > 0 ? "var(--success)"
                          : agent.delta != null && agent.delta < 0 ? "var(--destructive)"
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

function PredictionAccuracy() {
  const predictions = usePolling(() => api.predictions(), 30000)
  const data = predictions.data
  const accuracy = data?.accuracy
  const recent = data?.recent || []

  const hasData = accuracy && accuracy.total > 0

  return (
    <div class="bg-card rounded-lg border border-border animate-fade-in">
      <div class="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h2 class="text-sm font-medium">Stratus Prediction Accuracy</h2>
          <div class="text-[10px] text-muted-foreground mt-0.5 mono">
            JEPA rollout + chat ensemble — predicted vs actual eval deltas
          </div>
        </div>
        {hasData && (
          <span class={cn(
            "text-[10px] mono px-1.5 py-0.5 rounded uppercase",
            accuracy.direction_accuracy >= 0.7 ? "bg-success/15 text-success"
              : accuracy.direction_accuracy >= 0.5 ? "bg-warning/15 text-warning"
              : "bg-destructive/15 text-destructive",
          )}>
            {(accuracy.direction_accuracy * 100).toFixed(0)}% direction accuracy
          </span>
        )}
      </div>

      <div class="p-4">
        <div class="grid grid-cols-5 gap-4 mb-4">
          <div class="text-center">
            <div class="text-[10px] text-muted-foreground uppercase">Total</div>
            <div class="text-lg font-semibold mono">
              {hasData ? accuracy.total : "—"}
            </div>
          </div>
          <div class="text-center">
            <div class="text-[10px] text-muted-foreground uppercase">Resolved</div>
            <div class="text-lg font-semibold mono">
              {hasData ? accuracy.resolved : "—"}
            </div>
          </div>
          <div class="text-center">
            <div class="text-[10px] text-muted-foreground uppercase">Direction</div>
            <div class={cn("text-lg font-semibold mono",
              hasData && accuracy.direction_accuracy >= 0.7 ? "text-success"
              : hasData && accuracy.direction_accuracy >= 0.5 ? "text-warning"
              : hasData ? "text-destructive" : "text-muted-foreground/40"
            )}>
              {hasData ? `${(accuracy.direction_accuracy * 100).toFixed(0)}%` : "—"}
            </div>
          </div>
          <div class="text-center">
            <div class="text-[10px] text-muted-foreground uppercase">Mean Error</div>
            <div class="text-lg font-semibold mono">
              {hasData && accuracy.resolved > 0 ? accuracy.mean_delta_error.toFixed(4) : "—"}
            </div>
          </div>
          <div class="text-center">
            <div class="text-[10px] text-muted-foreground uppercase">Calibration</div>
            <div class="text-lg font-semibold mono">
              {hasData && accuracy.resolved > 0 ? accuracy.calibration.toFixed(2) : "—"}
            </div>
          </div>
        </div>

        {recent.length > 0 ? (
          <div class="overflow-hidden rounded border border-border/50">
            <table class="w-full text-xs">
              <thead>
                <tr class="text-muted-foreground border-b border-border bg-muted/30">
                  <th class="text-left py-2 px-3 font-medium">Proposal</th>
                  <th class="text-center py-2 px-3 font-medium">Method</th>
                  <th class="text-right py-2 px-3 font-medium">Predicted</th>
                  <th class="text-right py-2 px-3 font-medium">Actual</th>
                  <th class="text-right py-2 px-3 font-medium">Error</th>
                  <th class="text-center py-2 px-3 font-medium">Direction</th>
                  <th class="text-right py-2 px-3 font-medium">Goal Prox</th>
                  <th class="text-right py-2 px-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.prediction_id} class="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td class="py-1.5 px-3 max-w-48 truncate" title={r.proposal.description}>
                      {r.proposal.description}
                    </td>
                    <td class="py-1.5 px-3 text-center">
                      <span class={cn(
                        "text-[10px] mono px-1.5 py-0.5 rounded",
                        r.prediction.method === "ensemble" ? "bg-info/15 text-info"
                          : r.prediction.method === "rollout" ? "bg-warning/15 text-warning"
                          : "bg-muted text-muted-foreground",
                      )}>
                        {r.prediction.method}
                      </span>
                    </td>
                    <td class={cn("py-1.5 px-3 mono text-right",
                      r.prediction.delta >= 0 ? "text-success" : "text-destructive"
                    )}>
                      {r.prediction.delta >= 0 ? "+" : ""}{r.prediction.delta.toFixed(4)}
                    </td>
                    <td class="py-1.5 px-3 mono text-right">
                      {r.actual ? (
                        <span class={r.actual.delta >= 0 ? "text-success" : "text-destructive"}>
                          {r.actual.delta >= 0 ? "+" : ""}{r.actual.delta.toFixed(4)}
                        </span>
                      ) : (
                        <span class="text-muted-foreground/40">pending</span>
                      )}
                    </td>
                    <td class="py-1.5 px-3 mono text-right">
                      {r.accuracy ? r.accuracy.delta_error.toFixed(4) : "—"}
                    </td>
                    <td class="py-1.5 px-3 text-center">
                      {r.accuracy ? (
                        <span class={cn(
                          "inline-block w-2 h-2 rounded-full",
                          r.accuracy.direction_correct ? "bg-success" : "bg-destructive",
                        )} />
                      ) : (
                        <span class="inline-block w-2 h-2 rounded-full bg-muted-foreground/30" />
                      )}
                    </td>
                    <td class="py-1.5 px-3 mono text-right text-muted-foreground">
                      {r.prediction.brain_goal_proximity > 0
                        ? r.prediction.brain_goal_proximity.toFixed(2)
                        : "—"
                      }
                    </td>
                    <td class="py-1.5 px-3 mono text-right text-muted-foreground whitespace-nowrap">
                      {timeAgo(r.ts)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div class="text-center py-6 text-muted-foreground text-xs">
            No predictions yet. Run <span class="mono">jfl predict</span> before a PP change to see
            Stratus prediction accuracy here.
          </div>
        )}
      </div>
    </div>
  )
}
