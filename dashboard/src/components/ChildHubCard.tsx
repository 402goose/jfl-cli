import { ChildHub } from "@/api"
import { StatusDot } from "./StatusDot"

interface ChildHubCardProps {
  child: ChildHub
  onClick?: () => void
}

export function ChildHubCard({ child, onClick }: ChildHubCardProps) {
  return (
    <button
      onClick={onClick}
      class="w-full text-left bg-card rounded-lg border border-border p-4 hover:border-muted-foreground/40 transition-colors animate-fade-in"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <StatusDot status={child.status} />
          <span class="font-medium text-sm">{child.name}</span>
        </div>
        <span class="text-xs mono text-muted-foreground">:{child.port}</span>
      </div>
    </button>
  )
}
