import { HubEvent } from "@/api"
import { timeAgo } from "@/lib/hooks"

interface EventFeedProps {
  events: HubEvent[]
  maxItems?: number
}

const typeColors: Record<string, string> = {
  "eval:scored": "text-info",
  "flow:triggered": "text-warning",
  "journal:entry": "text-success",
  "session:started": "text-accent-foreground",
  "session:ended": "text-muted-foreground",
  "error": "text-destructive",
}

export function EventFeed({ events, maxItems = 20 }: EventFeedProps) {
  const shown = events.slice(0, maxItems)

  if (!shown.length) {
    return (
      <div class="text-sm text-muted-foreground py-8 text-center">No events yet</div>
    )
  }

  return (
    <div class="space-y-1">
      {shown.map((ev) => (
        <div
          key={ev.id}
          class="flex items-start gap-3 py-2 px-3 rounded hover:bg-muted/30 transition-colors text-sm animate-fade-in"
        >
          <span class="text-[10px] text-muted-foreground mono whitespace-nowrap mt-0.5">
            {timeAgo(ev.ts)}
          </span>
          <span
            class={`text-xs mono font-medium whitespace-nowrap ${typeColors[ev.type] || "text-foreground"}`}
          >
            {ev.type}
          </span>
          <span class="text-xs text-muted-foreground truncate flex-1">
            {ev.source}
            {ev.data?.agent && ` / ${ev.data.agent}`}
            {ev.data?.title && ` — ${ev.data.title}`}
            {ev.data?.composite != null && ` (${Number(ev.data.composite).toFixed(4)})`}
          </span>
        </div>
      ))}
    </div>
  )
}
