import { api, ContextItem } from "@/api"
import { usePolling, timeAgo, cn } from "@/lib/hooks"
import { useState } from "preact/hooks"

export function JournalPage() {
  const journal = usePolling(() => api.journal(), 10000)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  const entries = journal.data || []

  const typeCounts: Record<string, number> = {}
  for (const e of entries) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1
  }
  const typeEntries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])
  const maxCount = Math.max(...Object.values(typeCounts), 1)

  const typeColors: Record<string, string> = {
    feature: "bg-success",
    fix: "bg-destructive",
    decision: "bg-warning",
    milestone: "bg-info",
    discovery: "bg-info/70",
    submission: "bg-accent",
    iteration: "bg-muted-foreground",
    spec: "bg-muted-foreground/70",
  }

  const filtered = entries.filter((e) => {
    if (typeFilter && e.type !== typeFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        e.title.toLowerCase().includes(q) ||
        e.content?.toLowerCase().includes(q) ||
        e.source?.toLowerCase().includes(q)
      )
    }
    return true
  })

  return (
    <div class="space-y-5">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Journal</h1>
        <span class="text-sm text-muted-foreground">{filtered.length} entries</span>
      </div>

      <div class="relative">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          placeholder="Search journal entries..."
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          class="w-full bg-card border border-border rounded-lg pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-info/50 transition-colors"
        />
      </div>

      {typeEntries.length > 0 && (
        <div class="flex flex-wrap gap-1.5">
          <button
            onClick={() => setTypeFilter(null)}
            class={cn(
              "text-[11px] mono font-medium px-2 py-0.5 rounded-md transition-colors",
              !typeFilter
                ? "bg-foreground/10 text-foreground"
                : "bg-muted/50 text-muted-foreground hover:text-foreground",
            )}
          >
            all
          </button>
          {typeEntries.map(([type, count]) => (
            <button
              key={type}
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
              class={cn(
                "text-[11px] mono font-medium px-2 py-0.5 rounded-md transition-colors",
                typeFilter === type
                  ? "bg-foreground/10 text-foreground"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground",
              )}
            >
              {type}
              <span class="ml-1 text-[10px] opacity-60">{count}</span>
            </button>
          ))}
        </div>
      )}

      {typeEntries.length > 0 && !search && !typeFilter && (
        <div class="bg-card rounded-lg border border-border p-4">
          <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-3">By Type</h3>
          <div class="space-y-1.5">
            {typeEntries.map(([type, count]) => (
              <div key={type} class="flex items-center gap-3">
                <span class={`text-[10px] mono font-medium px-1.5 py-0.5 rounded ${typeColors[type] || "bg-muted"} text-white min-w-16 text-center uppercase`}>
                  {type}
                </span>
                <div class="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    class={`h-full rounded-full ${typeColors[type] || "bg-muted-foreground"} transition-all`}
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                </div>
                <span class="text-xs mono text-muted-foreground w-6 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {journal.loading ? (
        <div class="text-sm text-muted-foreground animate-pulse-dot">Loading journal...</div>
      ) : filtered.length === 0 ? (
        <div class="bg-card rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          {search || typeFilter ? "No matching entries" : "No journal entries"}
        </div>
      ) : (
        <div class="space-y-1.5">
          {filtered.map((entry, i) => (
            <JournalRow key={`${entry.timestamp}-${i}`} entry={entry} highlight={search} />
          ))}
        </div>
      )}
    </div>
  )
}

function JournalRow({ entry, highlight }: { entry: ContextItem; highlight?: string }) {
  const [expanded, setExpanded] = useState(false)

  const typeBadge: Record<string, { bg: string; text: string }> = {
    feature: { bg: "bg-success/10", text: "text-success" },
    fix: { bg: "bg-destructive/10", text: "text-destructive" },
    decision: { bg: "bg-warning/10", text: "text-warning" },
    milestone: { bg: "bg-info/10", text: "text-info" },
    discovery: { bg: "bg-accent", text: "text-accent-foreground" },
  }
  const badge = typeBadge[entry.type] || { bg: "bg-muted", text: "text-muted-foreground" }

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      class="w-full text-left bg-card rounded-lg border border-border p-3 hover:border-border/80 transition-colors animate-fade-in"
    >
      <div class="flex items-center gap-2 mb-1">
        <span class={`text-[10px] mono font-medium px-1.5 py-0.5 rounded ${badge.bg} ${badge.text}`}>
          {entry.type}
        </span>
        <span class="text-[10px] text-muted-foreground mono truncate">{entry.source}</span>
        <span class="text-[10px] text-muted-foreground ml-auto mono shrink-0">
          {timeAgo(entry.timestamp)}
        </span>
      </div>
      <div class="text-sm font-medium">{entry.title}</div>
      {entry.content && (
        <div class={cn(
          "text-xs text-muted-foreground mt-1",
          expanded ? "" : "line-clamp-2",
        )}>
          {entry.content}
        </div>
      )}
    </button>
  )
}
