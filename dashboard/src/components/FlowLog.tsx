/**
 * FlowLog Component
 *
 * Live feed of cross-service events with filtering, auto-scroll,
 * collapsible UI, and event frequency sparkline.
 *
 * @purpose Show real-time cross-service event flow for system observability
 */

import { useState, useEffect, useRef, useCallback } from "preact/hooks"
import { HubEvent } from "@/api"
import { sseSubscribe } from "@/api/client"
import { cn, timeAgo } from "@/lib/hooks"

const C = {
  bg: "#191919",
  card: "rgba(24, 24, 28, 0.95)",
  border: "rgba(60, 60, 60, 0.25)",
  text: "#f5f5f5",
  textMuted: "#8b8b8b",
  textDim: "#5a5a5a",
  data: "#4a7dfc",
  rl: "#a855f7",
  success: "#34d399",
  alert: "#f87171",
  orange: "#FF5722",
}

interface FlowLogProps {
  events?: HubEvent[]
  maxEvents?: number
  pollInterval?: number
  useSSE?: boolean
  collapsed?: boolean
  onToggleCollapse?: (collapsed: boolean) => void
  className?: string
}

type EventCategory = "data" | "rl" | "success" | "alert"

function categorizeEvent(type: string): EventCategory {
  if (type.includes("error") || type.includes("fail") || type.includes("crash") || type.includes("regression")) {
    return "alert"
  }
  if (type.includes("scored") || type.includes("success") || type.includes("complete") || type.includes("pass")) {
    return "success"
  }
  if (type.includes("peter") || type.includes("rollout") || type.includes("experiment") || type.includes("rl:")) {
    return "rl"
  }
  return "data"
}

function categoryColor(cat: EventCategory): string {
  switch (cat) {
    case "alert": return C.alert
    case "success": return C.success
    case "rl": return C.rl
    default: return C.data
  }
}

function isCrossServiceEvent(event: HubEvent): boolean {
  // Filter out session/hook events, keep cross-service communication
  if (event.type.startsWith("session:")) return false
  if (event.type.startsWith("hook:")) return false
  if (event.type === "heartbeat") return false
  return true
}

function parseEventFlow(event: HubEvent): { source: string; destination: string } {
  const source = event.source || "unknown"

  // Infer destination from event type patterns
  let destination = "system"
  const type = event.type.toLowerCase()

  if (type.includes("eval:") || type.includes(":scored")) {
    destination = source.includes("eval") ? "peter-parker" : "eval-engine"
  } else if (type.includes("telemetry:")) {
    destination = "peter-parker"
  } else if (type.includes("peter:")) {
    if (type.includes("rollout")) destination = "stratus"
    else if (type.includes("task")) destination = "eval-engine"
    else destination = "agents"
  } else if (type.includes("stratus:")) {
    destination = "eval-engine"
  } else if (type.includes("flow:")) {
    destination = "flow-engine"
  }

  return { source, destination }
}

function humanReadableSummary(event: HubEvent): string {
  const data = event.data || {}

  // Handle specific event types
  if (event.type === "eval:scored") {
    const agent = data.agent || "agent"
    const composite = typeof data.composite === "number" ? data.composite.toFixed(4) : "—"
    const delta = typeof data.delta === "number"
      ? (data.delta >= 0 ? `+${data.delta.toFixed(4)}` : data.delta.toFixed(4))
      : null
    return delta ? `${agent} scored ${composite} (${delta})` : `${agent} scored ${composite}`
  }

  if (event.type.includes("task-completed")) {
    return data.description as string || data.title as string || "Task completed"
  }

  if (event.type.includes("insight")) {
    return data.summary as string || data.insight as string || "Insight generated"
  }

  if (event.type.includes("flow:triggered")) {
    return `Flow "${data.flow || data.name || "flow"}" triggered`
  }

  if (event.type.includes("rollout")) {
    return data.description as string || "Rollout initiated"
  }

  if (event.type.includes("regression")) {
    return data.message as string || "Regression detected"
  }

  // Generic fallback
  return data.title as string || data.message as string || data.description as string || event.type.split(":").pop() || event.type
}

function FrequencySparkline({
  events,
  windowMs = 60000,
  buckets = 12
}: {
  events: HubEvent[]
  windowMs?: number
  buckets?: number
}) {
  const now = Date.now()
  const bucketMs = windowMs / buckets
  const counts: number[] = Array(buckets).fill(0)

  for (const evt of events) {
    const age = now - new Date(evt.ts).getTime()
    if (age < windowMs) {
      const bucket = Math.floor(age / bucketMs)
      if (bucket < buckets) counts[buckets - 1 - bucket]++
    }
  }

  const max = Math.max(...counts, 1)
  const width = 80
  const height = 20
  const barWidth = width / buckets - 1

  return (
    <svg width={width} height={height} class="shrink-0">
      {counts.map((count, i) => {
        const barHeight = (count / max) * (height - 4)
        const x = i * (barWidth + 1)
        const y = height - barHeight - 2
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            fill={C.orange}
            opacity={0.3 + (count / max) * 0.7}
            rx="1"
          />
        )
      })}
      {/* Animated current bucket indicator */}
      <rect
        x={(buckets - 1) * (barWidth + 1)}
        y={height - (counts[buckets - 1] / max) * (height - 4) - 2}
        width={barWidth}
        height={(counts[buckets - 1] / max) * (height - 4)}
        fill={C.orange}
        rx="1"
      >
        <animate attributeName="opacity" values="1;0.5;1" dur="1s" repeatCount="indefinite" />
      </rect>
    </svg>
  )
}

export function FlowLog({
  events: externalEvents,
  maxEvents = 50,
  useSSE: enableSSE = true,
  collapsed: controlledCollapsed,
  onToggleCollapse,
  className,
}: FlowLogProps) {
  const [internalEvents, setInternalEvents] = useState<HubEvent[]>([])
  const [internalCollapsed, setInternalCollapsed] = useState(false)
  const [connected, setConnected] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  const collapsed = controlledCollapsed ?? internalCollapsed
  const setCollapsed = onToggleCollapse ?? setInternalCollapsed

  // Use external events if provided, otherwise use internal SSE events
  const events = externalEvents ?? internalEvents
  const crossServiceEvents = events.filter(isCrossServiceEvent)

  // SSE subscription for live events
  useEffect(() => {
    if (!enableSSE || externalEvents) return

    const unsub = sseSubscribe(
      "/api/events/stream",
      (event) => {
        setConnected(true)
        const evt = event as HubEvent
        setInternalEvents((prev) => {
          const updated = [evt, ...prev].slice(0, maxEvents)
          return updated
        })
      },
      () => setConnected(false)
    )

    return () => unsub()
  }, [enableSSE, externalEvents, maxEvents])

  // Auto-scroll to newest
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current && !collapsed) {
      scrollRef.current.scrollTop = 0
    }
  }, [crossServiceEvents.length, collapsed])

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      autoScrollRef.current = scrollRef.current.scrollTop < 10
    }
  }, [])

  const eventCount = crossServiceEvents.length
  const recentCount = crossServiceEvents.filter(e =>
    Date.now() - new Date(e.ts).getTime() < 60000
  ).length

  return (
    <div
      class={cn("rounded-lg overflow-hidden", className)}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        class="w-full flex items-center justify-between px-4 py-2.5 transition-colors"
        style={{
          background: "transparent",
          border: "none",
          borderBottom: collapsed ? "none" : `1px solid ${C.border}`,
        }}
      >
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2">
            <span
              class="w-2 h-2 rounded-full"
              style={{
                backgroundColor: connected ? C.success : C.textDim,
                boxShadow: connected ? `0 0 8px ${C.success}` : "none",
              }}
            />
            <span class="text-xs font-semibold uppercase tracking-wider" style={{ color: C.text }}>
              Flow Log
            </span>
          </div>
          <span class="text-[10px] mono px-2 py-0.5 rounded-full" style={{
            background: `${C.orange}15`,
            color: C.orange,
            border: `1px solid ${C.orange}25`,
          }}>
            {recentCount}/min
          </span>
        </div>

        <div class="flex items-center gap-4">
          <FrequencySparkline events={crossServiceEvents} />
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={C.textMuted}
            stroke-width="2"
            style={{
              transform: collapsed ? "rotate(0deg)" : "rotate(180deg)",
              transition: "transform 0.2s ease",
            }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </button>

      {/* Event List */}
      {!collapsed && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          class="overflow-y-auto animate-fade-in"
          style={{ maxHeight: "240px" }}
        >
          {crossServiceEvents.length === 0 ? (
            <div class="px-4 py-6 text-center">
              <span class="text-xs" style={{ color: C.textMuted }}>
                {connected ? "Waiting for events..." : "Connecting to event stream..."}
              </span>
            </div>
          ) : (
            <div class="divide-y" style={{ borderColor: `${C.border}` }}>
              {crossServiceEvents.slice(0, 20).map((event, i) => {
                const category = categorizeEvent(event.type)
                const color = categoryColor(category)
                const { source, destination } = parseEventFlow(event)
                const summary = humanReadableSummary(event)

                return (
                  <div
                    key={event.id || `${event.ts}-${i}`}
                    class="px-4 py-2 flex items-start gap-3 transition-colors hover:bg-white/[0.02]"
                    style={{
                      animation: i === 0 ? "fade-in 0.2s ease" : undefined,
                      borderColor: C.border,
                    }}
                  >
                    {/* Timestamp */}
                    <span class="text-[9px] mono shrink-0 w-12 mt-0.5" style={{ color: C.textDim }}>
                      {timeAgo(event.ts)}
                    </span>

                    {/* Flow direction */}
                    <div class="flex items-center gap-1.5 shrink-0 min-w-[140px]">
                      <span class="text-[9px] mono truncate max-w-[50px]" style={{ color: C.textMuted }}>
                        {source.split("-")[0]}
                      </span>
                      <svg width="14" height="8" viewBox="0 0 14 8" class="shrink-0">
                        <path
                          d="M0 4h10M8 1l3 3-3 3"
                          fill="none"
                          stroke={color}
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                      <span class="text-[9px] mono truncate max-w-[50px]" style={{ color: C.textMuted }}>
                        {destination.split("-")[0]}
                      </span>
                    </div>

                    {/* Event type badge */}
                    <span
                      class="text-[8px] mono px-1.5 py-0.5 rounded shrink-0 uppercase tracking-wider"
                      style={{
                        background: `${color}18`,
                        color,
                        border: `1px solid ${color}30`,
                      }}
                    >
                      {category}
                    </span>

                    {/* Summary */}
                    <span class="text-[10px] truncate flex-1" style={{ color: C.text }}>
                      {summary}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Footer when collapsed */}
      {collapsed && eventCount > 0 && (
        <div class="px-4 py-1.5 flex items-center justify-between">
          <span class="text-[9px] mono" style={{ color: C.textDim }}>
            {eventCount} events buffered
          </span>
          <div class="flex gap-1">
            {["data", "rl", "success", "alert"].map((cat) => {
              const count = crossServiceEvents.filter(e => categorizeEvent(e.type) === cat).length
              if (count === 0) return null
              return (
                <span
                  key={cat}
                  class="text-[8px] mono px-1 rounded"
                  style={{
                    background: `${categoryColor(cat as EventCategory)}15`,
                    color: categoryColor(cat as EventCategory),
                  }}
                >
                  {count}
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
