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

    function useTelemetryDigest(hours) {
      const [digest, setDigest] = useState(null)
      const [loading, setLoading] = useState(true)

      useEffect(() => {
        function load() {
          apiFetch('/api/telemetry/digest?hours=' + (hours || 168))
            .then(data => setDigest(data))
            .catch(() => setDigest(null))
            .finally(() => setLoading(false))
        }
        load()
        const interval = setInterval(load, 120000)
        return () => clearInterval(interval)
      }, [hours])

      return { digest, loading }
    }

    function useFlowData() {
      const [flows, setFlows] = useState([])
      const [executions, setExecutions] = useState([])
      const [loading, setLoading] = useState(true)

      useEffect(() => {
        function load() {
          Promise.all([
            apiFetch('/api/flows').catch(() => []),
            apiFetch('/api/flows/executions').catch(() => ({ executions: [] }))
          ]).then(([flowsData, execData]) => {
            setFlows(flowsData || [])
            setExecutions(execData.executions || execData || [])
          }).finally(() => setLoading(false))
        }
        load()
        const interval = setInterval(load, 15000)
        return () => clearInterval(interval)
      }, [])

      return { flows, executions, loading }
    }

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
            recentEvents: [],
            startedAt: null,
            currentTask: null,
          })
        }

        const agent = agents.get(src)
        agent.eventCount++
        agent.lastEvent = e.type
        agent.lastSeen = e.ts || e.timestamp || agent.lastSeen

        if (agent.recentEvents.length < 20) {
          agent.recentEvents.push(e)
        }

        if (e.data?.model) agent.model = e.data.model
        if (e.data?.modelTier) agent.model = e.data.modelTier
        if (e.data?.role) agent.role = e.data.role
        if (e.data?.agentRole) agent.role = e.data.agentRole
        if (e.data?.runtime) agent.runtime = e.data.runtime

        if (e.type?.includes('started') || e.type?.includes('start')) {
          agent.status = 'active'
          agent.startedAt = e.ts || e.timestamp
        } else if (e.type?.includes('completed') || e.type?.includes('complete') || e.type?.includes('ended')) {
          agent.status = 'idle'
        } else if (e.type?.includes('failed')) {
          agent.status = 'error'
        }

        if (e.type === 'peter:task-selected' || e.type === 'task:started') {
          agent.currentTask = e.data?.task || e.data?.message || e.data?.title || null
        }
        if (e.type === 'peter:task-completed' || e.type === 'task:completed') {
          agent.currentTask = null
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
            <h2 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em;">Portfolio Overview</h2>
            <\${LiveIndicator} connected=\${connected} />
          </div>

          <div class="grid-4" style="margin-bottom: 1.5rem;">
            <\${MetricCard} value=\${totalProducts} label="Total Products" />
            <\${MetricCard} value=\${activeSessions} label="Active Sessions" color="var(--success)" />
            <\${MetricCard} value=\${eventRate} label="Events/hr" color="var(--info)" />
            <\${MetricCard} value=\${avgComposite > 0 ? avgComposite.toFixed(3) : '—'} label="Avg Composite" color="var(--accent)" />
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
                      <td style=\${'font-weight: 700; color:' + (i === 0 ? 'var(--accent)' : 'var(--muted-foreground)')}>\${i + 1}</td>
                      <td style="font-weight: 600;">\${a.agent}</td>
                      <td style="font-family: monospace; color: var(--accent);">\${a.composite != null ? a.composite.toFixed(4) : '—'}</td>
                      <td><\${Sparkline} data=\${a.trajectory} width=\${60} height=\${20} /></td>
                      <td>\${a.delta != null ? html\`<\${DeltaBadge} delta=\${a.delta} />\` : '—'}</td>
                      <td style="font-size: 0.75rem; color: var(--muted-foreground);">\${a.model_version || '—'}</td>
                      <td style="font-size: 0.75rem; color: var(--dim);">\${a.lastTs ? new Date(a.lastTs).toLocaleDateString() : '—'}</td>
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
    // EVALS PAGE
    // ================================================================

    function EvalsPage() {
      const [selectedAgent, setSelectedAgent] = useState('')
      const { leaderboard, trajectory, loading } = useEvalData(selectedAgent)

      useEffect(() => {
        if (!selectedAgent && leaderboard.length > 0) {
          setSelectedAgent(leaderboard[0].agent)
        }
      }, [leaderboard, selectedAgent])

      const metricKeys = leaderboard.length > 0
        ? [...new Set(leaderboard.flatMap(a => Object.keys(a.metrics || {})))]
        : []

      return html\`
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em;">Evals</h2>
            \${leaderboard.length > 0 && html\`
              <select class="agent-select" value=\${selectedAgent} onChange=\${e => setSelectedAgent(e.target.value)}>
                \${leaderboard.map(a => html\`<option key=\${a.agent} value=\${a.agent}>\${a.agent}</option>\`)}
              </select>
            \`}
          </div>

          \${loading ? html\`<div class="loading">Loading eval data</div>\` : leaderboard.length === 0 ? html\`
            <div class="empty-state" style="padding: 3rem;">
              <div style="font-size: 1.25rem; color: var(--dim); margin-bottom: 0.5rem;">No Eval Data</div>
              <div style="color: var(--dim); font-size: 0.85rem;">
                Run evals with <span style="color: var(--accent); font-family: monospace;">jfl eval run</span> to see results here.
              </div>
            </div>
          \` : html\`
            <\${ChartCard} title=\${'Composite Trajectory — ' + selectedAgent} subtitle="Score over time">
              <\${EvalChart} data=\${trajectory} width=\${800} height=\${240} label="composite score over time" />
            <//>

            \${metricKeys.length > 0 && html\`
              <div class="grid-3" style="margin-bottom: 1rem;">
                \${metricKeys.map(key => {
                  const agent = leaderboard.find(a => a.agent === selectedAgent)
                  const val = agent?.metrics?.[key]
                  return html\`
                    <\${MetricCard} key=\${key} value=\${val != null ? val.toFixed(3) : '—'} label=\${key} color="var(--accent)" />
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
                    <tr key=\${a.agent} style=\${a.agent === selectedAgent ? 'background: oklch(0.588 0.158 241.966 / 0.06);' : ''} onClick=\${() => setSelectedAgent(a.agent)}>
                      <td style=\${'font-weight: 700; cursor: pointer; color:' + (i === 0 ? 'var(--accent)' : 'var(--muted-foreground)')}>\${i + 1}</td>
                      <td style="font-weight: 600; cursor: pointer;">\${a.agent}</td>
                      <td style="font-family: monospace; color: var(--accent);">\${a.composite != null ? a.composite.toFixed(4) : '—'}</td>
                      <td><\${Sparkline} data=\${a.trajectory} width=\${60} height=\${20} /></td>
                      <td>\${a.delta != null ? html\`<\${DeltaBadge} delta=\${a.delta} />\` : '—'}</td>
                      <td style="font-size: 0.75rem; color: var(--muted-foreground);">\${a.model_version || '—'}</td>
                      <td style="font-size: 0.75rem; color: var(--dim);">\${a.lastTs ? new Date(a.lastTs).toLocaleDateString() : '—'}</td>
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
            <h2 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 1.5rem;">Scope</h2>
            <div class="empty-state" style="padding: 3rem;">
              <div style="color: var(--dim);">No registered services.</div>
              <div style="color: var(--dim); font-size: 0.8rem; margin-top: 0.5rem;">
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
          <h2 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 1.5rem;">Scope</h2>
          <\${Card}>
            <div class="scope-graph" style="overflow-x: auto;">
              <svg width=\${svgW} height=\${svgH} viewBox=\${'0 0 ' + svgW + ' ' + svgH}>
                <rect class="scope-node scope-node-self" x=\${topX} y=\${topY} width=\${nodeW} height=\${nodeH} />
                <text class="scope-label" x=\${topX + nodeW / 2} y=\${topY + 22} fill="var(--accent)">\${selfName}</text>
                <text x=\${topX + nodeW / 2} y=\${topY + 38} text-anchor="middle" fill="var(--dim)" font-size="10">\${config?.type || 'gtm'}</text>

                \${services.map((svc, i) => {
                  const cx = childStartX + i * (nodeW + 30)
                  const cy = childY
                  const scope = svc.context_scope || {}
                  const produces = scope.produces || []
                  const consumes = scope.consumes || []
                  const denied = scope.denied || []

                  const lineX1 = topX + nodeW / 2
                  const lineY1 = topY + nodeH
                  const lineX2 = cx + nodeW / 2
                  const lineY2 = cy

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
                      <text x=\${cx + nodeW / 2} y=\${cy + 38} text-anchor="middle" fill="var(--dim)" font-size="10">\${svc.type || 'service'}</text>
                      \${badges.map((b, bi) => html\`
                        <g key=\${b.label}>
                          <rect class=\${b.cls} x=\${cx + bi * 55 + 2} y=\${badgeY} width=\${50} height=\${18} rx="4" stroke-width="1" />
                          <text class="scope-badge-text" x=\${cx + bi * 55 + 27} y=\${badgeY + 13} fill="var(--foreground)">\${b.label}</text>
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
                      <td style="font-size: 0.8rem; color: var(--muted-foreground);">\${svc.type || '—'}</td>
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

      const myEval = leaderboard.find(a => a.agent.toLowerCase().includes(serviceName.toLowerCase()))

      const myEvents = events.filter(e =>
        (e.source || '').toLowerCase().includes(serviceName.toLowerCase())
      )

      return html\`
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em;">My Status</h2>
            <\${LiveIndicator} connected=\${connected} />
          </div>

          <div class="grid-3" style="margin-bottom: 1.5rem;">
            <\${MetricCard} value=\${serviceName} label=\${serviceType} description=\${parentName ? 'Parent: ' + parentName : ''} />
            <div class="metric-card">
              <div class="metric-label" style="margin-bottom: 0.5rem;">My Eval</div>
              \${myEval ? html\`
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <span class="metric-value" style="font-size: 1.5rem; color: var(--accent);">\${myEval.composite != null ? myEval.composite.toFixed(4) : '—'}</span>
                  \${myEval.delta != null && html\`<\${DeltaBadge} delta=\${myEval.delta} />\`}
                </div>
                <div style="margin-top: 0.375rem;">
                  <\${Sparkline} data=\${myEval.trajectory} width=\${100} height=\${24} />
                </div>
              \` : html\`<div style="color: var(--dim); font-size: 0.85rem;">No eval data</div>\`}
            </div>
            <\${MetricCard} value=\${myEvents.length} label="Events" description="from this service" />
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
                <div style="color: var(--dim); font-size: 0.8rem; padding: 0.5rem 0;">No journal entries</div>
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
    // COMMAND CENTER (Overview)
    // ================================================================

    function OverviewPage() {
      const { events, connected } = useEventStream()
      const { journal, knowledge, loading } = useContextData()
      const { leaderboard } = useEvalData()
      const { digest: telemetryDigest } = useTelemetryDigest(168)
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

      const topAgent = leaderboard[0]
      const evalCount = leaderboard.length

      const activeAgents = extractAgents(events).filter(a => a.status === 'active')

      return html\`
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em;">Command Center</h2>
            <\${LiveIndicator} connected=\${connected} />
          </div>

          <!-- Stats row -->
          <div class="grid-4" style="margin-bottom: 1rem;">
            <\${MetricCard} value=\${okProjects + '/' + totalProjects} label="Projects" color="var(--success)" />
            <\${MetricCard} value=\${journal.length} label="Journal Entries" />
            <\${MetricCard} value=\${decisionCount} label="Decisions" color="var(--accent)" />
            <div class="metric-card">
              <div class="metric-label" style="margin-bottom: 0.25rem;">Eval Velocity</div>
              \${topAgent ? html\`
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <span class="metric-value" style="font-size: 1.5rem; color: var(--accent);">\${topAgent.composite != null ? topAgent.composite.toFixed(3) : '—'}</span>
                  \${topAgent.delta != null && html\`<\${DeltaBadge} delta=\${topAgent.delta} />\`}
                </div>
                <div style="margin-top: 0.25rem;">
                  <\${Sparkline} data=\${topAgent.trajectory} width=\${80} height=\${18} />
                </div>
                <div class="metric-description">\${evalCount} agents evaluated</div>
              \` : html\`
                <div class="metric-value" style="color: var(--dim);">—</div>
                <div class="metric-description">No evals yet</div>
              \`}
            </div>
          </div>

          <!-- Active agents strip -->
          \${activeAgents.length > 0 && html\`
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; padding: 0.625rem 0.75rem; background: var(--card); border: 1px solid var(--border);">
              <span style="font-size: 0.75rem; font-weight: 600; color: var(--muted-foreground); text-transform: uppercase; letter-spacing: 0.05em;">Active</span>
              \${activeAgents.map(a => html\`
                <span key=\${a.name} style="display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.8rem;">
                  <span class="pulse-dot">
                    <span class="pulse-dot-ping" style="background: var(--success);"></span>
                    <span class="pulse-dot-core" style="background: var(--success);"></span>
                  </span>
                  \${a.name}
                </span>
              \`)}
            </div>
          \`}

          <!-- Run activity chart -->
          \${events.length > 0 && html\`
            <\${ChartCard} title="Activity" subtitle="Last 14 days">
              <\${RunActivityChart} events=\${events} days=\${14} />
            <//>
          \`}

          <div style="display: grid; grid-template-columns: 1fr 320px; gap: 1rem;">

            <!-- Left: Journal Feed -->
            <div>
              <\${Card} title="Recent Activity">
                \${loading ? html\`<div class="loading">Loading journal</div>\` :
                  journal.length === 0 ? html\`
                    <div class="empty-state" style="padding: 1.5rem;">
                      <div style="color: var(--dim);">No journal entries yet</div>
                      <div style="color: var(--dim); font-size: 0.75rem; margin-top: 0.5rem;">
                        Journal entries appear as you work across sessions
                      </div>
                    </div>
                  \` : html\`
                    <div style="max-height: 360px; overflow-y: auto;" class="divide-y">
                      \${journal.slice(0, 15).map((entry, i) => html\`
                        <\${ActivityRow} key=\${entry.timestamp + entry.title} event=\${{ type: entry.type, ts: entry.timestamp, data: { message: entry.title } }} isNew=\${i < 3} />
                      \`)}
                    </div>
                  \`
                }
              <//>

              \${telemetryDigest && telemetryDigest.commands && telemetryDigest.commands.length > 0 && html\`
                <\${Card} title="Command Health">
                  <div class="divide-y">
                    \${telemetryDigest.commands.slice(0, 5).map(c => html\`
                      <div key=\${c.command} style="display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0;">
                        <span style="font-size: 0.8rem; font-weight: 600; min-width: 90px; font-family: monospace;">\${c.command}</span>
                        <span style="font-size: 0.7rem; color: var(--dim); min-width: 35px;">\${c.count}x</span>
                        <div style="flex: 1;"><\${SuccessRateBar} rate=\${c.successRate} /></div>
                      </div>
                    \`)}
                  </div>
                <//>
              \`}

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

            <!-- Right: Decisions + Services + Search -->
            <div>
              <\${Card} title="Recent Decisions">
                \${loading ? html\`<div class="loading">Loading</div>\` :
                  (() => {
                    const decisions = journal.filter(e => e.type === 'decision')
                    return decisions.length === 0 ? html\`
                      <div style="color: var(--dim); font-size: 0.8rem; padding: 0.5rem 0;">No decisions recorded</div>
                    \` : html\`
                      <div class="divide-y">
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
                  <div class="divide-y">
                    \${serviceEntries.map(([name, svc]) => html\`
                      <div key=\${name} style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                          <span class=\${'agent-dot agent-dot-' + (svc.status === 'running' ? 'active' : 'idle')}></span>
                          <span style="font-size: 0.8rem; font-weight: 600;">\${name}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                          \${svc.port && svc.port !== '?' && html\`<span style="font-size: 0.7rem; color: var(--dim); font-family: monospace;">:\${svc.port}</span>\`}
                          <span style="font-size: 0.65rem; padding: 0.1rem 0.375rem; border-radius: 4px; background: oklch(0.708 0 0 / 0.12); color: var(--muted-foreground);">\${svc.type || 'unknown'}</span>
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
                  <div style="max-height: 250px; overflow-y: auto;" class="divide-y">
                    \${searchResults.length === 0 ? html\`
                      <div style="color: var(--dim); font-size: 0.8rem; padding: 0.5rem 0;">No results found</div>
                    \` : searchResults.map((r, i) => html\`
                      <div key=\${i} class="memory-result">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                          <\${TypeBadge} type=\${r.type || 'unknown'} />
                          <span style="font-size: 0.8rem; font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">\${r.title}</span>
                          \${r.timestamp && html\`<span style="font-size: 0.65rem; color: var(--dim); white-space: nowrap;">\${new Date(r.timestamp).toLocaleDateString()}</span>\`}
                        </div>
                        <div style="font-size: 0.75rem; color: var(--muted-foreground); margin-top: 0.25rem; line-height: 1.4;">
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
    // EVENTS
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
            <h2 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em;">Events</h2>
            <div style="display: flex; align-items: center; gap: 1rem;">
              <span style="font-size: 0.8rem; color: var(--dim);">\${filtered.length} events</span>
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
                  <div style="color: var(--dim);">\${filter ? 'No matching events' : 'No events yet'}</div>
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

    function AgentDetailPanel({ agent, events }) {
      const agentEvents = events.filter(e => (e.source || '') === agent.name).slice(0, 50)
      const duration = agent.startedAt ? Math.round((Date.now() - new Date(agent.startedAt).getTime()) / 1000) : null
      const durationStr = duration !== null
        ? duration < 60 ? duration + 's'
        : duration < 3600 ? Math.round(duration / 60) + 'm'
        : Math.round(duration / 3600) + 'h'
        : 'N/A'

      return html\`
        <\${Card}>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span class=\${'agent-dot agent-dot-' + agent.status}></span>
              <span style="font-size: 1.125rem; font-weight: 700;">\${agent.name}</span>
              \${agent.model && html\`<span class="model-badge">\${agent.model}</span>\`}
              \${agent.runtime && agent.runtime !== 'local' && html\`<span class="runtime-badge">\${agent.runtime}</span>\`}
            </div>
            <span style="font-size: 0.8rem; color: var(--dim);">\${agent.status} — \${durationStr}</span>
          </div>
          \${agent.role && html\`<div style="font-size: 0.8rem; color: var(--muted-foreground); margin-bottom: 0.75rem;">\${agent.role}</div>\`}
          \${agent.currentTask && html\`<div class="active-agent-task">\${agent.currentTask}</div>\`}

          <div class="grid-3" style="margin-bottom: 1rem;">
            <\${MetricCard} value=\${agent.eventCount} label="Total Events" />
            <\${MetricCard} value=\${durationStr} label="Running Time" />
            <\${MetricCard} value=\${agent.lastSeen ? new Date(agent.lastSeen).toLocaleTimeString() : '—'} label="Last Seen" />
          </div>

          <div class="section-header">Event Feed</div>
          <div style="max-height: 300px; overflow-y: auto;" class="divide-y">
            \${agentEvents.length === 0 ? html\`<div style="color: var(--dim); font-size: 0.8rem; padding: 0.5rem 0;">No events</div>\` :
              agentEvents.map((e, i) => html\`
                <\${ActivityRow} key=\${i} event=\${e} />
              \`)
            }
          </div>
        <//>
      \`
    }

    function AgentsPage() {
      const { events, connected } = useEventStream()
      const agents = extractAgents(events)
      const [tab, setTab] = useState('active')
      const [selectedAgent, setSelectedAgent] = useState(null)

      const activeAgents = agents.filter(a => a.status === 'active')
      const idleAgents = agents.filter(a => a.status !== 'active')
      const peterEvents = events.filter(e => (e.type || '').startsWith('peter:'))

      return html\`
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em;">Agents</h2>
            <div style="display: flex; align-items: center; gap: 1rem;">
              <span style="font-size: 0.8rem; color: var(--dim);">\${activeAgents.length} active / \${agents.length} total</span>
              <\${LiveIndicator} connected=\${connected} />
            </div>
          </div>

          \${agents.length === 0 ? html\`
            <div class="empty-state" style="padding: 3rem;">
              <div style="font-size: 1.5rem; color: var(--dim); margin-bottom: 1rem;">No Agent Activity</div>
              <div style="color: var(--dim); max-width: 400px; margin: 0 auto; line-height: 1.6;">
                Agents appear here when they emit MAP events.
                Run <span style="color: var(--accent); font-family: monospace;">jfl peter</span> or
                <span style="color: var(--accent); font-family: monospace;">jfl ralph</span> to see them in action.
              </div>
            </div>
          \` : html\`
            <div class="tab-group" style="margin-bottom: 1.5rem;">
              <button class=\${'tab-btn ' + (tab === 'active' ? 'tab-btn-active' : '')} onClick=\${() => { setTab('active'); setSelectedAgent(null) }}>
                Active \${activeAgents.length > 0 ? '(' + activeAgents.length + ')' : ''}
              </button>
              <button class=\${'tab-btn ' + (tab === 'all' ? 'tab-btn-active' : '')} onClick=\${() => { setTab('all'); setSelectedAgent(null) }}>
                All (\${agents.length})
              </button>
            </div>

            \${tab === 'active' && html\`
              \${activeAgents.length === 0 ? html\`
                <div class="empty-state" style="padding: 2rem;">
                  <div style="color: var(--dim);">No active agents</div>
                </div>
              \` : html\`
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                  \${activeAgents.map(a => html\`
                    <div key=\${a.name} onClick=\${() => setSelectedAgent(selectedAgent?.name === a.name ? null : a)} style="cursor: pointer;">
                      <\${ActiveAgentCard} agent=\${a} />
                    </div>
                  \`)}
                </div>
              \`}

              \${idleAgents.length > 0 && html\`
                <\${Card} title=\${'Idle / Completed (' + idleAgents.length + ')'}>
                  <div class="divide-y">
                    \${idleAgents.map(a => html\`
                      <div key=\${a.name} onClick=\${() => setSelectedAgent(selectedAgent?.name === a.name ? null : a)} style="cursor: pointer;">
                        <\${AgentCard} agent=\${a} />
                      </div>
                    \`)}
                  </div>
                <//>
              \`}
            \`}

            \${tab === 'all' && html\`
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <\${Card} title=\${'Local (' + agents.filter(a => !a.runtime || a.runtime === 'local').length + ')'}>
                  <div class="divide-y">
                    \${agents.filter(a => !a.runtime || a.runtime === 'local').map(a => html\`
                      <div key=\${a.name} onClick=\${() => setSelectedAgent(selectedAgent?.name === a.name ? null : a)} style="cursor: pointer;">
                        <\${AgentCard} agent=\${a} />
                      </div>
                    \`)}
                  </div>
                <//>
                <\${Card} title=\${'Remote (' + agents.filter(a => a.runtime && a.runtime !== 'local').length + ')'}>
                  <div class="divide-y">
                    \${agents.filter(a => a.runtime && a.runtime !== 'local').map(a => html\`
                      <div key=\${a.name} onClick=\${() => setSelectedAgent(selectedAgent?.name === a.name ? null : a)} style="cursor: pointer;">
                        <\${AgentCard} agent=\${a} />
                      </div>
                    \`)}
                  </div>
                  \${agents.filter(a => a.runtime && a.runtime !== 'local').length === 0 && html\`<div style="color: var(--dim); font-size: 0.8rem; padding: 0.5rem 0;">None</div>\`}
                <//>
              </div>
            \`}

            <!-- Agent Detail Panel (inline expand) -->
            \${selectedAgent && html\`
              <div style="margin-top: 1rem;">
                <\${AgentDetailPanel} agent=\${selectedAgent} events=\${events} />
              </div>
            \`}

            \${peterEvents.length > 0 && html\`
              <\${Card} title="Peter Parker Routing" className="margin-top: 1rem;">
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

    // ================================================================
    // PROJECTS
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
            <h2 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 1.5rem;">Projects</h2>
            <div class="empty-state">
              <div style="color: var(--dim);">No tracked projects found.</div>
            </div>
          </div>
        \`
      }

      const ok = projects.filter(p => p.status === 'OK').length
      const down = projects.filter(p => p.status === 'DOWN').length
      const zombie = projects.filter(p => p.status === 'ZOMBIE').length

      return html\`
        <div>
          <h2 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 1.5rem;">Projects</h2>
          <div class="grid-3" style="margin-bottom: 1rem;">
            <\${MetricCard} value=\${ok} label="Healthy" color="var(--success)" />
            <\${MetricCard} value=\${down} label="Down" color=\${down > 0 ? 'var(--error)' : 'var(--dim)'} />
            <\${MetricCard} value=\${zombie} label="Zombie" color=\${zombie > 0 ? 'var(--warning)' : 'var(--dim)'} />
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
                      <td style="font-family: monospace; font-size: 0.8rem; color: var(--muted-foreground);">\${p.pid || '-'}</td>
                      <td style="font-size: 0.8rem; color: var(--muted-foreground);">\${entryCount}</td>
                      <td style="font-size: 0.8rem; color: var(--muted-foreground);">\${lastActive}</td>
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
    // SESSIONS
    // ================================================================

    function SessionsPage() {
      const { journal, loading } = useContextData()

      const sessions = new Map()
      for (const entry of journal) {
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
          <h2 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 1.5rem;">Sessions</h2>
          \${loading ? html\`<div class="loading">Loading sessions</div>\` :
            sessionList.length === 0 ? html\`
              <div class="empty-state" style="padding: 3rem;">
                <div style="color: var(--dim);">No sessions found in journal.</div>
              </div>
            \` : html\`
              <div style="margin-bottom: 1rem; font-size: 0.8rem; color: var(--dim);">
                \${sessionList.length} sessions from journal entries
              </div>
              <div style="display: grid; gap: 0.75rem;">
                \${sessionList.map(s => html\`
                  <\${Card} key=\${s.id}>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                      <div>
                        <div style="font-weight: 600; font-family: monospace; font-size: 0.85rem;">\${s.id}</div>
                        <div style="font-size: 0.75rem; color: var(--dim); margin-top: 0.25rem;">
                          \${s.firstTs ? new Date(s.firstTs).toLocaleString() : ''}
                          \${s.lastTs && s.lastTs !== s.firstTs ? ' — ' + new Date(s.lastTs).toLocaleTimeString() : ''}
                        </div>
                      </div>
                      <span style="font-size: 0.8rem; font-weight: 600; color: var(--muted-foreground);">
                        \${s.entries.length} entries
                      </span>
                    </div>
                    <div style="display: flex; gap: 0.375rem; margin-top: 0.5rem; flex-wrap: wrap;">
                      \${[...s.types].map(t => html\`
                        <\${TypeBadge} key=\${t} type=\${t} />
                      \`)}
                    </div>
                    <div style="margin-top: 0.625rem; border-top: 1px solid var(--border); padding-top: 0.5rem;" class="divide-y">
                      \${s.entries.slice(0, 3).map(entry => html\`
                        <div key=\${entry.timestamp + entry.title} style="display: flex; gap: 0.5rem; align-items: baseline; padding: 0.2rem 0; font-size: 0.75rem;">
                          <span style="color: var(--dim); white-space: nowrap;">\${entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}</span>
                          <span style="color: var(--muted-foreground);">\${entry.title}</span>
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
    // COSTS PAGE
    // ================================================================

    function CostsPage() {
      const [period, setPeriod] = useState(168)
      const { digest, loading } = useTelemetryDigest(period)

      const totalTokens = digest ? digest.costs.reduce((sum, c) => sum + c.totalTokens, 0) : 0
      const totalCalls = digest ? digest.costs.reduce((sum, c) => sum + c.calls, 0) : 0

      return html\`
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em;">Costs</h2>
            <div style="display: flex; gap: 0.375rem;">
              \${[{v: 24, l: '24h'}, {v: 168, l: '7d'}, {v: 720, l: '30d'}].map(p => html\`
                <button key=\${p.v} class=\${'btn ' + (period === p.v ? 'btn-ghost active' : 'btn-ghost')}
                  style="font-size: 0.75rem; padding: 0.375rem 0.75rem;"
                  onClick=\${() => setPeriod(p.v)}>\${p.l}</button>
              \`)}
            </div>
          </div>

          \${loading ? html\`<div class="loading">Loading telemetry</div>\` : !digest ? html\`
            <div class="empty-state" style="padding: 3rem;">
              <div style="font-size: 1.25rem; color: var(--dim); margin-bottom: 0.5rem;">No Telemetry Data</div>
              <div style="color: var(--dim); font-size: 0.85rem;">
                Run some <span style="color: var(--accent); font-family: monospace;">jfl</span> commands to generate telemetry events.
              </div>
            </div>
          \` : html\`
            <div class="grid-4" style="margin-bottom: 1.5rem;">
              <\${MetricCard} value=\${'$' + digest.totalCostUsd.toFixed(4)} label="Total Spend" color="var(--accent)" />
              <\${MetricCard} value=\${totalCalls} label="API Calls" />
              <\${MetricCard} value=\${totalTokens.toLocaleString()} label="Total Tokens" />
              <\${MetricCard} value=\${digest.sessions.started} label="Sessions" />
            </div>

            \${digest.costs.length > 0 && html\`
              <\${Card} title="Cost by Model">
                <table>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th style="width: 70px;">Calls</th>
                      <th style="width: 120px;">Tokens (P/C)</th>
                      <th style="width: 140px;">Token Split</th>
                      <th style="width: 90px;">Cost</th>
                      <th style="width: 120px;">Utilization</th>
                      <th style="width: 90px;">Avg Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    \${digest.costs.map(c => {
                      const utilPct = totalTokens > 0 ? Math.round((c.totalTokens / totalTokens) * 100) : 0
                      return html\`
                        <tr key=\${c.model}>
                          <td style="font-weight: 600; font-size: 0.8rem;">\${c.model}</td>
                          <td style="font-family: monospace;">\${c.calls}</td>
                          <td style="font-family: monospace; font-size: 0.75rem;">\${c.promptTokens.toLocaleString()} / \${c.completionTokens.toLocaleString()}</td>
                          <td><\${CostBar} prompt=\${c.promptTokens} completion=\${c.completionTokens} /></td>
                          <td style="font-family: monospace; color: var(--accent);">$\${c.estimatedCostUsd.toFixed(4)}</td>
                          <td><\${UtilBar} value=\${utilPct} max=\${100} /></td>
                          <td style="font-family: monospace; font-size: 0.75rem; color: var(--muted-foreground);">\${c.avgLatencyMs > 0 ? Math.round(c.avgLatencyMs) + 'ms' : '—'}</td>
                        </tr>
                      \`
                    })}
                  </tbody>
                </table>
              <//>
            \`}

            <div class="grid-2">
              \${digest.commands.length > 0 && html\`
                <\${Card} title="Command Usage">
                  <div style="max-height: 300px; overflow-y: auto;" class="divide-y">
                    \${digest.commands.slice(0, 10).map(c => html\`
                      <div key=\${c.command} style="display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0;">
                        <span style="font-size: 0.8rem; font-weight: 600; min-width: 100px; font-family: monospace;">\${c.command}</span>
                        <span style="font-size: 0.75rem; color: var(--dim); min-width: 40px;">\${c.count}x</span>
                        <div style="flex: 1;"><\${SuccessRateBar} rate=\${c.successRate} /></div>
                      </div>
                    \`)}
                  </div>
                <//>
              \`}

              <\${Card} title="System Health">
                <\${StatRow} label="Hub Starts" value=\${digest.hubHealth.starts} />
                <\${StatRow} label="Hub Crashes" value=\${digest.hubHealth.crashes} />
                <\${StatRow} label="MCP Calls" value=\${digest.hubHealth.mcpCalls} />
                <\${StatRow} label="Avg MCP Latency" value=\${digest.hubHealth.avgMcpLatencyMs + 'ms'} />
                <\${StatRow} label="Memory Index Runs" value=\${digest.memoryHealth.indexRuns} />
                <\${StatRow} label="Entries Indexed" value=\${digest.memoryHealth.entriesIndexed} />
                <\${StatRow} label="Session Crashes" value=\${digest.sessions.crashed} />
                <\${StatRow} label="Errors" value=\${digest.errors.total} />
              <//>
            </div>
          \`}
        </div>
      \`
    }

    // ================================================================
    // FLOWS PAGE
    // ================================================================

    function FlowsPage() {
      const { flows, executions, loading } = useFlowData()
      const [tab, setTab] = useState('pending')

      const pending = executions.filter(e => e.gated)
      const all = executions

      async function approveExecution(flowName, triggerId) {
        try {
          await apiFetch('/api/flows/' + encodeURIComponent(flowName) + '/approve', {
            method: 'POST',
            body: JSON.stringify({ trigger_event_id: triggerId })
          })
        } catch (err) {
          console.error('Approval failed:', err)
        }
      }

      return html\`
        <div>
          <h2 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 1.5rem;">Flows</h2>
          <div class="tab-group" style="margin-bottom: 1.5rem;">
            <button class=\${'tab-btn ' + (tab === 'pending' ? 'tab-btn-active' : '')} onClick=\${() => setTab('pending')}>
              Pending \${pending.length > 0 ? '(' + pending.length + ')' : ''}
            </button>
            <button class=\${'tab-btn ' + (tab === 'all' ? 'tab-btn-active' : '')} onClick=\${() => setTab('all')}>
              All
            </button>
            <button class=\${'tab-btn ' + (tab === 'definitions' ? 'tab-btn-active' : '')} onClick=\${() => setTab('definitions')}>
              Definitions
            </button>
          </div>

          \${loading ? html\`<div class="loading">Loading flows</div>\` : html\`
            \${tab === 'pending' && html\`
              \${pending.length === 0 ? html\`
                <div class="empty-state" style="padding: 3rem;">
                  <div style="color: var(--dim);">No pending approvals</div>
                </div>
              \` : html\`
                <div style="display: grid; gap: 0.75rem;">
                  \${pending.map((ex, i) => html\`
                    <\${Card} key=\${i}>
                      <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                          <div style="font-weight: 700;">\${ex.flow}</div>
                          <div style="font-size: 0.75rem; color: var(--dim); margin-top: 0.25rem;">
                            Trigger: \${ex.trigger_event_type} — \${new Date(ex.started_at).toLocaleString()}
                          </div>
                          <span class="badge badge-gated" style="margin-top: 0.375rem;">\${ex.gated}</span>
                        </div>
                        \${ex.gated === 'approval' && html\`
                          <button class="btn-approve" onClick=\${() => approveExecution(ex.flow, ex.trigger_event_id)}>Approve</button>
                        \`}
                      </div>
                    <//>
                  \`)}
                </div>
              \`}
            \`}

            \${tab === 'all' && html\`
              <\${Card}>
                <div style="max-height: 500px; overflow-y: auto;">
                  <table>
                    <thead>
                      <tr>
                        <th>Flow</th>
                        <th>Trigger</th>
                        <th>Status</th>
                        <th>Actions</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      \${all.length === 0 ? html\`<tr><td colspan="5" style="text-align: center; color: var(--dim);">No executions</td></tr>\` :
                        all.slice().reverse().map((ex, i) => {
                          const status = ex.gated ? 'gated' : ex.actions_failed > 0 ? 'error' : 'completed'
                          const badgeCls = 'badge badge-' + status
                          return html\`
                            <tr key=\${i}>
                              <td style="font-weight: 600;">\${ex.flow}</td>
                              <td style="font-size: 0.75rem; color: var(--muted-foreground);">\${ex.trigger_event_type}</td>
                              <td><span class=\${badgeCls}>\${ex.gated || status}</span></td>
                              <td style="font-family: monospace; font-size: 0.8rem;">\${ex.actions_executed}\${ex.actions_failed > 0 ? ' / ' + ex.actions_failed + ' failed' : ''}</td>
                              <td style="font-size: 0.75rem; color: var(--dim);">\${ex.started_at ? new Date(ex.started_at).toLocaleString() : '—'}</td>
                            </tr>
                          \`
                        })
                      }
                    </tbody>
                  </table>
                </div>
              <//>
            \`}

            \${tab === 'definitions' && html\`
              \${flows.length === 0 ? html\`
                <div class="empty-state" style="padding: 3rem;">
                  <div style="color: var(--dim);">No flows defined</div>
                  <div style="font-size: 0.8rem; color: var(--dim); margin-top: 0.5rem;">
                    Create flows in <span style="color: var(--accent); font-family: monospace;">.jfl/flows.yaml</span>
                  </div>
                </div>
              \` : html\`
                <div style="display: grid; gap: 0.75rem;">
                  \${flows.map(f => html\`
                    <\${Card} key=\${f.name}>
                      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div>
                          <div style="font-weight: 700;">\${f.name}</div>
                          \${f.description && html\`<div style="font-size: 0.8rem; color: var(--muted-foreground); margin-top: 0.25rem;">\${f.description}</div>\`}
                        </div>
                        <span class=\${'badge ' + (f.enabled !== false ? 'badge-ok' : 'badge-unknown')}>\${f.enabled !== false ? 'enabled' : 'disabled'}</span>
                      </div>
                      <div style="margin-top: 0.75rem; display: flex; gap: 1rem; font-size: 0.75rem; color: var(--dim);">
                        <span>Trigger: <span style="color: var(--info); font-family: monospace;">\${f.trigger?.pattern}</span></span>
                        <span>Actions: \${(f.actions || []).length}</span>
                        \${f.gate?.requires_approval && html\`<span style="color: var(--warning);">Requires approval</span>\`}
                      </div>
                    <//>
                  \`)}
                </div>
              \`}
            \`}
          \`}
        </div>
      \`
    }

    // ================================================================
    // JOURNAL
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
            <h2 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em;">Journal</h2>
            <span style="font-size: 0.8rem; color: var(--dim);">\${filtered.length} entries</span>
          </div>

          <div style="display: flex; gap: 0.75rem; margin-bottom: 1rem; flex-wrap: wrap;">
            <\${SearchInput}
              value=\${searchFilter}
              onInput=\${e => setSearchFilter(e.target.value)}
              placeholder="Search journal entries..."
            />
            <div style="display: flex; gap: 0.375rem; flex-wrap: wrap; align-items: center;">
              <button
                class=\${'btn ' + (!typeFilter ? 'btn-ghost active' : 'btn-ghost')}
                style="font-size: 0.75rem; padding: 0.375rem 0.75rem;"
                onClick=\${() => setTypeFilter('')}
              >All</button>
              \${types.map(t => html\`
                <button
                  key=\${t}
                  class=\${'btn ' + (typeFilter === t ? 'btn-ghost active' : 'btn-ghost')}
                  style="font-size: 0.75rem; padding: 0.375rem 0.75rem;"
                  onClick=\${() => setTypeFilter(typeFilter === t ? '' : t)}
                >\${t}</button>
              \`)}
            </div>
          </div>

          \${loading ? html\`<div class="loading">Loading journal</div>\` : html\`
            <\${Card}>
              <div style="max-height: 600px; overflow-y: auto;" class="divide-y">
                \${filtered.length === 0 ? html\`
                  <div class="empty-state">
                    <div style="color: var(--dim);">\${searchFilter || typeFilter ? 'No matching entries' : 'No journal entries'}</div>
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
