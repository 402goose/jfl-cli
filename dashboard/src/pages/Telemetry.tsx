import { api, TelemetryDigest } from "@/api"
import { usePolling, cn, timeAgo } from "@/lib/hooks"
import { useState } from "preact/hooks"

export function TelemetryPage() {
  const [hours, setHours] = useState(168)
  const digest = usePolling(() => api.telemetryDigest(hours), 30000, [hours])
  const agentStatus = usePolling(() => api.telemetryAgentStatus(), 15000)
  const [runFeedback, setRunFeedback] = useState<string | null>(null)
  const data = digest.data
  const agent = agentStatus.data

  const handleRunAgent = async () => {
    setRunFeedback("running...")
    try {
      const result = await api.telemetryAgentRun()
      setRunFeedback(`${result.insights?.length || 0} insights`)
      setTimeout(() => setRunFeedback(null), 3000)
    } catch {
      setRunFeedback("error")
      setTimeout(() => setRunFeedback(null), 3000)
    }
  }

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold">Telemetry</h1>
          <p class="text-sm text-muted-foreground mt-0.5">Cost analysis, command usage, and system health</p>
        </div>
        <div class="flex items-center gap-2">
          {[24, 72, 168].map((h) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              class={cn(
                "text-[10px] mono px-2 py-1 rounded transition-colors",
                hours === h
                  ? "bg-info/15 text-info"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {h === 24 ? "24h" : h === 72 ? "3d" : "7d"}
            </button>
          ))}
        </div>
      </div>

      {agent && (
        <div class="bg-card rounded-lg border border-border p-3 flex items-center gap-4">
          <div class="flex items-center gap-2">
            <span class={cn(
              "w-2 h-2 rounded-full",
              agent.running ? "bg-success animate-pulse-dot" : "bg-muted-foreground/50",
            )} />
            <span class="text-xs font-medium">Telemetry Agent</span>
          </div>
          <div class="flex items-center gap-4 text-[10px] text-muted-foreground mono">
            <span>{agent.running ? "active" : "stopped"}</span>
            {agent.lastRun && <span>last: {timeAgo(agent.lastRun)}</span>}
            <span>runs: {agent.runCount}</span>
            <span>patterns: {agent.lastInsights.length}</span>
          </div>
          <button
            onClick={handleRunAgent}
            class={cn(
              "ml-auto text-[10px] mono px-2 py-1 rounded transition-colors",
              runFeedback
                ? runFeedback === "error" ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"
                : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80",
            )}
          >
            {runFeedback || "run now"}
          </button>
        </div>
      )}

      {!data ? (
        <div class="bg-card rounded-lg border border-border p-8 text-center">
          <div class="text-muted-foreground text-sm">
            {digest.loading ? "Loading telemetry..." : "No telemetry data available"}
          </div>
        </div>
      ) : (
        <>
          <div class="grid grid-cols-5 gap-4">
            <StatCard label="Events" value={data.totalEvents} />
            <StatCard label="Cost" value={`$${data.totalCostUsd.toFixed(2)}`} />
            <StatCard
              label="Sessions"
              value={data.sessions.started}
              sub={data.sessions.crashed > 0 ? `${data.sessions.crashed} crashed` : "healthy"}
              subColor={data.sessions.crashed > 0 ? "text-destructive" : "text-success"}
            />
            <StatCard
              label="Flows"
              value={data.flows.triggered}
              sub={`${data.flows.completed} ok / ${data.flows.failed} fail`}
            />
            <StatCard
              label="Errors"
              value={data.errors.total}
              subColor={data.errors.total > 0 ? "text-destructive" : "text-success"}
              sub={data.errors.total === 0 ? "clean" : undefined}
            />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="bg-card rounded-lg border border-border p-4 animate-fade-in">
              <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-3">Hub Health</div>
              <div class="grid grid-cols-2 gap-3 text-xs">
                <div><span class="text-muted-foreground">Starts:</span> <span class="mono">{data.hubHealth.starts}</span></div>
                <div><span class="text-muted-foreground">Crashes:</span> <span class={cn("mono", data.hubHealth.crashes > 0 ? "text-destructive" : "")}>{data.hubHealth.crashes}</span></div>
                <div><span class="text-muted-foreground">MCP Calls:</span> <span class="mono">{data.hubHealth.mcpCalls}</span></div>
                <div><span class="text-muted-foreground">Avg Latency:</span> <span class="mono">{data.hubHealth.avgMcpLatencyMs.toFixed(0)}ms</span></div>
              </div>
            </div>
            <div class="bg-card rounded-lg border border-border p-4 animate-fade-in">
              <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-3">Memory Health</div>
              <div class="grid grid-cols-2 gap-3 text-xs">
                <div><span class="text-muted-foreground">Index Runs:</span> <span class="mono">{data.memoryHealth.indexRuns}</span></div>
                <div><span class="text-muted-foreground">Indexed:</span> <span class="mono">{data.memoryHealth.entriesIndexed}</span></div>
                <div><span class="text-muted-foreground">Errors:</span> <span class={cn("mono", data.memoryHealth.errors > 0 ? "text-destructive" : "")}>{data.memoryHealth.errors}</span></div>
                <div><span class="text-muted-foreground">Avg Duration:</span> <span class="mono">{data.memoryHealth.avgDurationMs.toFixed(0)}ms</span></div>
              </div>
            </div>
          </div>

          <ModelCosts costs={data.costs} totalCost={data.totalCostUsd} />
          <CommandUsage commands={data.commands} />
          <FlowActivity flows={data.flows} />
          <HooksActivity hooks={data.hooks} />
          <ErrorBreakdown errors={data.errors} />
          <Suggestions suggestions={data.suggestions} />
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, sub, subColor }: {
  label: string; value: number | string; sub?: string; subColor?: string
}) {
  return (
    <div class="bg-card rounded-lg border border-border p-4 animate-fade-in">
      <div class="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div class="text-2xl font-bold mono mt-1">{value}</div>
      {sub && <div class={cn("text-[10px] mono mt-0.5", subColor || "text-muted-foreground")}>{sub}</div>}
    </div>
  )
}

function ModelCosts({ costs, totalCost }: { costs: TelemetryDigest["costs"]; totalCost: number }) {
  if (!costs || costs.length === 0) {
    return (
      <div class="bg-card rounded-lg border border-border/50 p-6 text-center animate-fade-in">
        <div class="text-muted-foreground text-xs">No model cost data yet</div>
        <div class="text-[10px] text-muted-foreground/60 mt-1 mono">Costs tracked automatically on LLM calls</div>
      </div>
    )
  }

  const sorted = [...costs].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)

  return (
    <div class="bg-card rounded-lg border border-border overflow-hidden animate-fade-in">
      <div class="px-3 py-2 border-b border-border flex items-center justify-between bg-muted/30">
        <span class="text-xs font-medium uppercase tracking-wider">Model Costs</span>
        <span class="text-xs mono text-warning">${totalCost.toFixed(4)} total</span>
      </div>
      <table class="w-full text-xs">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="text-left py-2 px-3 font-medium">Model</th>
            <th class="text-right py-2 px-3 font-medium">Calls</th>
            <th class="text-right py-2 px-3 font-medium">Tokens</th>
            <th class="text-right py-2 px-3 font-medium">Cost</th>
            <th class="text-left py-2 px-3 font-medium w-48">Share</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => {
            const share = totalCost > 0 ? (m.estimatedCostUsd / totalCost) * 100 : 0
            return (
              <tr key={m.model} class="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td class="py-1.5 px-3 mono">{m.model}</td>
                <td class="py-1.5 px-3 mono text-right">{m.calls}</td>
                <td class="py-1.5 px-3 mono text-right text-muted-foreground">{m.totalTokens.toLocaleString()}</td>
                <td class="py-1.5 px-3 mono text-right text-warning">${m.estimatedCostUsd.toFixed(4)}</td>
                <td class="py-1.5 px-3">
                  <div class="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div class="h-full bg-info rounded-full transition-all" style={{ width: `${Math.max(share, 2)}%` }} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CommandUsage({ commands }: { commands: TelemetryDigest["commands"] }) {
  if (!commands || commands.length === 0) {
    return (
      <div class="bg-card rounded-lg border border-border/50 p-6 text-center animate-fade-in">
        <div class="text-muted-foreground text-xs">No command usage data yet</div>
      </div>
    )
  }

  const sorted = [...commands].sort((a, b) => b.count - a.count)

  return (
    <div class="bg-card rounded-lg border border-border overflow-hidden animate-fade-in">
      <div class="px-3 py-2 border-b border-border bg-muted/30">
        <span class="text-xs font-medium uppercase tracking-wider">Command Usage</span>
        <span class="text-[10px] text-muted-foreground ml-2">{sorted.length} commands</span>
      </div>
      <table class="w-full text-xs">
        <thead>
          <tr class="text-muted-foreground border-b border-border">
            <th class="text-left py-2 px-3 font-medium">Command</th>
            <th class="text-right py-2 px-3 font-medium">Count</th>
            <th class="text-right py-2 px-3 font-medium">Avg Duration</th>
            <th class="text-right py-2 px-3 font-medium">Success Rate</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.command} class="border-b border-border/50 hover:bg-muted/20 transition-colors">
              <td class="py-1.5 px-3 mono">{c.command}</td>
              <td class="py-1.5 px-3 mono text-right">{c.count}</td>
              <td class="py-1.5 px-3 mono text-right text-muted-foreground">
                {c.avgDurationMs > 1000 ? `${(c.avgDurationMs / 1000).toFixed(1)}s` : `${Math.round(c.avgDurationMs)}ms`}
              </td>
              <td class="py-1.5 px-3 mono text-right">
                <span class={cn(c.successRate >= 0.9 ? "text-success" : c.successRate >= 0.7 ? "text-warning" : "text-destructive")}>
                  {(c.successRate * 100).toFixed(0)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FlowActivity({ flows }: { flows: TelemetryDigest["flows"] }) {
  const byFlow = flows?.byFlow || {}
  const entries = Object.entries(byFlow)
  if (entries.length === 0 && flows.triggered === 0) return null

  return (
    <div class="bg-card rounded-lg border border-border overflow-hidden animate-fade-in">
      <div class="px-3 py-2 border-b border-border flex items-center justify-between bg-muted/30">
        <span class="text-xs font-medium uppercase tracking-wider">Flow Activity</span>
        <span class="text-[10px] mono text-muted-foreground">
          {flows.triggered} triggered / {flows.completed} completed / {flows.failed} failed
        </span>
      </div>
      {entries.length > 0 && (
        <table class="w-full text-xs">
          <thead>
            <tr class="text-muted-foreground border-b border-border">
              <th class="text-left py-2 px-3 font-medium">Flow</th>
              <th class="text-right py-2 px-3 font-medium">Triggered</th>
              <th class="text-right py-2 px-3 font-medium">Completed</th>
              <th class="text-right py-2 px-3 font-medium">Failed</th>
            </tr>
          </thead>
          <tbody>
            {entries.sort(([, a], [, b]) => b.triggered - a.triggered).map(([name, stats]) => (
              <tr key={name} class="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td class="py-1.5 px-3 mono">{name}</td>
                <td class="py-1.5 px-3 mono text-right">{stats.triggered}</td>
                <td class="py-1.5 px-3 mono text-right text-success">{stats.completed}</td>
                <td class="py-1.5 px-3 mono text-right text-destructive">{stats.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function HooksActivity({ hooks }: { hooks: TelemetryDigest["hooks"] }) {
  if (hooks.received === 0) return null

  const toolEntries = Object.entries(hooks.byTool || {}).sort(([, a], [, b]) => b - a)
  const eventEntries = Object.entries(hooks.byEvent || {}).sort(([, a], [, b]) => b - a)

  return (
    <div class="bg-card rounded-lg border border-border overflow-hidden animate-fade-in">
      <div class="px-3 py-2 border-b border-border bg-muted/30">
        <span class="text-xs font-medium uppercase tracking-wider">Hooks</span>
        <span class="text-[10px] text-muted-foreground ml-2">{hooks.received} received</span>
      </div>
      <div class="p-3 grid grid-cols-2 gap-4">
        {toolEntries.length > 0 && (
          <div>
            <div class="text-[10px] text-muted-foreground uppercase mb-2">By Tool</div>
            {toolEntries.slice(0, 10).map(([tool, count]) => (
              <div key={tool} class="flex items-center justify-between py-0.5 text-xs">
                <span class="mono truncate">{tool}</span>
                <span class="mono text-muted-foreground tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        )}
        {eventEntries.length > 0 && (
          <div>
            <div class="text-[10px] text-muted-foreground uppercase mb-2">By Event</div>
            {eventEntries.slice(0, 10).map(([event, count]) => (
              <div key={event} class="flex items-center justify-between py-0.5 text-xs">
                <span class="mono truncate">{event}</span>
                <span class="mono text-muted-foreground tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {hooks.fileHotspots && hooks.fileHotspots.length > 0 && (
        <div class="px-3 pb-3 border-t border-border/30 pt-2">
          <div class="text-[10px] text-muted-foreground uppercase mb-1.5">File Hotspots</div>
          {hooks.fileHotspots.slice(0, 5).map((f, i) => (
            <div key={i} class="text-[10px] mono text-muted-foreground truncate py-0.5">{f}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function ErrorBreakdown({ errors }: { errors: TelemetryDigest["errors"] }) {
  const entries = Object.entries(errors.byType || {})
  if (errors.total === 0 && entries.length === 0) return null

  return (
    <div class="bg-card rounded-lg border border-border overflow-hidden animate-fade-in">
      <div class="px-3 py-2 border-b border-border bg-muted/30">
        <span class="text-xs font-medium uppercase tracking-wider">Errors</span>
        <span class="text-[10px] text-destructive ml-2">{errors.total} total</span>
      </div>
      <div class="p-3 space-y-1.5">
        {entries.sort(([, a], [, b]) => b - a).map(([type, count]) => (
          <div key={type} class="flex items-center gap-3 text-xs">
            <span class="mono text-destructive flex-1 truncate">{type}</span>
            <span class="mono tabular-nums">{count}x</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Suggestions({ suggestions }: { suggestions?: TelemetryDigest["suggestions"] }) {
  if (!suggestions || suggestions.length === 0) return null

  const severityColor: Record<string, string> = {
    high: "text-destructive border-destructive/30 bg-destructive/5",
    medium: "text-warning border-warning/30 bg-warning/5",
    low: "text-info border-info/30 bg-info/5",
  }

  return (
    <div class="bg-card rounded-lg border border-border overflow-hidden animate-fade-in">
      <div class="px-3 py-2 border-b border-border bg-muted/30">
        <span class="text-xs font-medium uppercase tracking-wider">Suggestions</span>
      </div>
      <div class="p-3 space-y-2">
        {suggestions.map((s, i) => (
          <div key={i} class={cn("rounded-md border p-3", severityColor[s.severity] || severityColor.low)}>
            <div class="flex items-center gap-2">
              <span class="text-[10px] mono uppercase font-medium">{s.severity}</span>
              <span class="text-xs">{s.message}</span>
            </div>
            {s.fix && <div class="text-[10px] mono mt-1 opacity-75">{s.fix}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
