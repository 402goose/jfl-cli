/**
 * Dashboard page components
 *
 * @purpose Command center pages: mode-aware overview, evals, portfolio, scope, service, events, agents, projects, sessions, journal
 */

export function getPagesJS(): string {
  return `
    // ================================================================
    // HOOKS
    // ================================================================

    // Workspace mode detection — fetches once at mount
    function useWorkspaceMode() {
      const [mode, setMode] = useState('gtm')
      const [config, setConfig] = useState({})
      const [children, setChildren] = useState([])
      const [loading, setLoading] = useState(true)

      useEffect(() => {
        apiFetch('/api/context/status')
          .then(data => {
            const t = data.type || 'standalone'
            setMode(t === 'standalone' ? 'gtm' : t)
            setConfig(data.config || {})
            setChildren(data.children || [])
          })
          .catch(() => {})
          .finally(() => setLoading(false))
      }, [])

      return { mode, config, children, loading }
    }

    // Eval data hook — leaderboard + optional trajectory, refreshes every 60s
    function useEvalData(selectedAgent) {
      const [leaderboard, setLeaderboard] = useState([])
      const [trajectory, setTrajectory] = useState([])
      const [loading, setLoading] = useState(true)

      useEffect(() => {
        function load() {
          apiFetch('/api/eval/leaderboard')
            .then(data => setLeaderboard(data || []))
            .catch(() => setLeaderboard([]))
            .finally(() => setLoading(false))
        }
        load()
        const interval = setInterval(load, 60000)
        return () => clearInterval(interval)
      }, [])

      useEffect(() => {
        if (!selectedAgent) { setTrajectory([]); return }
        apiFetch('/api/eval/trajectory?agent=' + encodeURIComponent(selectedAgent) + '&metric=composite')
          .then(data => setTrajectory(data.points || []))
          .catch(() => setTrajectory([]))
      }, [selectedAgent])

      return { leaderboard, trajectory, loading }
    }

    // Shared SSE hook — one connection, all pages can use it
    function useEventStream() {
      const [events, setEvents] = useState([])
      const [connected, setConnected] = useState(false)

      useEffect(() => {
        apiFetch('/api/events?limit=200')
          .then(data => setEvents(data.events || []))
          .catch(() => {})

        const token = localStorage.getItem('jfl-token')
        const url = new URL('/api/events/stream', window.location.origin)
        url.searchParams.set('patterns', '*')
        if (token) url.searchParams.set('token', token)
        const es = new EventSource(url.toString())

        es.onopen = () => setConnected(true)
        es.onerror = () => setConnected(false)

        function handleEvent(e) {
          try {
            const event = JSON.parse(e.data)
            setEvents(prev => [event, ...prev].slice(0, 500))
          } catch {}
        }

        es.onmessage = handleEvent
        const types = [
          'peter:started', 'peter:task-selected', 'peter:task-completed', 'peter:all-complete',
          'task:started', 'task:completed', 'task:failed',
          'session:started', 'session:ended',
          'service:healthy', 'service:unhealthy',
          'journal:entry', 'decision:made',
          'build:completed', 'deploy:completed',
          'openclaw:tag', 'custom'
        ]
        types.forEach(t => es.addEventListener(t, handleEvent))

        return () => es.close()
      }, [])

      return { events, connected }
    }

    // Fetch journal + knowledge from Context API
    function useContextData() {
      const [journal, setJournal] = useState([])
      const [knowledge, setKnowledge] = useState([])
      const [loading, setLoading] = useState(true)

      useEffect(() => {
        apiFetch('/api/context', {
          method: 'POST',
          body: JSON.stringify({ maxItems: 100 })
        })
          .then(data => {
            const items = data.items || []
            setJournal(items.filter(i => i.source === 'journal'))
            setKnowledge(items.filter(i => i.source === 'knowledge'))
          })
          .catch(() => {})
          .finally(() => setLoading(false))
      }, [])

      return { journal, knowledge, loading }
    }

    // Extract agents from events
    function extractAgents(events) {
      const agents = new Map()
      for (const e of events) {
        const src = e.source || ''
        if (!src) continue

        if (!agents.has(src)) {
          agents.set(src, {
            name: src,
            model: e.data?.model || e.data?.modelTier || null,
            role: e.data?.role || e.data?.agentRole || null,
            runtime: e.data?.runtime || null,
            status: 'idle',
            lastEvent: e.type,
            lastSeen: e.ts || e.timestamp,
            eventCount: 0,
          })
        }

        const agent = agents.get(src)
        agent.eventCount++
        agent.lastEvent = e.type
        agent.lastSeen = e.ts || e.timestamp || agent.lastSeen

        if (e.data?.model) agent.model = e.data.model
        if (e.data?.modelTier) agent.model = e.data.modelTier
        if (e.data?.role) agent.role = e.data.role
        if (e.data?.agentRole) agent.role = e.data.agentRole
        if (e.data?.runtime) agent.runtime = e.data.runtime

        if (e.type?.includes('started') || e.type?.includes('start')) {
          agent.status = 'active'
        } else if (e.type?.includes('completed') || e.type?.includes('complete') || e.type?.includes('ended')) {
          agent.status = 'idle'
        } else if (e.type?.includes('failed')) {
          agent.status = 'error'
        }
      }
      return [...agents.values()].sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1
        if (b.status === 'active' && a.status !== 'active') return 1
        return (b.eventCount || 0) - (a.eventCount || 0)
      })
    }

    // ================================================================
    // PORTFOLIO OVERVIEW (portfolio mode)
    // ================================================================

    function PortfolioOverviewPage({ children, config }) {
      const { events, connected } = useEventStream()
      const { leaderboard, loading: evalLoading } = useEvalData()
      const [childHealth, setChildHealth] = useState(children || [])

      // Enrich children with eval data
      const enrichedChildren = (childHealth || []).map(child => {
        const agentsForChild = leaderboard.filter(a => a.agent.toLowerCase().includes(child.name.toLowerCase()))
        const bestAgent = agentsForChild[0]
        return {
          ...child,
          composite: bestAgent?.composite ?? null,
          delta: bestAgent?.delta ?? null,
          sparkline: bestAgent?.trajectory ?? [],
          activeSessions: null,
        }
      })

      const totalProducts = enrichedChildren.length
      const activeSessions = events.filter(e => (e.type || '').includes('session:started')).length
      const eventRate = events.length > 0 ? Math.round(events.length / Math.max(1, (Date.now() - new Date(events[events.length - 1]?.timestamp || Date.now()).getTime()) / 3600000)) : 0
      const avgComposite = leaderboard.length > 0 ? (leaderboard.reduce((sum, a) => sum + (a.composite || 0), 0) / leaderboard.length) : 0

      return html\`
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 class="page-title" style="margin-bottom: 0;">Portfolio Overview</h2>
            <\${LiveIndicator} connected=\${connected} />
          </div>

          <div class="grid-4" style="margin-bottom: 1.5rem;">
            <\${Card} title="Total Products">
              <div class="card-value">\${totalProducts}</div>
            <//>
            <\${Card} title="Active Sessions">
              <div class="card-value" style="color: var(--success);">\${activeSessions}</div>
            <//>
            <\${Card} title="Events/hr">
              <div class="card-value" style="color: var(--info);">\${eventRate}</div>
            <//>
            <\${Card} title="Avg Composite">
              <div class="card-value" style="color: var(--accent);">\${avgComposite > 0 ? avgComposite.toFixed(3) : '—'}</div>
            <//>
          </div>

          \${enrichedChildren.length > 0 && html\`
            <\${Card} title="Health Grid">
              <div class="health-grid">
                \${enrichedChildren.map(child => html\`
                  <\${HealthCard} key=\${child.name} child=\${child} />
                \`)}
              </div>
            <//>
          \`}

          \${leaderboard.length > 0 && html\`
            <\${Card} title="Leaderboard">
              <table>
                <thead>
                  <tr>
                    <th style="width: 40px;">#</th>
                    <th>Agent</th>
                    <th style="width: 100px;">Composite</th>
                    <th style="width: 80px;">Trend</th>
                    <th style="width: 80px;">Delta</th>
                    <th style="width: 120px;">Model</th>
                    <th style="width: 100px;">Last Run</th>
                  </tr>
                </thead>
                <tbody>
                  \${leaderboard.map((a, i) => html\`
                    <tr key=\${a.agent}>
                      <td style="font-weight: 700; color: \${i === 0 ? 'var(--accent)' : 'var(--text-soft)'};">\${i + 1}</td>
                      <td style="font-weight: 600;">\${a.agent}</td>
                      <td style="font-family: monospace; color: var(--accent);">\${a.composite != null ? a.composite.toFixed(4) : '—'}</td>
                      <td><\${Sparkline} data=\${a.trajectory} width=\${60} height=\${20} /></td>
                      <td>\${a.delta != null ? html\`<\${DeltaBadge} delta=\${a.delta} />\` : '—'}</td>
                      <td style="font-size: 0.75rem; color: var(--text-soft);">\${a.model_version || '—'}</td>
                      <td style="font-size: 0.75rem; color: var(--text-dim);">\${a.lastTs ? new Date(a.lastTs).toLocaleDateString() : '—'}</td>
                    </tr>
                  \`)}
                </tbody>
              </table>
            <//>
          \`}

          \${events.length > 0 && html\`
            <\${Card} title="Recent Events">
              <div style="max-height: 200px; overflow-y: auto;">
                <table>
                  <thead>
                    <tr>
                      <th style="width: 80px;">Time</th>
                      <th style="width: 160px;">Type</th>
                      <th>Source</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    \${events.slice(0, 15).map(e => html\`<\${EventRow} key=\${e.id} event=\${e} />\`)}
                  </tbody>
                </table>
              </div>
            <//>
          \`}
        </div>
      \`
    }

    // ================================================================
    // EVALS PAGE (all modes)
    // ================================================================

    function EvalsPage() {
      const [selectedAgent, setSelectedAgent] = useState('')
      const { leaderboard, trajectory, loading } = useEvalData(selectedAgent)

      // Auto-select first agent
      useEffect(() => {
        if (!selectedAgent && leaderboard.length > 0) {
          setSelectedAgent(leaderboard[0].agent)
        }
      }, [leaderboard, selectedAgent])

      // Extract unique metric keys from leaderboard
      const metricKeys = leaderboard.length > 0
        ? [...new Set(leaderboard.flatMap(a => Object.keys(a.metrics || {})))]
        : []

      return html\`
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 class="page-title" style="margin-bottom: 0;">Evals</h2>
            \${leaderboard.length > 0 && html\`
              <select class="agent-select" value=\${selectedAgent} onChange=\${e => setSelectedAgent(e.target.value)}>
                \${leaderboard.map(a => html\`<option key=\${a.agent} value=\${a.agent}>\${a.agent}</option>\`)}
              </select>
            \`}
          </div>

          \${loading ? html\`<div class="loading">Loading eval data</div>\` : leaderboard.length === 0 ? html\`
            <div class="empty-state" style="padding: 3rem;">
              <div style="font-size: 1.25rem; color: var(--text-dim); margin-bottom: 0.5rem;">No Eval Data</div>
              <div style="color: var(--text-dim); font-size: 0.85rem;">
                Run evals with <span style="color: var(--accent); font-family: monospace;">jfl eval run</span> to see results here.
              </div>
            </div>
          \` : html\`
            <\${Card} title=\${'Composite Trajectory — ' + selectedAgent}>
              <\${EvalChart} data=\${trajectory} width=\${800} height=\${240} label="composite score over time" />
            <//>

            \${metricKeys.length > 0 && html\`
              <div class="grid-3" style="margin-bottom: 1rem;">
                \${metricKeys.map(key => {
                  const agent = leaderboard.find(a => a.agent === selectedAgent)
                  const val = agent?.metrics?.[key]
                  return html\`
                    <\${Card} key=\${key} title=\${key}>
                      <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <span style="font-size: 1.5rem; font-weight: 700; color: var(--accent);">\${val != null ? val.toFixed(3) : '—'}</span>
                      </div>
                    <//>
                  \`
                })}
              </div>
            \`}

            <\${Card} title="Leaderboard">
              <table>
                <thead>
                  <tr>
                    <th style="width: 40px;">#</th>
                    <th>Agent</th>
                    <th style="width: 100px;">Composite</th>
                    <th style="width: 80px;">Trend</th>
                    <th style="width: 80px;">Delta</th>
                    <th style="width: 120px;">Model</th>
                    <th style="width: 100px;">Last Run</th>
                  </tr>
                </thead>
                <tbody>
                  \${leaderboard.map((a, i) => html\`
                    <tr key=\${a.agent} style=\${a.agent === selectedAgent ? 'background: rgba(255,215,0,0.05);' : ''} onClick=\${() => setSelectedAgent(a.agent)}>
                      <td style="font-weight: 700; color: \${i === 0 ? 'var(--accent)' : 'var(--text-soft)'}; cursor: pointer;">\${i + 1}</td>
                      <td style="font-weight: 600; cursor: pointer;">\${a.agent}</td>
                      <td style="font-family: monospace; color: var(--accent);">\${a.composite != null ? a.composite.toFixed(4) : '—'}</td>
                      <td><\${Sparkline} data=\${a.trajectory} width=\${60} height=\${20} /></td>
                      <td>\${a.delta != null ? html\`<\${DeltaBadge} delta=\${a.delta} />\` : '—'}</td>
                      <td style="font-size: 0.75rem; color: var(--text-soft);">\${a.model_version || '—'}</td>
                      <td style="font-size: 0.75rem; color: var(--text-dim);">\${a.lastTs ? new Date(a.lastTs).toLocaleDateString() : '—'}</td>
                    </tr>
                  \`)}
                </tbody>
              </table>
            <//>
          \`}
        </div>
      \`
    }

    // ================================================================
    // SCOPE PAGE (GTM mode only)
    // ================================================================

    function ScopePage({ config }) {
      const services = (config?.registered_services || [])
      const selfName = config?.name || 'This Workspace'

      if (services.length === 0) {
        return html\`
          <div>
            <h2 class="page-title">Scope</h2>
            <div class="empty-state" style="padding: 3rem;">
              <div style="color: var(--text-dim);">No registered services.</div>
              <div style="color: var(--text-dim); font-size: 0.8rem; margin-top: 0.5rem;">
                Register services with <span style="color: var(--accent); font-family: monospace;">jfl services register</span>
              </div>
            </div>
          </div>
        \`
      }

      const nodeW = 160
      const nodeH = 50
      const svgW = Math.max(500, (services.length + 1) * (nodeW + 40))
      const svgH = 280
      const topX = svgW / 2 - nodeW / 2
      const topY = 20
      const childY = 160
      const childStartX = (svgW - services.length * (nodeW + 30) + 30) / 2

      return html\`
        <div>
          <h2 class="page-title">Scope</h2>
          <\${Card}>
            <div class="scope-graph" style="overflow-x: auto;">
              <svg width=\${svgW} height=\${svgH} viewBox=\${'0 0 ' + svgW + ' ' + svgH}>
                <!-- Top node: this workspace -->
                <rect class="scope-node scope-node-self" x=\${topX} y=\${topY} width=\${nodeW} height=\${nodeH} />
                <text class="scope-label" x=\${topX + nodeW / 2} y=\${topY + 22} fill="var(--accent)">\${selfName}</text>
                <text x=\${topX + nodeW / 2} y=\${topY + 38} text-anchor="middle" fill="var(--text-dim)" font-size="10">\${config?.type || 'gtm'}</text>

                \${services.map((svc, i) => {
                  const cx = childStartX + i * (nodeW + 30)
                  const cy = childY
                  const scope = svc.context_scope || {}
                  const produces = scope.produces || []
                  const consumes = scope.consumes || []
                  const denied = scope.denied || []

                  // Connection line
                  const lineX1 = topX + nodeW / 2
                  const lineY1 = topY + nodeH
                  const lineX2 = cx + nodeW / 2
                  const lineY2 = cy

                  // Scope badges below each service node
                  const badgeY = cy + nodeH + 10
                  const badges = []
                  if (produces.length > 0) badges.push({ label: 'produces', cls: 'scope-badge-produces', items: produces })
                  if (consumes.length > 0) badges.push({ label: 'consumes', cls: 'scope-badge-consumes', items: consumes })
                  if (denied.length > 0) badges.push({ label: 'denied', cls: 'scope-badge-denied', items: denied })

                  return html\`
                    <g key=\${svc.name}>
                      <line class="scope-line" x1=\${lineX1} y1=\${lineY1} x2=\${lineX2} y2=\${lineY2} />
                      <rect class="scope-node" x=\${cx} y=\${cy} width=\${nodeW} height=\${nodeH} />
                      <text class="scope-label" x=\${cx + nodeW / 2} y=\${cy + 22}>\${svc.name}</text>
                      <text x=\${cx + nodeW / 2} y=\${cy + 38} text-anchor="middle" fill="var(--text-dim)" font-size="10">\${svc.type || 'service'}</text>
                      \${badges.map((b, bi) => html\`
                        <g key=\${b.label}>
                          <rect class=\${b.cls} x=\${cx + bi * 55 + 2} y=\${badgeY} width=\${50} height=\${18} rx="4" stroke-width="1" />
                          <text class="scope-badge-text" x=\${cx + bi * 55 + 27} y=\${badgeY + 13} fill="var(--text)">\${b.label}</text>
                        </g>
                      \`)}
                    </g>
                  \`
                })}
              </svg>
            </div>
          <//>

          <\${Card} title="Service Details">
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Produces</th>
                  <th>Consumes</th>
                  <th>Denied</th>
                </tr>
              </thead>
              <tbody>
                \${services.map(svc => {
                  const scope = svc.context_scope || {}
                  return html\`
                    <tr key=\${svc.name}>
                      <td style="font-weight: 600;">\${svc.name}</td>
                      <td style="font-size: 0.8rem; color: var(--text-soft);">\${svc.type || '—'}</td>
                      <td><\${StatusBadge} status=\${svc.status || 'unknown'} /></td>
                      <td style="font-size: 0.75rem; color: var(--success);">\${(scope.produces || []).join(', ') || '—'}</td>
                      <td style="font-size: 0.75rem; color: var(--info);">\${(scope.consumes || []).join(', ') || '—'}</td>
                      <td style="font-size: 0.75rem; color: var(--error);">\${(scope.denied || []).join(', ') || '—'}</td>
                    </tr>
                  \`
                })}
              </tbody>
            </table>
          <//>
        </div>
      \`
    }

    // ================================================================
    // SERVICE OVERVIEW (service mode)
    // ================================================================

    function ServiceOverviewPage({ config }) {
      const { journal, loading: journalLoading } = useContextData()
      const { events, connected } = useEventStream()
      const { leaderboard } = useEvalData()

      const serviceName = config?.name || 'Service'
      const serviceType = config?.type || 'service'
      const parentName = config?.gtm_parent ? config.gtm_parent.split('/').pop() : null

      // Find eval for this service
      const myEval = leaderboard.find(a => a.agent.toLowerCase().includes(serviceName.toLowerCase()))

      // Filter events to this service
      const myEvents = events.filter(e =>
        (e.source || '').toLowerCase().includes(serviceName.toLowerCase())
      )

      return html\`
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 class="page-title" style="margin-bottom: 0;">My Status</h2>
            <\${LiveIndicator} connected=\${connected} />
          </div>

          <div class="grid-3" style="margin-bottom: 1.5rem;">
            <\${Card} title="Service">
              <div style="font-size: 1.25rem; font-weight: 700;">\${serviceName}</div>
              <div style="font-size: 0.8rem; color: var(--text-dim); margin-top: 0.25rem;">\${serviceType}</div>
              \${parentName && html\`<div style="font-size: 0.75rem; color: var(--text-soft); margin-top: 0.25rem;">Parent: \${parentName}</div>\`}
            <//>
            <\${Card} title="My Eval">
              \${myEval ? html\`
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <span style="font-size: 1.5rem; font-weight: 700; color: var(--accent);">\${myEval.composite != null ? myEval.composite.toFixed(4) : '—'}</span>
                  \${myEval.delta != null && html\`<\${DeltaBadge} delta=\${myEval.delta} />\`}
                </div>
                <div style="margin-top: 0.375rem;">
                  <\${Sparkline} data=\${myEval.trajectory} width=\${100} height=\${24} />
                </div>
              \` : html\`<div style="color: var(--text-dim); font-size: 0.85rem;">No eval data</div>\`}
            <//>
            <\${Card} title="Activity">
              <div class="card-value">\${myEvents.length}</div>
              <div style="font-size: 0.75rem; color: var(--text-dim);">events from this service</div>
            <//>
          </div>

          \${myEvents.length > 0 && html\`
            <\${Card} title="My Events">
              <div style="max-height: 250px; overflow-y: auto;">
                <table>
                  <thead>
                    <tr>
                      <th style="width: 80px;">Time</th>
                      <th style="width: 160px;">Type</th>
                      <th>Source</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    \${myEvents.slice(0, 30).map(e => html\`<\${EventRow} key=\${e.id} event=\${e} />\`)}
                  </tbody>
                </table>
              </div>
            <//>
          \`}

          <\${Card} title="Scoped Journal">
            \${journalLoading ? html\`<div class="loading">Loading</div>\` :
              journal.length === 0 ? html\`
                <div style="color: var(--text-dim); font-size: 0.8rem; padding: 0.5rem 0;">No journal entries</div>
              \` : html\`
                <div style="max-height: 300px; overflow-y: auto;">
                  \${journal.slice(0, 20).map(entry => html\`
                    <\${JournalEntryRow} key=\${entry.timestamp + entry.title} entry=\${entry} />
                  \`)}
                </div>
              \`
            }
          <//>
        </div>
      \`
    }

    // ================================================================
    // COMMAND CENTER (Overview) — Enhanced with eval velocity
    // ================================================================

    function OverviewPage() {
      const { events, connected } = useEventStream()
      const { journal, knowledge, loading } = useContextData()
      const { leaderboard } = useEvalData()
      const [services, setServices] = useState({})
      const [projects, setProjects] = useState([])
      const [searchQuery, setSearchQuery] = useState('')
      const [searchResults, setSearchResults] = useState(null)
      const [searching, setSearching] = useState(false)

      useEffect(() => {
        apiFetch('/api/services').then(setServices).catch(() => {})
        apiFetch('/api/projects').then(setProjects).catch(() => {})
      }, [])

      function doSearch() {
        if (!searchQuery.trim()) return
        setSearching(true)
        apiFetch('/api/context/search', {
          method: 'POST',
          body: JSON.stringify({ query: searchQuery, maxItems: 15 })
        })
          .then(data => {
            const items = (data.items || []).map(item => ({
              type: item.type || item.source || 'unknown',
              title: item.title || 'Untitled',
              content: item.content || '',
              summary: item.summary || '',
              relevance_label: item.relevance > 0.7 ? 'high' : item.relevance > 0.4 ? 'medium' : 'low',
              timestamp: item.timestamp
            }))
            setSearchResults(items)
          })
          .catch(() => setSearchResults([]))
          .finally(() => setSearching(false))
      }

      const serviceEntries = Object.entries(services || {})
      const okProjects = (projects || []).filter(p => p.status === 'OK').length
      const totalProjects = (projects || []).length
      const decisionCount = journal.filter(e => e.type === 'decision').length

      // Eval velocity: latest composite from top agent
      const topAgent = leaderboard[0]
      const evalCount = leaderboard.length

      return html\`
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 class="page-title" style="margin-bottom: 0;">Command Center</h2>
            <\${LiveIndicator} connected=\${connected} />
          </div>

          <!-- Stats row -->
          <div class="grid-4" style="margin-bottom: 1rem;">
            <\${Card} title="Projects">
              <div class="card-value" style="color: var(--success);">\${okProjects}<span style="font-size: 1rem; color: var(--text-dim);">/\${totalProjects}</span></div>
            <//>
            <\${Card} title="Journal Entries">
              <div class="card-value">\${journal.length}</div>
            <//>
            <\${Card} title="Decisions">
              <div class="card-value" style="color: var(--accent);">\${decisionCount}</div>
            <//>
            <\${Card} title="Eval Velocity">
              \${topAgent ? html\`
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <span style="font-size: 1.5rem; font-weight: 700; color: var(--accent);">\${topAgent.composite != null ? topAgent.composite.toFixed(3) : '—'}</span>
                  \${topAgent.delta != null && html\`<\${DeltaBadge} delta=\${topAgent.delta} />\`}
                </div>
                <div style="margin-top: 0.25rem;">
                  <\${Sparkline} data=\${topAgent.trajectory} width=\${80} height=\${18} />
                </div>
                <div style="font-size: 0.65rem; color: var(--text-dim); margin-top: 0.125rem;">\${evalCount} agents evaluated</div>
              \` : html\`
                <div class="card-value" style="color: var(--text-dim);">—</div>
                <div style="font-size: 0.65rem; color: var(--text-dim);">No evals yet</div>
              \`}
            <//>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 320px; gap: 1rem;">

            <!-- Left: Journal Feed -->
            <div>
              <\${Card} title="Recent Activity">
                \${loading ? html\`<div class="loading">Loading journal</div>\` :
                  journal.length === 0 ? html\`
                    <div class="empty-state" style="padding: 1.5rem;">
                      <div style="color: var(--text-dim);">No journal entries yet</div>
                      <div style="color: var(--text-dim); font-size: 0.75rem; margin-top: 0.5rem;">
                        Journal entries appear as you work across sessions
                      </div>
                    </div>
                  \` : html\`
                    <div style="max-height: 360px; overflow-y: auto;">
                      \${journal.slice(0, 15).map(entry => html\`
                        <\${JournalEntryRow} key=\${entry.timestamp + entry.title} entry=\${entry} />
                      \`)}
                    </div>
                  \`
                }
              <//>

              <!-- Event stream (secondary, below journal) -->
              \${events.length > 0 && html\`
                <\${Card} title="Event Stream">
                  <div style="max-height: 200px; overflow-y: auto;">
                    <table>
                      <thead>
                        <tr>
                          <th style="width: 80px;">Time</th>
                          <th style="width: 160px;">Type</th>
                          <th>Source</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        \${events.slice(0, 20).map(e => html\`<\${EventRow} key=\${e.id} event=\${e} />\`)}
                      </tbody>
                    </table>
                  </div>
                <//>
              \`}
            </div>

            <!-- Right: Decisions + Services + Memory Search -->
            <div>
              <\${Card} title="Recent Decisions">
                \${loading ? html\`<div class="loading">Loading</div>\` :
                  (() => {
                    const decisions = journal.filter(e => e.type === 'decision')
                    return decisions.length === 0 ? html\`
                      <div style="color: var(--text-dim); font-size: 0.8rem; padding: 0.5rem 0;">No decisions recorded</div>
                    \` : html\`
                      <div>
                        \${decisions.slice(0, 5).map(d => html\`
                          <div key=\${d.timestamp + d.title} class="decision-row">
                            <div class="decision-title">\${d.title}</div>
                            <div class="decision-meta">
                              \${d.timestamp ? new Date(d.timestamp).toLocaleDateString() : ''}
                            </div>
                            \${d.content && html\`<div class="decision-summary">\${d.content.slice(0, 100)}\${d.content.length > 100 ? '...' : ''}</div>\`}
                          </div>
                        \`)}
                      </div>
                    \`
                  })()
                }
              <//>

              \${serviceEntries.length > 0 && html\`
                <\${Card} title="Services">
                  <div style="display: grid; gap: 0.375rem;">
                    \${serviceEntries.map(([name, svc]) => html\`
                      <div key=\${name} style="display: flex; align-items: center; justify-content: space-between; padding: 0.375rem 0; border-bottom: 1px solid rgba(51,65,85,0.3);">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                          <span class=\${'agent-dot agent-dot-' + (svc.status === 'running' ? 'active' : 'idle')}></span>
                          <span style="font-size: 0.8rem; font-weight: 600;">\${name}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                          \${svc.port && svc.port !== '?' && html\`<span style="font-size: 0.7rem; color: var(--text-dim); font-family: monospace;">:\${svc.port}</span>\`}
                          <span style="font-size: 0.65rem; padding: 0.1rem 0.375rem; border-radius: 4px; background: rgba(148,163,184,0.12); color: var(--text-soft);">\${svc.type || 'unknown'}</span>
                        </div>
                      </div>
                    \`)}
                  </div>
                <//>
              \`}

              <\${Card} title="Search">
                <div style="display: flex; gap: 0.5rem; margin-bottom: 0.75rem;">
                  <\${SearchInput}
                    value=\${searchQuery}
                    onInput=\${e => setSearchQuery(e.target.value)}
                    placeholder="Search journal, knowledge, code..."
                    loading=\${searching}
                  />
                  <button class="btn btn-primary" style="white-space: nowrap;" onClick=\${doSearch}>Search</button>
                </div>
                \${searchResults !== null && html\`
                  <div style="max-height: 250px; overflow-y: auto;">
                    \${searchResults.length === 0 ? html\`
                      <div style="color: var(--text-dim); font-size: 0.8rem; padding: 0.5rem 0;">No results found</div>
                    \` : searchResults.map((r, i) => html\`
                      <div key=\${i} class="memory-result">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                          <\${TypeBadge} type=\${r.type || 'unknown'} />
                          <span style="font-size: 0.8rem; font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">\${r.title}</span>
                          \${r.timestamp && html\`<span style="font-size: 0.65rem; color: var(--text-dim); white-space: nowrap;">\${new Date(r.timestamp).toLocaleDateString()}</span>\`}
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-soft); margin-top: 0.25rem; line-height: 1.4;">
                          \${(r.content || r.summary || '').slice(0, 150)}\${(r.content || r.summary || '').length > 150 ? '...' : ''}
                        </div>
                      </div>
                    \`)}
                  </div>
                \`}
              <//>
            </div>
          </div>
        </div>
      \`
    }

    // ================================================================
    // EVENTS (full stream with filtering)
    // ================================================================

    function EventsPage() {
      const { events, connected } = useEventStream()
      const [filter, setFilter] = useState('')

      const filtered = filter
        ? events.filter(e =>
            (e.type || '').toLowerCase().includes(filter.toLowerCase()) ||
            (e.source || '').toLowerCase().includes(filter.toLowerCase()) ||
            JSON.stringify(e.data || {}).toLowerCase().includes(filter.toLowerCase())
          )
        : events

      return html\`
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 class="page-title" style="margin-bottom: 0;">Events</h2>
            <div style="display: flex; align-items: center; gap: 1rem;">
              <span style="font-size: 0.8rem; color: var(--text-dim);">\${filtered.length} events</span>
              <\${LiveIndicator} connected=\${connected} />
            </div>
          </div>
          <div style="margin-bottom: 1rem;">
            <\${SearchInput}
              value=\${filter}
              onInput=\${e => setFilter(e.target.value)}
              placeholder="Filter by type, source, or data..."
            />
          </div>
          <\${Card}>
            <div style="max-height: 600px; overflow-y: auto;">
              <table>
                <thead>
                  <tr>
                    <th style="width: 80px;">Time</th>
                    <th style="width: 180px;">Type</th>
                    <th style="width: 140px;">Source</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  \${filtered.slice(0, 200).map(e => html\`<\${EventRow} key=\${e.id} event=\${e} />\`)}
                </tbody>
              </table>
              \${filtered.length === 0 && html\`
                <div class="empty-state">
                  <div style="color: var(--text-dim);">\${filter ? 'No matching events' : 'No events yet'}</div>
                </div>
              \`}
            </div>
          <//>
        </div>
      \`
    }

    // ================================================================
    // AGENTS
    // ================================================================

    function AgentsPage() {
      const { events, connected } = useEventStream()
      const agents = extractAgents(events)

      const localAgents = agents.filter(a => !a.runtime || a.runtime === 'local')
      const remoteAgents = agents.filter(a => a.runtime && a.runtime !== 'local')
      const peterEvents = events.filter(e => (e.type || '').startsWith('peter:'))

      return html\`
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 class="page-title" style="margin-bottom: 0;">Agents</h2>
            <\${LiveIndicator} connected=\${connected} />
          </div>

          \${agents.length === 0 ? html\`
            <div class="empty-state" style="padding: 3rem;">
              <div style="font-size: 1.5rem; color: var(--text-dim); margin-bottom: 1rem;">No Agent Activity</div>
              <div style="color: var(--text-dim); max-width: 400px; margin: 0 auto; line-height: 1.6;">
                Agents appear here when they emit MAP events.<br/>
                Run <span style="color: var(--accent); font-family: monospace;">jfl peter</span> or
                <span style="color: var(--accent); font-family: monospace;">jfl ralph</span> to see them in action.
              </div>
            </div>
          \` : html\`
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
              <\${Card} title=\${'Local Agents (' + localAgents.length + ')'}>
                \${localAgents.map(a => html\`
                  <\${AgentCard} key=\${a.name} agent=\${a} />
                \`)}
                \${localAgents.length === 0 && html\`<div style="color: var(--text-dim); font-size: 0.8rem;">None</div>\`}
              <//>
              <\${Card} title=\${'Remote Agents (' + remoteAgents.length + ')'}>
                \${remoteAgents.map(a => html\`
                  <\${AgentCard} key=\${a.name} agent=\${a} />
                \`)}
                \${remoteAgents.length === 0 && html\`<div style="color: var(--text-dim); font-size: 0.8rem;">None</div>\`}
              <//>
            </div>

            \${peterEvents.length > 0 && html\`
              <\${Card} title="Peter Parker Routing" style="margin-top: 1rem;">
                <div style="max-height: 300px; overflow-y: auto;">
                  <table>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Action</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      \${peterEvents.slice(0, 30).map(e => html\`
                        <tr key=\${e.id} class="event-row">
                          <td class="event-time">\${new Date(e.ts || e.timestamp).toLocaleTimeString()}</td>
                          <td><\${TypeBadge} type=\${e.type} /></td>
                          <td class="event-payload">
                            \${e.data?.task || e.data?.message || e.data?.agentRole || JSON.stringify(e.data || {}).slice(0, 80)}
                          </td>
                        </tr>
                      \`)}
                    </tbody>
                  </table>
                </div>
              <//>
            \`}
          \`}
        </div>
      \`
    }

    function AgentCard({ agent }) {
      const a = agent
      const age = a.lastSeen ? Math.round((Date.now() - new Date(a.lastSeen).getTime()) / 1000) : null
      const ageStr = age !== null
        ? age < 60 ? age + 's ago'
        : age < 3600 ? Math.round(age / 60) + 'm ago'
        : Math.round(age / 3600) + 'h ago'
        : ''

      return html\`
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid rgba(51,65,85,0.3);">
          <div style="display: flex; align-items: center; gap: 0.625rem;">
            <span class=\${'agent-dot agent-dot-' + a.status}></span>
            <div>
              <div style="font-size: 0.85rem; font-weight: 600;">\${a.name}</div>
              \${a.role && html\`<div style="font-size: 0.7rem; color: var(--text-dim);">\${a.role}</div>\`}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem; text-align: right;">
            \${a.model && html\`<span class="model-badge">\${a.model}</span>\`}
            \${a.runtime && a.runtime !== 'local' && html\`<span class="runtime-badge">\${a.runtime}</span>\`}
            <span style="font-size: 0.65rem; color: var(--text-dim); min-width: 50px;">\${ageStr}</span>
          </div>
        </div>
      \`
    }

    // ================================================================
    // PROJECTS (cross-project health)
    // ================================================================

    function ProjectsPage() {
      const [projects, setProjects] = useState(null)
      const [loading, setLoading] = useState(true)
      const [projectJournal, setProjectJournal] = useState({})

      useEffect(() => {
        async function load() {
          try {
            const data = await apiFetch('/api/projects')
            setProjects(data)
          } catch (err) {
            console.error('Failed to load projects:', err)
          } finally {
            setLoading(false)
          }
        }
        load()
        const interval = setInterval(load, 30000)

        // Fetch journal for entry counts
        apiFetch('/api/context', {
          method: 'POST',
          body: JSON.stringify({ maxItems: 500 })
        })
          .then(data => {
            const entries = (data.items || []).filter(i => i.source === 'journal')
            const bySession = {}
            for (const e of entries) {
              const session = (e.path || '').split('/').pop() || 'unknown'
              const project = session.replace('.jsonl', '').replace(/^session-/, '')
              if (!bySession[project]) bySession[project] = { count: 0, lastTs: '' }
              bySession[project].count++
              if (e.timestamp && e.timestamp > bySession[project].lastTs) {
                bySession[project].lastTs = e.timestamp
              }
            }
            setProjectJournal(bySession)
          })
          .catch(() => {})

        return () => clearInterval(interval)
      }, [])

      if (loading) return html\`<div class="loading">Loading projects</div>\`

      if (!projects || projects.length === 0) {
        return html\`
          <div>
            <h2 class="page-title">Projects</h2>
            <div class="empty-state">
              <div style="color: var(--text-dim);">No tracked projects found.</div>
            </div>
          </div>
        \`
      }

      const ok = projects.filter(p => p.status === 'OK').length
      const down = projects.filter(p => p.status === 'DOWN').length
      const zombie = projects.filter(p => p.status === 'ZOMBIE').length

      return html\`
        <div>
          <h2 class="page-title">Projects</h2>
          <div class="grid-3" style="margin-bottom: 1rem;">
            <\${Card} title="Healthy">
              <div class="card-value" style="color: var(--success);">\${ok}</div>
            <//>
            <\${Card} title="Down">
              <div class="card-value" style="color: \${down > 0 ? 'var(--error)' : 'var(--text-dim)'};">\${down}</div>
            <//>
            <\${Card} title="Zombie">
              <div class="card-value" style="color: \${zombie > 0 ? 'var(--warning)' : 'var(--text-dim)'};">\${zombie}</div>
            <//>
          </div>
          <\${Card}>
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Port</th>
                  <th>Status</th>
                  <th>PID</th>
                  <th>Journal Entries</th>
                  <th>Last Active</th>
                </tr>
              </thead>
              <tbody>
                \${projects.map(p => {
                  const name = p.name || ''
                  const journalInfo = Object.entries(projectJournal).find(([k]) => name.toLowerCase().includes(k.toLowerCase().slice(0, 8)))
                  const entryCount = journalInfo ? journalInfo[1].count : '-'
                  const lastActive = journalInfo && journalInfo[1].lastTs
                    ? new Date(journalInfo[1].lastTs).toLocaleDateString()
                    : '-'
                  return html\`
                    <tr key=\${p.path}>
                      <td style="font-weight: 600;">\${p.name}</td>
                      <td style="font-family: monospace; font-size: 0.8rem;">\${p.port}</td>
                      <td><\${StatusBadge} status=\${p.status} /></td>
                      <td style="font-family: monospace; font-size: 0.8rem; color: var(--text-soft);">\${p.pid || '-'}</td>
                      <td style="font-size: 0.8rem; color: var(--text-soft);">\${entryCount}</td>
                      <td style="font-size: 0.8rem; color: var(--text-soft);">\${lastActive}</td>
                    </tr>
                  \`
                })}
              </tbody>
            </table>
          <//>
        </div>
      \`
    }

    // ================================================================
    // SESSIONS (journal-based)
    // ================================================================

    function SessionsPage() {
      const { journal, loading } = useContextData()

      // Group entries by session field
      const sessions = new Map()
      for (const entry of journal) {
        // Extract session ID from path (filename) since journal entries are per-session files
        const filename = (entry.path || '').split('/').pop() || ''
        const sid = filename.replace('.jsonl', '') || 'unknown'
        if (!sessions.has(sid)) {
          sessions.set(sid, {
            id: sid,
            entries: [],
            types: new Set(),
            firstTs: entry.timestamp,
            lastTs: entry.timestamp,
          })
        }
        const s = sessions.get(sid)
        s.entries.push(entry)
        s.types.add(entry.type)
        if (entry.timestamp) {
          if (!s.firstTs || entry.timestamp < s.firstTs) s.firstTs = entry.timestamp
          if (!s.lastTs || entry.timestamp > s.lastTs) s.lastTs = entry.timestamp
        }
      }

      const sessionList = [...sessions.values()]
        .sort((a, b) => (b.lastTs || '').localeCompare(a.lastTs || ''))

      return html\`
        <div>
          <h2 class="page-title">Sessions</h2>
          \${loading ? html\`<div class="loading">Loading sessions</div>\` :
            sessionList.length === 0 ? html\`
              <div class="empty-state" style="padding: 3rem;">
                <div style="color: var(--text-dim);">No sessions found in journal.</div>
              </div>
            \` : html\`
              <div style="margin-bottom: 1rem; font-size: 0.8rem; color: var(--text-dim);">
                \${sessionList.length} sessions from journal entries
              </div>
              <div style="display: grid; gap: 0.75rem;">
                \${sessionList.map(s => html\`
                  <\${Card} key=\${s.id}>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                      <div>
                        <div style="font-weight: 600; font-family: monospace; font-size: 0.85rem;">\${s.id}</div>
                        <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 0.25rem;">
                          \${s.firstTs ? new Date(s.firstTs).toLocaleString() : ''}
                          \${s.lastTs && s.lastTs !== s.firstTs ? ' — ' + new Date(s.lastTs).toLocaleTimeString() : ''}
                        </div>
                      </div>
                      <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-soft);">
                        \${s.entries.length} entries
                      </span>
                    </div>
                    <div style="display: flex; gap: 0.375rem; margin-top: 0.5rem; flex-wrap: wrap;">
                      \${[...s.types].map(t => html\`
                        <\${TypeBadge} key=\${t} type=\${t} />
                      \`)}
                    </div>
                    <!-- Show last 3 entries as preview -->
                    <div style="margin-top: 0.625rem; border-top: 1px solid var(--border); padding-top: 0.5rem;">
                      \${s.entries.slice(0, 3).map(entry => html\`
                        <div key=\${entry.timestamp + entry.title} style="display: flex; gap: 0.5rem; align-items: baseline; padding: 0.2rem 0; font-size: 0.75rem;">
                          <span style="color: var(--text-dim); white-space: nowrap;">\${entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}</span>
                          <span style="color: var(--text-soft);">\${entry.title}</span>
                        </div>
                      \`)}
                    </div>
                  <//>
                \`)}
              </div>
            \`
          }
        </div>
      \`
    }

    // ================================================================
    // JOURNAL (full feed with type filtering)
    // ================================================================

    function JournalPage() {
      const { journal, loading } = useContextData()
      const [typeFilter, setTypeFilter] = useState('')
      const [searchFilter, setSearchFilter] = useState('')

      const types = [...new Set(journal.map(e => e.type))].sort()

      const filtered = journal.filter(entry => {
        if (typeFilter && entry.type !== typeFilter) return false
        if (searchFilter) {
          const q = searchFilter.toLowerCase()
          return (entry.title || '').toLowerCase().includes(q) ||
                 (entry.content || '').toLowerCase().includes(q)
        }
        return true
      })

      return html\`
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 class="page-title" style="margin-bottom: 0;">Journal</h2>
            <span style="font-size: 0.8rem; color: var(--text-dim);">\${filtered.length} entries</span>
          </div>

          <div style="display: flex; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap;">
            <\${SearchInput}
              value=\${searchFilter}
              onInput=\${e => setSearchFilter(e.target.value)}
              placeholder="Search journal entries..."
            />
            <div style="display: flex; gap: 0.375rem; flex-wrap: wrap; align-items: center;">
              <button
                class=\${'btn ' + (!typeFilter ? 'btn-primary' : 'btn-secondary')}
                style="font-size: 0.75rem; padding: 0.375rem 0.75rem;"
                onClick=\${() => setTypeFilter('')}
              >All</button>
              \${types.map(t => html\`
                <button
                  key=\${t}
                  class=\${'btn ' + (typeFilter === t ? 'btn-primary' : 'btn-secondary')}
                  style="font-size: 0.75rem; padding: 0.375rem 0.75rem;"
                  onClick=\${() => setTypeFilter(typeFilter === t ? '' : t)}
                >\${t}</button>
              \`)}
            </div>
          </div>

          \${loading ? html\`<div class="loading">Loading journal</div>\` : html\`
            <\${Card}>
              <div style="max-height: 600px; overflow-y: auto;">
                \${filtered.length === 0 ? html\`
                  <div class="empty-state">
                    <div style="color: var(--text-dim);">\${searchFilter || typeFilter ? 'No matching entries' : 'No journal entries'}</div>
                  </div>
                \` : filtered.map(entry => html\`
                  <\${JournalEntryRow} key=\${entry.timestamp + entry.title} entry=\${entry} expanded=\${true} />
                \`)}
              </div>
            <//>
          \`}
        </div>
      \`
    }
  `
}
