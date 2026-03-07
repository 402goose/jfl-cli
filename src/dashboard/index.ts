/**
 * Context Hub Web Dashboard
 *
 * Serves pre-built Vite+Preact SPA from dist/dashboard-static/.
 * Static files built at publish time, served by Context Hub at runtime.
 *
 * @purpose Static file server + SPA fallback for Context Hub web dashboard
 */

import * as http from "http"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

function getStaticDir(): string {
  return path.resolve(__dirname, "../dashboard-static")
}

export function handleDashboardRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  _projectRoot: string,
  port: number
): boolean {
  const url = new URL(req.url || "/", `http://localhost:${port}`)

  if (!url.pathname.startsWith("/dashboard")) {
    return false
  }

  const staticDir = getStaticDir()

  if (!fs.existsSync(staticDir)) {
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Dashboard not built. Run: cd dashboard && npm run build" }))
    return true
  }

  const relativePath = url.pathname.replace(/^\/dashboard\/?/, "") || "index.html"
  const filePath = path.join(staticDir, relativePath)
  const normalizedPath = path.normalize(filePath)
  if (!normalizedPath.startsWith(staticDir)) {
    res.writeHead(403, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Forbidden" }))
    return true
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath)
    const contentType = MIME_TYPES[ext] || "application/octet-stream"
    const isAsset = relativePath.startsWith("assets/")

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
    })
    fs.createReadStream(filePath).pipe(res)
    return true
  }

  const indexPath = path.join(staticDir, "index.html")
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    })
    fs.createReadStream(indexPath).pipe(res)
    return true
  }

  res.writeHead(404, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ error: "Dashboard index.html not found" }))
  return true
}
