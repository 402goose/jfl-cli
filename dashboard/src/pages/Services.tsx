import { WorkspaceStatus, api, DiscoveredService, ServiceRegistration } from "@/api"
import { StatusDot } from "@/components"
import { usePolling, cn } from "@/lib/hooks"

interface ServicesPageProps {
  status: WorkspaceStatus | null
}

function patternMatches(produced: string, consumed: string): boolean {
  if (consumed.endsWith("*")) {
    return produced.startsWith(consumed.slice(0, -1))
  }
  return produced === consumed
}

interface DataFlow {
  from: string
  to: string
  pattern: string
}

function computeFlows(services: ServiceRegistration[]): DataFlow[] {
  const flows: DataFlow[] = []
  for (const producer of services) {
    for (const consumer of services) {
      if (producer.name === consumer.name) continue
      const produces = producer.context_scope?.produces || []
      const consumes = consumer.context_scope?.consumes || []
      for (const p of produces) {
        for (const c of consumes) {
          if (patternMatches(p, c)) {
            flows.push({ from: producer.name, to: consumer.name, pattern: p })
          }
        }
      }
    }
  }
  return flows
}

export function ServicesPage({ status }: ServicesPageProps) {
  const services = usePolling(() => api.services(), 10000)

  const children = status?.children || []
  const mode = status?.type || "standalone"
  const configServices = status?.config?.registered_services || []
  const discoveredServices = services.data ? Object.values(services.data) : []
  const dataFlows = computeFlows(configServices)

  const servicesByParent: Record<string, DiscoveredService[]> = {}
  if (mode === "portfolio") {
    for (const child of children) {
      const prefix = child.name.replace("-gtm", "")
      servicesByParent[child.name] = discoveredServices.filter((svc) =>
        svc.name.startsWith(prefix),
      )
    }
  }

  return (
    <div class="space-y-6">
      <h1 class="text-xl font-semibold">Services</h1>

      {configServices.length > 0 && configServices.some((s) => s.context_scope) && (
        <ScopeGraph services={configServices} flows={dataFlows} children={children} />
      )}

      {dataFlows.length > 0 && (
        <section>
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Data Flows ({dataFlows.length})
          </h2>
          <div class="bg-card rounded-lg border border-border overflow-hidden">
            {dataFlows.map((flow, i) => (
              <div
                key={i}
                class={cn(
                  "flex items-center gap-3 px-4 py-2 text-sm",
                  i > 0 && "border-t border-border/50",
                )}
              >
                <span class="mono text-xs font-medium text-info min-w-40">{flow.pattern}</span>
                <span class="text-xs text-muted-foreground">{flow.from}</span>
                <svg width="16" height="8" viewBox="0 0 16 8" class="shrink-0 text-muted-foreground">
                  <path d="M0 4h12M10 1l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.5" />
                </svg>
                <span class="text-xs text-muted-foreground">{flow.to}</span>
              </div>
            ))}
          </div>
        </section>
      )}

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
                Registered ({configServices.length})
              </h2>
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {configServices.map((svc) => (
                  <RegisteredServiceCard key={svc.name} service={svc} />
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
          <div class="text-muted-foreground text-xs mt-1 mono">
            jfl services register &lt;path&gt;
          </div>
        </div>
      )}
    </div>
  )
}

function ScopeGraph({
  services,
  flows,
  children,
}: {
  services: ServiceRegistration[]
  flows: DataFlow[]
  children: { name: string; port: number; status: string }[]
}) {
  return (
    <section>
      <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
        Context Scope
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        {services
          .filter((s) => s.context_scope)
          .map((svc) => {
            const child = children.find((c) => c.name === svc.name)
            const produces = svc.context_scope?.produces || []
            const consumes = svc.context_scope?.consumes || []
            const outgoing = flows.filter((f) => f.from === svc.name)
            const incoming = flows.filter((f) => f.to === svc.name)

            return (
              <div key={svc.name} class="bg-card rounded-lg border border-border p-4 animate-fade-in">
                <div class="flex items-center justify-between mb-3">
                  <div class="flex items-center gap-2">
                    <StatusDot status={child?.status === "ok" ? "ok" : "idle"} />
                    <span class="font-medium text-sm">{svc.name}</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    {svc.type && (
                      <span class="text-[10px] mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded uppercase">
                        {svc.type}
                      </span>
                    )}
                    {child && (
                      <span class="text-[10px] mono text-muted-foreground">:{child.port}</span>
                    )}
                  </div>
                </div>

                {produces.length > 0 && (
                  <div class="mb-2">
                    <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Produces</div>
                    <div class="flex flex-wrap gap-1">
                      {produces.map((p) => {
                        const connected = outgoing.some((f) => f.pattern === p)
                        return (
                          <span
                            key={p}
                            class={cn(
                              "text-[10px] mono px-1.5 py-0.5 rounded",
                              connected
                                ? "bg-success/15 text-success"
                                : "bg-success/5 text-success/60",
                            )}
                          >
                            {p}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}

                {consumes.length > 0 && (
                  <div>
                    <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Consumes</div>
                    <div class="flex flex-wrap gap-1">
                      {consumes.map((c) => {
                        const connected = incoming.some((f) => patternMatches(f.pattern, c))
                        return (
                          <span
                            key={c}
                            class={cn(
                              "text-[10px] mono px-1.5 py-0.5 rounded",
                              connected
                                ? "bg-info/15 text-info"
                                : "bg-info/5 text-info/60",
                            )}
                          >
                            {c}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}

                {(outgoing.length > 0 || incoming.length > 0) && (
                  <div class="mt-3 pt-2 border-t border-border">
                    <div class="flex items-center gap-3 text-[10px] text-muted-foreground">
                      {outgoing.length > 0 && (
                        <span>{outgoing.length} outgoing</span>
                      )}
                      {incoming.length > 0 && (
                        <span>{incoming.length} incoming</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </section>
  )
}

function RegisteredServiceCard({ service }: { service: ServiceRegistration }) {
  return (
    <div class="bg-card rounded-lg border border-border p-4 animate-fade-in">
      <div class="flex items-center justify-between mb-2">
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
      {service.context_scope && (
        <div class="mt-2 space-y-1">
          {service.context_scope.produces && service.context_scope.produces.length > 0 && (
            <div class="flex flex-wrap gap-1">
              <span class="text-[10px] text-muted-foreground mr-1">produces:</span>
              {service.context_scope.produces.map((p) => (
                <span key={p} class="text-[10px] bg-success/10 text-success px-1.5 py-0.5 rounded mono">
                  {p}
                </span>
              ))}
            </div>
          )}
          {service.context_scope.consumes && service.context_scope.consumes.length > 0 && (
            <div class="flex flex-wrap gap-1">
              <span class="text-[10px] text-muted-foreground mr-1">consumes:</span>
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
