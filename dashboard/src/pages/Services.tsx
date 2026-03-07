import { WorkspaceStatus, api, DiscoveredService, ProjectHealth } from "@/api"
import { StatusDot } from "@/components"
import { usePolling } from "@/lib/hooks"

interface ServicesPageProps {
  status: WorkspaceStatus | null
}

export function ServicesPage({ status }: ServicesPageProps) {
  const services = usePolling(() => api.services(), 10000)
  const projects = usePolling(() => api.projects(), 15000)

  const children = status?.children || []
  const mode = status?.type || "standalone"
  const discoveredServices = services.data ? Object.values(services.data) : []
  const projectList = projects.data || []

  return (
    <div class="space-y-6">
      <h1 class="text-xl font-semibold">Services & Infrastructure</h1>

      {mode === "portfolio" && children.length > 0 && (
        <section>
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Child Hubs
          </h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            {children.map((child) => (
              <div key={child.name} class="bg-card rounded-lg border border-border p-4 animate-fade-in">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <StatusDot status={child.status} />
                    <span class="font-medium">{child.name}</span>
                  </div>
                  <span class="text-xs mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    :{child.port}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {discoveredServices.length > 0 && (
        <section>
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Discovered Services ({discoveredServices.length})
          </h2>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {discoveredServices.map((svc) => (
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
                {svc.description && (
                  <p class="text-xs text-muted-foreground">{svc.description}</p>
                )}
                {svc.path && (
                  <p class="text-[10px] mono text-muted-foreground mt-1 truncate">{svc.path}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {projectList.length > 0 && (
        <section>
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            All Running Hubs ({projectList.filter(p => p.status === "OK").length}/{projectList.length})
          </h2>
          <div class="bg-card rounded-lg border border-border overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-border text-xs text-muted-foreground">
                  <th class="text-left py-2 px-3 font-medium">Name</th>
                  <th class="text-left py-2 px-3 font-medium">Status</th>
                  <th class="text-right py-2 px-3 font-medium">Port</th>
                  <th class="text-right py-2 px-3 font-medium">PID</th>
                </tr>
              </thead>
              <tbody>
                {projectList.map((proj) => (
                  <tr key={proj.name} class="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td class="py-2 px-3 font-medium">{proj.name}</td>
                    <td class="py-2 px-3">
                      <StatusDot
                        status={proj.status === "OK" ? "ok" : "down"}
                        label={proj.status}
                      />
                    </td>
                    <td class="py-2 px-3 mono text-right text-muted-foreground">{proj.port}</td>
                    <td class="py-2 px-3 mono text-right text-muted-foreground">
                      {proj.pid || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {discoveredServices.length === 0 && children.length === 0 && projectList.length === 0 && (
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
