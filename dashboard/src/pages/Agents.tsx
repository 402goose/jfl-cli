import { api, EvalAgent, TrajectoryPoint } from "@/api"
import { AgentCard, Sparkline } from "@/components"
import { usePolling } from "@/lib/hooks"
import { useState } from "preact/hooks"

export function AgentsPage() {
  const leaderboard = usePolling(() => api.leaderboard(), 15000)
  const [selected, setSelected] = useState<string | null>(null)

  const agents = leaderboard.data || []

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Agents</h1>
        <span class="text-sm text-muted-foreground">{agents.length} tracked</span>
      </div>

      {leaderboard.loading ? (
        <div class="text-sm text-muted-foreground">Loading leaderboard...</div>
      ) : agents.length === 0 ? (
        <div class="bg-card rounded-lg border border-border p-8 text-center">
          <div class="text-muted-foreground text-sm">No eval data yet</div>
          <div class="text-muted-foreground text-xs mt-1">
            Run evaluations to see agent performance here
          </div>
        </div>
      ) : (
        <>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.agent}
                agent={agent}
                onClick={() => setSelected(agent.agent === selected ? null : agent.agent)}
              />
            ))}
          </div>

          {selected && <AgentDetail agentName={selected} />}
        </>
      )}
    </div>
  )
}

function AgentDetail({ agentName }: { agentName: string }) {
  const trajectory = usePolling(
    () => api.trajectory(agentName),
    30000,
    [agentName],
  )

  const points = trajectory.data?.points || []

  return (
    <div class="bg-card rounded-lg border border-border p-4 animate-fade-in">
      <h3 class="text-sm font-medium mb-3">{agentName} — Trajectory</h3>
      {trajectory.loading ? (
        <div class="text-sm text-muted-foreground">Loading...</div>
      ) : points.length === 0 ? (
        <div class="text-sm text-muted-foreground">No trajectory data</div>
      ) : (
        <div class="space-y-4">
          <Sparkline
            data={points.map((p) => p.value)}
            width={600}
            height={120}
            color="var(--info)"
          />
          <div class="grid grid-cols-3 gap-4 text-xs">
            <div>
              <span class="text-muted-foreground">Latest</span>
              <div class="mono font-medium">{points[points.length - 1].value.toFixed(4)}</div>
            </div>
            <div>
              <span class="text-muted-foreground">Best</span>
              <div class="mono font-medium">
                {Math.max(...points.map((p) => p.value)).toFixed(4)}
              </div>
            </div>
            <div>
              <span class="text-muted-foreground">Points</span>
              <div class="mono font-medium">{points.length}</div>
            </div>
          </div>
          <div class="max-h-48 overflow-y-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="text-muted-foreground border-b border-border">
                  <th class="text-left py-1 font-medium">Time</th>
                  <th class="text-right py-1 font-medium">Score</th>
                  <th class="text-right py-1 font-medium">Model</th>
                </tr>
              </thead>
              <tbody>
                {points
                  .slice()
                  .reverse()
                  .slice(0, 20)
                  .map((p, i) => (
                    <tr key={i} class="border-b border-border/50">
                      <td class="py-1 mono text-muted-foreground">
                        {new Date(p.ts).toLocaleString()}
                      </td>
                      <td class="py-1 mono text-right">{p.value.toFixed(4)}</td>
                      <td class="py-1 mono text-right text-muted-foreground">
                        {p.model_version || "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
