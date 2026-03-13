import { render } from "preact"
import { useState, useEffect, useRef } from "preact/hooks"
import { api, WorkspaceStatus } from "./api"

// Dashboard telemetry — fire-and-forget event tracking
const telemetry = {
  _startTime: Date.now(),
  _lastPage: "",
  pageView(page: string) {
    const timeOnPrev = this._lastPage ? Date.now() - this._startTime : 0
    if (this._lastPage && timeOnPrev > 1000) {
      this._emit("dashboard:page-dwell", { page: this._lastPage, durationMs: timeOnPrev })
    }
    this._emit("dashboard:page-view", { page })
    this._startTime = Date.now()
    this._lastPage = page
  },
  click(target: string, context?: Record<string, unknown>) {
    this._emit("dashboard:click", { target, ...context })
  },
  _emit(type: string, data: Record<string, unknown>) {
    const ts = new Date().toISOString()
    const token = localStorage.getItem("jfl-token") || ""

    // 1. Hub events (local context pipeline)
    fetch("/api/hooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, source: "dashboard", data, ts }),
    }).catch(() => {})

    // 2. Platform telemetry table (persistent, queryable)
    fetch("https://jfl-platform.fly.dev/api/v1/telemetry/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-jfl-install-id": "jfl-dashboard" },
      body: JSON.stringify({ events: [{
        event_id: crypto.randomUUID(),
        ts,
        category: "dashboard",
        event: type,
        install_id: "jfl-dashboard",
        ...data,
      }]}),
    }).catch(() => {})
  },
}
import { Sidebar } from "./components/Sidebar"
import {
  OverviewPage,
  ActivityPage,
  LoopPage,
  ExperimentsPage,
  FindingsPage,
  SystemPage,
  TopologyPage,
  ReviewsPage,
  ChatPage,
  SynopsisPage,
} from "./pages"
import { usePolling } from "./lib/hooks"
import "./index.css"

type PageId = "overview" | "activity" | "loop" | "experiments" | "findings" | "reviews" | "chat" | "synopsis" | "topology" | "system"

const pageMap: Record<PageId, (props: { status: WorkspaceStatus | null }) => preact.JSX.Element> = {
  overview: OverviewPage,
  activity: () => <ActivityPage />,
  loop: () => <LoopPage />,
  experiments: () => <ExperimentsPage />,
  findings: () => <FindingsPage />,
  reviews: () => <ReviewsPage />,
  chat: () => <ChatPage />,
  synopsis: SynopsisPage,
  topology: TopologyPage,
  system: SystemPage,
}

function App() {
  const status = usePolling(() => api.status(), 10000)
  const hashPage = (location.hash.replace("#/", "") || "overview") as PageId
  const [page, setPage] = useState<PageId>(hashPage in pageMap ? hashPage : "overview")
  const firstRender = useRef(true)

  useEffect(() => {
    telemetry.pageView(page)
    if (!firstRender.current) location.hash = `#/${page}`
    firstRender.current = false
  }, [page])

  if (status.loading) {
    return (
      <div class="flex items-center justify-center h-screen">
        <div class="text-muted-foreground text-sm animate-pulse-dot">Loading dashboard...</div>
      </div>
    )
  }

  if (status.error) {
    return (
      <div class="flex items-center justify-center h-screen">
        <div class="text-center">
          <div class="text-destructive text-sm font-medium">Connection Error</div>
          <div class="text-muted-foreground text-xs mt-1">{status.error}</div>
          <div class="text-muted-foreground text-xs mt-2 mono">
            jfl context-hub start
          </div>
        </div>
      </div>
    )
  }

  const PageComponent = pageMap[page] || pageMap.overview

  return (
    <div class="flex min-h-screen">
      <Sidebar status={status.data} currentPage={page} setPage={(p) => setPage(p as PageId)} />
      <main class="flex-1 ml-56 p-6">
        <PageComponent status={status.data} />
      </main>
    </div>
  )
}

render(<App />, document.getElementById("app")!)
