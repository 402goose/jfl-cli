/**
 * AlertsBubble Component
 *
 * Notification card showing significant cross-service events like regressions,
 * cross-service insights, and agent milestones. Dismissable with animation.
 *
 * @purpose Surface important system events that need attention
 */

import { useState, useEffect } from "preact/hooks"
import { HubEvent, api } from "@/api"
import { usePolling, cn, timeAgo } from "@/lib/hooks"

const C = {
  bg: "rgba(24, 24, 28, 0.95)",
  border: "rgba(60, 60, 60, 0.25)",
  text: "#f5f5f5",
  textMuted: "#8b8b8b",
  textDim: "#5a5a5a",
  success: "#34d399",
  warning: "#eab308",
  destructive: "#f87171",
  info: "#4a7dfc",
  purple: "#a855f7",
  orange: "#FF5722",
}

type AlertType = "regression" | "insight" | "milestone" | "success"

interface Alert {
  id: string
  type: AlertType
  title: string
  description: string
  ts: string
  source?: string
  data?: Record<string, unknown>
}

function alertIcon(type: AlertType): string {
  switch (type) {
    case "regression": return "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
    case "insight": return "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
    case "milestone": return "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
    case "success": return "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
  }
}

function alertColor(type: AlertType): string {
  switch (type) {
    case "regression": return C.destructive
    case "insight": return C.purple
    case "milestone": return C.orange
    case "success": return C.success
  }
}

function alertBgColor(type: AlertType): string {
  switch (type) {
    case "regression": return `${C.destructive}08`
    case "insight": return `${C.purple}08`
    case "milestone": return `${C.orange}08`
    case "success": return `${C.success}08`
  }
}

function parseAlertFromEvent(event: HubEvent): Alert | null {
  const data = event.data || {}
  const type = event.type.toLowerCase()

  // Regression detection
  if (type.includes("regression") || (type === "eval:scored" && (data.delta as number) < -0.01)) {
    return {
      id: event.id,
      type: "regression",
      title: "Regression Detected",
      description: data.message as string || data.description as string ||
        `Score dropped by ${Math.abs((data.delta as number) || 0).toFixed(4)}`,
      ts: event.ts,
      source: event.source,
      data,
    }
  }

  // Cross-service insights
  if (type.includes("insight") || type.includes("discovery") || type.includes("correlation")) {
    return {
      id: event.id,
      type: "insight",
      title: data.title as string || "Cross-Service Insight",
      description: data.summary as string || data.insight as string || data.description as string || "New pattern detected",
      ts: event.ts,
      source: event.source,
      data,
    }
  }

  // Agent milestones
  if (type.includes("milestone") || type.includes("first-positive") || type.includes("breakthrough")) {
    return {
      id: event.id,
      type: "milestone",
      title: data.title as string || "Agent Milestone",
      description: data.description as string || data.message as string || "Achievement unlocked",
      ts: event.ts,
      source: event.source,
      data,
    }
  }

  // Significant positive delta (first positive, big jump)
  if (type === "eval:scored") {
    const delta = data.delta as number
    const composite = data.composite as number
    if (delta > 0.02) {
      return {
        id: event.id,
        type: "success",
        title: "Significant Improvement",
        description: `${data.agent || "Agent"} improved by +${delta.toFixed(4)} to ${composite?.toFixed(4) || "—"}`,
        ts: event.ts,
        source: event.source,
        data,
      }
    }
  }

  // New tests added
  if (type.includes("test") && (type.includes("added") || type.includes("created"))) {
    const count = data.count as number || data.tests_added as number || 1
    return {
      id: event.id,
      type: "milestone",
      title: "Tests Added",
      description: `${count} new test${count > 1 ? "s" : ""} added to coverage`,
      ts: event.ts,
      source: event.source,
      data,
    }
  }

  return null
}

interface AlertsBubbleProps {
  className?: string
  maxAlerts?: number
}

export function AlertsBubble({ className, maxAlerts = 5 }: AlertsBubbleProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [alerts, setAlerts] = useState<Alert[]>([])

  const events = usePolling(() => api.events(100), 15000)
  const eventList = events.data?.events || []

  // Parse events into alerts
  useEffect(() => {
    const newAlerts: Alert[] = []
    const seenIds = new Set<string>()

    for (const event of eventList) {
      if (seenIds.has(event.id) || dismissed.has(event.id)) continue
      seenIds.add(event.id)

      const alert = parseAlertFromEvent(event)
      if (alert) {
        newAlerts.push(alert)
      }
    }

    // Sort by timestamp (newest first) and limit
    newAlerts.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    setAlerts(newAlerts.slice(0, maxAlerts))
  }, [eventList, dismissed, maxAlerts])

  const handleDismiss = (id: string) => {
    setDismissed((prev) => new Set([...prev, id]))
  }

  const handleDismissAll = () => {
    setDismissed((prev) => new Set([...prev, ...alerts.map(a => a.id)]))
  }

  // Don't render if no alerts
  if (alerts.length === 0) return null

  return (
    <div
      class={cn("rounded-lg overflow-hidden animate-fade-in", className)}
      style={{
        background: alertBgColor(alerts[0].type),
        border: `1px solid ${alertColor(alerts[0].type)}30`,
      }}
    >
      {/* Header */}
      <div
        class="px-4 py-2.5 flex items-center justify-between"
        style={{ borderBottom: `1px solid ${alertColor(alerts[0].type)}20` }}
      >
        <div class="flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={alertColor(alerts[0].type)}
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d={alertIcon(alerts[0].type)} />
          </svg>
          <span class="text-xs font-semibold uppercase tracking-wider" style={{ color: alertColor(alerts[0].type) }}>
            {alerts.length === 1 ? "Alert" : `${alerts.length} Alerts`}
          </span>
        </div>

        {alerts.length > 1 && (
          <button
            onClick={handleDismissAll}
            class="text-[9px] mono px-2 py-0.5 rounded transition-colors"
            style={{
              color: C.textMuted,
              background: "rgba(255,255,255,0.05)",
              border: "none",
            }}
          >
            dismiss all
          </button>
        )}
      </div>

      {/* Alert List */}
      <div class="divide-y" style={{ borderColor: `${C.border}` }}>
        {alerts.map((alert, i) => {
          const color = alertColor(alert.type)

          return (
            <div
              key={alert.id}
              class="px-4 py-3 flex items-start gap-3 transition-all"
              style={{
                animation: i === 0 ? "fade-in 0.3s ease" : undefined,
                background: i === 0 ? `${color}05` : "transparent",
                borderColor: `${color}15`,
              }}
            >
              {/* Icon */}
              <div
                class="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                style={{
                  background: `${color}15`,
                  border: `1px solid ${color}25`,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={color}
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d={alertIcon(alert.type)} />
                </svg>
              </div>

              {/* Content */}
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-0.5">
                  <span class="text-sm font-medium" style={{ color: C.text }}>
                    {alert.title}
                  </span>
                  <span class="text-[9px] mono" style={{ color: C.textDim }}>
                    {timeAgo(alert.ts)}
                  </span>
                </div>
                <p class="text-xs leading-relaxed" style={{ color: C.textMuted }}>
                  {alert.description}
                </p>
                {alert.source && (
                  <span class="text-[9px] mono mt-1 inline-block" style={{ color: C.textDim }}>
                    via {alert.source}
                  </span>
                )}
              </div>

              {/* Dismiss button */}
              <button
                onClick={() => handleDismiss(alert.id)}
                class="shrink-0 p-1.5 rounded transition-colors hover:bg-white/5"
                style={{ color: C.textMuted, background: "none", border: "none" }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
