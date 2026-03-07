import { api, ContextItem } from "@/api"
import { usePolling, timeAgo } from "@/lib/hooks"

export function JournalPage() {
  const journal = usePolling(() => api.journal(), 10000)

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

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Journal</h1>
        <span class="text-sm text-muted-foreground">{entries.length} entries</span>
      </div>

      {typeEntries.length > 0 && (
        <div class="bg-card rounded-lg border border-border p-4">
          <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-3">By Type</h3>
          <div class="space-y-2">
            {typeEntries.map(([type, count]) => (
              <div key={type} class="flex items-center gap-3">
                <span class={`text-[10px] mono font-medium px-1.5 py-0.5 rounded ${typeColors[type] || "bg-muted"} text-white min-w-16 text-center uppercase`}>
                  {type}
                </span>
                <div class="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    class={`h-full rounded-full ${typeColors[type] || "bg-muted-foreground"}`}
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
        <div class="text-sm text-muted-foreground">Loading journal...</div>
      ) : entries.length === 0 ? (
        <div class="bg-card rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          No journal entries
        </div>
      ) : (
        <div class="space-y-2">
          {entries.map((entry, i) => (
            <JournalRow key={`${entry.timestamp}-${i}`} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}

function JournalRow({ entry }: { entry: ContextItem }) {
  const typeColors: Record<string, { bg: string; text: string }> = {
    feature: { bg: "bg-success/10", text: "text-success" },
    fix: { bg: "bg-destructive/10", text: "text-destructive" },
    decision: { bg: "bg-warning/10", text: "text-warning" },
    milestone: { bg: "bg-info/10", text: "text-info" },
    discovery: { bg: "bg-accent", text: "text-accent-foreground" },
  }
  const badge = typeColors[entry.type] || { bg: "bg-muted", text: "text-muted-foreground" }

  return (
    <div class="bg-card rounded-lg border border-border p-3 animate-fade-in">
      <div class="flex items-center gap-2 mb-1">
        <span class={`text-[10px] mono font-medium px-1.5 py-0.5 rounded ${badge.bg} ${badge.text}`}>
          {entry.type}
        </span>
        <span class="text-[10px] text-muted-foreground mono truncate">{entry.source}</span>
        <span class="text-[10px] text-muted-foreground ml-auto mono">
          {timeAgo(entry.timestamp)}
        </span>
      </div>
      <div class="text-sm font-medium">{entry.title}</div>
      {entry.content && (
        <div class="text-xs text-muted-foreground mt-1 line-clamp-2">{entry.content}</div>
      )}
    </div>
  )
}
