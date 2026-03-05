/**
 * Dashboard reusable Preact components
 *
 * @purpose Preact+HTM component JS strings for Nav, Card, StatusBadge, Table, JournalEntry, etc.
 */

export function getComponentsJS(): string {
  return `
    function Nav({ currentPage, setPage, projectName, port, mode }) {
      const m = mode || 'gtm'
      const portfolioPages = [
        { id: 'portfolio', label: 'Portfolio Overview' },
        { id: 'evals', label: 'Leaderboard' },
        { id: 'events', label: 'Events' },
        { id: 'projects', label: 'Health' },
      ]
      const gtmPages = [
        { id: 'overview', label: 'Command Center' },
        { id: 'journal', label: 'Journal' },
        { id: 'agents', label: 'Agents' },
        { id: 'evals', label: 'Evals' },
        { id: 'events', label: 'Events' },
        { id: 'sessions', label: 'Sessions' },
        { id: 'scope', label: 'Scope' },
        { id: 'projects', label: 'Projects' },
      ]
      const servicePages = [
        { id: 'service', label: 'My Status' },
        { id: 'journal', label: 'Journal' },
        { id: 'evals', label: 'My Evals' },
        { id: 'events', label: 'Events' },
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
      return html\`
        <span style="display: inline-flex; align-items: center; font-size: 0.8rem;">
          <span class="live-dot" style=\${'background: ' + (connected ? 'var(--success)' : 'var(--error)')}></span>
          \${connected ? 'Live' : 'Disconnected'}
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
        return html\`<svg width=\${w} height=\${h} class="sparkline"><line x1="0" y1=\${h/2} x2=\${w} y2=\${h/2} stroke="var(--text-dim)" stroke-width="1" stroke-dasharray="2,2" /></svg>\`
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
                <text x=\${pad.left - 5} y=\${t.y + 3} text-anchor="end" fill="var(--text-dim)" font-size="10">\${t.val.toFixed(2)}</text>
              </g>
            \`)}
            <path d=\${gradientPath} fill="url(#evalGrad)" />
            <polyline points=\${polyline} fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            \${points.map((p, i) => html\`
              <g key=\${i} class="eval-point">
                <circle cx=\${p.x} cy=\${p.y} r="3" fill="var(--bg-card)" stroke="var(--accent)" stroke-width="1.5" />
                <title>\${(p.model || '') + ' ' + p.value.toFixed(4) + '\\n' + new Date(p.ts).toLocaleDateString()}</title>
              </g>
            \`)}
            \${label && html\`<text x=\${pad.left} y=\${h - 3} fill="var(--text-dim)" font-size="10">\${label}</text>\`}
          </svg>
        </div>
      \`
    }

    function HealthCard({ child }) {
      const statusColor = child.status === 'ok' ? 'var(--success)' : child.status === 'error' ? 'var(--error)' : 'var(--warning)'
      const dotClass = child.status === 'ok' ? 'health-dot-ok' : child.status === 'error' ? 'health-dot-error' : 'health-dot-down'
      return html\`
        <div class="card health-card">
          <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
            <span class=\${'health-dot ' + dotClass}></span>
            <span style="font-weight: 700; font-size: 0.9rem;">\${child.name}</span>
          </div>
          \${child.composite != null && html\`
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span style="font-size: 1.5rem; font-weight: 700; color: var(--accent);">\${child.composite.toFixed(2)}</span>
              \${child.delta != null && html\`<\${DeltaBadge} delta=\${child.delta} />\`}
            </div>
          \`}
          \${child.sparkline && child.sparkline.length > 1 && html\`
            <div style="margin-top: 0.5rem;">
              <\${Sparkline} data=\${child.sparkline} width=\${120} height=\${24} />
            </div>
          \`}
          \${child.activeSessions != null && html\`
            <div style="font-size: 0.7rem; color: var(--text-dim); margin-top: 0.375rem;">\${child.activeSessions} active sessions</div>
          \`}
          <div style="font-size: 0.65rem; color: var(--text-dim); margin-top: 0.25rem;">Port \${child.port}</div>
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

    function ModeBadge({ mode }) {
      const cls = 'mode-badge mode-' + mode
      const label = mode === 'portfolio' ? 'PORTFOLIO' : mode === 'gtm' ? 'GTM' : mode === 'service' ? 'SERVICE' : 'STANDALONE'
      return html\`<span class=\${cls}>\${label}</span>\`
    }
  `
}
