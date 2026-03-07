import { api, HubEvent } from "@/api"
import { EventFeed } from "@/components"
import { usePolling, useSSE } from "@/lib/hooks"
import { useState, useCallback } from "preact/hooks"

export function EventsPage() {
  const [liveEvents, setLiveEvents] = useState<HubEvent[]>([])
  const events = usePolling(() => api.events(100), 10000)

  useSSE("/api/events/stream", useCallback((event: unknown) => {
    setLiveEvents((prev) => [event as HubEvent, ...prev].slice(0, 50))
  }, []))

  const allEvents = [...liveEvents, ...(events.data?.events || [])]
  const unique = allEvents.filter(
    (ev, i, arr) => arr.findIndex((e) => e.id === ev.id) === i,
  )

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Events</h1>
        <div class="flex items-center gap-3">
          {liveEvents.length > 0 && (
            <span class="text-xs text-success mono animate-pulse-dot">LIVE</span>
          )}
          <span class="text-sm text-muted-foreground">{unique.length} events</span>
        </div>
      </div>

      <div class="bg-card rounded-lg border border-border">
        {events.loading && unique.length === 0 ? (
          <div class="p-4 text-sm text-muted-foreground">Loading events...</div>
        ) : (
          <EventFeed events={unique} maxItems={100} />
        )}
      </div>
    </div>
  )
}
