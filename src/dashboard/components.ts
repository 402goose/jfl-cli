/**
 * Dashboard reusable Preact components
 *
 * @purpose Preact+HTM component JS strings for Nav, Card, StatusBadge, Table, JournalEntry, etc.
 */

export function getComponentsJS(): string {
  return `
    function Nav({ currentPage, setPage, projectName, port }) {
      const pages = [
        { id: 'overview', label: 'Command Center' },
        { id: 'journal', label: 'Journal' },
        { id: 'agents', label: 'Agents' },
        { id: 'events', label: 'Events' },
        { id: 'sessions', label: 'Sessions' },
        { id: 'projects', label: 'Projects' },
      ]

      return html\`
        <div class="sidebar">
          <div class="sidebar-brand">
            <h1>\${projectName || 'Context Hub'}</h1>
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
  `
}
