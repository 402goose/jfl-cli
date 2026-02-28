/**
 * Context Hub Web Dashboard
 *
 * Serves a Preact+HTM SPA from the existing Context Hub HTTP server.
 * Zero build step — ships as template strings compiled by normal tsc.
 *
 * @purpose HTML generator + route handler for Context Hub web dashboard
 */

import * as http from "http"
import { getDashboardStyles } from "./styles.js"
import { getComponentsJS } from "./components.js"
import { getPagesJS } from "./pages.js"

export function generateDashboardHTML(projectName: string, port: number): string {
  const styles = getDashboardStyles()
  const components = getComponentsJS()
  const pages = getPagesJS()

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(projectName)} - Context Hub</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script type="importmap">
  {
    "imports": {
      "preact": "https://esm.sh/preact@10.24.3",
      "preact/hooks": "https://esm.sh/preact@10.24.3/hooks",
      "htm": "https://esm.sh/htm@3.1.1"
    }
  }
  </script>
  <style>${styles}</style>
</head>
<body>
  <div id="app"></div>
  <script type="module">
    import { h, render } from 'preact'
    import { useState, useEffect, useRef } from 'preact/hooks'
    import htm from 'htm'

    const html = htm.bind(h)

    // Auth: read token from URL, store in localStorage, strip from URL
    const urlParams = new URLSearchParams(window.location.search)
    const urlToken = urlParams.get('token')
    if (urlToken) {
      localStorage.setItem('jfl-token', urlToken)
      const clean = new URL(window.location)
      clean.searchParams.delete('token')
      window.history.replaceState({}, '', clean.toString())
    }

    function getToken() {
      return localStorage.getItem('jfl-token') || ''
    }

    async function apiFetch(path, opts = {}) {
      const token = getToken()
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
        ...(opts.headers || {})
      }
      const res = await fetch(path, { ...opts, headers })
      if (res.status === 401) {
        document.getElementById('app').innerHTML = '<div style="padding: 3rem; text-align: center; color: var(--error);"><h2>Unauthorized</h2><p style="color: var(--text-soft); margin-top: 0.5rem;">Token expired or invalid. Run: jfl context-hub dashboard</p></div>'
        throw new Error('Unauthorized')
      }
      return res.json()
    }

    // Components
    ${components}

    // Pages
    ${pages}

    // App
    function App() {
      const [page, setPage] = useState('overview')

      const pageComponent = {
        overview: OverviewPage,
        journal: JournalPage,
        agents: AgentsPage,
        events: EventsPage,
        sessions: SessionsPage,
        projects: ProjectsPage,
      }[page] || OverviewPage

      return html\`
        <\${Nav}
          currentPage=\${page}
          setPage=\${setPage}
          projectName="${escapeHtml(projectName)}"
          port=\${${port}}
        />
        <div class="main-content">
          <\${pageComponent} />
        </div>
      \`
    }

    render(html\`<\${App} />\`, document.getElementById('app'))
  </script>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function handleDashboardRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projectRoot: string,
  port: number
): boolean {
  const url = new URL(req.url || "/", `http://localhost:${port}`)

  if (!url.pathname.startsWith("/dashboard")) {
    return false
  }

  // Derive project name from directory
  const projectName = projectRoot.split("/").pop() || "Context Hub"

  const html = generateDashboardHTML(projectName, port)
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
  })
  res.end(html)
  return true
}
