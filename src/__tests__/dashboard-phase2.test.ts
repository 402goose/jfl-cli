import { getComponentsJS } from "../dashboard/components.js"
import { getPagesJS } from "../dashboard/pages.js"
import { getDashboardStyles } from "../dashboard/styles.js"
import { generateDashboardHTML } from "../dashboard/index.js"

describe("Dashboard Phase 2 — Components", () => {
  let components: string

  beforeAll(() => {
    components = getComponentsJS()
  })

  it("exports CostBar component", () => {
    expect(components).toContain("function CostBar(")
    expect(components).toContain("cost-bar-prompt")
    expect(components).toContain("cost-bar-completion")
  })

  it("exports SuccessRateBar component", () => {
    expect(components).toContain("function SuccessRateBar(")
    expect(components).toContain("success-bar")
    expect(components).toContain("success-bar-fill")
  })

  it("exports UtilizationRing component", () => {
    expect(components).toContain("function UtilizationRing(")
    expect(components).toContain("<svg")
    expect(components).toContain("circle")
  })

  it("exports ActiveAgentCard component", () => {
    expect(components).toContain("function ActiveAgentCard(")
    expect(components).toContain("active-agent-card")
    expect(components).toContain("run-feed")
  })

  it("Nav includes costs page for all modes", () => {
    expect(components).toContain("{ id: 'costs', label: 'Costs' }")
  })

  it("Nav includes flows page for gtm mode", () => {
    expect(components).toContain("{ id: 'flows', label: 'Flows' }")
  })

  it("ActiveAgentCard has tone-based event coloring", () => {
    expect(components).toContain("includes('error')")
    expect(components).toContain("includes('failed')")
    expect(components).toContain("includes('health')")
    expect(components).toContain("includes('completed')")
  })

  it("ActiveAgentCard shows running duration", () => {
    expect(components).toContain("startedAt")
  })
})

describe("Dashboard Phase 2 — Pages", () => {
  let pages: string

  beforeAll(() => {
    pages = getPagesJS()
  })

  it("exports useTelemetryDigest hook", () => {
    expect(pages).toContain("function useTelemetryDigest(")
    expect(pages).toContain("/api/telemetry/digest")
  })

  it("useTelemetryDigest refreshes every 2 minutes", () => {
    expect(pages).toContain("120000")
  })

  it("exports useFlowData hook", () => {
    expect(pages).toContain("function useFlowData(")
    expect(pages).toContain("/api/flows")
    expect(pages).toContain("/api/flows/executions")
  })

  it("useFlowData refreshes every 15 seconds", () => {
    expect(pages).toContain("15000")
  })

  it("exports CostsPage with period selector", () => {
    expect(pages).toContain("function CostsPage(")
    expect(pages).toContain("24")
    expect(pages).toContain("168")
    expect(pages).toContain("720")
  })

  it("CostsPage shows stat cards", () => {
    expect(pages).toContain("Total Spend")
    expect(pages).toContain("API Calls")
    expect(pages).toContain("Total Tokens")
  })

  it("CostsPage uses CostBar for model breakdown", () => {
    expect(pages).toContain("CostBar")
  })

  it("CostsPage uses SuccessRateBar for commands", () => {
    expect(pages).toContain("SuccessRateBar")
  })

  it("exports FlowsPage with tabs", () => {
    expect(pages).toContain("function FlowsPage(")
    expect(pages).toContain("Pending")
    expect(pages).toContain("Definitions")
  })

  it("FlowsPage has approve button", () => {
    expect(pages).toContain("Approve")
    expect(pages).toContain("/approve")
  })

  it("extractAgents tracks recentEvents", () => {
    expect(pages).toContain("recentEvents")
  })

  it("extractAgents tracks startedAt", () => {
    expect(pages).toContain("startedAt")
  })

  it("extractAgents tracks currentTask", () => {
    expect(pages).toContain("currentTask")
  })

  it("AgentsPage has Active/All tabs", () => {
    expect(pages).toContain("'active'")
    expect(pages).toContain("ActiveAgentCard")
  })

  it("OverviewPage uses telemetry digest for command health", () => {
    expect(pages).toContain("Command Health")
    expect(pages).toContain("useTelemetryDigest")
  })
})

describe("Dashboard Phase 2 — Styles", () => {
  let styles: string

  beforeAll(() => {
    styles = getDashboardStyles()
  })

  it("includes cost bar styles", () => {
    expect(styles).toContain(".cost-bar")
    expect(styles).toContain(".cost-bar-prompt")
    expect(styles).toContain(".cost-bar-completion")
  })

  it("includes success bar styles", () => {
    expect(styles).toContain(".success-bar")
    expect(styles).toContain(".success-bar-fill")
  })

  it("includes utilization ring styles", () => {
    expect(styles).toContain(".util-ring")
  })

  it("includes active agent card styles", () => {
    expect(styles).toContain(".active-agent-card")
    expect(styles).toContain(".active-agent-header")
    expect(styles).toContain(".active-agent-task")
  })

  it("includes run feed styles", () => {
    expect(styles).toContain(".run-feed")
    expect(styles).toContain(".run-feed-line")
    expect(styles).toContain(".run-feed-type")
  })

  it("includes tab styles", () => {
    expect(styles).toContain(".tab-group")
    expect(styles).toContain(".tab-btn")
    expect(styles).toContain(".tab-btn-active")
  })

  it("includes gate badge styles", () => {
    expect(styles).toContain(".badge-gated")
    expect(styles).toContain(".badge-completed")
    expect(styles).toContain(".badge-error")
  })

  it("includes approve/reject button styles", () => {
    expect(styles).toContain(".btn-approve")
    expect(styles).toContain(".btn-reject")
  })
})

describe("Dashboard Phase 2 — Index", () => {
  it("pageMap includes costs page", () => {
    const html = generateDashboardHTML("Test Project", 4800)
    expect(html).toContain("costs: CostsPage")
  })

  it("pageMap includes flows page", () => {
    const html = generateDashboardHTML("Test Project", 4800)
    expect(html).toContain("flows: FlowsPage")
  })

  it("generates valid HTML with Phase 2 components", () => {
    const html = generateDashboardHTML("Test Project", 4800)
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("CostBar")
    expect(html).toContain("SuccessRateBar")
    expect(html).toContain("UtilizationRing")
    expect(html).toContain("ActiveAgentCard")
    expect(html).toContain("CostsPage")
    expect(html).toContain("FlowsPage")
    expect(html).toContain("useTelemetryDigest")
    expect(html).toContain("useFlowData")
  })

  it("escapes project name in HTML", () => {
    const html = generateDashboardHTML('<script>alert("xss")</script>', 4800)
    expect(html).not.toContain('<script>alert("xss")</script>')
    expect(html).toContain("&lt;script&gt;")
  })
})
