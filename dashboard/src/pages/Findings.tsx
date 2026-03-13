import { api, Finding, FindingSeverity, FindingType } from "@/api"
import { usePolling, cn, timeAgo } from "@/lib/hooks"
import { useState } from "preact/hooks"

const SEVERITY_STYLES: Record<FindingSeverity, { bg: string; text: string; icon: string }> = {
  critical: { bg: "bg-destructive/10", text: "text-destructive", icon: "🔴" },
  warning: { bg: "bg-warning/10", text: "text-warning", icon: "⚠️" },
  info: { bg: "bg-info/10", text: "text-info", icon: "ℹ️" },
}

const TYPE_LABELS: Record<FindingType, string> = {
  performance_regression: "Performance Regression",
  test_failure: "Test Failure",
  error_spike: "Error Spike",
  coverage_gap: "Coverage Gap",
  stale_code: "Stale Code",
  eval_plateau: "Eval Plateau",
}

export function FindingsPage() {
  const [showDismissed, setShowDismissed] = useState(false)
  const [spawning, setSpawning] = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const findings = usePolling(
    () => api.findings(false, showDismissed),
    30000,
    [showDismissed, refreshKey],
  )

  const handleRefresh = async () => {
    try {
      await api.analyzeFindings()
      setRefreshKey((k) => k + 1)
    } catch (err) {
      console.error("Failed to analyze:", err)
    }
  }

  const handleSpawn = async (finding: Finding) => {
    setSpawning(finding.id)
    try {
      await api.spawnFindingAgent(finding.id)
      setTimeout(() => setSpawning(null), 3000)
    } catch (err) {
      console.error("Failed to spawn:", err)
      setSpawning(null)
    }
  }

  const handleDismiss = async (finding: Finding) => {
    setDismissing(finding.id)
    try {
      await api.dismissFinding(finding.id)
      setRefreshKey((k) => k + 1)
    } catch (err) {
      console.error("Failed to dismiss:", err)
    }
    setDismissing(null)
  }

  const data = findings.data?.findings || []
  const active = data.filter((f) => !f.dismissed)
  const dismissed = data.filter((f) => f.dismissed)

  // Sort by severity
  const severityOrder: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2 }
  active.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  const criticalCount = active.filter((f) => f.severity === "critical").length
  const warningCount = active.filter((f) => f.severity === "warning").length
  const infoCount = active.filter((f) => f.severity === "info").length

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold">Findings</h1>
          <p class="text-sm text-muted-foreground mt-1">
            Automatically detected issues — click Fix to spawn an agent
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            class="text-[10px] mono px-2 py-1 rounded bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {findings.loading ? "analyzing..." : "re-analyze"}
          </button>
          <button
            onClick={() => setShowDismissed(!showDismissed)}
            class={cn(
              "text-[10px] mono px-2 py-1 rounded transition-colors",
              showDismissed
                ? "bg-info/15 text-info"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {showDismissed ? "hide dismissed" : "show dismissed"}
          </button>
        </div>
      </div>

      {/* Summary */}
      {active.length > 0 && (
        <div class="flex items-center gap-4">
          {criticalCount > 0 && (
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-destructive" />
              <span class="text-sm mono">{criticalCount} critical</span>
            </div>
          )}
          {warningCount > 0 && (
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-warning" />
              <span class="text-sm mono">{warningCount} warning</span>
            </div>
          )}
          {infoCount > 0 && (
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-info" />
              <span class="text-sm mono">{infoCount} info</span>
            </div>
          )}
        </div>
      )}

      {findings.loading && data.length === 0 ? (
        <div class="text-sm text-muted-foreground animate-pulse-dot">
          Loading findings...
        </div>
      ) : active.length === 0 && !showDismissed ? (
        <div class="bg-card rounded-lg border border-border p-8 text-center">
          <div class="text-success text-2xl mb-2">✓</div>
          <div class="text-sm font-medium">No active findings</div>
          <div class="text-xs text-muted-foreground mt-1">
            Everything looks good! Run re-analyze to check again.
          </div>
        </div>
      ) : (
        <div class="space-y-4">
          {active.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              spawning={spawning === finding.id}
              dismissing={dismissing === finding.id}
              onSpawn={() => handleSpawn(finding)}
              onDismiss={() => handleDismiss(finding)}
            />
          ))}

          {showDismissed && dismissed.length > 0 && (
            <>
              <div class="text-xs text-muted-foreground uppercase tracking-wider pt-4">
                Dismissed ({dismissed.length})
              </div>
              {dismissed.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  spawning={false}
                  dismissing={false}
                  onSpawn={() => {}}
                  onDismiss={() => {}}
                  disabled
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface FindingCardProps {
  finding: Finding
  spawning: boolean
  dismissing: boolean
  onSpawn: () => void
  onDismiss: () => void
  disabled?: boolean
}

function FindingCard({
  finding,
  spawning,
  dismissing,
  onSpawn,
  onDismiss,
  disabled,
}: FindingCardProps) {
  const [expanded, setExpanded] = useState(false)
  const style = SEVERITY_STYLES[finding.severity]
  const typeLabel = TYPE_LABELS[finding.type]

  return (
    <div
      class={cn(
        "bg-card rounded-lg border border-border overflow-hidden transition-all",
        finding.dismissed && "opacity-50",
      )}
    >
      <div class="p-4">
        <div class="flex items-start gap-3">
          <span class="text-lg leading-none">{style.icon}</span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class={cn("font-medium", style.text)}>{finding.title}</span>
              <span class="text-[10px] mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {typeLabel}
              </span>
            </div>
            <p class="text-sm text-muted-foreground mt-1">{finding.description}</p>

            {finding.scope_files.length > 0 && (
              <div class="mt-2">
                <button
                  onClick={() => setExpanded(!expanded)}
                  class="text-[10px] mono text-info hover:underline"
                >
                  {expanded ? "hide" : "show"} {finding.scope_files.length} file{finding.scope_files.length !== 1 ? "s" : ""}
                </button>
                {expanded && (
                  <div class="mt-2 p-2 bg-muted/30 rounded text-xs mono space-y-0.5 max-h-32 overflow-y-auto">
                    {finding.scope_files.map((f, i) => (
                      <div key={i} class="text-muted-foreground truncate">{f}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {!disabled && (
            <div class="flex items-center gap-2 shrink-0">
              {finding.agent_config && (
                <button
                  onClick={onSpawn}
                  disabled={spawning}
                  class={cn(
                    "text-[10px] mono px-3 py-1.5 rounded transition-colors",
                    spawning
                      ? "bg-success/15 text-success"
                      : "bg-info/15 text-info hover:bg-info/25",
                  )}
                >
                  {spawning ? "spawned!" : "Fix"}
                </button>
              )}
              <button
                onClick={onDismiss}
                disabled={dismissing}
                class="text-[10px] mono px-2 py-1.5 rounded bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                {dismissing ? "..." : "dismiss"}
              </button>
            </div>
          )}
        </div>

        {finding.agent_config && (
          <div class="flex items-center gap-4 mt-3 pt-3 border-t border-border text-[10px] mono text-muted-foreground">
            <span>target: {finding.agent_config.metric} ≥ {finding.agent_config.target}</span>
            <span>rounds: {finding.agent_config.rounds}</span>
            <span>eval: {finding.agent_config.eval_script}</span>
          </div>
        )}
      </div>
    </div>
  )
}
