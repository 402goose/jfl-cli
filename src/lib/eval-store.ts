/**
 * @purpose Read/write eval entries to .jfl/eval.jsonl with dual-write to GTM parent
 */

import * as fs from "fs"
import * as path from "path"
import type { EvalEntry } from "../types/eval.js"
import type { ServiceConfig } from "./service-gtm.js"

function findProjectRoot(): string {
  let dir = process.cwd()
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".jfl", "config.json"))) return dir
    if (fs.existsSync(path.join(dir, ".jfl"))) return dir
    dir = path.dirname(dir)
  }
  return process.cwd()
}

function getEvalPath(root: string): string {
  return path.join(root, ".jfl", "eval.jsonl")
}

function loadConfig(root: string): ServiceConfig | null {
  const configPath = path.join(root, ".jfl", "config.json")
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as ServiceConfig
  } catch {
    return null
  }
}

export function appendEval(entry: EvalEntry, projectRoot?: string): void {
  const root = projectRoot ?? findProjectRoot()
  const evalPath = getEvalPath(root)

  const dir = path.dirname(evalPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  fs.appendFileSync(evalPath, JSON.stringify(entry) + "\n")

  // Dual-write up the parent chain (service → GTM → portfolio)
  const config = loadConfig(root)
  const parents: string[] = []

  if (config?.gtm_parent && fs.existsSync(config.gtm_parent)) {
    parents.push(config.gtm_parent)
    // Check if GTM has a portfolio parent
    const gtmConfig = loadConfig(config.gtm_parent)
    if (gtmConfig?.portfolio_parent && fs.existsSync(gtmConfig.portfolio_parent)) {
      parents.push(gtmConfig.portfolio_parent)
    }
  } else if (config?.portfolio_parent && fs.existsSync(config.portfolio_parent)) {
    parents.push(config.portfolio_parent)
  }

  for (const parent of parents) {
    const parentEvalPath = getEvalPath(parent)
    const parentDir = path.dirname(parentEvalPath)
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true })
    try {
      fs.appendFileSync(parentEvalPath, JSON.stringify(entry) + "\n")
    } catch {}
  }
}

function readEvalsFromPath(evalPath: string): EvalEntry[] {
  if (!fs.existsSync(evalPath)) return []
  const entries: EvalEntry[] = []
  const lines = fs.readFileSync(evalPath, "utf-8").split("\n")
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line) as EvalEntry)
    } catch {}
  }
  return entries
}

/**
 * Read evals from local .jfl/eval.jsonl AND from registered service paths
 * when running as a GTM or portfolio hub. This gives the GTM dashboard
 * a unified view of all agents across all services.
 */
export function readEvals(projectRoot?: string): EvalEntry[] {
  const root = projectRoot ?? findProjectRoot()
  const evalPath = getEvalPath(root)

  const entries = readEvalsFromPath(evalPath)

  // If this is a GTM or portfolio, also read from registered services
  const config = loadConfig(root)
  if (config && (config.type === "gtm" || config.type === "portfolio")) {
    const services = (config as any).registered_services as Array<{
      name: string; path: string
    }> | undefined

    if (services) {
      const seen = new Set(entries.map(e => `${e.agent}:${e.ts}:${e.run_id}`))
      for (const svc of services) {
        if (!svc.path) continue
        const svcEvalPath = getEvalPath(svc.path)
        const svcEntries = readEvalsFromPath(svcEvalPath)
        for (const entry of svcEntries) {
          const key = `${entry.agent}:${entry.ts}:${entry.run_id}`
          if (!seen.has(key)) {
            entries.push(entry)
            seen.add(key)
          }
        }
      }
    }
  }

  return entries
}

export function getTrajectory(
  agent: string,
  metric: string,
  projectRoot?: string
): Array<{ ts: string; value: number; model_version?: string }> {
  const evals = readEvals(projectRoot)
  const filtered = evals.filter(e => e.agent === agent)
  const points: Array<{ ts: string; value: number; model_version?: string }> = []

  for (const e of filtered) {
    const value = metric === "composite" ? e.composite : e.metrics[metric]
    if (value !== undefined && value !== null) {
      points.push({ ts: e.ts, value, model_version: e.model_version })
    }
  }

  return points.sort((a, b) => a.ts.localeCompare(b.ts))
}

export function getLatestEval(agent: string, projectRoot?: string): EvalEntry | null {
  const evals = readEvals(projectRoot)
  const filtered = evals
    .filter(e => e.agent === agent)
    .sort((a, b) => b.ts.localeCompare(a.ts))

  return filtered[0] ?? null
}

export function listAgents(projectRoot?: string): string[] {
  const evals = readEvals(projectRoot)
  const agents = new Set<string>()
  for (const e of evals) agents.add(e.agent)
  return [...agents].sort()
}

export function getScopedJournalDirs(projectRoot?: string): string[] {
  const root = projectRoot ?? findProjectRoot()
  const config = loadConfig(root)
  const dirs: string[] = []

  // Always include local journal
  const localJournal = path.join(root, ".jfl", "journal")
  if (fs.existsSync(localJournal)) dirs.push(localJournal)

  if (!config) return dirs

  const registeredServices = (config as any).registered_services as Array<{
    name: string
    path: string
    type?: string
    context_scope?: { produces?: string[]; consumes?: string[]; denied?: string[] }
  }> | undefined

  // Portfolio sees all child GTMs and their services
  if (config.type === "portfolio" && registeredServices) {
    for (const child of registeredServices) {
      const childJournal = path.join(child.path, ".jfl", "journal")
      if (fs.existsSync(childJournal)) dirs.push(childJournal)

      // Also include child's registered services
      const childConfig = loadConfig(child.path)
      const childServices = (childConfig as any)?.registered_services as Array<{
        name: string; path: string
      }> | undefined
      if (childServices) {
        for (const svc of childServices) {
          const svcJournal = path.join(svc.path, ".jfl", "journal")
          if (fs.existsSync(svcJournal)) dirs.push(svcJournal)
        }
      }
    }
    return dirs
  }

  // GTM sees all registered service journals
  if (config.type === "gtm" && registeredServices) {
    for (const svc of registeredServices) {
      const svcJournal = path.join(svc.path, ".jfl", "journal")
      if (fs.existsSync(svcJournal)) dirs.push(svcJournal)
    }
    return dirs
  }

  // If service, check scope to determine which journals we can read
  if (config.type === "service" && config.gtm_parent) {
    const parentConfig = loadConfig(config.gtm_parent)
    const parentServices = (parentConfig as any)?.registered_services as Array<{
      name: string
      path: string
    }> | undefined

    if (!parentServices) return dirs

    const scope = config.context_scope
    if (!scope?.consumes?.length) return dirs // no consumes = only own journal

    for (const svc of parentServices) {
      if (svc.path === root) continue // skip self, already added

      // Check if any consumes pattern matches this service's journal
      const svcJournalPattern = `journal:${svc.name}`
      const canConsume = scope.consumes.some(pattern => {
        const regexStr = pattern.replace(/\*/g, ".*")
        return new RegExp(`^${regexStr}$`).test(svcJournalPattern) ||
          new RegExp(`^${regexStr}`).test(svcJournalPattern)
      })

      // Check denied
      const isDenied = scope.denied?.some(pattern => {
        const regexStr = pattern.replace(/\*/g, ".*")
        return new RegExp(`^${regexStr}$`).test(svcJournalPattern) ||
          new RegExp(`^${regexStr}`).test(svcJournalPattern)
      }) ?? false

      if (canConsume && !isDenied) {
        const svcJournal = path.join(svc.path, ".jfl", "journal")
        if (fs.existsSync(svcJournal)) dirs.push(svcJournal)
      }
    }
  }

  return dirs
}
