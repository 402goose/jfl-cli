import { ServiceRegistration } from "@/api"
import { StatusDot } from "./StatusDot"

interface ServiceCardProps {
  service: ServiceRegistration
}

export function ServiceCard({ service }: ServiceCardProps) {
  const statusVal =
    service.status === "ok" || service.status === "active"
      ? "ok"
      : service.status === "error"
        ? "error"
        : "idle"

  return (
    <div class="bg-card rounded-lg border border-border p-4 animate-fade-in">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <StatusDot status={statusVal as "ok" | "error" | "idle"} />
          <span class="font-medium text-sm">{service.name}</span>
        </div>
        {service.type && (
          <span class="text-[10px] mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded uppercase">
            {service.type}
          </span>
        )}
      </div>

      {service.context_scope && (
        <div class="mt-2 space-y-1">
          {service.context_scope.produces && service.context_scope.produces.length > 0 && (
            <div class="flex flex-wrap gap-1">
              {service.context_scope.produces.map((p) => (
                <span key={p} class="text-[10px] bg-success/10 text-success px-1.5 py-0.5 rounded mono">
                  +{p}
                </span>
              ))}
            </div>
          )}
          {service.context_scope.consumes && service.context_scope.consumes.length > 0 && (
            <div class="flex flex-wrap gap-1">
              {service.context_scope.consumes.map((c) => (
                <span key={c} class="text-[10px] bg-info/10 text-info px-1.5 py-0.5 rounded mono">
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
