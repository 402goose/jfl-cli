import { render } from "preact"
import { useState } from "preact/hooks"
import { api, WorkspaceStatus } from "./api"
import { Sidebar } from "./components/Sidebar"
import {
  OverviewPage,
  ActivityPage,
  LoopPage,
  SystemPage,
  TopologyPage,
  ReviewsPage,
  ChatPage,
  SynopsisPage,
} from "./pages"
import { usePolling } from "./lib/hooks"
import "./index.css"

type PageId = "overview" | "activity" | "loop" | "reviews" | "chat" | "synopsis" | "topology" | "system"

const pageMap: Record<PageId, (props: { status: WorkspaceStatus | null }) => preact.JSX.Element> = {
  overview: OverviewPage,
  activity: () => <ActivityPage />,
  loop: () => <LoopPage />,
  reviews: () => <ReviewsPage />,
  chat: () => <ChatPage />,
  synopsis: SynopsisPage,
  topology: TopologyPage,
  system: SystemPage,
}

function App() {
  const status = usePolling(() => api.status(), 10000)
  const [page, setPage] = useState<PageId>("overview")

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
