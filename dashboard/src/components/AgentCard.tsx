import { EvalAgent } from "@/api"
import { Sparkline } from "./Sparkline"
import { StatusDot } from "./StatusDot"

interface AgentCardProps {
  agent: EvalAgent
  onClick?: () => void
}

export function AgentCard({ agent, onClick }: AgentCardProps) {
  const composite = agent.composite != null ? agent.composite.toFixed(4) : "—"
  const deltaStr =
    agent.delta != null
      ? `${agent.delta >= 0 ? "+" : ""}${agent.delta.toFixed(4)}`
      : null
  const trend =
    agent.delta != null ? (agent.delta > 0 ? "up" : agent.delta < 0 ? "down" : "neutral") : "neutral"
  const trendColor =
    trend === "up" ? "text-success" : trend === "down" ? "text-destructive" : "text-muted-foreground"

  const metricEntries = Object.entries(agent.metrics).filter(
    ([k]) => k !== "composite",
  )

  return (
    <button
      onClick={onClick}
      class="w-full text-left bg-card rounded-lg border border-border p-4 hover:border-muted-foreground/40 transition-colors animate-fade-in"
    >
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <StatusDot status="active" />
          <span class="font-medium text-sm">{agent.agent}</span>
        </div>
        {agent.model_version && (
          <span class="text-[10px] mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {agent.model_version}
          </span>
        )}
      </div>

      <div class="flex items-end justify-between">
        <div>
          <div class="text-2xl font-semibold mono">{composite}</div>
          {deltaStr && (
            <span class={`text-xs mono ${trendColor}`}>{deltaStr}</span>
          )}
        </div>
        {agent.trajectory.length > 1 && (
          <Sparkline
            data={agent.trajectory}
            color={trend === "up" ? "var(--success)" : trend === "down" ? "var(--destructive)" : "var(--info)"}
          />
        )}
      </div>

      {metricEntries.length > 0 && (
        <div class="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-x-4 gap-y-1">
          {metricEntries.map(([k, v]) => (
            <div key={k} class="flex justify-between text-xs">
              <span class="text-muted-foreground">{k}</span>
              <span class="mono">{typeof v === "number" ? v.toFixed(4) : v}</span>
            </div>
          ))}
        </div>
      )}
    </button>
  )
}
