/**
 * Findings Engine
 *
 * Analyzes telemetry, eval, and training data to surface actionable findings.
 * Designed to power the dashboard operations center — click a finding to spawn
 * an agent that fixes it overnight.
 *
 * @purpose Engine that detects regressions, failures, coverage gaps, and plateaus
 */

import * as fs from "fs"
import * as path from "path"

export type FindingType =
  | "performance_regression"
  | "test_failure"
  | "error_spike"
  | "coverage_gap"
  | "stale_code"
  | "eval_plateau"

export type FindingSeverity = "critical" | "warning" | "info"
export type SuggestedAction = "spawn_agent" | "alert" | "investigate"

export interface AgentConfig {
  metric: string
  target: number
  scope_files: string[]
  rounds: number
  eval_script: string
}

export interface Finding {
  id: string
  type: FindingType
  severity: FindingSeverity
  title: string
  description: string
  metric?: string
  scope_files: string[]
  suggested_action: SuggestedAction
  agent_config?: AgentConfig
  created_at: number
  dismissed: boolean
}

interface TrainingEntry {
  id: string
  ts: string
  agent: string
  state: {
    composite_score?: number
    dimension_scores?: Record<string, number>
    tests_passing?: number
    tests_total?: number
    recent_deltas?: number[]
  }
  action: {
    type: string
    description: string
    files_affected?: string[]
    scope?: string
    branch?: string
  }
  reward: {
    composite_delta?: number
    quality_score?: number
    improved?: boolean
    prediction_error?: number
    tests_added?: number
  }
  metadata?: {
    branch?: string
    source?: string
    autoresearch_round?: number
    pr_number?: number
  }
}

interface EvalEntry {
  v: number
  ts: string
  agent: string
  run_id: string
  metrics: Record<string, number>
  composite?: number
  delta?: Record<string, number>
  improved?: boolean
  notes?: string
}

interface JournalEntry {
  ts: string
  type: string
  title: string
  summary?: string
  detail?: string
  status?: string
}

export class FindingsEngine {
  private projectRoot: string
  private findingsPath: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
    this.findingsPath = path.join(projectRoot, ".jfl", "findings.json")
  }

  async analyze(): Promise<Finding[]> {
    const findings: Finding[] = []

    // Load existing findings to preserve dismissed state
    const existingFindings = this.loadFindings()
    const dismissedIds = new Set(
      existingFindings.filter((f) => f.dismissed).map((f) => f.id)
    )

    // Run all detectors
    const detectors = [
      this.detectPerformanceRegressions.bind(this),
      this.detectTestFailures.bind(this),
      this.detectEvalPlateaus.bind(this),
      this.detectCoverageGaps.bind(this),
      this.detectStaleCode.bind(this),
    ]

    for (const detector of detectors) {
      const detected = await detector()
      for (const finding of detected) {
        // Preserve dismissed state
        finding.dismissed = dismissedIds.has(finding.id)
        findings.push(finding)
      }
    }

    // Save findings
    this.saveFindings(findings)

    return findings
  }

  private loadFindings(): Finding[] {
    try {
      if (fs.existsSync(this.findingsPath)) {
        return JSON.parse(fs.readFileSync(this.findingsPath, "utf-8"))
      }
    } catch {}
    return []
  }

  private saveFindings(findings: Finding[]): void {
    const dir = path.dirname(this.findingsPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(this.findingsPath, JSON.stringify(findings, null, 2))
  }

  getFindings(): Finding[] {
    return this.loadFindings()
  }

  dismissFinding(id: string): boolean {
    const findings = this.loadFindings()
    const finding = findings.find((f) => f.id === id)
    if (finding) {
      finding.dismissed = true
      this.saveFindings(findings)
      return true
    }
    return false
  }

  private readJsonlFile<T>(filePath: string): T[] {
    if (!fs.existsSync(filePath)) return []

    const content = fs.readFileSync(filePath, "utf-8")
    const entries: T[] = []

    for (const line of content.split("\n")) {
      if (!line.trim()) continue
      // Skip conflict markers
      if (line.startsWith("<<<<") || line.startsWith(">>>>") || line.startsWith("====")) continue
      try {
        entries.push(JSON.parse(line))
      } catch {}
    }

    return entries
  }

  private async detectPerformanceRegressions(): Promise<Finding[]> {
    const findings: Finding[] = []
    const trainingPath = path.join(this.projectRoot, ".jfl", "training-buffer.jsonl")
    const entries = this.readJsonlFile<TrainingEntry>(trainingPath)

    if (entries.length < 2) return findings

    // Group by agent
    const byAgent = new Map<string, TrainingEntry[]>()
    for (const entry of entries) {
      const agent = entry.agent || "unknown"
      if (!byAgent.has(agent)) byAgent.set(agent, [])
      byAgent.get(agent)!.push(entry)
    }

    for (const [agent, agentEntries] of byAgent) {
      // Sort by timestamp
      agentEntries.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

      // Compare last 3 entries to baseline (first 3)
      if (agentEntries.length < 6) continue

      const baseline = agentEntries.slice(0, 3)
      const recent = agentEntries.slice(-3)

      const baselineAvg =
        baseline.reduce((sum, e) => sum + (e.state.composite_score || 0), 0) / baseline.length
      const recentAvg =
        recent.reduce((sum, e) => sum + (e.state.composite_score || 0), 0) / recent.length

      if (baselineAvg > 0 && recentAvg < baselineAvg * 0.9) {
        const percentDrop = Math.round((1 - recentAvg / baselineAvg) * 100)
        const affectedFiles = new Set<string>()
        for (const e of recent) {
          for (const f of e.action.files_affected || []) {
            affectedFiles.add(f)
          }
        }

        findings.push({
          id: `perf-regression-${agent}-${Date.now()}`,
          type: "performance_regression",
          severity: percentDrop > 20 ? "critical" : "warning",
          title: `${agent} composite score dropped ${percentDrop}%`,
          description: `Score went from ${baselineAvg.toFixed(2)} to ${recentAvg.toFixed(2)}. Last ${recent.length} runs show consistent regression.`,
          metric: "composite_score",
          scope_files: Array.from(affectedFiles).slice(0, 10),
          suggested_action: "spawn_agent",
          agent_config: {
            metric: "composite_score",
            target: baselineAvg,
            scope_files: Array.from(affectedFiles).slice(0, 10),
            rounds: 5,
            eval_script: "npm test",
          },
          created_at: Date.now(),
          dismissed: false,
        })
      }
    }

    return findings
  }

  private async detectTestFailures(): Promise<Finding[]> {
    const findings: Finding[] = []
    const evalPath = path.join(this.projectRoot, ".jfl", "eval.jsonl")
    const entries = this.readJsonlFile<EvalEntry>(evalPath)

    if (entries.length === 0) return findings

    // Sort by timestamp
    entries.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

    const recent = entries.slice(-5)
    const failingEntries = recent.filter((e) => {
      const passRate = e.metrics?.test_pass_rate
      return passRate !== undefined && passRate < 1
    })

    if (failingEntries.length > 0) {
      const latest = failingEntries[failingEntries.length - 1]
      const passRate = latest.metrics?.test_pass_rate || 0
      const passed = latest.metrics?.tests_passed || 0
      const total = latest.metrics?.tests_total || 0
      const failing = total - passed

      findings.push({
        id: `test-failure-${Date.now()}`,
        type: "test_failure",
        severity: passRate < 0.9 ? "critical" : "warning",
        title: `${failing} test${failing !== 1 ? "s" : ""} failing`,
        description: `Test pass rate is ${(passRate * 100).toFixed(1)}% (${passed}/${total}). Agent: ${latest.agent}`,
        metric: "test_pass_rate",
        scope_files: [],
        suggested_action: "spawn_agent",
        agent_config: {
          metric: "test_pass_rate",
          target: 1.0,
          scope_files: [],
          rounds: 10,
          eval_script: "npm test",
        },
        created_at: Date.now(),
        dismissed: false,
      })
    }

    return findings
  }

  private async detectEvalPlateaus(): Promise<Finding[]> {
    const findings: Finding[] = []
    const trainingPath = path.join(this.projectRoot, ".jfl", "training-buffer.jsonl")
    const entries = this.readJsonlFile<TrainingEntry>(trainingPath)

    // Group by agent
    const byAgent = new Map<string, TrainingEntry[]>()
    for (const entry of entries) {
      const agent = entry.agent || "unknown"
      if (!byAgent.has(agent)) byAgent.set(agent, [])
      byAgent.get(agent)!.push(entry)
    }

    for (const [agent, agentEntries] of byAgent) {
      if (agentEntries.length < 5) continue

      // Sort by timestamp
      agentEntries.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

      // Check if recent deltas are all near zero
      const recent = agentEntries.slice(-5)
      const deltas = recent.map((e) => e.reward.composite_delta || 0)
      const allNearZero = deltas.every((d) => Math.abs(d) < 0.01)
      const noneImproved = recent.every((e) => !e.reward.improved)

      if (allNearZero && noneImproved) {
        const currentScore = recent[recent.length - 1].state.composite_score || 0

        findings.push({
          id: `eval-plateau-${agent}-${Date.now()}`,
          type: "eval_plateau",
          severity: "warning",
          title: `${agent} plateaued at ${currentScore.toFixed(2)}`,
          description: `Last ${recent.length} experiments show no improvement. May need a different approach.`,
          metric: "composite_score",
          scope_files: [],
          suggested_action: "investigate",
          created_at: Date.now(),
          dismissed: false,
        })
      }
    }

    return findings
  }

  private async detectCoverageGaps(): Promise<Finding[]> {
    const findings: Finding[] = []
    const srcDir = path.join(this.projectRoot, "src")
    const testDir = path.join(this.projectRoot, "src", "__tests__")

    if (!fs.existsSync(srcDir)) return findings

    const sourceFiles = this.findFiles(srcDir, [".ts", ".tsx"])
      .filter((f) => !f.includes("__tests__") && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
      .filter((f) => !f.includes(".d.ts"))

    const testFiles = new Set(
      this.findFiles(testDir, [".test.ts", ".test.tsx"])
        .concat(this.findFiles(srcDir, [".test.ts", ".test.tsx"]))
    )

    const untestedFiles: string[] = []

    for (const file of sourceFiles) {
      const baseName = path.basename(file, path.extname(file))
      const hasTest = Array.from(testFiles).some(
        (tf) =>
          path.basename(tf).includes(baseName) ||
          path.basename(tf).startsWith(baseName + ".test")
      )
      if (!hasTest) {
        untestedFiles.push(file)
      }
    }

    if (untestedFiles.length >= 5) {
      const relativePaths = untestedFiles
        .map((f) => path.relative(this.projectRoot, f))
        .slice(0, 20)

      findings.push({
        id: `coverage-gap-${Date.now()}`,
        type: "coverage_gap",
        severity: untestedFiles.length > 15 ? "warning" : "info",
        title: `${untestedFiles.length} files have no test coverage`,
        description: `Source files without corresponding test files: ${relativePaths.slice(0, 5).join(", ")}${untestedFiles.length > 5 ? ` and ${untestedFiles.length - 5} more` : ""}`,
        scope_files: relativePaths,
        suggested_action: "spawn_agent",
        agent_config: {
          metric: "test_coverage",
          target: 0.8,
          scope_files: relativePaths.slice(0, 10),
          rounds: 10,
          eval_script: "npm test",
        },
        created_at: Date.now(),
        dismissed: false,
      })
    }

    return findings
  }

  private async detectStaleCode(): Promise<Finding[]> {
    const findings: Finding[] = []
    const srcDir = path.join(this.projectRoot, "src")

    if (!fs.existsSync(srcDir)) return findings

    const files = this.findFiles(srcDir, [".ts", ".tsx", ".js", ".jsx"])
    const todoFiles: { file: string; count: number }[] = []

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf-8")
        const todoMatches = content.match(/TODO|FIXME|HACK|XXX/gi)
        if (todoMatches && todoMatches.length >= 3) {
          todoFiles.push({
            file: path.relative(this.projectRoot, file),
            count: todoMatches.length,
          })
        }
      } catch {}
    }

    if (todoFiles.length >= 3) {
      const totalTodos = todoFiles.reduce((sum, f) => sum + f.count, 0)
      const topFiles = todoFiles
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map((f) => f.file)

      findings.push({
        id: `stale-code-${Date.now()}`,
        type: "stale_code",
        severity: totalTodos > 20 ? "warning" : "info",
        title: `${totalTodos} TODO/FIXME markers in ${todoFiles.length} files`,
        description: `Files with most markers: ${topFiles.slice(0, 3).join(", ")}`,
        scope_files: topFiles,
        suggested_action: "investigate",
        created_at: Date.now(),
        dismissed: false,
      })
    }

    return findings
  }

  private findFiles(dir: string, extensions: string[]): string[] {
    const files: string[] = []

    const scan = (d: string) => {
      if (!fs.existsSync(d)) return
      try {
        const entries = fs.readdirSync(d, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(d, entry.name)
          if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
            scan(fullPath)
          } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
            files.push(fullPath)
          }
        }
      } catch {}
    }

    scan(dir)
    return files
  }
}

export function createFindingsEngine(projectRoot: string): FindingsEngine {
  return new FindingsEngine(projectRoot)
}
