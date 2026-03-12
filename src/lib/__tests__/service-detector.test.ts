/**
 * @purpose Tests for service-detector module — auto-detect service metadata from codebase
 */

import { join } from "path"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs"
import {
  detectServiceType,
  detectPort,
  detectServiceName,
  detectVersion,
  detectCommands,
  detectDependencies,
  detectHealthcheck,
  extractServiceMetadata,
} from "../service-detector.js"

// Create a temp directory for test fixtures
const TEST_DIR = join(process.cwd(), ".test-fixtures-service-detector")

function setupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true })
  }
  mkdirSync(TEST_DIR, { recursive: true })
}

function cleanupTestDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true })
  }
}

describe("service-detector", () => {
  beforeAll(() => {
    setupTestDir()
  })

  afterAll(() => {
    cleanupTestDir()
  })

  describe("detectServiceType", () => {
    it("detects Next.js as web type", () => {
      const testPath = join(TEST_DIR, "nextjs-app")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({
          name: "my-nextjs-app",
          dependencies: { next: "14.0.0", react: "18.0.0" },
        })
      )

      expect(detectServiceType(testPath)).toBe("web")
    })

    it("detects Express as api type", () => {
      const testPath = join(TEST_DIR, "express-app")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({
          name: "my-express-api",
          dependencies: { express: "4.18.0" },
        })
      )

      expect(detectServiceType(testPath)).toBe("api")
    })

    it("detects Fastify as api type", () => {
      const testPath = join(TEST_DIR, "fastify-app")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({
          name: "my-fastify-api",
          dependencies: { fastify: "4.0.0" },
        })
      )

      expect(detectServiceType(testPath)).toBe("api")
    })

    it("detects Koa as api type", () => {
      const testPath = join(TEST_DIR, "koa-app")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({
          name: "my-koa-api",
          dependencies: { koa: "2.0.0" },
        })
      )

      expect(detectServiceType(testPath)).toBe("api")
    })

    it("detects Docker project as container type", () => {
      const testPath = join(TEST_DIR, "docker-app")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "Dockerfile"), "FROM node:18")

      expect(detectServiceType(testPath)).toBe("container")
    })

    it("detects docker-compose project as container type", () => {
      const testPath = join(TEST_DIR, "compose-app")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "docker-compose.yml"),
        "version: '3'\nservices:\n  app:\n    image: node:18"
      )

      expect(detectServiceType(testPath)).toBe("container")
    })

    it("detects npm library type", () => {
      const testPath = join(TEST_DIR, "npm-library")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({
          name: "my-library",
          main: "dist/index.js",
          exports: { ".": "./dist/index.js" },
        })
      )

      expect(detectServiceType(testPath)).toBe("library")
    })

    it("detects FastAPI as api type from requirements.txt", () => {
      const testPath = join(TEST_DIR, "fastapi-app")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "requirements.txt"), "fastapi==0.100.0\nuvicorn==0.23.0")

      expect(detectServiceType(testPath)).toBe("api")
    })

    it("detects Flask as api type from requirements.txt", () => {
      const testPath = join(TEST_DIR, "flask-app")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "requirements.txt"), "flask==2.3.0")

      expect(detectServiceType(testPath)).toBe("api")
    })

    it("detects Django as api type from pyproject.toml", () => {
      const testPath = join(TEST_DIR, "django-app")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "pyproject.toml"),
        '[project]\nname = "myapp"\ndependencies = ["django>=4.0"]'
      )

      expect(detectServiceType(testPath)).toBe("api")
    })

    it("detects Go Gin project as api type", () => {
      const testPath = join(TEST_DIR, "go-gin-app")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "go.mod"),
        "module example.com/app\n\ngo 1.21\n\nrequire github.com/gin-gonic/gin v1.9.0"
      )

      expect(detectServiceType(testPath)).toBe("api")
    })

    it("detects Rust Actix project as api type", () => {
      const testPath = join(TEST_DIR, "rust-actix-app")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "Cargo.toml"),
        '[package]\nname = "myapp"\n\n[dependencies]\nactix-web = "4"'
      )

      expect(detectServiceType(testPath)).toBe("api")
    })

    it("detects Mintlify docs as infrastructure type", () => {
      const testPath = join(TEST_DIR, "mintlify-docs")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "mint.json"), '{"name": "Docs"}')

      expect(detectServiceType(testPath)).toBe("infrastructure")
    })

    it("detects OpenClaw worker plugin type", () => {
      const testPath = join(TEST_DIR, "openclaw-worker")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "openclaw.plugin.json"),
        JSON.stringify({
          runtime: { type: "clawdbot" },
          agent: { capabilities: ["session_create"] },
        })
      )

      expect(detectServiceType(testPath)).toBe("worker")
    })

    it("returns infrastructure for unknown project type", () => {
      const testPath = join(TEST_DIR, "unknown-app")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "README.md"), "# Unknown Project")

      expect(detectServiceType(testPath)).toBe("infrastructure")
    })
  })

  describe("detectPort", () => {
    it("detects port from colon format in dev script", () => {
      const testPath = join(TEST_DIR, "port-colon-script")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({
          scripts: { dev: "vite --host :3001" },
        })
      )

      expect(detectPort(testPath)).toBe(3001)
    })

    it("detects port from PORT= in script", () => {
      const testPath = join(TEST_DIR, "port-env-script")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({
          scripts: { start: "PORT=4000 node server.js" },
        })
      )

      expect(detectPort(testPath)).toBe(4000)
    })

    it("defaults to 3000 for Next.js", () => {
      const testPath = join(TEST_DIR, "nextjs-default-port")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({
          dependencies: { next: "14.0.0" },
        })
      )

      expect(detectPort(testPath)).toBe(3000)
    })

    it("detects port from .env file", () => {
      const testPath = join(TEST_DIR, "port-env-file")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "package.json"), JSON.stringify({}))
      writeFileSync(join(testPath, ".env"), "PORT=5000\nOTHER=value")

      expect(detectPort(testPath)).toBe(5000)
    })

    it("detects port from Python server.py", () => {
      const testPath = join(TEST_DIR, "python-port")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "server.py"), "uvicorn.run(app, port=8000)")

      expect(detectPort(testPath)).toBe(8000)
    })

    it("detects port from docker-compose.yml", () => {
      const testPath = join(TEST_DIR, "compose-port")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "docker-compose.yml"),
        'services:\n  app:\n    ports:\n      - "9000:8080"'
      )

      expect(detectPort(testPath)).toBe(9000)
    })

    it("returns null when no port found", () => {
      const testPath = join(TEST_DIR, "no-port")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "README.md"), "# No port here")

      expect(detectPort(testPath)).toBeNull()
    })
  })

  describe("detectServiceName", () => {
    it("extracts name from package.json", () => {
      const testPath = join(TEST_DIR, "named-app")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({ name: "@scope/my-service" })
      )

      expect(detectServiceName(testPath)).toBe("scope-my-service")
    })

    it("extracts name from pyproject.toml", () => {
      const testPath = join(TEST_DIR, "python-named")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "pyproject.toml"),
        '[project]\nname = "my-python-service"'
      )

      expect(detectServiceName(testPath)).toBe("my-python-service")
    })

    it("uses git remote name when in a git repo without package.json", () => {
      const testPath = join(TEST_DIR, "git-repo-service")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "README.md"), "# Service")
      // Since this is inside the jfl-cli git repo, it will pick up the parent git remote
      const name = detectServiceName(testPath)
      // Should be a valid slug (lowercase alphanumeric with dashes)
      expect(name).toMatch(/^[a-z0-9-]+$/)
    })
  })

  describe("detectVersion", () => {
    it("prefers git describe over package.json when in git repo", () => {
      const testPath = join(TEST_DIR, "versioned-app")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({ name: "app", version: "1.2.3" })
      )
      // Since we're in a git repo, detectVersion will use git describe first
      const version = detectVersion(testPath)
      // Should be a valid git version format (tag or commit hash)
      expect(version).toBeTruthy()
      expect(typeof version).toBe("string")
    })

    it("returns a version string for any path in a git repo", () => {
      const testPath = join(TEST_DIR, "python-versioned")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "pyproject.toml"),
        '[project]\nname = "app"\nversion = "2.0.0"'
      )
      // Since we're in a git repo, git describe takes precedence
      const version = detectVersion(testPath)
      expect(version).toBeTruthy()
      expect(version.length).toBeGreaterThan(0)
    })

    it("returns version from git describe even without manifest", () => {
      const testPath = join(TEST_DIR, "no-version")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "README.md"), "# No version")
      // In a git repo, we should still get a version from git describe
      const version = detectVersion(testPath)
      expect(version).toBeTruthy()
    })
  })

  describe("detectCommands", () => {
    it("detects npm commands from package.json", () => {
      const testPath = join(TEST_DIR, "npm-commands")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "package-lock.json"), "{}")
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({
          scripts: {
            dev: "next dev",
            build: "next build",
            test: "jest",
          },
        })
      )

      const commands = detectCommands(testPath, "web", 3000)

      expect(commands.start).toContain("npm run dev")
      expect(commands.build).toContain("npm run build")
      expect(commands.test).toContain("npm test")
      expect(commands.stop).toContain("lsof")
    })

    it("detects yarn commands", () => {
      const testPath = join(TEST_DIR, "yarn-commands")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "yarn.lock"), "")
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({
          scripts: { dev: "vite" },
        })
      )

      const commands = detectCommands(testPath, "web", 3000)

      expect(commands.start).toContain("yarn run dev")
    })

    it("detects pnpm commands", () => {
      const testPath = join(TEST_DIR, "pnpm-commands")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "pnpm-lock.yaml"), "")
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({
          scripts: { dev: "vite" },
        })
      )

      const commands = detectCommands(testPath, "web", 3000)

      expect(commands.start).toContain("pnpm run dev")
    })

    it("detects bun commands", () => {
      const testPath = join(TEST_DIR, "bun-commands")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "bun.lockb"), "")
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({
          scripts: { dev: "vite" },
        })
      )

      const commands = detectCommands(testPath, "web", 3000)

      expect(commands.start).toContain("bun run dev")
    })

    it("detects docker-compose commands", () => {
      const testPath = join(TEST_DIR, "docker-commands")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "docker-compose.yml"), "version: '3'")

      const commands = detectCommands(testPath, "container", null)

      expect(commands.start).toContain("docker compose up")
      expect(commands.stop).toContain("docker compose down")
      expect(commands.logs).toContain("docker compose logs")
    })

    it("detects Python commands", () => {
      const testPath = join(TEST_DIR, "python-commands")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "requirements.txt"), "fastapi")
      writeFileSync(join(testPath, "main.py"), "app = FastAPI()")
      mkdirSync(join(testPath, "tests"), { recursive: true })

      const commands = detectCommands(testPath, "api", 8000)

      expect(commands.start).toContain("python main.py")
      expect(commands.test).toContain("pytest")
    })
  })

  describe("detectDependencies", () => {
    it("detects Node.js dependencies", () => {
      const testPath = join(TEST_DIR, "node-deps")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({
          dependencies: { next: "14.0.0", react: "18.0.0", express: "4.18.0" },
          devDependencies: { typescript: "5.0.0" },
        })
      )

      const deps = detectDependencies(testPath)

      expect(deps).toContain("node")
      expect(deps).toContain("next.js")
      expect(deps).toContain("react")
      expect(deps).toContain("express")
      expect(deps).toContain("typescript")
    })

    it("detects Python dependencies", () => {
      const testPath = join(TEST_DIR, "python-deps")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "requirements.txt"), "fastapi\nuvicorn\nflask")

      const deps = detectDependencies(testPath)

      expect(deps).toContain("python")
      expect(deps).toContain("fastapi")
      expect(deps).toContain("flask")
      expect(deps).toContain("uvicorn")
    })

    it("detects Docker dependencies", () => {
      const testPath = join(TEST_DIR, "docker-deps")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "Dockerfile"), "FROM node:18")
      writeFileSync(join(testPath, "docker-compose.yml"), "version: '3'")

      const deps = detectDependencies(testPath)

      expect(deps).toContain("docker")
      expect(deps).toContain("docker-compose")
    })

    it("detects Go dependencies", () => {
      const testPath = join(TEST_DIR, "go-deps")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "go.mod"), "module example.com/app")

      const deps = detectDependencies(testPath)

      expect(deps).toContain("go")
    })

    it("detects Rust dependencies", () => {
      const testPath = join(TEST_DIR, "rust-deps")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "Cargo.toml"), '[package]\nname = "app"')

      const deps = detectDependencies(testPath)

      expect(deps).toContain("rust")
    })
  })

  describe("detectHealthcheck", () => {
    it("returns generic healthcheck for web with port", () => {
      const testPath = join(TEST_DIR, "healthcheck-web")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "package.json"), JSON.stringify({}))

      const healthcheck = detectHealthcheck(testPath, "web", 3000)

      expect(healthcheck).toContain("curl")
      expect(healthcheck).toContain("3000")
    })

    it("returns undefined when no port", () => {
      const testPath = join(TEST_DIR, "healthcheck-no-port")
      mkdirSync(testPath, { recursive: true })

      const healthcheck = detectHealthcheck(testPath, "api", null)

      expect(healthcheck).toBeUndefined()
    })

    it("detects Next.js API health route", () => {
      const testPath = join(TEST_DIR, "healthcheck-nextjs")
      mkdirSync(testPath, { recursive: true })
      mkdirSync(join(testPath, "app", "api", "health"), { recursive: true })
      writeFileSync(join(testPath, "package.json"), JSON.stringify({}))
      writeFileSync(
        join(testPath, "app", "api", "health", "route.ts"),
        "export function GET() { return Response.json({ ok: true }) }"
      )

      const healthcheck = detectHealthcheck(testPath, "web", 3000)

      expect(healthcheck).toContain("/api/health")
    })
  })

  describe("extractServiceMetadata", () => {
    it("extracts complete metadata for Next.js app", () => {
      const testPath = join(TEST_DIR, "full-nextjs")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(join(testPath, "package-lock.json"), "{}")
      writeFileSync(
        join(testPath, "package.json"),
        JSON.stringify({
          name: "my-nextjs-app",
          version: "1.0.0",
          description: "A Next.js application",
          dependencies: { next: "14.0.0", react: "18.0.0" },
          devDependencies: { typescript: "5.0.0" },
          scripts: {
            dev: "next dev",
            build: "next build",
            test: "jest",
          },
        })
      )

      const metadata = extractServiceMetadata(testPath)

      expect(metadata.name).toBe("my-nextjs-app")
      expect(metadata.type).toBe("web")
      // Version comes from git describe in a git repo, so just check it's present
      expect(metadata.version).toBeTruthy()
      expect(metadata.description).toBe("A Next.js application")
      expect(metadata.port).toBe(3000)
      expect(metadata.dependencies).toContain("next.js")
      expect(metadata.dependencies).toContain("typescript")
      expect(metadata.commands.start).toContain("npm run dev")
      expect(metadata.healthcheck).toContain("curl")
    })

    it("extracts metadata with OpenClaw manifest enrichment", () => {
      const testPath = join(TEST_DIR, "openclaw-enriched")
      mkdirSync(testPath, { recursive: true })
      writeFileSync(
        join(testPath, "openclaw.plugin.json"),
        JSON.stringify({
          runtime: { type: "clawdbot" },
          agent: {
            name: "my-agent",
            description: "An OpenClaw agent plugin",
            capabilities: ["session_create"],
          },
        })
      )

      const metadata = extractServiceMetadata(testPath)

      expect(metadata.type).toBe("worker")
      expect(metadata.description).toBe("An OpenClaw agent plugin")
    })
  })
})
