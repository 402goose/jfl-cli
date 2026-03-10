import { api, HubEvent, ContextItem } from "@/api"
import { usePolling, useSSE, timeAgo, cn } from "@/lib/hooks"
import { useState, useCallback } from "preact/hooks"

type ActivityItem = {
  id: string
  ts: string
  kind: "event" | "journal"
  type: string
  title: string
  detail?: string
  source?: string
  files?: string[]
  data?: Record<string, unknown>
}

function mergeActivity(events: HubEvent[], journal: ContextItem[]): ActivityItem[] {
  const items: ActivityItem[] = []

  for (const ev of events) {
    if (ev.type === "session:started" || ev.type === "session:ended") continue
    const d = ev.data || {}
    let title: string
    let detail: string | undefined
    if (ev.type === "hook:tool-use") {
      const toolName = d.tool_name as string || "tool"
      const files = d.file_paths as string[] || []
      title = files.length > 0 ? `${toolName} → ${files[0]}${files.length > 1 ? ` +${files.length - 1}` : ""}` : toolName
      detail = d.hook_event_name as string || ev.source
    } else if (ev.type === "hook:subagent-start" || ev.type === "hook:subagent-stop") {
      title = `Agent ${ev.type === "hook:subagent-start" ? "started" : "stopped"}`
      detail = ev.source
    } else {
      title = d.title as string || ev.type
      detail = d.summary as string || ev.source
    }
    items.push({
      id: ev.id,
      ts: ev.ts,
      kind: "event",
      type: ev.type,
      title,
      detail,
      source: ev.source,
      data: ev.data,
    })
  }

  for (const j of journal) {
    if (j.type === "file") continue
    items.push({
      id: `j-${j.timestamp}-${j.title}`,
      ts: j.timestamp,
      kind: "journal",
      type: j.type,
      title: j.title,
      detail: j.content,
      source: j.source,
    })
  }

  items.sort((a, b) => b.ts.localeCompare(a.ts))

  const seen = new Set<string>()
  return items.filter(item => {
    const key = `${item.kind}-${item.title}-${item.ts.slice(0, 16)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function groupByDay(items: ActivityItem[]): Record<string, ActivityItem[]> {
  const groups: Record<string, ActivityItem[]> = {}
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  for (const item of items) {
    const day = item.ts.slice(0, 10)
    const label = day === today ? "Today" : day === yesterday ? "Yesterday" : day
    if (!groups[label]) groups[label] = []
    groups[label].push(item)
  }
  return groups
}

const presets = [
  { label: "All", filter: "" },
  { label: "Eval", filter: "eval" },
  { label: "Agent", filter: "peter" },
  { label: "Decision", filter: "decision" },
  { label: "Feature", filter: "feature" },
  { label: "Fix", filter: "fix" },
  { label: "Flow", filter: "flow" },
  { label: "Telemetry", filter: "telemetry" },
]

const kindIcon: Record<string, string> = {
  event: "\u25cf",
  journal: "\u25c6",
}

const typeColorMap: Record<string, string> = {
  "eval:scored": "text-info",
  "peter:pr-created": "text-warning",
  "peter:pr-proposed": "text-warning",
  "telemetry:insight": "text-accent-foreground",
  "flow:triggered": "text-info/70",
  "flow:completed": "text-success",
  feature: "text-success",
  fix: "text-destructive",
  decision: "text-warning",
  milestone: "text-info",
  discovery: "text-info/70",
}

export function ActivityPage() {
  const [liveEvents, setLiveEvents] = useState<HubEvent[]>([])
  const [filter, setFilter] = useState("")
  const [search, setSearch] = useState("")
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const events = usePolling(() => api.events(200), 10000)
  const journal = usePolling(() => api.journal(), 10000)
  const sseState = useSSE("/api/events/stream", useCallback((event: unknown) => {
    setLiveEvents(prev => [event as HubEvent, ...prev].slice(0, 50))
  }, []))

  const allEvents = [...liveEvents, ...(events.data?.events || [])]
  const uniqueEvents = allEvents.filter(
    (ev, i, arr) => arr.findIndex(e => e.id === ev.id) === i,
  )

  const items = mergeActivity(uniqueEvents, journal.data || [])

  const filtered = items.filter(item => {
    if (filter) {
      const matchesType = item.type.toLowerCase().includes(filter)
      if (!matchesType) return false
    }
    if (search) {
      const q = search.toLowerCase()
      return (
        item.title.toLowerCase().includes(q) ||
        item.detail?.toLowerCase().includes(q) ||
        item.type.toLowerCase().includes(q)
      )
    }
    return true
  })

  const grouped = groupByDay(filtered)
  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div class="space-y-5">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Activity</h1>
        <div class="flex items-center gap-3">
          {sseState.connected && (
            <span class="text-xs text-success mono animate-pulse-dot">LIVE</span>
          )}
          <span class="text-sm text-muted-foreground">{filtered.length} items</span>
        </div>
      </div>

      <div class="relative">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          placeholder="Search activity..."
          value={search}
          onInput={e => setSearch((e.target as HTMLInputElement).value)}
          class="w-full bg-card border border-border rounded-lg pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-info/50 transition-colors"
        />
      </div>

      <div class="flex flex-wrap gap-1.5">
        {presets.map(p => (
          <button
            key={p.filter}
            onClick={() => setFilter(filter === p.filter ? "" : p.filter)}
            class={cn(
              "text-[11px] mono font-medium px-2 py-0.5 rounded-md transition-colors",
              filter === p.filter
                ? "bg-foreground/10 text-foreground"
                : "bg-muted/50 text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {Object.entries(grouped).map(([day, dayItems]) => (
        <div key={day}>
          <div class="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-2 sticky top-0 bg-background py-1">
            {day}
          </div>
          <div class="space-y-0.5">
            {dayItems.map(item => {
              const expanded = expandedIds.has(item.id)
              const colorClass = typeColorMap[item.type] || "text-foreground"
              const icon = kindIcon[item.kind] || "\u25cb"
              const evalDelta = item.data?.delta as number | undefined
              const evalImproved = item.data?.improved === "true" || item.data?.improved === true

              return (
                <button
                  key={item.id}
                  onClick={() => toggleExpand(item.id)}
                  class="w-full text-left flex items-start gap-3 py-2 px-3 rounded hover:bg-muted/30 transition-colors animate-fade-in"
                >
                  <span class="text-[10px] text-muted-foreground mono whitespace-nowrap mt-0.5 w-14 shrink-0">
                    {timeAgo(item.ts)}
                  </span>
                  <span class={cn("text-xs mt-0.5 shrink-0", item.kind === "journal" ? "text-success" : "text-info")}>
                    {icon}
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class={cn("text-xs mono font-medium whitespace-nowrap", colorClass)}>
                        {item.type}
                      </span>
                      <span class="text-sm truncate">{item.title}</span>
                      {evalDelta != null && (
                        <span class={cn(
                          "text-xs mono ml-auto shrink-0",
                          evalImproved ? "text-success" : "text-destructive",
                        )}>
                          {evalDelta >= 0 ? "+" : ""}{Number(evalDelta).toFixed(3)}
                        </span>
                      )}
                    </div>
                    {expanded && item.detail && (
                      <div class="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                        {item.detail}
                      </div>
                    )}
                    {expanded && item.files && item.files.length > 0 && (
                      <div class="flex flex-wrap gap-1 mt-1">
                        {item.files.map(f => (
                          <span key={f} class="text-[10px] mono bg-muted/50 px-1.5 py-0.5 rounded">{f}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div class="bg-card rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {search || filter ? "No matching activity" : "No activity yet"}
        </div>
      )}
    </div>
  )
}
