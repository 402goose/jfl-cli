import { api, HubEvent } from "@/api"
import { usePolling, useSSE, cn, timeAgo } from "@/lib/hooks"
import { useState, useCallback, useMemo } from "preact/hooks"

type Severity = "red" | "yellow" | "green"

interface Finding {
  file: string
  line?: number
  severity: Severity
  category: string
  message: string
  suggestion?: string
}

interface ReviewEvent {
  id: string
  ts: string
  pr?: number
  branch?: string
  agent?: string
  findings: Finding[]
  summary?: string
  source: string
}

function parseReviewEvent(ev: HubEvent): ReviewEvent {
  const d = ev.data || {}
  const findings: Finding[] = []

  if (Array.isArray(d.findings)) {
    for (const f of d.findings) {
      findings.push({
        file: (f as any).file || "unknown",
        line: (f as any).line,
        severity: ((f as any).severity || "yellow") as Severity,
        category: (f as any).category || "general",
        message: (f as any).message || "",
        suggestion: (f as any).suggestion,
      })
    }
  }

  return {
    id: ev.id,
    ts: ev.ts,
    pr: d.pr as number | undefined,
    branch: (d.branch || d.ref) as string | undefined,
    agent: (d.agent || ev.source) as string,
    findings,
    summary: d.summary as string | undefined,
    source: ev.source,
  }
}

const severityConfig: Record<Severity, { bg: string; text: string; label: string }> = {
  red: { bg: "bg-destructive/15", text: "text-destructive", label: "RED" },
  yellow: { bg: "bg-warning/15", text: "text-warning", label: "YLW" },
  green: { bg: "bg-success/15", text: "text-success", label: "OK" },
}

const severityFilters = [
  { label: "All", value: "" },
  { label: "Red", value: "red" },
  { label: "Yellow", value: "yellow" },
  { label: "Green", value: "green" },
]

export function ReviewsPage() {
  const [liveEvents, setLiveEvents] = useState<HubEvent[]>([])
  const [severityFilter, setSeverityFilter] = useState("")
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const events = usePolling(
    () => api.events(200, "review:*"),
    15000,
  )

  useSSE("/api/events/stream", useCallback((event: unknown) => {
    const ev = event as HubEvent
    if (ev.type?.startsWith("review:")) {
      setLiveEvents((prev) => [ev, ...prev].slice(0, 50))
    }
  }, []))

  const allEvents = [...liveEvents, ...(events.data?.events || [])]
  const unique = allEvents.filter(
    (ev, i, arr) => arr.findIndex((e) => e.id === ev.id) === i,
  )

  const reviews = useMemo(
    () => unique.map(parseReviewEvent).sort((a, b) => b.ts.localeCompare(a.ts)),
    [unique],
  )

  const filtered = severityFilter
    ? reviews.filter((r) => r.findings.some((f) => f.severity === severityFilter))
    : reviews

  const stats = useMemo(() => {
    let red = 0, yellow = 0, green = 0
    for (const r of reviews) {
      for (const f of r.findings) {
        if (f.severity === "red") red++
        else if (f.severity === "yellow") yellow++
        else green++
      }
    }
    return { red, yellow, green, total: reviews.length }
  }, [reviews])

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div class="space-y-5">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Reviews</h1>
        <div class="flex items-center gap-3">
          {liveEvents.length > 0 && (
            <span class="text-xs text-success mono animate-pulse-dot">LIVE</span>
          )}
          <span class="text-sm text-muted-foreground">{filtered.length} reviews</span>
        </div>
      </div>

      <div class="grid grid-cols-4 gap-3">
        <StatCard label="Reviews" value={stats.total} color="text-foreground" />
        <StatCard label="Red Findings" value={stats.red} color="text-destructive" />
        <StatCard label="Yellow Findings" value={stats.yellow} color="text-warning" />
        <StatCard label="Green Findings" value={stats.green} color="text-success" />
      </div>

      <div class="flex flex-wrap gap-1.5">
        {severityFilters.map((f) => (
          <button
            key={f.value}
            onClick={() => setSeverityFilter(f.value)}
            class={cn(
              "text-[11px] mono font-medium px-2 py-0.5 rounded-md transition-colors",
              severityFilter === f.value
                ? "bg-foreground/10 text-foreground"
                : "bg-muted/50 text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div class="bg-card rounded-lg border border-border">
        {events.loading && filtered.length === 0 ? (
          <div class="p-4 text-sm text-muted-foreground animate-pulse-dot">Loading reviews...</div>
        ) : filtered.length === 0 ? (
          <div class="py-8 text-sm text-muted-foreground text-center">
            No review events yet. Reviews appear when AI eval runs on PRs.
          </div>
        ) : (
          <div class="divide-y divide-border/50">
            {filtered.map((review) => (
              <ReviewCard
                key={review.id}
                review={review}
                expanded={expandedIds.has(review.id)}
                onToggle={() => toggleExpand(review.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div class="bg-card rounded-lg border border-border p-3">
      <div class="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div class={cn("text-2xl font-semibold mono tabular-nums mt-1", color)}>{value}</div>
    </div>
  )
}

function ReviewCard({
  review,
  expanded,
  onToggle,
}: {
  review: ReviewEvent
  expanded: boolean
  onToggle: () => void
}) {
  const redCount = review.findings.filter((f) => f.severity === "red").length
  const yellowCount = review.findings.filter((f) => f.severity === "yellow").length
  const greenCount = review.findings.filter((f) => f.severity === "green").length

  return (
    <div class="animate-fade-in">
      <button
        onClick={onToggle}
        class="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors text-left"
      >
        <div class="flex items-center gap-1.5 shrink-0">
          {redCount > 0 && <SeverityBadge severity="red" count={redCount} />}
          {yellowCount > 0 && <SeverityBadge severity="yellow" count={yellowCount} />}
          {greenCount > 0 && <SeverityBadge severity="green" count={greenCount} />}
          {review.findings.length === 0 && <SeverityBadge severity="green" count={0} />}
        </div>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            {review.pr && (
              <span class="text-xs mono font-medium text-info">PR #{review.pr}</span>
            )}
            {review.branch && (
              <span class="text-xs mono text-muted-foreground truncate">{review.branch}</span>
            )}
          </div>
          {review.summary && (
            <div class="text-xs text-muted-foreground mt-0.5 truncate">{review.summary}</div>
          )}
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[10px] mono text-muted-foreground">{review.agent}</span>
          <span class="text-[10px] mono text-muted-foreground whitespace-nowrap">
            {timeAgo(review.ts)}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class={cn(
              "text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {expanded && review.findings.length > 0 && (
        <div class="px-4 pb-3 space-y-1.5">
          {review.findings.map((finding, i) => (
            <FindingRow key={i} finding={finding} />
          ))}
        </div>
      )}
    </div>
  )
}

function SeverityBadge({ severity, count }: { severity: Severity; count: number }) {
  const config = severityConfig[severity]
  return (
    <span class={cn("text-[10px] mono font-medium px-1.5 py-0.5 rounded", config.bg, config.text)}>
      {count > 0 ? count : config.label}
    </span>
  )
}

function FindingRow({ finding }: { finding: Finding }) {
  const config = severityConfig[finding.severity]
  return (
    <div class={cn("rounded-md px-3 py-2 text-xs", config.bg)}>
      <div class="flex items-center gap-2">
        <span class={cn("mono font-medium", config.text)}>{config.label}</span>
        <span class="mono text-muted-foreground">
          {finding.file}
          {finding.line && `:${finding.line}`}
        </span>
        <span class="text-muted-foreground/60 mono">{finding.category}</span>
      </div>
      <div class="mt-1 text-foreground">{finding.message}</div>
      {finding.suggestion && (
        <div class="mt-1 text-muted-foreground italic">{finding.suggestion}</div>
      )}
    </div>
  )
}
