import { JSX } from "preact"

interface MetricCardProps {
  label: string
  value: string | number
  sub?: string
  trend?: "up" | "down" | "neutral"
  icon?: JSX.Element
}

export function MetricCard({ label, value, sub, trend, icon }: MetricCardProps) {
  const trendColor =
    trend === "up"
      ? "text-success"
      : trend === "down"
        ? "text-destructive"
        : "text-muted-foreground"

  return (
    <div class="bg-card rounded-lg border border-border p-4 animate-fade-in">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
        {icon && <span class="text-muted-foreground">{icon}</span>}
      </div>
      <div class="text-2xl font-semibold mono">{value}</div>
      {sub && <div class={`text-xs mt-1 ${trendColor}`}>{sub}</div>}
    </div>
  )
}
