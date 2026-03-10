import { WorkspaceStatus, api } from "@/api"
import { cn, usePolling } from "@/lib/hooks"

interface SidebarProps {
  status: WorkspaceStatus | null
  currentPage: string
  setPage: (page: string) => void
}

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, preact.JSX.Element> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    journal: (
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    ),
    events: (
      <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
    ),
    services: (
      <>
        <path d="m12 2-10 5 10 5 10-5z" />
        <path d="m2 17 10 5 10-5" />
        <path d="m2 12 10 5 10-5" />
      </>
    ),
    agents: (
      <>
        <circle cx="12" cy="8" r="5" />
        <path d="M20 21a8 8 0 0 0-16 0" />
      </>
    ),
    flows: (
      <>
        <rect x="3" y="3" width="8" height="8" rx="2" />
        <rect x="13" y="13" width="8" height="8" rx="2" />
        <path d="M7 11v4a2 2 0 0 0 2 2h4" />
      </>
    ),
    health: (
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    ),
    experiments: (
      <>
        <circle cx="7" cy="12" r="2" />
        <circle cx="12" cy="7" r="2" />
        <circle cx="17" cy="10" r="2" />
        <circle cx="12" cy="17" r="2" />
        <path d="M7 12l5-5M12 7l5 3M17 10l-5 7" />
      </>
    ),
  }

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="shrink-0"
    >
      {paths[name]}
    </svg>
  )
}

interface NavItemDef {
  id: string
  label: string
  icon: string
  modes?: string[]
}

const sections: { label?: string; items: NavItemDef[] }[] = [
  {
    items: [
      { id: "overview", label: "Dashboard", icon: "dashboard" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { id: "journal", label: "Journal", icon: "journal" },
      { id: "events", label: "Events", icon: "events" },
      { id: "flows", label: "Flows", icon: "flows" },
    ],
  },
  {
    label: "Infra",
    items: [
      { id: "services", label: "Services", icon: "services" },
      { id: "health", label: "Health", icon: "health" },
    ],
  },
  {
    label: "Eval",
    items: [
      { id: "agents", label: "Agents", icon: "agents" },
      { id: "experiments", label: "Experiments", icon: "experiments" },
    ],
  },
]

export function Sidebar({ status, currentPage, setPage }: SidebarProps) {
  const mode = status?.type || "standalone"
  const name = status?.config?.name || "JFL"
  const wsStatus = status?.status || "unknown"
  const children = status?.children || []

  const leaderboard = usePolling(() => api.leaderboard(), 30000)
  const agents = leaderboard.data || []

  return (
    <aside class="w-56 h-screen bg-sidebar flex flex-col fixed left-0 top-0 z-10 border-r border-sidebar-border">
      <div class="px-4 pt-5 pb-4">
        <div class="flex items-center gap-2.5">
          <div class={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold",
            wsStatus === "ok" || wsStatus === "running"
              ? "bg-success/15 text-success"
              : "bg-warning/15 text-warning",
          )}>
            {name.charAt(0).toUpperCase()}
          </div>
          <div class="min-w-0">
            <div class="font-semibold text-sm text-sidebar-foreground truncate">{name}</div>
            <div class="flex items-center gap-1.5 mt-0.5">
              <span class="text-[10px] mono text-muted-foreground uppercase tracking-wider">{mode}</span>
              {status?.port && (
                <span class="text-[10px] mono text-muted-foreground">:{status.port}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <nav class="flex-1 overflow-y-auto pb-2">
        {sections.map((section, si) => {
          const filteredItems = section.items.filter(
            (item) => !item.modes || item.modes.includes(mode),
          )
          if (!filteredItems.length) return null

          return (
            <div key={si} class={si > 0 ? "mt-5" : ""}>
              {section.label && (
                <div class="px-4 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                  {section.label}
                </div>
              )}
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setPage(item.id)}
                  class={cn(
                    "w-full flex items-center gap-2.5 px-4 py-1.5 text-[13px] transition-colors relative",
                    currentPage === item.id
                      ? "text-sidebar-foreground font-medium bg-accent/60 before:absolute before:left-0 before:top-[5px] before:bottom-[5px] before:w-[2px] before:bg-info before:rounded-r"
                      : "text-muted-foreground hover:text-sidebar-foreground hover:bg-accent/30",
                  )}
                >
                  <NavIcon name={item.icon} />
                  {item.label}
                </button>
              ))}
            </div>
          )
        })}

        {agents.length > 0 && (
          <div class="mt-5">
            <div class="px-4 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
              Agents
            </div>
            {agents
              .sort((a, b) => (b.composite || 0) - (a.composite || 0))
              .slice(0, 8)
              .map((agent) => {
                const improving = agent.delta != null && agent.delta > 0
                return (
                  <button
                    key={agent.agent}
                    onClick={() => setPage("agents")}
                    class="w-full flex items-center gap-2.5 px-4 py-1 text-[13px] text-muted-foreground hover:text-sidebar-foreground transition-colors"
                  >
                    <span class={cn(
                      "w-[6px] h-[6px] rounded-full shrink-0",
                      improving ? "bg-success" : "bg-muted-foreground/50",
                    )} />
                    <span class="truncate">{agent.agent}</span>
                    {agent.composite != null && (
                      <span class="ml-auto mono text-[10px] tabular-nums">
                        {agent.composite.toFixed(2)}
                      </span>
                    )}
                  </button>
                )
              })}
          </div>
        )}
      </nav>

      {children.length > 0 && (
        <div class="border-t border-sidebar-border py-3 px-4">
          <div class="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-2">
            Products
          </div>
          <div class="space-y-1.5">
            {children.map((child) => (
              <div key={child.name} class="flex items-center gap-2">
                <span class={cn(
                  "w-[6px] h-[6px] rounded-full shrink-0",
                  child.status === "ok" ? "bg-success" : child.status === "error" ? "bg-destructive" : "bg-muted-foreground/50",
                )} />
                <span class="text-xs text-sidebar-foreground truncate flex-1">{child.name}</span>
                <span class="text-[10px] mono text-muted-foreground">:{child.port}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div class="px-4 py-3 border-t border-sidebar-border">
        <div class="text-[10px] text-muted-foreground/60 mono">jfl v0.3.0</div>
      </div>
    </aside>
  )
}
