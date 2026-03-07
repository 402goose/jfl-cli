import { JournalEntry } from "@/api"
import { timeAgo } from "@/lib/hooks"

interface JournalFeedProps {
  entries: JournalEntry[]
  maxItems?: number
}

const typeBadge: Record<string, { bg: string; text: string }> = {
  feature: { bg: "bg-success/10", text: "text-success" },
  fix: { bg: "bg-destructive/10", text: "text-destructive" },
  decision: { bg: "bg-warning/10", text: "text-warning" },
  milestone: { bg: "bg-info/10", text: "text-info" },
  discovery: { bg: "bg-accent", text: "text-accent-foreground" },
  spec: { bg: "bg-muted", text: "text-muted-foreground" },
}

export function JournalFeed({ entries, maxItems = 10 }: JournalFeedProps) {
  const shown = entries.slice(0, maxItems)

  if (!shown.length) {
    return (
      <div class="text-sm text-muted-foreground py-8 text-center">No journal entries</div>
    )
  }

  return (
    <div class="space-y-2">
      {shown.map((entry, i) => {
        const badge = typeBadge[entry.type] || typeBadge.spec
        return (
          <div
            key={`${entry.ts}-${i}`}
            class="bg-card rounded-lg border border-border p-3 animate-fade-in"
          >
            <div class="flex items-center gap-2 mb-1">
              <span class={`text-[10px] mono font-medium px-1.5 py-0.5 rounded ${badge.bg} ${badge.text}`}>
                {entry.type}
              </span>
              {entry.status && (
                <span class="text-[10px] text-muted-foreground">{entry.status}</span>
              )}
              <span class="text-[10px] text-muted-foreground ml-auto mono">
                {timeAgo(entry.ts)}
              </span>
            </div>
            <div class="text-sm font-medium mb-0.5">{entry.title}</div>
            <div class="text-xs text-muted-foreground">{entry.summary}</div>
            {entry.files && entry.files.length > 0 && (
              <div class="mt-2 flex flex-wrap gap-1">
                {entry.files.slice(0, 4).map((f) => (
                  <span key={f} class="text-[10px] mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {f.split("/").pop()}
                  </span>
                ))}
                {entry.files.length > 4 && (
                  <span class="text-[10px] text-muted-foreground">
                    +{entry.files.length - 4} more
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
