import { WorkspaceStatus, api, SynopsisData, ChildHub } from "@/api"
import { usePolling, cn, timeAgo } from "@/lib/hooks"
import { useState, useEffect } from "preact/hooks"

interface ChildSynopsis {
  name: string
  port: number
  status: "ok" | "error" | "loading"
  data: SynopsisData | null
}

interface SynopsisPageProps {
  status: WorkspaceStatus | null
}

export function SynopsisPage({ status }: SynopsisPageProps) {
  const [hours, setHours] = useState(24)
  const [childData, setChildData] = useState<ChildSynopsis[]>([])
  const [loadingChildren, setLoadingChildren] = useState(false)

  const localSynopsis = usePolling(() => api.synopsis(hours), 30000, [hours])
  const children = status?.children || []
  const mode = status?.type || "standalone"
  const isPortfolio = mode === "portfolio" && children.length > 0

  useEffect(() => {
    if (!isPortfolio) return
    setLoadingChildren(true)
    const initial = children.map((c) => ({
      name: c.name,
      port: c.port,
      status: "loading" as const,
      data: null,
    }))
    setChildData(initial)

    Promise.all(
      children.map(async (child) => {
        const data = await api.childSynopsis(child.port, hours)
        return {
          name: child.name,
          port: child.port,
          status: data ? "ok" as const : "error" as const,
          data,
        }
      }),
    ).then((results) => {
      setChildData(results)
      setLoadingChildren(false)
    })
  }, [isPortfolio, hours, children.map((c) => c.port).join(",")])

  const aggregate = aggregateSynopses(localSynopsis.data, childData)

  const hourOptions = [6, 12, 24, 48, 168]

  return (
    <div class="space-y-5">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Synopsis</h1>
        <div class="flex items-center gap-2">
          {hourOptions.map((h) => (
            <button
              key={h}
              onClick={() => setHours(h)}
              class={cn(
                "text-[11px] mono font-medium px-2 py-0.5 rounded-md transition-colors",
                hours === h
                  ? "bg-foreground/10 text-foreground"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground",
              )}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>

      {isPortfolio && (
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <AggCard label="Features" value={aggregate.features} color="text-success" />
          <AggCard label="Fixes" value={aggregate.fixes} color="text-warning" />
          <AggCard label="Decisions" value={aggregate.decisions} color="text-info" />
          <AggCard label="Commits" value={aggregate.commits} color="text-foreground" />
        </div>
      )}

      <div class="bg-card rounded-lg border border-border p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-xs text-muted-foreground uppercase tracking-wider">
            {status?.config?.name || "This Project"}
          </h3>
          {localSynopsis.loading && (
            <span class="text-[10px] text-muted-foreground animate-pulse-dot">loading...</span>
          )}
        </div>
        {localSynopsis.data ? (
          <SynopsisDetail data={localSynopsis.data} />
        ) : (
          <div class="text-sm text-muted-foreground">No activity in the last {hours}h</div>
        )}
      </div>

      {isPortfolio && (
        <div class="space-y-4">
          <h2 class="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Products ({children.length})
          </h2>
          {childData.map((child) => (
            <div key={child.name} class="bg-card rounded-lg border border-border p-4">
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <span class={cn(
                    "w-[6px] h-[6px] rounded-full shrink-0",
                    child.status === "ok" ? "bg-success" : child.status === "loading" ? "bg-muted-foreground/50 animate-pulse" : "bg-destructive",
                  )} />
                  <h3 class="text-sm font-medium">{child.name}</h3>
                  <span class="text-[10px] mono text-muted-foreground">:{child.port}</span>
                </div>
                {child.status === "loading" && (
                  <span class="text-[10px] text-muted-foreground animate-pulse-dot">loading...</span>
                )}
              </div>
              {child.data ? (
                <SynopsisDetail data={child.data} />
              ) : child.status === "error" ? (
                <div class="text-xs text-muted-foreground">Unable to fetch synopsis</div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {!isPortfolio && localSynopsis.data && localSynopsis.data.commits.length > 0 && (
        <div class="bg-card rounded-lg border border-border p-4">
          <h3 class="text-xs text-muted-foreground uppercase tracking-wider mb-3">Commits</h3>
          <div class="space-y-1.5">
            {localSynopsis.data.commits.map((c) => (
              <div key={c.hash} class="flex items-center gap-2 text-xs">
                <span class="mono text-muted-foreground text-[10px] w-14 shrink-0">{c.hash.slice(0, 7)}</span>
                <span class="truncate flex-1">{c.message}</span>
                <span class="text-[10px] mono text-muted-foreground">{c.author}</span>
                <span class="text-[10px] text-muted-foreground whitespace-nowrap">{timeAgo(c.date)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AggCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div class="bg-card rounded-lg border border-border p-3">
      <div class="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div class={cn("text-2xl font-semibold mono tabular-nums mt-1", color)}>{value}</div>
      <div class="text-[10px] text-muted-foreground">across all projects</div>
    </div>
  )
}

function SynopsisDetail({ data }: { data: SynopsisData }) {
  const s = data.summary
  const hasMetrics = s.features + s.fixes + s.decisions + s.discoveries > 0

  return (
    <div class="space-y-3">
      {hasMetrics && (
        <div class="flex gap-4">
          {s.features > 0 && <Metric label="features" value={s.features} color="text-success" />}
          {s.fixes > 0 && <Metric label="fixes" value={s.fixes} color="text-warning" />}
          {s.decisions > 0 && <Metric label="decisions" value={s.decisions} color="text-info" />}
          {s.discoveries > 0 && <Metric label="discoveries" value={s.discoveries} color="text-purple-400" />}
          {data.commits.length > 0 && <Metric label="commits" value={data.commits.length} color="text-foreground" />}
          {s.filesModified > 0 && <Metric label="files" value={s.filesModified} color="text-muted-foreground" />}
        </div>
      )}

      {data.journalEntries.length > 0 && (
        <div>
          <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Journal</div>
          <div class="space-y-1">
            {data.journalEntries.slice(0, 5).map((j, i) => (
              <div key={i} class="flex items-start gap-2 text-xs">
                <span class={cn(
                  "text-[10px] mono px-1 py-0.5 rounded shrink-0",
                  j.type === "feature" ? "bg-success/15 text-success"
                    : j.type === "fix" ? "bg-warning/15 text-warning"
                    : j.type === "decision" ? "bg-info/15 text-info"
                    : "bg-muted text-muted-foreground",
                )}>
                  {j.type}
                </span>
                <span class="truncate">{j.title}</span>
                <span class="text-[10px] text-muted-foreground whitespace-nowrap ml-auto">{timeAgo(j.ts)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {s.incompleteItems.length > 0 && (
        <div>
          <div class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Incomplete</div>
          <div class="space-y-1">
            {s.incompleteItems.map((item, i) => (
              <div key={i} class="text-xs text-warning/80 flex items-center gap-1.5">
                <span class="w-1 h-1 rounded-full bg-warning/60 shrink-0" />
                {item}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div class={cn("text-lg font-semibold mono tabular-nums", color)}>{value}</div>
      <div class="text-[10px] text-muted-foreground uppercase">{label}</div>
    </div>
  )
}

function aggregateSynopses(
  local: SynopsisData | null,
  children: ChildSynopsis[],
): { features: number; fixes: number; decisions: number; commits: number } {
  let features = 0, fixes = 0, decisions = 0, commits = 0

  const add = (data: SynopsisData | null) => {
    if (!data) return
    features += data.summary.features
    fixes += data.summary.fixes
    decisions += data.summary.decisions
    commits += data.commits.length
  }

  add(local)
  for (const child of children) {
    add(child.data)
  }

  return { features, fixes, decisions, commits }
}
