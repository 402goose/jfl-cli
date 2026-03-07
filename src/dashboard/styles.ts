/**
 * Dashboard CSS styles
 *
 * @purpose CSS string with Paperclip-inspired oklch monochromatic design system for the web dashboard
 */

export function getDashboardStyles(): string {
  return `
    :root {
      --background: oklch(0.145 0 0);
      --card: oklch(0.205 0 0);
      --card-hover: oklch(0.25 0 0);
      --border: oklch(0.269 0 0);
      --foreground: oklch(0.985 0 0);
      --muted-foreground: oklch(0.708 0 0);
      --dim: oklch(0.45 0 0);

      --success: oklch(0.696 0.17 162.48);
      --error: oklch(0.637 0.237 25.331);
      --warning: oklch(0.795 0.184 86.047);
      --info: oklch(0.588 0.158 241.966);
      --accent: oklch(0.588 0.158 241.966);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--background);
      color: var(--foreground);
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      min-height: 100vh;
    }

    #app { display: flex; min-height: 100vh; }

    .sidebar {
      width: 220px;
      background: var(--card);
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
      color: var(--foreground);
      letter-spacing: -0.02em;
    }

    .sidebar-brand .port-badge {
      font-size: 0.75rem;
      color: var(--muted-foreground);
      margin-top: 0.25rem;
    }

    .nav-items { list-style: none; }

    .nav-item {
      display: block;
      padding: 0.625rem 1.25rem;
      color: var(--muted-foreground);
      text-decoration: none;
      cursor: pointer;
      font-size: 0.875rem;
      transition: all 0.15s;
      border-left: 3px solid transparent;
    }

    .nav-item:hover {
      color: var(--foreground);
      background: oklch(0.985 0 0 / 0.04);
    }

    .nav-item.active {
      color: var(--foreground);
      background: oklch(0.588 0.158 241.966 / 0.08);
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

    .section-header {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--muted-foreground);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
    }

    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 0;
      padding: 1.5rem;
      margin-bottom: 1rem;
    }

    .card-title {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--muted-foreground);
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

    /* Metric card (Paperclip pattern) */
    .metric-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 0;
      padding: 1.5rem;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }

    .metric-card:hover {
      background: oklch(0.588 0.158 241.966 / 0.06);
      border-color: oklch(0.588 0.158 241.966 / 0.2);
    }

    .metric-value {
      font-size: 1.875rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1;
    }

    .metric-label {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--muted-foreground);
      margin-top: 0.25rem;
    }

    .metric-description {
      font-size: 0.7rem;
      color: var(--dim);
      margin-top: 0.25rem;
    }

    /* Chart card */
    .chart-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 0;
      padding: 1.5rem;
      margin-bottom: 1rem;
    }

    .chart-card-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--foreground);
    }

    .chart-card-subtitle {
      font-size: 0.75rem;
      color: var(--muted-foreground);
      margin-top: 0.125rem;
    }

    /* Pure CSS stacked bar chart */
    .stacked-bars {
      display: flex;
      align-items: flex-end;
      gap: 3px;
      height: 5rem;
    }

    .stacked-bar {
      display: flex;
      flex-direction: column-reverse;
      gap: 1px;
      min-width: 6px;
      flex: 1;
    }

    .stacked-bar-segment {
      min-height: 2px;
      border-radius: 1px;
    }

    .stacked-bar-segment-success { background: var(--success); }
    .stacked-bar-segment-error { background: var(--error); }
    .stacked-bar-segment-warning { background: var(--warning); }

    .stacked-bar-empty {
      background: oklch(0.708 0 0 / 0.2);
      height: 2px;
      border-radius: 1px;
    }

    .stacked-bar-label {
      font-size: 0.6rem;
      color: var(--dim);
      text-align: center;
      margin-top: 0.25rem;
    }

    /* Activity row with entrance animation */
    .activity-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      font-size: 0.875rem;
      transition: background 0.15s;
      border-bottom: 1px solid var(--border);
    }

    .activity-row:last-child { border-bottom: none; }

    .activity-row:hover {
      background: oklch(0.588 0.158 241.966 / 0.06);
    }

    .activity-row-enter {
      animation: activityEnter 0.5s ease-out;
    }

    @keyframes activityEnter {
      from {
        transform: translateY(-14px) scale(0.985);
        opacity: 0;
        filter: blur(4px);
      }
      to {
        transform: none;
        opacity: 1;
        filter: none;
      }
    }

    /* Active agent card with blue glow */
    .active-agent-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 0;
      padding: 1rem;
      transition: border-color 0.15s;
    }

    .active-agent-card:hover {
      border-color: oklch(0.588 0.158 241.966 / 0.3);
    }

    .active-agent-card-live {
      border-color: oklch(0.588 0.158 241.966 / 0.3);
      box-shadow: 0 0 12px rgba(59, 130, 246, 0.08);
    }

    .active-agent-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .active-agent-task {
      font-size: 0.75rem;
      color: var(--muted-foreground);
      background: oklch(0.588 0.158 241.966 / 0.06);
      border-left: 2px solid var(--accent);
      padding: 0.25rem 0.5rem;
      margin-bottom: 0.5rem;
      border-radius: 0 2px 2px 0;
    }

    /* Agent run feed (monospace) */
    .run-feed {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.6875rem;
      max-height: 140px;
      overflow-y: auto;
      border-top: 1px solid var(--border);
      padding-top: 0.375rem;
    }

    .run-feed-line {
      display: flex;
      gap: 0.5rem;
      padding: 0.125rem 0;
      align-items: baseline;
    }

    .run-feed-seq {
      color: var(--dim);
      min-width: 18px;
      flex-shrink: 0;
    }

    .run-feed-type {
      min-width: 70px;
      flex-shrink: 0;
      font-weight: 600;
    }

    .run-feed-data {
      color: var(--muted-foreground);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .feed-line-error { color: var(--error); }
    .feed-line-warn { color: var(--warning); }
    .feed-line-success { color: var(--success); }
    .feed-line-info { color: var(--info); }
    .feed-line-dim { color: var(--dim); }

    /* Utilization bar */
    .util-bar {
      height: 0.5rem;
      background: oklch(0.269 0 0);
      border-radius: 9999px;
      overflow: hidden;
    }

    .util-bar-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.3s, background 0.3s;
    }

    .util-bar-green { background: var(--success); }
    .util-bar-yellow { background: var(--warning); }
    .util-bar-red { background: var(--error); }

    /* Pulsing dot */
    .pulse-dot {
      position: relative;
      display: inline-flex;
      height: 0.625rem;
      width: 0.625rem;
    }

    .pulse-dot-ping {
      position: absolute;
      display: inline-flex;
      height: 100%;
      width: 100%;
      border-radius: 9999px;
      opacity: 0.75;
      animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
    }

    .pulse-dot-core {
      position: relative;
      display: inline-flex;
      border-radius: 9999px;
      height: 0.625rem;
      width: 0.625rem;
    }

    @keyframes ping {
      75%, 100% {
        transform: scale(2);
        opacity: 0;
      }
    }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 0.1rem 0.4rem;
      border-radius: 9999px;
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .badge-ok { background: oklch(0.696 0.17 162.48 / 0.12); color: var(--success); }
    .badge-down { background: oklch(0.637 0.237 25.331 / 0.12); color: var(--error); }
    .badge-zombie { background: oklch(0.637 0.237 25.331 / 0.12); color: var(--error); }
    .badge-stale { background: oklch(0.795 0.184 86.047 / 0.12); color: var(--warning); }
    .badge-unknown { background: oklch(0.708 0 0 / 0.12); color: var(--muted-foreground); }

    .badge-feature { background: oklch(0.588 0.158 241.966 / 0.12); color: var(--info); }
    .badge-fix { background: oklch(0.637 0.237 25.331 / 0.12); color: var(--error); }
    .badge-decision { background: oklch(0.588 0.158 241.966 / 0.12); color: var(--accent); }
    .badge-discovery { background: oklch(0.696 0.17 162.48 / 0.12); color: var(--success); }
    .badge-milestone { background: oklch(0.795 0.184 86.047 / 0.12); color: var(--warning); }

    .badge-peter { background: oklch(0.588 0.158 241.966 / 0.12); color: var(--info); }
    .badge-task { background: oklch(0.696 0.17 162.48 / 0.12); color: var(--success); }
    .badge-session { background: oklch(0.588 0.158 241.966 / 0.12); color: var(--accent); }
    .badge-system { background: oklch(0.708 0 0 / 0.12); color: var(--muted-foreground); }

    .badge-gated { background: oklch(0.795 0.184 86.047 / 0.12); color: var(--warning); }
    .badge-completed { background: oklch(0.696 0.17 162.48 / 0.12); color: var(--success); }
    .badge-error { background: oklch(0.637 0.237 25.331 / 0.12); color: var(--error); }
    .badge-approval { background: oklch(0.795 0.184 86.047 / 0.12); color: var(--warning); }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    th {
      text-align: left;
      padding: 0.625rem 0.75rem;
      color: var(--muted-foreground);
      font-weight: 600;
      border-bottom: 1px solid var(--border);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    td {
      padding: 0.625rem 0.75rem;
      border-bottom: 1px solid var(--border);
      color: var(--foreground);
    }

    tr:hover td { background: oklch(0.985 0 0 / 0.02); }

    /* Search input */
    .search-input {
      width: 100%;
      padding: 0.625rem 0.875rem;
      background: var(--background);
      border: 1px solid var(--border);
      border-radius: 0;
      color: var(--foreground);
      font-size: 0.875rem;
      outline: none;
      transition: border-color 0.15s;
    }

    .search-input:focus { border-color: var(--accent); }
    .search-input::placeholder { color: var(--dim); }

    /* Live dot */
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

    /* Event row */
    .event-row {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.8rem;
    }

    .event-time { color: var(--dim); white-space: nowrap; }

    .event-payload {
      color: var(--muted-foreground);
      max-width: 400px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Stat row */
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 0.375rem 0;
      font-size: 0.875rem;
      border-bottom: 1px solid var(--border);
    }

    .stat-row:last-child { border-bottom: none; }
    .stat-label { color: var(--muted-foreground); }
    .stat-value { color: var(--foreground); font-weight: 600; }

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
      background: var(--dim);
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
      background: oklch(0.588 0.158 241.966 / 0.12);
      color: var(--accent);
    }

    /* Runtime badges */
    .runtime-badge {
      font-size: 0.6rem;
      font-weight: 600;
      padding: 0.1rem 0.375rem;
      border-radius: 4px;
      background: oklch(0.588 0.158 241.966 / 0.12);
      color: var(--info);
      text-transform: lowercase;
    }

    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--dim);
    }

    .empty-state-icon { font-size: 2rem; margin-bottom: 0.75rem; }

    /* Buttons */
    .btn {
      padding: 0.5rem 1rem;
      border-radius: 0;
      font-size: 0.875rem;
      font-weight: 600;
      border: none;
      cursor: pointer;
      transition: all 0.15s;
    }

    .btn-primary {
      background: var(--accent);
      color: var(--background);
    }

    .btn-primary:hover { background: oklch(0.65 0.158 241.966); }

    .btn-secondary {
      background: var(--card);
      color: var(--foreground);
      border: 1px solid var(--border);
    }

    .btn-secondary:hover { background: var(--card-hover); }

    .btn-ghost {
      background: transparent;
      color: var(--muted-foreground);
      border: 1px solid transparent;
    }

    .btn-ghost:hover {
      background: oklch(0.985 0 0 / 0.04);
      color: var(--foreground);
    }

    .btn-ghost.active {
      background: oklch(0.588 0.158 241.966 / 0.08);
      color: var(--foreground);
      border-color: oklch(0.588 0.158 241.966 / 0.2);
    }

    /* Form */
    .form-group { margin-bottom: 0.75rem; }

    .form-label {
      display: block;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--muted-foreground);
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
      color: var(--dim);
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
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border);
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
      color: var(--foreground);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .journal-entry-time {
      font-size: 0.7rem;
      color: var(--dim);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .journal-entry-content {
      font-size: 0.75rem;
      color: var(--muted-foreground);
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
      border-bottom: 1px solid var(--border);
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
      color: var(--foreground);
      flex: 1;
    }

    .knowledge-words {
      font-size: 0.7rem;
      color: var(--dim);
      font-family: monospace;
    }

    /* Decision rows */
    .decision-row {
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border);
    }

    .decision-row:last-child { border-bottom: none; }

    .decision-title {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--accent);
    }

    .decision-meta {
      font-size: 0.65rem;
      color: var(--dim);
      margin-top: 0.125rem;
    }

    .decision-summary {
      font-size: 0.7rem;
      color: var(--muted-foreground);
      margin-top: 0.25rem;
      line-height: 1.4;
    }

    /* Memory search results */
    .memory-result {
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border);
    }

    .memory-result:last-child { border-bottom: none; }

    /* Health grid */
    .health-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 1rem;
    }

    .health-card {
      transition: border-color 0.15s;
    }

    .health-card:hover {
      border-color: oklch(0.588 0.158 241.966 / 0.2);
    }

    .health-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }

    .health-dot-ok {
      background: var(--success);
      box-shadow: 0 0 6px var(--success);
    }

    .health-dot-error {
      background: var(--error);
      box-shadow: 0 0 6px var(--error);
    }

    .health-dot-down {
      background: var(--dim);
    }

    /* Delta badges */
    .delta-up {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--success);
      background: oklch(0.696 0.17 162.48 / 0.1);
      padding: 0.1rem 0.375rem;
      border-radius: 4px;
    }

    .delta-down {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--error);
      background: oklch(0.637 0.237 25.331 / 0.1);
      padding: 0.1rem 0.375rem;
      border-radius: 4px;
    }

    .delta-neutral {
      display: inline-block;
      font-size: 0.75rem;
      color: var(--dim);
      padding: 0.1rem 0.375rem;
    }

    /* Eval chart */
    .eval-chart-container {
      width: 100%;
      overflow: hidden;
    }

    .eval-chart-container svg {
      width: 100%;
      height: auto;
    }

    .eval-point circle {
      transition: r 0.15s;
    }

    .eval-point:hover circle {
      r: 5;
    }

    .sparkline {
      display: inline-block;
      vertical-align: middle;
    }

    /* Mode badge */
    .mode-badge {
      display: inline-block;
      font-size: 0.65rem;
      font-weight: 700;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      letter-spacing: 0.08em;
      margin-top: 0.375rem;
    }

    .mode-portfolio {
      background: oklch(0.588 0.158 241.966 / 0.12);
      color: var(--accent);
    }

    .mode-gtm {
      background: oklch(0.696 0.17 162.48 / 0.12);
      color: var(--success);
    }

    .mode-service {
      background: oklch(0.588 0.158 241.966 / 0.12);
      color: var(--info);
    }

    .mode-standalone {
      background: oklch(0.708 0 0 / 0.12);
      color: var(--muted-foreground);
    }

    /* Scope graph */
    .scope-graph {
      padding: 1.5rem;
    }

    .scope-node {
      fill: var(--card);
      stroke: var(--border);
      stroke-width: 1.5;
      rx: 0;
    }

    .scope-node-self {
      stroke: var(--accent);
      stroke-width: 2;
    }

    .scope-line {
      stroke: var(--border);
      stroke-width: 1.5;
    }

    .scope-label {
      fill: var(--foreground);
      font-size: 12px;
      font-weight: 600;
      text-anchor: middle;
    }

    .scope-badge-produces {
      fill: oklch(0.696 0.17 162.48 / 0.15);
      stroke: var(--success);
    }

    .scope-badge-consumes {
      fill: oklch(0.588 0.158 241.966 / 0.15);
      stroke: var(--info);
    }

    .scope-badge-denied {
      fill: oklch(0.637 0.237 25.331 / 0.15);
      stroke: var(--error);
    }

    .scope-badge-text {
      font-size: 9px;
      font-weight: 600;
      text-anchor: middle;
    }

    /* Agent selector */
    .agent-select {
      padding: 0.5rem 0.75rem;
      background: var(--background);
      border: 1px solid var(--border);
      border-radius: 0;
      color: var(--foreground);
      font-size: 0.875rem;
      outline: none;
      cursor: pointer;
    }

    .agent-select:focus {
      border-color: var(--accent);
    }

    /* Cost bar (token split) */
    .cost-bar {
      display: flex;
      height: 8px;
      border-radius: 0;
      overflow: hidden;
      background: var(--border);
      min-width: 80px;
    }

    .cost-bar-prompt {
      background: var(--info);
      height: 100%;
      transition: width 0.3s;
    }

    .cost-bar-completion {
      background: var(--accent);
      height: 100%;
      transition: width 0.3s;
    }

    .cost-bar-empty {
      width: 100%;
      text-align: center;
      font-size: 0.6rem;
      color: var(--dim);
      line-height: 8px;
    }

    /* Success rate bar */
    .success-bar {
      position: relative;
      height: 8px;
      border-radius: 9999px;
      background: var(--border);
      overflow: hidden;
      min-width: 60px;
    }

    .success-bar-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.3s;
    }

    .success-bar-label {
      position: absolute;
      right: -30px;
      top: -3px;
      font-size: 0.65rem;
      color: var(--muted-foreground);
      font-weight: 600;
    }

    /* Utilization ring */
    .util-ring {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    /* Tab group */
    .tab-group {
      display: flex;
      gap: 0.25rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0;
    }

    .tab-btn {
      padding: 0.5rem 1rem;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--muted-foreground);
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      margin-bottom: -1px;
    }

    .tab-btn:hover {
      color: var(--foreground);
    }

    .tab-btn-active {
      color: var(--foreground);
      border-bottom-color: var(--accent);
    }

    /* Approve/reject buttons */
    .btn-approve {
      padding: 0.375rem 1rem;
      border-radius: 0;
      font-size: 0.8rem;
      font-weight: 700;
      border: none;
      cursor: pointer;
      background: var(--success);
      color: var(--background);
      transition: all 0.15s;
    }

    .btn-approve:hover {
      background: oklch(0.75 0.17 162.48);
    }

    .btn-reject {
      padding: 0.375rem 1rem;
      border-radius: 0;
      font-size: 0.8rem;
      font-weight: 700;
      border: none;
      cursor: pointer;
      background: var(--error);
      color: var(--background);
      transition: all 0.15s;
    }

    .btn-reject:hover {
      background: oklch(0.7 0.237 25.331);
    }

    /* Divide-y pattern for lists */
    .divide-y > * + * {
      border-top: 1px solid var(--border);
    }

    @media (max-width: 768px) {
      .sidebar { width: 60px; padding: 1rem 0; }
      .sidebar-brand h1 { display: none; }
      .sidebar-brand .port-badge { display: none; }
      .sidebar-brand .mode-badge { display: none; }
      .nav-item { padding: 0.625rem; text-align: center; font-size: 0; }
      .nav-item::before { font-size: 1rem; }
      .main-content { margin-left: 60px; padding: 1rem; }
      .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
      .health-grid { grid-template-columns: 1fr; }
    }
  `
}
