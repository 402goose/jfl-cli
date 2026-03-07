/**
 * Dashboard reusable Preact components
 *
 * @purpose Preact+HTM component JS strings for Nav, Card, MetricCard, ChartCard, RunActivityChart, ActivityRow, etc.
 */

export function getComponentsJS(): string {
  return `
    function Nav({ currentPage, setPage, projectName, port, mode }) {
      const m = mode || 'gtm'
      const portfolioPages = [
        { id: 'portfolio', label: 'Portfolio Overview' },
        { id: 'evals', label: 'Leaderboard' },
        { id: 'events', label: 'Events' },
        { id: 'costs', label: 'Costs' },
        { id: 'projects', label: 'Health' },
      ]
      const gtmPages = [
        { id: 'overview', label: 'Command Center' },
        { id: 'journal', label: 'Journal' },
        { id: 'agents', label: 'Agents' },
        { id: 'evals', label: 'Evals' },
        { id: 'events', label: 'Events' },
        { id: 'costs', label: 'Costs' },
        { id: 'flows', label: 'Flows' },
        { id: 'sessions', label: 'Sessions' },
        { id: 'scope', label: 'Scope' },
        { id: 'projects', label: 'Projects' },
      ]
      const servicePages = [
        { id: 'service', label: 'My Status' },
        { id: 'journal', label: 'Journal' },
        { id: 'evals', label: 'My Evals' },
        { id: 'events', label: 'Events' },
        { id: 'costs', label: 'Costs' },
        { id: 'sessions', label: 'Sessions' },
      ]

      const pages = m === 'portfolio' ? portfolioPages : m === 'service' ? servicePages : gtmPages

      return html\`
        <div class="sidebar">
          <div class="sidebar-brand">
            <h1>\${projectName || 'Context Hub'}</h1>
            <\${ModeBadge} mode=\${m} />
            <div class="port-badge">Port \${port}</div>
          </div>
          <ul class="nav-items">
            \${pages.map(p => html\`
              <li
                key=\${p.id}
                class=\${'nav-item' + (currentPage === p.id ? ' active' : '')}
                onClick=\${() => setPage(p.id)}
              >
                \${p.label}
              </li>
            \`)}
          </ul>
        </div>
      \`
    }

    function Card({ title, children, className }) {
      return html\`
        <div class=\${'card ' + (className || '')}>
          \${title && html\`<div class="card-title">\${title}</div>\`}
          \${children}
        </div>
      \`
    }

    function MetricCard({ icon, value, label, description, onClick, color }) {
      return html\`
        <div class="metric-card" onClick=\${onClick}>
          \${icon && html\`<div style="font-size: 0.875rem; color: var(--muted-foreground); margin-bottom: 0.5rem;">\${icon}</div>\`}
          <div class="metric-value" style=\${color ? 'color:' + color : ''}>\${value}</div>
          <div class="metric-label">\${label}</div>
          \${description && html\`<div class="metric-description">\${description}</div>\`}
        </div>
      \`
    }

    function ChartCard({ title, subtitle, children }) {
      return html\`
        <div class="chart-card">
          <div style="margin-bottom: 1rem;">
            <div class="chart-card-title">\${title}</div>
            \${subtitle && html\`<div class="chart-card-subtitle">\${subtitle}</div>\`}
          </div>
          \${children}
        </div>
      \`
    }

    function RunActivityChart({ events, days }) {
      const numDays = days || 14
      const now = new Date()
      const buckets = []

      for (let i = numDays - 1; i >= 0; i--) {
        const d = new Date(now)
        d.setDate(d.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        buckets.push({ date: key, success: 0, failed: 0, other: 0, dayIndex: numDays - 1 - i })
      }

      const dateSet = new Set(buckets.map(b => b.date))

      for (const e of (events || [])) {
        const ts = e.ts || e.timestamp
        if (!ts) continue
        const day = new Date(ts).toISOString().slice(0, 10)
        const bucket = buckets.find(b => b.date === day)
        if (!bucket) continue
        const t = (e.type || '').toLowerCase()
        if (t.includes('completed') || t.includes('success')) bucket.success++
        else if (t.includes('failed') || t.includes('error')) bucket.failed++
        else bucket.other++
      }

      const maxCount = Math.max(1, ...buckets.map(b => b.success + b.failed + b.other))

      return html\`
        <div>
          <div class="stacked-bars">
            \${buckets.map((b, i) => {
              const total = b.success + b.failed + b.other
              const h = 80
              const successH = total > 0 ? Math.max(2, Math.round((b.success / maxCount) * h)) : 0
              const failedH = total > 0 ? Math.max(2, Math.round((b.failed / maxCount) * h)) : 0
              const otherH = total > 0 ? Math.max(2, Math.round((b.other / maxCount) * h)) : 0

              return html\`
                <div key=\${i} class="stacked-bar" title=\${b.date + ': ' + total + ' events'}>
                  \${total === 0 ? html\`<div class="stacked-bar-empty"></div>\` : html\`
                    \${successH > 0 && html\`<div class="stacked-bar-segment stacked-bar-segment-success" style=\${'height:' + successH + 'px'}></div>\`}
                    \${failedH > 0 && html\`<div class="stacked-bar-segment stacked-bar-segment-error" style=\${'height:' + failedH + 'px'}></div>\`}
                    \${otherH > 0 && html\`<div class="stacked-bar-segment stacked-bar-segment-warning" style=\${'height:' + otherH + 'px'}></div>\`}
                  \`}
                </div>
              \`
            })}
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: 0.25rem;">
            <span class="stacked-bar-label">\${buckets[0]?.date.slice(5) || ''}</span>
            <span class="stacked-bar-label">\${buckets[Math.floor(numDays / 2)]?.date.slice(5) || ''}</span>
            <span class="stacked-bar-label">\${buckets[numDays - 1]?.date.slice(5) || ''}</span>
          </div>
        </div>
      \`
    }

    function ActivityRow({ event, isNew }) {
      const time = new Date(event.ts || event.timestamp).toLocaleTimeString()
      const t = (event.type || '').toLowerCase()
      let icon = ''
      if (t.includes('completed') || t.includes('success')) icon = 'var(--success)'
      else if (t.includes('failed') || t.includes('error')) icon = 'var(--error)'
      else if (t.includes('started') || t.includes('start')) icon = 'var(--info)'
      else icon = 'var(--dim)'

      const detail = event.data
        ? (typeof event.data === 'object'
          ? (event.data.message || event.data.task || event.data.title || JSON.stringify(event.data).slice(0, 80))
          : String(event.data))
        : ''

      return html\`
        <div class=\${'activity-row' + (isNew ? ' activity-row-enter' : '')}>
          <span style=\${'width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; background:' + icon}></span>
          <span style="font-size: 0.75rem; color: var(--dim); white-space: nowrap; min-width: 60px;">\${time}</span>
          <\${TypeBadge} type=\${event.type} />
          <span style="font-size: 0.8rem; color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">\${detail}</span>
        </div>
      \`
    }

    function StatusBadge({ status }) {
      const s = (status || 'unknown').toLowerCase()
      return html\`<span class=\${'badge badge-' + s}>\${status}</span>\`
    }

    function TypeBadge({ type }) {
      const t = (type || 'unknown').toLowerCase()
      let cls = 'badge-unknown'
      if (t.startsWith('peter')) cls = 'badge-peter'
      else if (t.startsWith('task')) cls = 'badge-task'
      else if (t.startsWith('session')) cls = 'badge-session'
      else if (t.startsWith('system')) cls = 'badge-system'
      else if (t === 'feature') cls = 'badge-feature'
      else if (t === 'fix') cls = 'badge-fix'
      else if (t === 'decision') cls = 'badge-decision'
      else if (t === 'discovery') cls = 'badge-discovery'
      else if (t === 'milestone') cls = 'badge-milestone'
      else if (t === 'entry') cls = 'badge-unknown'
      else if (t === 'doc') cls = 'badge-unknown'
      return html\`<span class=\${'badge ' + cls}>\${type}</span>\`
    }

    function DataTable({ headers, rows }) {
      if (!rows || rows.length === 0) {
        return html\`<div class="empty-state">No data</div>\`
      }
      return html\`
        <table>
          <thead>
            <tr>\${headers.map(h => html\`<th key=\${h}>\${h}</th>\`)}</tr>
          </thead>
          <tbody>
            \${rows.map((row, i) => html\`
              <tr key=\${i}>
                \${row.map((cell, j) => html\`<td key=\${j}>\${cell}</td>\`)}
              </tr>
            \`)}
          </tbody>
        </table>
      \`
    }

    function EventRow({ event }) {
      const time = new Date(event.timestamp).toLocaleTimeString()
      const payload = JSON.stringify(event.data || {}).slice(0, 80)
      return html\`
        <tr class="event-row">
          <td class="event-time">\${time}</td>
          <td><\${TypeBadge} type=\${event.type} /></td>
          <td>\${event.source || '-'}</td>
          <td class="event-payload">\${payload}</td>
        </tr>
      \`
    }

    function JournalEntryRow({ entry, expanded }) {
      const time = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ''
      return html\`
        <div class="journal-entry">
          <div class="journal-entry-header">
            <\${TypeBadge} type=\${entry.type || 'entry'} />
            <span class="journal-entry-title">\${entry.title}</span>
            <span class="journal-entry-time">\${time}</span>
          </div>
          \${(expanded || entry.content) && html\`
            <div class="journal-entry-content">\${(entry.content || '').slice(0, 200)}\${(entry.content || '').length > 200 ? '...' : ''}</div>
          \`}
        </div>
      \`
    }

    function SearchInput({ value, onInput, placeholder, loading }) {
      return html\`
        <div style="position: relative; flex: 1;">
          <input
            type="text"
            class="search-input"
            value=\${value}
            onInput=\${onInput}
            placeholder=\${placeholder || 'Search...'}
            onKeyDown=\${e => { if (e.key === 'Enter' && e.target.closest('.card')) { const btn = e.target.closest('.card').querySelector('.btn-primary'); if (btn) btn.click() }}}
          />
          \${loading && html\`<div class="loading" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); padding: 0;"></div>\`}
        </div>
      \`
    }

    function LiveIndicator({ connected }) {
      if (connected) {
        return html\`
          <span style="display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.8rem; color: var(--muted-foreground);">
            <span class="pulse-dot">
              <span class="pulse-dot-ping" style="background: var(--success);"></span>
              <span class="pulse-dot-core" style="background: var(--success);"></span>
            </span>
            Live
          </span>
        \`
      }
      return html\`
        <span style="display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.8rem; color: var(--error);">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: var(--error);"></span>
          Disconnected
        </span>
      \`
    }

    function StatRow({ label, value }) {
      return html\`
        <div class="stat-row">
          <span class="stat-label">\${label}</span>
          <span class="stat-value">\${value}</span>
        </div>
      \`
    }

    function RelevanceBar({ score, max }) {
      const pct = Math.min(100, Math.round((score / (max || 1)) * 100))
      return html\`
        <div class="relevance-bar" style="width: 60px;">
          <div class="relevance-fill" style=\${'width: ' + pct + '%'}></div>
        </div>
      \`
    }

    function Sparkline({ data, width, height, color }) {
      const w = width || 60
      const h = height || 20
      const c = color || 'var(--accent)'
      if (!data || data.length < 2) {
        return html\`<svg width=\${w} height=\${h} class="sparkline"><line x1="0" y1=\${h/2} x2=\${w} y2=\${h/2} stroke="var(--dim)" stroke-width="1" stroke-dasharray="2,2" /></svg>\`
      }
      const min = Math.min(...data)
      const max = Math.max(...data)
      const range = max - min || 1
      const pad = 2
      const points = data.map((v, i) => {
        const x = (i / (data.length - 1)) * w
        const y = h - pad - ((v - min) / range) * (h - pad * 2)
        return x + ',' + y
      }).join(' ')
      return html\`
        <svg width=\${w} height=\${h} class="sparkline">
          <polyline points=\${points} fill="none" stroke=\${c} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      \`
    }

    function EvalChart({ data, width, height, label }) {
      const w = width || 500
      const h = height || 200
      const pad = { top: 10, right: 10, bottom: 25, left: 45 }
      const cw = w - pad.left - pad.right
      const ch = h - pad.top - pad.bottom

      if (!data || data.length < 2) {
        return html\`
          <div class="eval-chart-container" style=\${'width:' + w + 'px;height:' + h + 'px;'}>
            <div class="empty-state" style="padding: 2rem;">No eval data yet</div>
          </div>
        \`
      }

      const values = data.map(d => d.value)
      const min = Math.min(...values) * 0.95
      const max = Math.max(...values) * 1.05
      const range = max - min || 1

      const points = data.map((d, i) => {
        const x = pad.left + (i / (data.length - 1)) * cw
        const y = pad.top + ch - ((d.value - min) / range) * ch
        return { x, y, value: d.value, ts: d.ts, model: d.model_version }
      })

      const polyline = points.map(p => p.x + ',' + p.y).join(' ')
      const gradientPath = 'M' + points[0].x + ',' + (pad.top + ch) + ' L' + points.map(p => p.x + ',' + p.y).join(' L') + ' L' + points[points.length - 1].x + ',' + (pad.top + ch) + ' Z'

      const yTicks = 5
      const yLines = Array.from({ length: yTicks }, (_, i) => {
        const val = min + (range * i) / (yTicks - 1)
        const y = pad.top + ch - (i / (yTicks - 1)) * ch
        return { val, y }
      })

      return html\`
        <div class="eval-chart-container">
          <svg width=\${w} height=\${h} viewBox=\${'0 0 ' + w + ' ' + h}>
            <defs>
              <linearGradient id="evalGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.3" />
                <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
              </linearGradient>
            </defs>
            \${yLines.map(t => html\`
              <g key=\${t.val}>
                <line x1=\${pad.left} y1=\${t.y} x2=\${w - pad.right} y2=\${t.y} stroke="var(--border)" stroke-width="0.5" />
                <text x=\${pad.left - 5} y=\${t.y + 3} text-anchor="end" fill="var(--dim)" font-size="10">\${t.val.toFixed(2)}</text>
              </g>
            \`)}
            <path d=\${gradientPath} fill="url(#evalGrad)" />
            <polyline points=\${polyline} fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            \${points.map((p, i) => html\`
              <g key=\${i} class="eval-point">
                <circle cx=\${p.x} cy=\${p.y} r="3" fill="var(--card)" stroke="var(--accent)" stroke-width="1.5" />
                <title>\${(p.model || '') + ' ' + p.value.toFixed(4) + '\\n' + new Date(p.ts).toLocaleDateString()}</title>
              </g>
            \`)}
            \${label && html\`<text x=\${pad.left} y=\${h - 3} fill="var(--dim)" font-size="10">\${label}</text>\`}
          </svg>
        </div>
      \`
    }

    function HealthCard({ child }) {
      const dotClass = child.status === 'ok' ? 'health-dot-ok' : child.status === 'error' ? 'health-dot-error' : 'health-dot-down'
      return html\`
        <div class="card health-card">
          <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
            <span class=\${'health-dot ' + dotClass}></span>
            <span style="font-weight: 700; font-size: 0.9rem;">\${child.name}</span>
          </div>
          \${child.composite != null && html\`
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span class="metric-value" style="font-size: 1.5rem;">\${child.composite.toFixed(2)}</span>
              \${child.delta != null && html\`<\${DeltaBadge} delta=\${child.delta} />\`}
            </div>
          \`}
          \${child.sparkline && child.sparkline.length > 1 && html\`
            <div style="margin-top: 0.5rem;">
              <\${Sparkline} data=\${child.sparkline} width=\${120} height=\${24} />
            </div>
          \`}
          \${child.activeSessions != null && html\`
            <div style="font-size: 0.7rem; color: var(--dim); margin-top: 0.375rem;">\${child.activeSessions} active sessions</div>
          \`}
          <div style="font-size: 0.65rem; color: var(--dim); margin-top: 0.25rem;">Port \${child.port}</div>
        </div>
      \`
    }

    function DeltaBadge({ delta }) {
      if (delta == null || delta === 0) {
        return html\`<span class="delta-neutral">—</span>\`
      }
      const isUp = delta > 0
      const cls = isUp ? 'delta-up' : 'delta-down'
      const arrow = isUp ? '▲' : '▼'
      return html\`<span class=\${cls}>\${arrow} \${Math.abs(delta).toFixed(3)}</span>\`
    }

    function CostBar({ prompt, completion }) {
      const total = (prompt || 0) + (completion || 0)
      if (total === 0) return html\`<div class="cost-bar"><div class="cost-bar-empty">—</div></div>\`
      const pPct = Math.round((prompt / total) * 100)
      const cPct = 100 - pPct
      return html\`
        <div class="cost-bar">
          <div class="cost-bar-prompt" style=\${'width:' + pPct + '%'} title=\${'Prompt: ' + prompt.toLocaleString()}></div>
          <div class="cost-bar-completion" style=\${'width:' + cPct + '%'} title=\${'Completion: ' + completion.toLocaleString()}></div>
        </div>
      \`
    }

    function UtilBar({ value, max, label }) {
      const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
      const cls = pct < 60 ? 'util-bar-green' : pct < 85 ? 'util-bar-yellow' : 'util-bar-red'
      return html\`
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <div class="util-bar" style="flex: 1;">
            <div class=\${'util-bar-fill ' + cls} style=\${'width:' + pct + '%'}></div>
          </div>
          <span style="font-size: 0.65rem; color: var(--muted-foreground); font-weight: 600; min-width: 28px;">\${pct}%</span>
        </div>
      \`
    }

    function SuccessRateBar({ rate }) {
      const pct = Math.round((rate || 0) * 100)
      const color = pct >= 95 ? 'var(--success)' : pct >= 80 ? 'var(--warning)' : 'var(--error)'
      return html\`
        <div style="display: flex; align-items: center; gap: 0.375rem;">
          <div class="success-bar">
            <div class="success-bar-fill" style=\${'width:' + pct + '%; background:' + color}></div>
          </div>
          <span style="font-size: 0.65rem; color: var(--muted-foreground); font-weight: 600; min-width: 28px;">\${pct}%</span>
        </div>
      \`
    }

    function UtilizationRing({ value, max, label }) {
      const pct = max > 0 ? Math.min(1, value / max) : 0
      const r = 30
      const circumference = 2 * Math.PI * r
      const offset = circumference * (1 - pct)
      const color = pct < 0.6 ? 'var(--success)' : pct < 0.85 ? 'var(--warning)' : 'var(--error)'
      return html\`
        <div class="util-ring">
          <svg width="76" height="76" viewBox="0 0 76 76">
            <circle cx="38" cy="38" r=\${r} fill="none" stroke="var(--border)" stroke-width="6" />
            <circle cx="38" cy="38" r=\${r} fill="none" stroke=\${color} stroke-width="6"
              stroke-dasharray=\${circumference} stroke-dashoffset=\${offset}
              stroke-linecap="round" transform="rotate(-90 38 38)" />
            <text x="38" y="35" text-anchor="middle" fill="var(--foreground)" font-size="14" font-weight="700">\${Math.round(pct * 100)}%</text>
            \${label && html\`<text x="38" y="50" text-anchor="middle" fill="var(--dim)" font-size="9">\${label}</text>\`}
          </svg>
        </div>
      \`
    }

    function ActiveAgentCard({ agent }) {
      const a = agent
      const isLive = a.status === 'active'
      const duration = a.startedAt ? Math.round((Date.now() - new Date(a.startedAt).getTime()) / 1000) : null
      const durationStr = duration !== null
        ? duration < 60 ? duration + 's'
        : duration < 3600 ? Math.round(duration / 60) + 'm'
        : Math.round(duration / 3600) + 'h'
        : ''

      function feedColor(type) {
        if (!type) return 'feed-line-dim'
        if (type.includes('error') || type.includes('failed')) return 'feed-line-error'
        if (type.includes('warn')) return 'feed-line-warn'
        if (type.includes('health') || type.includes('analysis') || type.includes('info')) return 'feed-line-info'
        if (type.includes('completed') || type.includes('complete') || type.includes('success')) return 'feed-line-success'
        return 'feed-line-dim'
      }

      return html\`
        <div class=\${'active-agent-card' + (isLive ? ' active-agent-card-live' : '')}>
          <div class="active-agent-header">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              \${isLive ? html\`
                <span class="pulse-dot">
                  <span class="pulse-dot-ping" style="background: var(--success);"></span>
                  <span class="pulse-dot-core" style="background: var(--success);"></span>
                </span>
              \` : html\`
                <span class="agent-dot agent-dot-idle"></span>
              \`}
              <span style="font-weight: 700; font-size: 0.9rem;">\${a.name}</span>
              \${a.model && html\`<span class="model-badge">\${a.model}</span>\`}
            </div>
            <span style="font-size: 0.75rem; color: var(--dim);">\${durationStr}</span>
          </div>
          \${a.currentTask && html\`
            <div class="active-agent-task">\${a.currentTask}</div>
          \`}
          \${a.role && html\`<div style="font-size: 0.7rem; color: var(--dim); margin-bottom: 0.5rem;">\${a.role}</div>\`}
          \${a.recentEvents && a.recentEvents.length > 0 && html\`
            <div class="run-feed">
              \${a.recentEvents.slice(0, 5).map((e, i) => html\`
                <div key=\${i} class="run-feed-line">
                  <span class="run-feed-seq">\${String(i + 1).padStart(2, '0')}</span>
                  <span class=\${'run-feed-type ' + feedColor(e.type)}>\${(e.type || '').split(':').pop()}</span>
                  <span class="run-feed-data">\${e.data ? (typeof e.data === 'object' ? (e.data.message || e.data.task || JSON.stringify(e.data).slice(0, 60)) : String(e.data)) : ''}</span>
                </div>
              \`)}
            </div>
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
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
          <div style="display: flex; align-items: center; gap: 0.625rem;">
            <span class=\${'agent-dot agent-dot-' + a.status}></span>
            <div>
              <div style="font-size: 0.85rem; font-weight: 600;">\${a.name}</div>
              \${a.role && html\`<div style="font-size: 0.7rem; color: var(--dim);">\${a.role}</div>\`}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem; text-align: right;">
            \${a.model && html\`<span class="model-badge">\${a.model}</span>\`}
            \${a.runtime && a.runtime !== 'local' && html\`<span class="runtime-badge">\${a.runtime}</span>\`}
            <span style="font-size: 0.65rem; color: var(--dim); min-width: 50px;">\${ageStr}</span>
          </div>
        </div>
      \`
    }

    function ModeBadge({ mode }) {
      const cls = 'mode-badge mode-' + mode
      const label = mode === 'portfolio' ? 'PORTFOLIO' : mode === 'gtm' ? 'GTM' : mode === 'service' ? 'SERVICE' : 'STANDALONE'
      return html\`<span class=\${cls}>\${label}</span>\`
    }
  `
}
