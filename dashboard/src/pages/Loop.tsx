import { api, HubEvent, EvalAgent, EvalEntry } from "@/api"
import { Sparkline } from "@/components"
import { usePolling, timeAgo, cn } from "@/lib/hooks"

interface CycleDisplay {
  ts: string
  branch?: string
  prNumber?: number
  delta?: number
  composite?: number
  improved?: boolean
  agent?: string
  testsTotal?: number
  testsPassed?: number
  description?: string
}

function extractBranchDescription(branch?: string): string | undefined {
  if (!branch) return undefined
  // Extract meaningful part from branch name
  // e.g., "pp/autoresearch-r1-add-tests-1234567890" → "Round 1"
  // e.g., "pp/test-self-driving-loop" → "test-self-driving-loop"
  const match = branch.match(/autoresearch-r(\d+)/)
  if (match) return `Round ${match[1]}`

  // Remove common prefixes and timestamps
  let desc = branch
    .replace(/^pp\//, "")
    .replace(/^feature\//, "")
    .replace(/-\d{10,}$/, "") // remove trailing timestamps
    .replace(/-/g, " ")

  // Capitalize first letter
  if (desc) desc = desc.charAt(0).toUpperCase() + desc.slice(1)
  return desc || undefined
}

function entriesFromEvals(entries: EvalEntry[]): CycleDisplay[] {
  return entries.map(e => ({
    ts: e.ts,
    branch: e.branch,
    prNumber: e.pr_number,
    delta: e.delta?.composite,
    composite: e.composite,
    improved: e.improved,
    agent: e.agent,
    testsTotal: e.metrics?.tests_total,
    testsPassed: e.metrics?.tests_passed,
    description: extractBranchDescription(e.branch) || e.notes,
  }))
}

export function LoopPage() {
  const events = usePolling(() => api.events(500), 15000)
  const leaderboard = usePolling(() => api.leaderboard(), 15000)
  const flowExecs = usePolling(() => api.flowExecutions(), 15000)
  const evalEntries = usePolling(() => api.evalEntries(100), 15000)

  const allEvents = events.data?.events || []
  const agents = leaderboard.data || []
  const executions = flowExecs.data || []
  const entries = evalEntries.data?.entries || []

  const cycles = entriesFromEvals(entries)
  const detectCount = allEvents.filter(e => e.type === "telemetry:insight").length
  const proposeCount = allEvents.filter(e => e.type.startsWith("peter:")).length
  const evalCount = cycles.length
  const mergeCount = cycles.filter(c => c.improved === true).length
  const rejectCount = cycles.filter(c => c.improved === false).length
  const flowRuns = executions.length

  const bestAgent = [...agents].sort((a, b) => (b.composite || 0) - (a.composite || 0))[0]
  const scoreStart = bestAgent?.trajectory?.[0]
  const scoreEnd = bestAgent?.composite

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Self-Driving Loop</h1>
        <span class="text-sm text-muted-foreground">{cycles.length} cycles</span>
      </div>

      {/* Score */}
      {scoreStart != null && scoreEnd != null && (
        <div class="bg-card rounded-lg border border-border p-4">
          <div class="flex items-center gap-4">
            <div>
              <div class="text-xs text-muted-foreground uppercase tracking-wider mb-1">Score</div>
              <div class="flex items-center gap-2">
                <span class="text-2xl font-bold tabular-nums">{scoreEnd.toFixed(2)}</span>
                {(() => {
                  const d = scoreEnd - scoreStart
                  return (
                    <span class={cn("text-sm mono", d >= 0 ? "text-success" : "text-destructive")}>
                      {d >= 0 ? "\u25b2" : "\u25bc"}{d >= 0 ? "+" : ""}{d.toFixed(3)}
                    </span>
                  )
                })()}
              </div>
            </div>
            {bestAgent?.trajectory && bestAgent.trajectory.length > 1 && (
              <Sparkline
                data={bestAgent.trajectory}
                width={200}
                height={40}
                color={scoreEnd >= scoreStart ? "var(--success)" : "var(--destructive)"}
              />
            )}
            <div class="ml-auto">
              <div class="w-40 h-3 bg-muted rounded-full overflow-hidden">
                <div
                  class="h-full bg-success rounded-full transition-all"
                  style={{ width: `${Math.round(scoreEnd * 100)}%` }}
                />
              </div>
              <div class="text-[10px] text-muted-foreground text-right mt-0.5">{Math.round(scoreEnd * 100)}%</div>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline */}
      <div class="bg-card rounded-lg border border-border p-4">
        <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-4">Pipeline</h3>
        <div class="flex items-center justify-between text-center">
          {[
            { label: "DETECT", count: detectCount, color: "text-accent-foreground", detail: "insights" },
            { label: "PROPOSE", count: proposeCount, color: "text-warning", detail: "PRs" },
            { label: "EVAL", count: evalCount, color: "text-info", detail: "runs" },
            { label: "MERGE", count: mergeCount, color: "text-success", detail: "merged" },
            { label: "LEARN", count: flowRuns, color: "text-info/70", detail: "flows" },
          ].map((stage, i) => (
            <div key={stage.label} class="flex items-center">
              {i > 0 && (
                <svg width="24" height="16" class="text-muted-foreground/30 mx-1 shrink-0">
                  <path d="M2 8h16M14 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" />
                </svg>
              )}
              <div>
                <div class={cn("text-2xl font-bold tabular-nums", stage.color)}>{stage.count}</div>
                <div class="text-[10px] mono text-muted-foreground uppercase tracking-wider">{stage.label}</div>
                <div class="text-[10px] text-muted-foreground">{stage.detail}</div>
              </div>
            </div>
          ))}
        </div>
        {rejectCount > 0 && (
          <div class="flex items-center gap-2 mt-3 text-xs text-destructive">
            <span class="mono">{rejectCount} rejected</span>
          </div>
        )}
      </div>

      {/* Agents */}
      {agents.length > 0 && (
        <div class="bg-card rounded-lg border border-border p-4">
          <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-3">Agents</h3>
          <div class="space-y-2">
            {agents
              .sort((a, b) => (b.composite || 0) - (a.composite || 0))
              .map(agent => (
                <div key={agent.agent} class="flex items-center gap-3">
                  <span class={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    agent.delta != null && agent.delta > 0 ? "bg-success" : "bg-muted-foreground/50",
                  )} />
                  <span class="text-sm font-medium flex-1 truncate">{agent.agent}</span>
                  <span class="text-sm mono tabular-nums text-muted-foreground">
                    {agent.composite != null ? agent.composite.toFixed(4) : "\u2014"}
                  </span>
                  {agent.trajectory && agent.trajectory.length > 1 && (
                    <Sparkline data={agent.trajectory} width={80} height={24} />
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Recent Cycles */}
      {cycles.length > 0 && (
        <div class="bg-card rounded-lg border border-border p-4">
          <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-3">Recent Cycles</h3>
          <div class="space-y-1">
            {cycles.slice(0, 20).map((c, i) => (
              <div
                key={`${c.ts}-${i}`}
                class={cn(
                  "flex items-center gap-3 py-2 px-2 text-sm rounded -mx-2",
                  c.improved === true && "bg-success/5",
                  c.improved === false && "bg-destructive/5",
                )}
              >
                {/* Timestamp */}
                <span class="text-[10px] text-muted-foreground mono w-12 shrink-0">{timeAgo(c.ts)}</span>

                {/* Status indicator */}
                <span class={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  c.improved === true ? "bg-success" : c.improved === false ? "bg-destructive" : "bg-muted-foreground/50",
                )} />

                {/* Experiment name/description */}
                <span class="truncate flex-1 text-foreground" title={c.branch || c.agent}>
                  {c.description || c.branch || c.agent || "Eval run"}
                </span>

                {/* Score badge */}
                {c.composite != null && (
                  <span class="text-xs mono tabular-nums bg-muted px-1.5 py-0.5 rounded">
                    {c.composite.toFixed(2)}
                  </span>
                )}

                {/* Delta badge */}
                {c.delta != null && (
                  <span class={cn(
                    "text-xs mono tabular-nums px-1.5 py-0.5 rounded",
                    c.delta >= 0 ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive",
                  )}>
                    {c.delta >= 0 ? "+" : ""}{c.delta.toFixed(3)}
                  </span>
                )}

                {/* Test count */}
                {c.testsTotal != null && (
                  <span class="text-[10px] text-muted-foreground mono whitespace-nowrap">
                    {c.testsPassed != null && c.testsPassed !== c.testsTotal
                      ? `${c.testsPassed}/${c.testsTotal}`
                      : `${c.testsTotal}`} tests
                  </span>
                )}

                {/* PR number */}
                {c.prNumber && (
                  <span class="text-[10px] mono text-muted-foreground">#{c.prNumber}</span>
                )}

                {/* Status text */}
                <span class={cn(
                  "text-[10px] mono w-14 text-right",
                  c.improved === true ? "text-success" : c.improved === false ? "text-destructive" : "text-muted-foreground",
                )}>
                  {c.improved === true ? "\u2713 merged" : c.improved === false ? "\u2717 rejected" : "\u2014"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {cycles.length === 0 && (
        <div class="bg-card rounded-lg border border-border p-8 text-center">
          <div class="text-sm text-muted-foreground">No eval cycles yet</div>
          <div class="text-xs text-muted-foreground/70 mt-1">
            Run <span class="mono">jfl peter pr --task "add tests"</span> to start the loop
          </div>
        </div>
      )}
    </div>
  )
}
