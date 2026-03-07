import { HubEvent, ContextItem } from "@/api"

interface ActivityChartProps {
  events: HubEvent[]
  journalItems: ContextItem[]
}

interface DayBucket {
  label: string
  date: string
  events: number
  journal: number
}

function bucketByDay(events: HubEvent[], journalItems: ContextItem[]): DayBucket[] {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const buckets: DayBucket[] = []

  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    buckets.push({
      label: dayNames[d.getDay()],
      date: dateStr,
      events: 0,
      journal: 0,
    })
  }

  for (const ev of events) {
    const dateStr = ev.ts?.slice(0, 10)
    const bucket = buckets.find((b) => b.date === dateStr)
    if (bucket) bucket.events++
  }

  for (const item of journalItems) {
    const dateStr = item.timestamp?.slice(0, 10)
    const bucket = buckets.find((b) => b.date === dateStr)
    if (bucket) bucket.journal++
  }

  return buckets
}

export function ActivityChart({ events, journalItems }: ActivityChartProps) {
  const days = bucketByDay(events, journalItems)
  const maxVal = Math.max(...days.map((d) => d.events + d.journal), 1)

  return (
    <div class="bg-card rounded-lg border border-border p-4 animate-fade-in">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-medium">Activity</h3>
        <span class="text-xs text-muted-foreground">last 7 days</span>
      </div>
      <div class="flex items-end justify-between gap-2 h-24">
        {days.map((day) => {
          const total = day.events + day.journal
          const eventH = maxVal > 0 ? (day.events / maxVal) * 80 : 0
          const journalH = maxVal > 0 ? (day.journal / maxVal) * 80 : 0
          return (
            <div key={day.date} class="flex-1 flex flex-col items-center gap-1">
              <div class="w-full flex flex-col items-center justify-end h-20">
                <div class="w-full max-w-8 flex flex-col-reverse gap-px">
                  {day.journal > 0 && (
                    <div
                      class="w-full bg-success/80 rounded-t-sm"
                      style={{ height: `${Math.max(journalH, 3)}px` }}
                    />
                  )}
                  {day.events > 0 && (
                    <div
                      class="w-full bg-info/60 rounded-t-sm"
                      style={{ height: `${Math.max(eventH, 3)}px` }}
                    />
                  )}
                </div>
              </div>
              <span class="text-[10px] text-muted-foreground">{day.label}</span>
              <span class="text-[10px] mono text-muted-foreground">{total}</span>
            </div>
          )
        })}
      </div>
      <div class="flex items-center gap-4 mt-3 justify-center">
        <span class="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span class="inline-block w-2.5 h-2.5 rounded-sm bg-info/60" /> events
        </span>
        <span class="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <span class="inline-block w-2.5 h-2.5 rounded-sm bg-success/80" /> journal
        </span>
      </div>
    </div>
  )
}
