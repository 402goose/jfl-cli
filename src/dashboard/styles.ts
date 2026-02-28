/**
 * Dashboard CSS styles
 *
 * @purpose CSS string with brand colors from theme.ts for the web dashboard
 */

export function getDashboardStyles(): string {
  return `
    :root {
      --accent: #FFD700;
      --accent-soft: #FFA500;
      --accent-dim: #B8860B;
      --success: #00FF88;
      --error: #FF4444;
      --warning: #FFAA00;
      --info: #4FC3F7;
      --bg: #0f172a;
      --bg-card: #1e293b;
      --bg-card-hover: #334155;
      --text: #f8fafc;
      --text-soft: #94a3b8;
      --text-dim: #64748b;
      --border: #334155;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      min-height: 100vh;
    }

    #app { display: flex; min-height: 100vh; }

    .sidebar {
      width: 220px;
      background: var(--bg-card);
      border-right: 1px solid var(--border);
      padding: 1.5rem 0;
      display: flex;
      flex-direction: column;
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      z-index: 10;
    }

    .sidebar-brand {
      padding: 0 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border);
      margin-bottom: 1rem;
    }

    .sidebar-brand h1 {
      font-size: 1.125rem;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: -0.02em;
    }

    .sidebar-brand .port-badge {
      font-size: 0.75rem;
      color: var(--text-soft);
      margin-top: 0.25rem;
    }

    .nav-items { list-style: none; }

    .nav-item {
      display: block;
      padding: 0.625rem 1.25rem;
      color: var(--text-soft);
      text-decoration: none;
      cursor: pointer;
      font-size: 0.875rem;
      transition: all 0.15s;
      border-left: 3px solid transparent;
    }

    .nav-item:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.04);
    }

    .nav-item.active {
      color: var(--accent);
      background: rgba(255, 215, 0, 0.06);
      border-left-color: var(--accent);
      font-weight: 600;
    }

    .main-content {
      flex: 1;
      margin-left: 220px;
      padding: 2rem;
      max-width: 1200px;
    }

    .page-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 1.5rem;
      letter-spacing: -0.02em;
    }

    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }

    .card-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-soft);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
    }

    .card-value {
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; }
    .grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 1rem; }

    .badge {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .badge-ok { background: rgba(0, 255, 136, 0.15); color: var(--success); }
    .badge-down { background: rgba(255, 68, 68, 0.15); color: var(--error); }
    .badge-zombie { background: rgba(255, 68, 68, 0.15); color: var(--error); }
    .badge-stale { background: rgba(255, 170, 0, 0.15); color: var(--warning); }
    .badge-unknown { background: rgba(148, 163, 184, 0.15); color: var(--text-soft); }

    .badge-feature { background: rgba(79, 195, 247, 0.15); color: var(--info); }
    .badge-fix { background: rgba(255, 68, 68, 0.15); color: var(--error); }
    .badge-decision { background: rgba(255, 215, 0, 0.15); color: var(--accent); }
    .badge-discovery { background: rgba(0, 255, 136, 0.15); color: var(--success); }
    .badge-milestone { background: rgba(255, 170, 0, 0.15); color: var(--warning); }

    .badge-peter { background: rgba(79, 195, 247, 0.15); color: var(--info); }
    .badge-task { background: rgba(0, 255, 136, 0.15); color: var(--success); }
    .badge-session { background: rgba(255, 215, 0, 0.15); color: var(--accent); }
    .badge-system { background: rgba(148, 163, 184, 0.15); color: var(--text-soft); }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    th {
      text-align: left;
      padding: 0.625rem 0.75rem;
      color: var(--text-soft);
      font-weight: 600;
      border-bottom: 1px solid var(--border);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    td {
      padding: 0.625rem 0.75rem;
      border-bottom: 1px solid rgba(51, 65, 85, 0.5);
      color: var(--text);
    }

    tr:hover td { background: rgba(255, 255, 255, 0.02); }

    .search-input {
      width: 100%;
      padding: 0.625rem 0.875rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      color: var(--text);
      font-size: 0.875rem;
      outline: none;
      transition: border-color 0.15s;
    }

    .search-input:focus { border-color: var(--accent); }

    .search-input::placeholder { color: var(--text-dim); }

    .live-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      animation: pulse 2s infinite;
      margin-right: 0.5rem;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .event-row {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.8rem;
    }

    .event-time { color: var(--text-dim); white-space: nowrap; }

    .event-payload {
      color: var(--text-soft);
      max-width: 400px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 0.375rem 0;
      font-size: 0.875rem;
    }

    .stat-label { color: var(--text-soft); }
    .stat-value { color: var(--text); font-weight: 600; }

    /* Agent status dots */
    .agent-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }

    .agent-dot-active {
      background: var(--success);
      box-shadow: 0 0 6px var(--success);
      animation: pulse 2s infinite;
    }

    .agent-dot-idle {
      background: var(--text-dim);
    }

    .agent-dot-error {
      background: var(--error);
      box-shadow: 0 0 6px var(--error);
    }

    /* Model tier badges */
    .model-badge {
      font-size: 0.65rem;
      font-weight: 700;
      padding: 0.1rem 0.375rem;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: rgba(255, 215, 0, 0.12);
      color: var(--accent);
    }

    /* Runtime badges (fly, local) */
    .runtime-badge {
      font-size: 0.6rem;
      font-weight: 600;
      padding: 0.1rem 0.375rem;
      border-radius: 4px;
      background: rgba(79, 195, 247, 0.12);
      color: var(--info);
      text-transform: lowercase;
    }

    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-dim);
    }

    .empty-state-icon { font-size: 2rem; margin-bottom: 0.75rem; }

    .btn {
      padding: 0.5rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      font-weight: 600;
      border: none;
      cursor: pointer;
      transition: all 0.15s;
    }

    .btn-primary {
      background: var(--accent);
      color: var(--bg);
    }

    .btn-primary:hover { background: var(--accent-soft); }

    .btn-secondary {
      background: var(--bg-card);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .btn-secondary:hover { background: var(--bg-card-hover); }

    .form-group { margin-bottom: 0.75rem; }

    .form-label {
      display: block;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-soft);
      margin-bottom: 0.375rem;
    }

    textarea.search-input {
      min-height: 80px;
      resize: vertical;
    }

    .tag-input {
      display: flex;
      gap: 0.375rem;
      flex-wrap: wrap;
    }

    .relevance-bar {
      height: 4px;
      border-radius: 2px;
      background: var(--border);
      overflow: hidden;
    }

    .relevance-fill {
      height: 100%;
      border-radius: 2px;
      background: var(--accent);
      transition: width 0.3s;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      color: var(--text-dim);
    }

    .loading::after {
      content: '';
      width: 20px;
      height: 20px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-left: 0.5rem;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Journal entries */
    .journal-entry {
      padding: 0.625rem 0;
      border-bottom: 1px solid rgba(51, 65, 85, 0.4);
    }

    .journal-entry:last-child { border-bottom: none; }

    .journal-entry-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .journal-entry-title {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .journal-entry-time {
      font-size: 0.7rem;
      color: var(--text-dim);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .journal-entry-content {
      font-size: 0.75rem;
      color: var(--text-soft);
      margin-top: 0.25rem;
      padding-left: calc(0.5rem + 60px);
      line-height: 1.5;
    }

    /* Knowledge status rows */
    .knowledge-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.375rem 0;
      border-bottom: 1px solid rgba(51, 65, 85, 0.3);
    }

    .knowledge-row:last-child { border-bottom: none; }

    .knowledge-indicator {
      font-size: 0.85rem;
      width: 1.25rem;
      text-align: center;
      flex-shrink: 0;
    }

    .knowledge-name {
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--text);
      flex: 1;
    }

    .knowledge-words {
      font-size: 0.7rem;
      color: var(--text-dim);
      font-family: monospace;
    }

    /* Decision rows */
    .decision-row {
      padding: 0.5rem 0;
      border-bottom: 1px solid rgba(51, 65, 85, 0.3);
    }

    .decision-row:last-child { border-bottom: none; }

    .decision-title {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--accent);
    }

    .decision-meta {
      font-size: 0.65rem;
      color: var(--text-dim);
      margin-top: 0.125rem;
    }

    .decision-summary {
      font-size: 0.7rem;
      color: var(--text-soft);
      margin-top: 0.25rem;
      line-height: 1.4;
    }

    /* Memory search results */
    .memory-result {
      padding: 0.5rem 0;
      border-bottom: 1px solid rgba(51, 65, 85, 0.3);
    }

    .memory-result:last-child { border-bottom: none; }

    @media (max-width: 768px) {
      .sidebar { width: 60px; padding: 1rem 0; }
      .sidebar-brand h1 { display: none; }
      .sidebar-brand .port-badge { display: none; }
      .nav-item { padding: 0.625rem; text-align: center; font-size: 0; }
      .nav-item::before { font-size: 1rem; }
      .main-content { margin-left: 60px; padding: 1rem; }
      .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
    }
  `
}
