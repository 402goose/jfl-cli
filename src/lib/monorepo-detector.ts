/**
 * Monorepo Detector
 *
 * Detects TS/JS monorepo structures (Turborepo, Nx, pnpm/yarn/npm workspaces,
 * Lerna), resolves workspace packages, classifies them as app/package/config/tool,
 * and builds a dependency graph.
 *
 * @purpose Detect monorepo structure, resolve packages, build dependency graph
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import { join, basename, relative } from "path"
import { execSync } from "child_process"
import { extractServiceMetadata, type ServiceMetadata } from "./service-detector.js"

export type MonorepoTool = "turborepo" | "nx" | "pnpm-workspaces" | "yarn-workspaces" | "npm-workspaces" | "lerna"
export type PackageManager = "npm" | "yarn" | "pnpm" | "bun"
export type PackageRole = "app" | "package" | "config" | "tool"

export interface MonorepoPackage {
  name: string
  path: string
  relativePath: string
  metadata: ServiceMetadata
  role: PackageRole
  isDeployable: boolean
  internalDeps: string[]
  consumers: string[]
}

export interface MonorepoInfo {
  type: MonorepoTool
  root: string
  rootName: string
  workspaceGlobs: string[]
  packages: MonorepoPackage[]
  manager: PackageManager
  apps: MonorepoPackage[]
  libs: MonorepoPackage[]
  depGraph: DependencyEdge[]
  impactMatrix: Record<string, string[]>
  commands: MonorepoCommands
}

export interface DependencyEdge {
  from: string
  to: string
}

export interface MonorepoCommands {
  buildAll: string
  testAll: string
  filterRun: (pkg: string, script: string) => string
  affected: string | null
}

function readJson(filePath: string): any {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

function readYaml(filePath: string): any {
  if (!existsSync(filePath)) return null
  try {
    const content = readFileSync(filePath, "utf-8")
    const packages: string[] = []
    let inPackages = false
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (trimmed === "packages:") {
        inPackages = true
        continue
      }
      if (inPackages) {
        if (trimmed.startsWith("- ")) {
          packages.push(trimmed.slice(2).replace(/['"]/g, ""))
        } else if (!trimmed.startsWith("#") && trimmed !== "") {
          break
        }
      }
    }
    return { packages }
  } catch {
    return null
  }
}

export function detectMonorepoTool(root: string): { tool: MonorepoTool; globs: string[] } | null {
  if (existsSync(join(root, "turbo.json"))) {
    const pkg = readJson(join(root, "package.json"))
    const globs = resolveWorkspaceGlobs(root, pkg)
    if (globs.length > 0) return { tool: "turborepo", globs }
  }

  if (existsSync(join(root, "nx.json"))) {
    const pkg = readJson(join(root, "package.json"))
    const globs = resolveWorkspaceGlobs(root, pkg)
    if (globs.length > 0) return { tool: "nx", globs }
  }

  if (existsSync(join(root, "pnpm-workspace.yaml"))) {
    const yaml = readYaml(join(root, "pnpm-workspace.yaml"))
    if (yaml?.packages?.length > 0) return { tool: "pnpm-workspaces", globs: yaml.packages }
  }

  if (existsSync(join(root, "lerna.json"))) {
    const lerna = readJson(join(root, "lerna.json"))
    const globs = lerna?.packages || ["packages/*"]
    return { tool: "lerna", globs }
  }

  const pkg = readJson(join(root, "package.json"))
  if (pkg?.workspaces) {
    const globs = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages || []
    if (globs.length > 0) {
      if (existsSync(join(root, "yarn.lock"))) return { tool: "yarn-workspaces", globs }
      return { tool: "npm-workspaces", globs }
    }
  }

  return null
}

function resolveWorkspaceGlobs(root: string, pkg: any): string[] {
  if (!pkg) return []
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces
  if (pkg.workspaces?.packages) return pkg.workspaces.packages
  return []
}

function expandGlobs(root: string, globs: string[]): string[] {
  const dirs: string[] = []

  for (const glob of globs) {
    if (glob.endsWith("/*") || glob.endsWith("/**")) {
      const parent = join(root, glob.replace(/\/\*+$/, ""))
      if (!existsSync(parent)) continue
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const pkgJson = join(parent, entry.name, "package.json")
        if (existsSync(pkgJson)) {
          dirs.push(join(parent, entry.name))
        }
      }
    } else {
      const dir = join(root, glob)
      if (existsSync(join(dir, "package.json"))) {
        dirs.push(dir)
      }
    }
  }

  return dirs
}

export function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return "bun"
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(root, "yarn.lock"))) return "yarn"
  return "npm"
}

function classifyPackage(pkgPath: string, pkg: any, metadata: ServiceMetadata): PackageRole {
  const name = (pkg.name || "").toLowerCase()

  if (name.includes("config") || name.includes("eslint") || name.includes("tsconfig") || name.includes("prettier")) {
    return "config"
  }

  if (pkg.bin || name.includes("cli") || name.includes("tool") || name.includes("script")) {
    return "tool"
  }

  if (metadata.type === "web" || metadata.type === "api" || metadata.type === "worker" || metadata.type === "container") {
    return "app"
  }

  if (pkg.scripts?.start || pkg.scripts?.dev || pkg.scripts?.serve) {
    if (metadata.port) return "app"
  }

  return "package"
}

function isDeployable(role: PackageRole, pkg: any): boolean {
  if (role === "app") return true
  if (pkg.scripts?.start || pkg.scripts?.dev) return true
  return false
}

function resolveInternalDeps(
  pkg: any,
  allPackageNames: Set<string>
): string[] {
  const deps: string[] = []
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  }

  for (const depName of Object.keys(allDeps || {})) {
    if (allPackageNames.has(depName)) {
      deps.push(depName)
    }
  }

  return deps
}

function buildImpactMatrix(packages: MonorepoPackage[]): Record<string, string[]> {
  const matrix: Record<string, string[]> = {}

  for (const pkg of packages) {
    matrix[pkg.name] = []
  }

  for (const pkg of packages) {
    for (const dep of pkg.internalDeps) {
      if (!matrix[dep]) matrix[dep] = []
      if (!matrix[dep].includes(pkg.name)) {
        matrix[dep].push(pkg.name)
      }
    }
  }

  return matrix
}

function buildTransitiveImpact(
  matrix: Record<string, string[]>,
  pkg: string,
  visited = new Set<string>()
): string[] {
  if (visited.has(pkg)) return []
  visited.add(pkg)

  const direct = matrix[pkg] || []
  const all = [...direct]

  for (const dep of direct) {
    const transitive = buildTransitiveImpact(matrix, dep, visited)
    for (const t of transitive) {
      if (!all.includes(t)) all.push(t)
    }
  }

  return all
}

function buildMonorepoCommands(tool: MonorepoTool, manager: PackageManager): MonorepoCommands {
  const run = manager === "yarn" ? "yarn" : manager === "bun" ? "bun" : `${manager} run`

  switch (tool) {
    case "turborepo":
      return {
        buildAll: `${run} build`,
        testAll: `${run} test`,
        filterRun: (pkg, script) => manager === "pnpm"
          ? `pnpm --filter ${pkg} ${script}`
          : `npx turbo run ${script} --filter=${pkg}`,
        affected: "npx turbo run build --filter=...[HEAD^1]",
      }
    case "nx":
      return {
        buildAll: "npx nx run-many --target=build",
        testAll: "npx nx run-many --target=test",
        filterRun: (pkg, script) => `npx nx run ${pkg}:${script}`,
        affected: "npx nx affected --target=build",
      }
    case "pnpm-workspaces":
      return {
        buildAll: "pnpm -r run build",
        testAll: "pnpm -r run test",
        filterRun: (pkg, script) => `pnpm --filter ${pkg} run ${script}`,
        affected: null,
      }
    case "yarn-workspaces":
      return {
        buildAll: "yarn workspaces run build",
        testAll: "yarn workspaces run test",
        filterRun: (pkg, script) => `yarn workspace ${pkg} run ${script}`,
        affected: null,
      }
    default:
      return {
        buildAll: `${run} build`,
        testAll: `${run} test`,
        filterRun: (pkg, script) => `cd ${pkg} && ${run} ${script}`,
        affected: null,
      }
  }
}

export function detectMonorepo(root: string): MonorepoInfo | null {
  const detection = detectMonorepoTool(root)
  if (!detection) return null

  const { tool, globs } = detection
  const manager = detectPackageManager(root)
  const rootPkg = readJson(join(root, "package.json")) || {}
  const rootName = rootPkg.name ? slugify(rootPkg.name) : basename(root)

  const packageDirs = expandGlobs(root, globs)
  if (packageDirs.length === 0) return null

  const allPackageNames = new Set<string>()
  const packageMap = new Map<string, { dir: string; pkg: any }>()

  for (const dir of packageDirs) {
    const pkg = readJson(join(dir, "package.json"))
    if (!pkg?.name) continue
    allPackageNames.add(pkg.name)
    packageMap.set(pkg.name, { dir, pkg })
  }

  const packages: MonorepoPackage[] = []

  for (const [name, { dir, pkg }] of packageMap) {
    const metadata = extractServiceMetadata(dir)
    const role = classifyPackage(dir, pkg, metadata)
    const internalDeps = resolveInternalDeps(pkg, allPackageNames)

    packages.push({
      name,
      path: dir,
      relativePath: relative(root, dir),
      metadata,
      role,
      isDeployable: isDeployable(role, pkg),
      internalDeps,
      consumers: [],
    })
  }

  const impactMatrix = buildImpactMatrix(packages)

  for (const pkg of packages) {
    pkg.consumers = impactMatrix[pkg.name] || []
  }

  const depGraph: DependencyEdge[] = []
  for (const pkg of packages) {
    for (const dep of pkg.internalDeps) {
      depGraph.push({ from: pkg.name, to: dep })
    }
  }

  const apps = packages.filter(p => p.role === "app")
  const libs = packages.filter(p => p.role !== "app")
  const commands = buildMonorepoCommands(tool, manager)

  return {
    type: tool,
    root,
    rootName,
    workspaceGlobs: globs,
    packages,
    manager,
    apps,
    libs,
    depGraph,
    impactMatrix,
    commands,
  }
}

export function generateDependencyGraphDoc(info: MonorepoInfo): string {
  const lines: string[] = [
    `# ${info.rootName} — Dependency Graph`,
    "",
    `**Monorepo:** ${info.type} + ${info.manager}`,
    `**Packages:** ${info.packages.length} (${info.apps.length} apps, ${info.libs.length} libraries)`,
    "",
    "## Apps",
    "",
    "| App | Path | Depends On | Port | Type |",
    "|-----|------|-----------|------|------|",
  ]

  for (const app of info.apps) {
    const deps = app.internalDeps.join(", ") || "—"
    const port = app.metadata.port ? String(app.metadata.port) : "—"
    lines.push(`| ${app.name} | ${app.relativePath} | ${deps} | ${port} | ${app.metadata.type} |`)
  }

  lines.push("", "## Libraries", "", "| Package | Path | Role | Consumed By |", "|---------|------|------|------------|")

  for (const lib of info.libs) {
    const consumers = lib.consumers.join(", ") || "—"
    lines.push(`| ${lib.name} | ${lib.relativePath} | ${lib.role} | ${consumers} |`)
  }

  lines.push("", "## Impact Matrix", "", "| If you change... | These need rebuild/test |", "|-----------------|----------------------|")

  for (const pkg of info.packages) {
    const affected = buildTransitiveImpact(info.impactMatrix, pkg.name)
    if (affected.length > 0) {
      lines.push(`| ${pkg.name} | ${affected.join(", ")} |`)
    }
  }

  lines.push("", "## Commands", "", "| Scope | Command |", "|-------|---------|")
  lines.push(`| Build all | \`${info.commands.buildAll}\` |`)
  lines.push(`| Test all | \`${info.commands.testAll}\` |`)

  for (const app of info.apps) {
    lines.push(`| ${app.name} only | \`${info.commands.filterRun(app.name, "dev")}\` |`)
  }

  if (info.commands.affected) {
    lines.push(`| Affected by last commit | \`${info.commands.affected}\` |`)
  }

  lines.push("")

  return lines.join("\n")
}

export function generateMonorepoAgentName(rootName: string, pkgName: string): string {
  const slug = slugify(pkgName)
  const rootSlug = slugify(rootName)

  if (slug.startsWith(rootSlug + "-")) return slug
  if (slug === rootSlug) return slug

  return `${rootSlug}-${slug}`
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[@\/]/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
}
