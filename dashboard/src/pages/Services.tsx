import { WorkspaceStatus, api, DiscoveredService } from "@/api"
import { StatusDot } from "@/components"
import { usePolling } from "@/lib/hooks"

interface ServicesPageProps {
  status: WorkspaceStatus | null
}

export function ServicesPage({ status }: ServicesPageProps) {
  const services = usePolling(() => api.services(), 10000)

  const children = status?.children || []
  const mode = status?.type || "standalone"
  const configServices = status?.config?.registered_services || []
  const discoveredServices = services.data ? Object.values(services.data) : []

  const servicesByParent: Record<string, DiscoveredService[]> = {}
  if (mode === "portfolio") {
    for (const child of children) {
      const prefix = child.name.replace("-gtm", "")
      servicesByParent[child.name] = discoveredServices.filter((svc) =>
        svc.name.startsWith(prefix)
      )
    }
  }

  return (
    <div class="space-y-6">
      <h1 class="text-xl font-semibold">Services</h1>

      {mode === "portfolio" ? (
        children.map((child) => {
          const childSvcs = servicesByParent[child.name] || []
          return (
            <section key={child.name}>
              <div class="flex items-center gap-2 mb-3">
                <StatusDot status={child.status} />
                <h2 class="text-sm font-medium">{child.name}</h2>
                <span class="text-xs mono text-muted-foreground">:{child.port}</span>
                <span class="text-[10px] text-muted-foreground ml-2">
                  {childSvcs.length} services
                </span>
              </div>
              {childSvcs.length > 0 ? (
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {childSvcs.map((svc) => (
                    <ServiceDetailCard key={svc.name} service={svc} />
                  ))}
                </div>
              ) : (
                <div class="bg-card rounded-lg border border-border p-4 text-sm text-muted-foreground">
                  No services discovered for this product
                </div>
              )}
            </section>
          )
        })
      ) : (
        <>
          {configServices.length > 0 && (
            <section>
              <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Registered Services ({configServices.length})
              </h2>
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {configServices.map((svc) => (
                  <div key={svc.name} class="bg-card rounded-lg border border-border p-4 animate-fade-in">
                    <div class="flex items-center justify-between mb-2">
                      <div class="flex items-center gap-2">
                        <StatusDot status={svc.status === "active" ? "ok" : "idle"} />
                        <span class="font-medium text-sm">{svc.name}</span>
                      </div>
                      {svc.type && (
                        <span class="text-[10px] mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded uppercase">
                          {svc.type}
                        </span>
                      )}
                    </div>
                    {svc.context_scope && (
                      <div class="mt-2 space-y-1">
                        {svc.context_scope.produces && svc.context_scope.produces.length > 0 && (
                          <div class="flex flex-wrap gap-1">
                            <span class="text-[10px] text-muted-foreground mr-1">produces:</span>
                            {svc.context_scope.produces.map((p) => (
                              <span key={p} class="text-[10px] bg-success/10 text-success px-1.5 py-0.5 rounded mono">
                                {p}
                              </span>
                            ))}
                          </div>
                        )}
                        {svc.context_scope.consumes && svc.context_scope.consumes.length > 0 && (
                          <div class="flex flex-wrap gap-1">
                            <span class="text-[10px] text-muted-foreground mr-1">consumes:</span>
                            {svc.context_scope.consumes.map((c) => (
                              <span key={c} class="text-[10px] bg-info/10 text-info px-1.5 py-0.5 rounded mono">
                                {c}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {discoveredServices.length > 0 && (
            <section>
              <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Discovered ({discoveredServices.length})
              </h2>
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {discoveredServices.map((svc) => (
                  <ServiceDetailCard key={svc.name} service={svc} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {children.length === 0 && configServices.length === 0 && discoveredServices.length === 0 && (
        <div class="bg-card rounded-lg border border-border p-8 text-center">
          <div class="text-muted-foreground text-sm">No services registered</div>
          <div class="text-muted-foreground text-xs mt-1">
            Register services with: jfl services register &lt;path&gt;
          </div>
        </div>
      )}
    </div>
  )
}

function ServiceDetailCard({ service }: { service: DiscoveredService }) {
  return (
    <div class="bg-card rounded-lg border border-border p-4 animate-fade-in">
      <div class="flex items-center justify-between mb-1">
        <div class="flex items-center gap-2">
          <StatusDot status={service.status === "active" ? "ok" : "idle"} />
          <span class="font-medium text-sm">{service.name}</span>
        </div>
        {service.type && (
          <span class="text-[10px] mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded uppercase">
            {service.type}
          </span>
        )}
      </div>
      {service.description && (
        <p class="text-xs text-muted-foreground mt-1">{service.description}</p>
      )}
    </div>
  )
}
