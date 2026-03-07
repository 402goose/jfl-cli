import { api, HubEvent } from "@/api"
import { EventFeed } from "@/components"
import { usePolling, useSSE, cn } from "@/lib/hooks"
import { useState, useCallback } from "preact/hooks"

const presets = [
  { label: "All", pattern: "" },
  { label: "Eval", pattern: "eval:*" },
  { label: "Session", pattern: "session:*" },
  { label: "Journal", pattern: "journal:*" },
  { label: "Peter", pattern: "peter:*" },
  { label: "Flow", pattern: "flow:*" },
  { label: "Service", pattern: "service:*" },
  { label: "Hook", pattern: "hook:*" },
]

export function EventsPage() {
  const [liveEvents, setLiveEvents] = useState<HubEvent[]>([])
  const [pattern, setPattern] = useState("")
  const [customPattern, setCustomPattern] = useState("")

  const events = usePolling(
    () => api.events(100, pattern || undefined),
    10000,
    [pattern],
  )

  useSSE("/api/events/stream", useCallback((event: unknown) => {
    setLiveEvents((prev) => [event as HubEvent, ...prev].slice(0, 50))
  }, []))

  const allEvents = [...liveEvents, ...(events.data?.events || [])]
  const unique = allEvents.filter(
    (ev, i, arr) => arr.findIndex((e) => e.id === ev.id) === i,
  )

  const filtered = pattern
    ? unique.filter((ev) => {
        if (!pattern.includes("*")) return ev.type === pattern
        const prefix = pattern.replace("*", "")
        return ev.type.startsWith(prefix)
      })
    : unique

  return (
    <div class="space-y-5">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Events</h1>
        <div class="flex items-center gap-3">
          {liveEvents.length > 0 && (
            <span class="text-xs text-success mono animate-pulse-dot">LIVE</span>
          )}
          <span class="text-sm text-muted-foreground">{filtered.length} events</span>
        </div>
      </div>

      <div class="space-y-2">
        <div class="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.pattern}
              onClick={() => {
                setPattern(p.pattern)
                setCustomPattern("")
              }}
              class={cn(
                "text-[11px] mono font-medium px-2 py-0.5 rounded-md transition-colors",
                pattern === p.pattern
                  ? "bg-foreground/10 text-foreground"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div class="relative">
          <svg
            width="14"
            height="14"
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
            placeholder="Custom pattern (e.g. peter:*, eval:scored)"
            value={customPattern}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value
              setCustomPattern(v)
              setPattern(v)
            }}
            class="w-full bg-card border border-border rounded-lg pl-9 pr-4 py-1.5 text-xs mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-info/50 transition-colors"
          />
        </div>
      </div>

      <div class="bg-card rounded-lg border border-border">
        {events.loading && filtered.length === 0 ? (
          <div class="p-4 text-sm text-muted-foreground animate-pulse-dot">Loading events...</div>
        ) : (
          <EventFeed events={filtered} maxItems={100} />
        )}
      </div>
    </div>
  )
}
