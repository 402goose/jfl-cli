/**
 * Service Detector
 *
 * Analyzes a codebase to auto-detect service metadata:
 * - Service type (web, api, container, worker, infrastructure)
 * - Name, port, version
 * - Start/stop/logs commands
 * - Dependencies
 *
 * @purpose Auto-detect service metadata from codebase
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"

export interface ServiceMetadata {
  name: string
  type: "web" | "api" | "container" | "worker" | "cli" | "infrastructure" | "library"
  description: string
  port: number | null
  version: string
  commands: {
    start?: string
    stop?: string
    logs?: string
    build?: string
    test?: string
  }
  dependencies: string[]
  healthcheck?: string
  url?: string
}

/**
 * Detect service type from codebase structure
 */
export function detectServiceType(path: string): ServiceMetadata["type"] {
  // Check for OpenClaw plugin - parse manifest for enriched type detection
  if (existsSync(join(path, "openclaw.plugin.json"))) {
    try {
      const manifest = JSON.parse(readFileSync(join(path, "openclaw.plugin.json"), "utf-8"))
      const runtimeType = manifest.runtime?.type
      // Map runtime types to service types
      if (runtimeType === "clawdbot") return "worker"
      if (runtimeType === "claude-code" || runtimeType === "cursor") return "cli"
      // Default: infer from capabilities
      const caps: string[] = manifest.agent?.capabilities || []
      if (caps.includes("session_create")) return "worker"
    } catch {
      // Malformed manifest, fall through
    }
    return "library"
  }

  // Check for Docker
  if (existsSync(join(path, "Dockerfile")) || existsSync(join(path, "docker-compose.yml"))) {
    return "container"
  }

  // Check for Mintlify docs project
  const docsJson = join(path, "docs.json")
  const mintJson = join(path, "mint.json")

  if (existsSync(docsJson)) {
    const content = readFileSync(docsJson, "utf-8")
    if (content.includes("mintlify")) {
      return "infrastructure" // docs aren't operational services
    }
  } else if (existsSync(mintJson)) {
    return "infrastructure"
  }

  // Check for package.json (Node.js)
  if (existsSync(join(path, "package.json"))) {
    const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf-8"))

    // Next.js = web
    if (pkg.dependencies?.["next"] || pkg.devDependencies?.["next"]) {
      return "web"
    }

    // Express/Fastify/Koa = api
    if (
      pkg.dependencies?.["express"] ||
      pkg.dependencies?.["fastify"] ||
      pkg.dependencies?.["koa"]
    ) {
      return "api"
    }

    // Detect npm library (has exports/main but no start script)
    if ((pkg.exports || pkg.main) && !pkg.scripts?.start && !pkg.scripts?.dev) {
      return "library"
    }

    // Generic Node.js app
    return "cli"
  }

  // Check for Python API frameworks
  if (
    existsSync(join(path, "requirements.txt")) ||
    existsSync(join(path, "pyproject.toml")) ||
    existsSync(join(path, "setup.py"))
  ) {
    const reqFiles = [
      join(path, "requirements.txt"),
      join(path, "pyproject.toml"),
      join(path, "Pipfile"),
    ]

    for (const file of reqFiles) {
      if (existsSync(file)) {
        const content = readFileSync(file, "utf-8").toLowerCase()

        // FastAPI/Flask/Django = api
        if (content.includes("fastapi") || content.includes("flask") || content.includes("django")) {
          return "api"
        }
      }
    }

    return "cli"
  }

  // Check for Go
  if (existsSync(join(path, "go.mod"))) {
    const goMod = readFileSync(join(path, "go.mod"), "utf-8").toLowerCase()

    if (goMod.includes("gin-gonic") || goMod.includes("echo") || goMod.includes("fiber")) {
      return "api"
    }

    return "cli"
  }

  // Check for Rust
  if (existsSync(join(path, "Cargo.toml"))) {
    const cargo = readFileSync(join(path, "Cargo.toml"), "utf-8").toLowerCase()

    if (cargo.includes("actix") || cargo.includes("rocket") || cargo.includes("axum")) {
      return "api"
    }

    return "cli"
  }

  // Default to infrastructure
  return "infrastructure"
}

/**
 * Extract port from package.json scripts or common config files
 */
export function detectPort(path: string): number | null {
  // Check package.json scripts
  if (existsSync(join(path, "package.json"))) {
    const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf-8"))

    // Look for port in dev/start scripts
    const scripts = [pkg.scripts?.dev, pkg.scripts?.start, pkg.scripts?.serve]

    for (const script of scripts) {
      if (!script) continue

      // Match PORT=3000, --port 3000, -p 3000, :3000
      const portMatch = script.match(/(?:PORT=|--port|:|\-p\s+)(\d{4,5})/)
      if (portMatch) {
        return parseInt(portMatch[1], 10)
      }
    }

    // Check for Next.js default (3000)
    if (pkg.dependencies?.["next"]) {
      return 3000
    }
  }

  // Check for .env files
  const envFiles = [".env", ".env.local", ".env.development"]
  for (const envFile of envFiles) {
    const envPath = join(path, envFile)
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8")
      const portMatch = content.match(/PORT=(\d{4,5})/)
      if (portMatch) {
        return parseInt(portMatch[1], 10)
      }
    }
  }

  // Check Python files for common patterns
  const pythonFiles = ["server.py", "main.py", "app.py", "api.py"]
  for (const pyFile of pythonFiles) {
    const pyPath = join(path, pyFile)
    if (existsSync(pyPath)) {
      const content = readFileSync(pyPath, "utf-8")

      // Match uvicorn.run(app, port=8000) or similar
      const portMatch = content.match(/port\s*[=:]\s*(\d{4,5})/)
      if (portMatch) {
        return parseInt(portMatch[1], 10)
      }
    }
  }

  // Check docker-compose.yml
  if (existsSync(join(path, "docker-compose.yml"))) {
    const compose = readFileSync(join(path, "docker-compose.yml"), "utf-8")
    const portMatch = compose.match(/- ["']?(\d{4,5}):\d{4,5}["']?/)
    if (portMatch) {
      return parseInt(portMatch[1], 10)
    }
  }

  return null
}

/**
 * Get service name from package.json, git remote, or directory name
 */
export function detectServiceName(path: string): string {
  // Try package.json name
  if (existsSync(join(path, "package.json"))) {
    const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf-8"))
    if (pkg.name) {
      return slugify(pkg.name)
    }
  }

  // Try Python project name
  if (existsSync(join(path, "pyproject.toml"))) {
    const content = readFileSync(join(path, "pyproject.toml"), "utf-8")
    const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/)
    if (nameMatch) {
      return slugify(nameMatch[1])
    }
  }

  // Try git remote
  try {
    const remote = execSync("git config --get remote.origin.url", {
      cwd: path,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim()

    // Extract repo name from URL
    const match = remote.match(/\/([^\/]+?)(\.git)?$/)
    if (match) {
      return slugify(match[1])
    }
  } catch {
    // No git remote
  }

  // Fall back to directory name
  const dirName = path.split("/").pop() || "service"
  return slugify(dirName)
}

/**
 * Get version from git, package.json, or pyproject.toml
 */
export function detectVersion(path: string): string {
  // Try git describe
  try {
    const version = execSync("git describe --tags --always", {
      cwd: path,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim()
    return version
  } catch {
    // No git tags
  }

  // Try package.json
  if (existsSync(join(path, "package.json"))) {
    const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf-8"))
    if (pkg.version) {
      return pkg.version
    }
  }

  // Try pyproject.toml
  if (existsSync(join(path, "pyproject.toml"))) {
    const content = readFileSync(join(path, "pyproject.toml"), "utf-8")
    const versionMatch = content.match(/version\s*=\s*["']([^"']+)["']/)
    if (versionMatch) {
      return versionMatch[1]
    }
  }

  return "unknown"
}

/**
 * Detect package manager from lockfiles
 */
function detectPackageManager(path: string): "npm" | "yarn" | "pnpm" | "bun" | null {
  if (existsSync(join(path, "bun.lockb"))) return "bun"
  if (existsSync(join(path, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(path, "yarn.lock"))) return "yarn"
  if (existsSync(join(path, "package-lock.json"))) return "npm"
  return null
}

/**
 * Scan README for start commands
 * Returns detected command or null
 */
function scanReadmeForCommand(path: string): string | null {
  // Find README file (case-insensitive)
  const readmeFiles = ["README.md", "README.MD", "readme.md", "README", "readme"]
  let readme = null

  for (const file of readmeFiles) {
    const readmePath = join(path, file)
    if (existsSync(readmePath)) {
      readme = readFileSync(readmePath, "utf-8")
      break
    }
  }

  if (!readme) return null

  // Pattern 1: Code blocks with commands
  // Match: ```bash\nnpm run dev\n```
  const codeBlockPattern = /```(?:bash|sh|shell)?\s*\n\s*((?:npm|yarn|pnpm|bun|make|docker|mint|python|go)\s+[^\n]+)/gi
  const codeBlockMatch = codeBlockPattern.exec(readme)
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim()
  }

  // Pattern 2: Command after $ or >
  // Match: $ npm run dev
  const dollarPattern = /[\$>]\s*((?:npm|yarn|pnpm|bun|make|docker|mint|python|go)\s+[^\n]+)/i
  const dollarMatch = dollarPattern.exec(readme)
  if (dollarMatch) {
    return dollarMatch[1].trim()
  }

  // Pattern 3: "Run: <command>" or "Start: <command>"
  const runPattern = /(?:run|start|development):\s*((?:npm|yarn|pnpm|bun|make|docker|mint|python|go)\s+[^\n]+)/i
  const runMatch = runPattern.exec(readme)
  if (runMatch) {
    return runMatch[1].trim()
  }

  return null
}

/**
 * Generate commands for service management
 */
export function detectCommands(
  path: string,
  type: ServiceMetadata["type"],
  port: number | null
): ServiceMetadata["commands"] {
  const commands: ServiceMetadata["commands"] = {}

  // Node.js projects
  if (existsSync(join(path, "package.json"))) {
    const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf-8"))
    const pkgManager = detectPackageManager(path) || "npm"

    if (pkg.scripts?.dev) {
      commands.start = `cd ${path} && ${pkgManager} run dev`
    } else if (pkg.scripts?.start) {
      commands.start = `cd ${path} && ${pkgManager} start`
    }

    if (pkg.scripts?.build) {
      commands.build = `cd ${path} && ${pkgManager} run build`
    }

    if (pkg.scripts?.test) {
      commands.test = `cd ${path} && ${pkgManager} test`
    }

    if (port) {
      commands.stop = `lsof -ti :${port} | xargs kill -9 2>/dev/null || true`
      commands.logs = `echo 'Check terminal where ${pkgManager} run dev is running'`
    }
  }

  // Python projects
  if (existsSync(join(path, "requirements.txt")) || existsSync(join(path, "pyproject.toml"))) {
    // Check for common entry points
    const entryPoints = ["server.py", "main.py", "app.py", "api/server.py"]

    for (const entry of entryPoints) {
      if (existsSync(join(path, entry))) {
        const dir = entry.includes("/") ? entry.split("/")[0] : "."
        const file = entry.includes("/") ? entry.split("/")[1] : entry

        if (dir === ".") {
          commands.start = `cd ${path} && python ${file}`
        } else {
          commands.start = `cd ${path}/${dir} && python ${file}`
        }
        break
      }
    }

    if (port) {
      commands.stop = `lsof -ti :${port} | xargs kill -9 2>/dev/null || true`
      commands.logs = `tail -f ${path}/*.log`
    }

    // Check for pytest
    if (existsSync(join(path, "tests")) || existsSync(join(path, "test"))) {
      commands.test = `cd ${path} && pytest`
    }
  }

  // Docker projects
  if (existsSync(join(path, "docker-compose.yml"))) {
    commands.start = `cd ${path} && docker compose up -d`
    commands.stop = `cd ${path} && docker compose down`
    commands.logs = `cd ${path} && docker compose logs -f`
  } else if (existsSync(join(path, "Dockerfile"))) {
    const serviceName = detectServiceName(path)
    commands.start = `cd ${path} && docker build -t ${serviceName} . && docker run -d --name ${serviceName} ${serviceName}`
    commands.stop = `docker stop ${serviceName} && docker rm ${serviceName}`
    commands.logs = `docker logs -f ${serviceName}`
  }

  // Fallback: Try README scanning if no start command detected
  if (!commands.start) {
    const readmeCommand = scanReadmeForCommand(path)
    if (readmeCommand) {
      commands.start = `cd ${path} && ${readmeCommand}`
    }
  }

  return commands
}

/**
 * Detect dependencies (languages, frameworks, tools)
 */
export function detectDependencies(path: string): string[] {
  const deps: string[] = []

  // Node.js
  if (existsSync(join(path, "package.json"))) {
    const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf-8"))
    deps.push("node")

    if (pkg.dependencies?.["next"]) deps.push("next.js")
    if (pkg.dependencies?.["react"]) deps.push("react")
    if (pkg.dependencies?.["express"]) deps.push("express")
    if (pkg.dependencies?.["fastify"]) deps.push("fastify")
    if (pkg.devDependencies?.["typescript"] || pkg.dependencies?.["typescript"]) {
      deps.push("typescript")
    }
  }

  // Python
  if (existsSync(join(path, "requirements.txt")) || existsSync(join(path, "pyproject.toml"))) {
    deps.push("python")

    const files = [
      join(path, "requirements.txt"),
      join(path, "pyproject.toml"),
    ]

    for (const file of files) {
      if (existsSync(file)) {
        const content = readFileSync(file, "utf-8").toLowerCase()
        if (content.includes("fastapi")) deps.push("fastapi")
        if (content.includes("flask")) deps.push("flask")
        if (content.includes("django")) deps.push("django")
        if (content.includes("uvicorn")) deps.push("uvicorn")
      }
    }
  }

  // Docker
  if (existsSync(join(path, "Dockerfile"))) deps.push("docker")
  if (existsSync(join(path, "docker-compose.yml"))) deps.push("docker-compose")

  // Go
  if (existsSync(join(path, "go.mod"))) deps.push("go")

  // Rust
  if (existsSync(join(path, "Cargo.toml"))) deps.push("rust")

  return deps
}

/**
 * Generate healthcheck command
 */
export function detectHealthcheck(
  path: string,
  type: ServiceMetadata["type"],
  port: number | null
): string | undefined {
  if (!port) return undefined

  // Check for explicit health endpoint in code
  if (type === "web" || type === "api") {
    // Node.js
    if (existsSync(join(path, "package.json"))) {
      // Check for Next.js API route
      const healthPaths = [
        "pages/api/health.ts",
        "pages/api/health.js",
        "app/api/health/route.ts",
        "app/api/health/route.js",
      ]

      for (const healthPath of healthPaths) {
        if (existsSync(join(path, healthPath))) {
          return `curl -sf http://localhost:${port}/api/health > /dev/null`
        }
      }
    }

    // Python
    const pythonFiles = ["server.py", "main.py", "app.py", "api.py"]
    for (const pyFile of pythonFiles) {
      const pyPath = join(path, pyFile)
      if (existsSync(pyPath)) {
        const content = readFileSync(pyPath, "utf-8")
        if (content.includes("/health") || content.includes("health_check")) {
          return `curl -sf http://localhost:${port}/health > /dev/null`
        }
      }
    }

    // Generic check - just see if port responds
    return `curl -sf http://localhost:${port}/ > /dev/null`
  }

  return undefined
}

/**
 * Extract full service metadata from codebase
 */
export function extractServiceMetadata(path: string): ServiceMetadata {
  const name = detectServiceName(path)
  const type = detectServiceType(path)
  const port = detectPort(path)
  const version = detectVersion(path)
  const commands = detectCommands(path, type, port)
  const dependencies = detectDependencies(path)
  const healthcheck = detectHealthcheck(path, type, port)

  // Generate description
  let description = `${type.charAt(0).toUpperCase() + type.slice(1)} service`

  // Enrich from OpenClaw manifest if present
  const openclawManifest = join(path, "openclaw.plugin.json")
  if (existsSync(openclawManifest)) {
    try {
      const manifest = JSON.parse(readFileSync(openclawManifest, "utf-8"))
      if (manifest.agent?.description) {
        description = manifest.agent.description
      }
      if (manifest.agent?.name && !name) {
        // Use agent name as fallback service name
      }
    } catch {
      // Malformed manifest
    }
  }

  if (existsSync(join(path, "package.json"))) {
    const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf-8"))
    if (pkg.description) {
      description = pkg.description
    }
  }

  return {
    name,
    type,
    description,
    port,
    version,
    commands,
    dependencies,
    healthcheck,
  }
}

/**
 * Slugify a string for use as service ID
 */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[@\/]/g, "-") // Replace @ and / with -
    .replace(/[^a-z0-9-]/g, "") // Remove non-alphanumeric except -
    .replace(/^-+|-+$/g, "") // Trim leading/trailing -
    .replace(/-+/g, "-") // Collapse multiple -
}
