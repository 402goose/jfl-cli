import { cn } from "@/lib/hooks"

interface StatusDotProps {
  status: "ok" | "error" | "down" | "active" | "idle" | "warning"
  label?: string
  pulse?: boolean
}

const colorMap: Record<string, string> = {
  ok: "bg-success",
  active: "bg-success",
  error: "bg-destructive",
  down: "bg-destructive",
  warning: "bg-warning",
  idle: "bg-muted-foreground",
}

export function StatusDot({ status, label, pulse = true }: StatusDotProps) {
  return (
    <span class="inline-flex items-center gap-1.5">
      <span
        class={cn(
          "inline-block w-2 h-2 rounded-full",
          colorMap[status] || "bg-muted-foreground",
          pulse && (status === "ok" || status === "active") && "animate-pulse-dot",
        )}
      />
      {label && <span class="text-xs text-muted-foreground">{label}</span>}
    </span>
  )
}
