import { WorkspaceStatus } from "@/api"
import { StatusDot } from "./StatusDot"
import { cn } from "@/lib/hooks"

interface SidebarProps {
  status: WorkspaceStatus | null
  currentPage: string
  setPage: (page: string) => void
}

interface NavItem {
  id: string
  label: string
  modes?: string[]
}

const navItems: NavItem[] = [
  { id: "overview", label: "Overview" },
  { id: "agents", label: "Agents" },
  { id: "journal", label: "Journal" },
  { id: "events", label: "Events" },
  { id: "services", label: "Services", modes: ["portfolio", "gtm"] },
]

export function Sidebar({ status, currentPage, setPage }: SidebarProps) {
  const mode = status?.type || "standalone"
  const name = status?.config?.name || "JFL"
  const wsStatus = status?.status || "unknown"

  const filteredNav = navItems.filter(
    (item) => !item.modes || item.modes.includes(mode),
  )

  return (
    <aside class="w-56 h-screen bg-sidebar border-r border-sidebar-border flex flex-col fixed left-0 top-0 z-10">
      <div class="p-4 border-b border-sidebar-border">
        <div class="flex items-center gap-2">
          <StatusDot
            status={wsStatus === "ok" ? "ok" : wsStatus === "running" ? "ok" : "warning"}
          />
          <span class="font-semibold text-sm text-sidebar-foreground truncate">
            {name}
          </span>
        </div>
        <div class="flex items-center gap-1.5 mt-1.5">
          <span class="text-[10px] mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded uppercase">
            {mode}
          </span>
          {status?.port && (
            <span class="text-[10px] mono text-muted-foreground">:{status.port}</span>
          )}
        </div>
      </div>

      <nav class="flex-1 py-2 overflow-y-auto">
        {filteredNav.map((item) => (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            class={cn(
              "w-full text-left px-4 py-2 text-sm transition-colors",
              currentPage === item.id
                ? "bg-accent text-accent-foreground font-medium"
                : "text-sidebar-foreground hover:bg-accent/50",
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {status?.children && status.children.length > 0 && (
        <div class="border-t border-sidebar-border py-2 px-4">
          <div class="text-[10px] uppercase text-muted-foreground tracking-wider mb-2">
            Children
          </div>
          {status.children.map((child) => (
            <div key={child.name} class="flex items-center gap-1.5 py-1">
              <StatusDot status={child.status} />
              <span class="text-xs text-sidebar-foreground truncate">{child.name}</span>
              <span class="text-[10px] mono text-muted-foreground ml-auto">
                :{child.port}
              </span>
            </div>
          ))}
        </div>
      )}

      <div class="p-3 border-t border-sidebar-border">
        <div class="text-[10px] text-muted-foreground mono">
          jfl v0.3.0
        </div>
      </div>
    </aside>
  )
}
