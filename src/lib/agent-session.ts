/**
 * Agent Session
 *
 * Session lifecycle management following Karpathy's autoresearch loop:
 * branch → change → eval → keep|revert → repeat
 *
 * Git as state machine: keep = advance branch, discard = git reset --hard HEAD~1
 * results.tsv is NOT committed (append-only local log)
 *
 * @purpose Manage scoped agent session lifecycle with git-based state tracking
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { spawnSync, spawn } from "child_process"
import { createHash } from "crypto"
import type { AgentConfig } from "./agent-config.js"
import { createEvalSnapshot, freezeEvalSnapshot, runEvalSnapshot, type EvalSnapshot, type EvalResult } from "./eval-snapshot.js"
import type { RLState, RLAction, RLReward } from "./training-buffer.js"

// ============================================================================
// Experiment History — Karpathy's program.md pattern
// ============================================================================

export interface ExperimentEntry {
  round: number
  task: string
  metricBefore: number
  metricAfter: number
  delta: number
  kept: boolean
  files: string[]
  timestamp: string
}

/**
 * Build experiment history markdown for the agent to read.
 * This is the KEY missing piece — agents need memory of past experiments.
 *
 * Following Karpathy's autoresearch pattern: agent sees program.md with
 * instructions + history of past experiments so it knows what to try next.
 */
export function buildExperimentHistory(
  session: AgentSession,
  transitions: Transition[],
  currentMetric: number
): string {
  const config = session.config
  const direction = config.direction === "minimize" ? "lower is better" : "higher is better"

  // Get scope_files from constraints if available
  const scopeFiles = (config.constraints as any)?.scope_files || config.constraints.files_in_scope || []

  const lines: string[] = [
    `# Experiment History — ${session.agentName}`,
    "",
    `## Goal`,
    `Optimize metric: **${config.metric}** (${direction})`,
    `Current value: **${currentMetric.toFixed(4)}**`,
    `Baseline: ${session.baselineMetric.toFixed(4)}`,
    "",
    `## Files to Modify`,
    `Focus your changes on these specific files:`,
    ...scopeFiles.map((f: string) => `- ${f}`),
    "",
    `## Constraints`,
    `- Max files per change: ${config.constraints.max_file_changes}`,
    `- Read-only: ${config.constraints.files_readonly.join(", ")}`,
    "",
    `## Past Experiments`,
    ""
  ]

  if (transitions.length === 0) {
    lines.push("No experiments yet. This is round 1.")
    lines.push("")
    lines.push("Make ONE small, focused change to improve the metric.")
  } else {
    // Group by kept/rejected
    const kept = transitions.filter(t => t.reward > 0)
    const rejected = transitions.filter(t => t.reward <= 0)

    lines.push(`### Kept (${kept.length} experiments that improved the metric):`)
    if (kept.length === 0) {
      lines.push("None yet.")
    } else {
      for (const t of kept.slice(-10)) { // Last 10 kept
        const files = t.action.files_affected.join(", ") || "unknown"
        lines.push(`- R${t.state.trajectory_length}: "${t.action.description.slice(0, 60)}" → +${t.reward.toFixed(4)} (files: ${files})`)
      }
    }
    lines.push("")

    lines.push(`### Rejected (${rejected.length} experiments that did NOT improve):`)
    if (rejected.length === 0) {
      lines.push("None yet.")
    } else {
      for (const t of rejected.slice(-10)) { // Last 10 rejected
        lines.push(`- R${t.state.trajectory_length}: "${t.action.description.slice(0, 60)}" → ${t.reward.toFixed(4)}`)
      }
    }
    lines.push("")

    lines.push(`## What to Do`)
    lines.push(`1. DO NOT repeat rejected experiments`)
    lines.push(`2. BUILD on kept experiments — they worked`)
    lines.push(`3. Make ONE small, focused change`)
    lines.push(`4. Prefer modifying existing code over adding new files`)
  }

  return lines.join("\n")
}

/**
 * Write experiment history to the worktree as EXPERIMENTS.md.
 * Claude Code will read this file to understand what has been tried.
 */
export function writeExperimentHistory(
  session: AgentSession,
  transitions: Transition[],
  currentMetric: number
): void {
  const content = buildExperimentHistory(session, transitions, currentMetric)
  const historyPath = join(session.worktreePath, "EXPERIMENTS.md")

  try {
    writeFileSync(historyPath, content)
  } catch (err) {
    console.error(`  Warning: Could not write experiment history: ${err}`)
  }
}

/**
 * Read experiment history from the worktree.
 * Returns empty string if file doesn't exist.
 */
export function readExperimentHistory(session: AgentSession): string {
  const historyPath = join(session.worktreePath, "EXPERIMENTS.md")

  try {
    if (existsSync(historyPath)) {
      return readFileSync(historyPath, "utf-8")
    }
  } catch {}

  return ""
}

// ============================================================================
// Types
// ============================================================================

export interface AgentSession {
  id: string                    // Unique session identifier
  agentName: string             // Agent name from config
  config: AgentConfig           // Full agent config
  projectRoot: string           // GTM root — where agent configs, eval scripts, and persistent files live
  evalRoot: string              // Where eval scripts resolve from (same as projectRoot)
  worktreePath: string          // Isolated worktree in /tmp — all work happens here (may be a service repo)
  branch: string                // Session branch name
  baseBranch: string            // Base branch (usually main)
  evalSnapshot: EvalSnapshot    // Frozen eval snapshot
  baselineMetric: number        // Baseline metric value
  startedAt: string             // ISO timestamp
  resultsPath: string           // Path to results.tsv (NOT committed)
  round: number                 // Current round number
  status: "active" | "completed" | "failed"
}

export interface RoundResult {
  round: number
  task: string
  hypothesis: string
  metricBefore: number
  metricAfter: number
  delta: number
  kept: boolean
  duration_ms: number
  error?: string
}

export interface Transition {
  agent: string
  session_id: string
  state_hash: string
  state: RLState
  action_diff: string           // Git diff of changes
  action: RLAction
  hypothesis: string
  reward: number
  timestamp: string
}

export interface SessionSummary {
  session_id: string
  agentName: string
  rounds: number
  baseline: number
  finalMetric: number
  totalDelta: number
  bestDelta: number
  improvedRounds: number
  transitions: Transition[]
  prUrl?: string       // Set later if human/agent creates PR from review
  branchUrl?: string   // Remote branch URL for review
}

// ============================================================================
// Git Helpers
// ============================================================================

function gitExec(args: string[], cwd: string): { ok: boolean; output: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" })
  return { ok: result.status === 0, output: (result.stdout || "").trim() }
}

function getCurrentBranch(cwd: string): string {
  const result = gitExec(["branch", "--show-current"], cwd)
  return result.output
}

function hasUncommittedChanges(cwd: string): boolean {
  const diff = gitExec(["diff", "--quiet", "HEAD"], cwd)
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd, encoding: "utf-8", stdio: "pipe",
  })
  return !diff.ok || (untracked.stdout || "").trim().length > 0
}

function getGitDiff(cwd: string): string {
  const result = gitExec(["diff", "HEAD"], cwd)
  return result.output
}

// ============================================================================
// Scope Impact Emission
// ============================================================================

function emitScopeImpact(
  session: AgentSession,
  pattern: string,
  delta: number,
  summary: SessionSummary
): void {
  // Write scope:impact event to service-events.jsonl for the hub to pick up
  const eventsPath = join(session.projectRoot, ".jfl", "service-events.jsonl")
  const event = {
    type: "scope:impact",
    source: `agent:${session.agentName}`,
    data: {
      agent: session.agentName,
      pattern,
      metric: session.config.metric,
      delta,
      direction: session.config.direction,
      session_id: session.id,
      baseline: summary.baseline,
      final: summary.finalMetric,
      rounds: summary.rounds,
      improved_rounds: summary.improvedRounds,
      pr_url: summary.prUrl,
      branch_url: summary.branchUrl,
      produces: session.config.context_scope.produces,
      consumes: session.config.context_scope.consumes,
    },
    ts: new Date().toISOString(),
  }

  try {
    appendFileSync(eventsPath, JSON.stringify(event) + "\n")
  } catch {
    // Non-fatal — hub may not be running
  }

  // Also try to POST to hub if running
  try {
    const tokenPath = join(session.projectRoot, ".jfl", "context-hub.token")
    if (existsSync(tokenPath)) {
      const token = readFileSync(tokenPath, "utf-8").trim()
      const http = require("http")
      const postData = JSON.stringify(event)
      const req = http.request({
        hostname: "localhost",
        port: 4242,
        path: "/api/events",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "Content-Length": Buffer.byteLength(postData),
        },
      })
      req.write(postData)
      req.end()
    }
  } catch {
    // Non-fatal
  }
}

// ============================================================================
// Session Management
// ============================================================================

export function startSession(
  config: AgentConfig,
  projectRoot: string,
  baseBranch: string = "main"
): AgentSession {
  // Generate unique session ID
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const hashPart = createHash("sha256")
    .update(`${config.name}-${timestamp}-${Math.random()}`)
    .digest("hex")
    .slice(0, 8)
  const sessionId = `${config.name}-${hashPart}-${Date.now()}`

  // Create session branch
  const branch = `session/${config.name}-${hashPart}-${timestamp.slice(0, 10)}`

  // Create isolated worktree in /tmp — never touch the main working directory
  const worktreePath = join("/tmp", `jfl-agent-${config.name}-${hashPart}`)

  // Resolve target repo — agents can target a different service repo than the GTM root
  const repoRoot = config.target_repo
    ? join(projectRoot, config.target_repo)
    : projectRoot

  // Fetch latest base branch
  gitExec(["fetch", "origin", baseBranch], repoRoot)

  // Create worktree with new branch from origin/baseBranch (in the target repo, not GTM)
  let wt = gitExec(["worktree", "add", worktreePath, "-b", branch, `origin/${baseBranch}`], repoRoot)
  if (!wt.ok) {
    // Fallback: try local baseBranch
    wt = gitExec(["worktree", "add", worktreePath, "-b", branch, baseBranch], repoRoot)
  }
  if (!wt.ok) {
    throw new Error(`Failed to create worktree for ${branch}: ${wt.output}`)
  }

  // Create eval snapshot — eval scripts live in GTM (projectRoot), not the service worktree
  // Copy eval files into the worktree so they're available during agent runs
  const evalSnapshot = createEvalSnapshot(
    projectRoot,
    config.eval.script,
    config.eval.data
  )
  freezeEvalSnapshot(evalSnapshot)

  // Results persist in main repo (survives worktree cleanup)
  const resultsDir = join(projectRoot, ".jfl", "sessions", sessionId)
  mkdirSync(resultsDir, { recursive: true })
  const resultsPath = join(resultsDir, "results.tsv")

  // Write TSV header
  writeFileSync(
    resultsPath,
    "round\ttask\tbaseline\tmetric\tdelta\tkept\tduration_ms\terror\ttimestamp\n"
  )

  // Run baseline eval
  const session: AgentSession = {
    id: sessionId,
    agentName: config.name,
    config,
    projectRoot,
    evalRoot: projectRoot,
    worktreePath,
    branch,
    baseBranch,
    evalSnapshot,
    baselineMetric: 0,
    startedAt: new Date().toISOString(),
    resultsPath,
    round: 0,
    status: "active",
  }

  return session
}

export async function runBaseline(session: AgentSession): Promise<number> {
  // Eval scripts live in GTM (evalRoot), not the service worktree
  const result = await runEvalSnapshot(
    session.evalSnapshot,
    session.evalRoot,
    session.config.time_budget_seconds * 1000
  )

  if (!result.success) {
    throw new Error(`Baseline eval failed: ${result.error}`)
  }

  session.baselineMetric = result.metric
  return result.metric
}

export async function runRound(
  session: AgentSession,
  round: number,
  task: string,
  hypothesis: string,
  previousTransitions: Transition[] = []
): Promise<{ result: RoundResult; transition: Transition }> {
  const startTime = Date.now()
  session.round = round

  // Capture state before changes
  const stateBefore: RLState = {
    composite_score: session.baselineMetric,
    dimension_scores: {},
    tests_passing: 0,
    tests_total: 1,
    trajectory_length: round,
    recent_deltas: previousTransitions.slice(-5).map(t => t.reward),
    agent: session.agentName,
  }
  const stateHash = createHash("sha256")
    .update(JSON.stringify(stateBefore))
    .digest("hex")
    .slice(0, 12)

  // Write experiment history BEFORE running Claude Code
  // This is the Karpathy pattern: agent sees history + instructions
  writeExperimentHistory(session, previousTransitions, session.baselineMetric)

  // Run Claude Code with fixed time budget
  await runClaudeCode(session, task)

  // Check if any changes were made (in the worktree)
  const hasChanges = hasUncommittedChanges(session.worktreePath)

  if (!hasChanges) {
    const noChangeResult: RoundResult = {
      round,
      task,
      hypothesis,
      metricBefore: session.baselineMetric,
      metricAfter: session.baselineMetric,
      delta: 0,
      kept: false,
      duration_ms: Date.now() - startTime,
      error: "No changes made",
    }

    const noChangeTransition: Transition = {
      agent: session.agentName,
      session_id: session.id,
      state_hash: stateHash,
      state: stateBefore,
      action_diff: "",
      action: {
        type: "experiment",
        description: task,
        files_affected: [],
        scope: "small",
        branch: session.branch,
      },
      hypothesis,
      reward: 0,
      timestamp: new Date().toISOString(),
    }

    logResult(session, noChangeResult)
    return { result: noChangeResult, transition: noChangeTransition }
  }

  // Capture the diff before committing
  const diff = getGitDiff(session.worktreePath)

  // Get changed files
  const changedFilesResult = spawnSync("git", ["diff", "--name-only", "HEAD"], {
    cwd: session.worktreePath,
    encoding: "utf-8",
    stdio: "pipe",
  })
  const changedFiles = (changedFilesResult.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean)

  // Commit changes in worktree
  gitExec(["add", "-A"], session.worktreePath)
  gitExec(["commit", "-m", `agent(${session.agentName}): round ${round} - ${task.slice(0, 50)}`], session.worktreePath)

  // Run frozen eval — scripts verify against evalRoot (GTM), not the service worktree
  const evalResult = await runEvalSnapshot(
    session.evalSnapshot,
    session.evalRoot,
    session.config.time_budget_seconds * 1000
  )

  const metricAfter = evalResult.success ? evalResult.metric : 0
  const delta = metricAfter - session.baselineMetric

  // Decide: keep or discard
  // For maximize: keep if delta > 0
  // For minimize: keep if delta < 0
  const improved = session.config.direction === "maximize"
    ? delta > 0
    : delta < 0

  if (improved) {
    // Keep: advance baseline
    session.baselineMetric = metricAfter
  } else {
    // Discard: git reset --hard HEAD~1 (in worktree only)
    gitExec(["reset", "--hard", "HEAD~1"], session.worktreePath)
  }

  const result: RoundResult = {
    round,
    task,
    hypothesis,
    metricBefore: session.baselineMetric,
    metricAfter,
    delta,
    kept: improved,
    duration_ms: Date.now() - startTime,
    error: evalResult.success ? undefined : evalResult.error,
  }

  const action: RLAction = {
    type: "experiment",
    description: task,
    files_affected: changedFiles,
    scope: changedFiles.length <= 2 ? "small" : changedFiles.length <= 5 ? "medium" : "large",
    branch: session.branch,
  }

  const transition: Transition = {
    agent: session.agentName,
    session_id: session.id,
    state_hash: stateHash,
    state: stateBefore,
    action_diff: diff,
    action,
    hypothesis,
    reward: improved ? Math.abs(delta) : -Math.abs(delta),  // Positive reward = improvement, regardless of direction
    timestamp: new Date().toISOString(),
  }

  logResult(session, result)
  return { result, transition }
}

async function runClaudeCode(session: AgentSession, task: string): Promise<void> {
  const timeout = session.config.time_budget_seconds * 1000

  // Build enhanced task with experiment history reference
  // This is the Karpathy pattern: agent sees program.md (EXPERIMENTS.md) with history
  const scopeFiles = (session.config.constraints as any)?.scope_files || session.config.constraints.files_in_scope || []
  const scopeFilesStr = scopeFiles.slice(0, 5).join(", ")

  const enhancedTask = `${task}

IMPORTANT: Read EXPERIMENTS.md first — it contains the history of past experiments for this agent.
- DO NOT repeat experiments that failed (rejected section)
- BUILD on experiments that worked (kept section)
- Focus changes on these files: ${scopeFilesStr}
- Make ONE small, focused change
- Do not add new files unless absolutely necessary`

  // Use claude CLI directly — relies on OAuth from macOS keychain
  // Must run from a context with keychain access (terminal/tmux, NOT background daemon)
  return new Promise((resolve) => {
    console.log("  Spawning claude CLI...")
    const child = spawn("claude", [
      "--dangerously-skip-permissions",
      "-p", enhancedTask,
      "--output-format", "text",
    ], {
      cwd: session.worktreePath,
      stdio: "inherit",
      env: {
        ...process.env,
        CLAUDECODE: undefined,
        CLAUDE_CODE: undefined,
      },
    })

    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM")
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL")
      }, 5000)
    }, timeout)

    child.on("error", (err) => {
      console.error(`  Claude CLI error: ${err.message}`)
      clearTimeout(timeoutId)
      resolve()
    })

    child.on("exit", (code, signal) => {
      console.error(`  Claude CLI exit: code=${code} signal=${signal}`)
      clearTimeout(timeoutId)
      resolve()
    })
  })
}

function logResult(session: AgentSession, result: RoundResult): void {
  const line = [
    result.round,
    result.task.replace(/\t/g, " ").slice(0, 100),
    result.metricBefore.toFixed(6),
    result.metricAfter.toFixed(6),
    result.delta.toFixed(6),
    result.kept ? "1" : "0",
    result.duration_ms,
    (result.error || "").replace(/\t/g, " ").slice(0, 100),
    new Date().toISOString(),
  ].join("\t")

  appendFileSync(session.resultsPath, line + "\n")

  // Remove EXPERIMENTS.md from git tracking (it's ephemeral, regenerated each round)
  const experimentsPath = join(session.worktreePath, "EXPERIMENTS.md")
  if (existsSync(experimentsPath)) {
    gitExec(["reset", "HEAD", "EXPERIMENTS.md"], session.worktreePath)
    // Don't delete — keep it for reference, just don't commit
  }
}

export async function endSession(
  session: AgentSession,
  transitions: Transition[]
): Promise<SessionSummary> {
  session.status = "completed"

  // Calculate summary statistics
  let improvedRounds = 0
  let bestDelta = 0
  let totalDelta = 0

  for (const t of transitions) {
    if (t.reward > 0) improvedRounds++
    if (t.reward > bestDelta) bestDelta = t.reward
    totalDelta += t.reward
  }

  const summary: SessionSummary = {
    session_id: session.id,
    agentName: session.agentName,
    rounds: transitions.length,
    baseline: session.baselineMetric - totalDelta,  // Reconstruct original baseline
    finalMetric: session.baselineMetric,
    totalDelta,
    bestDelta,
    improvedRounds,
    transitions,
  }

  // Write transitions to training buffer WITH diffs (for code-policy training)
  try {
    const { TrainingBuffer } = await import("./training-buffer.js")
    const tb = new TrainingBuffer(session.projectRoot)
    for (const t of transitions) {
      tb.append({
        agent: t.agent,
        state: t.state,
        action: {
          ...t.action,
          // Include the actual code diff for code-policy training (AutoHarness pattern)
          code_diff: t.action_diff?.slice(0, 10000) || "", // Cap at 10KB
        },
        reward: {
          composite_delta: t.reward,
          dimension_deltas: {},
          tests_added: 0,
          quality_score: t.reward > 0 ? 1 : 0,
          improved: t.reward > 0,
        },
        metadata: {
          branch: session.branch,
          source: "autoresearch",
          session_id: session.id,
          round: t.state?.trajectory_length || 0,
          hypothesis: t.hypothesis,
        },
      })
    }
  } catch {}

  // If we improved, push the branch (but do NOT create a PR or auto-merge)
  // Following Karpathy's autoresearch pattern: branches grow overnight,
  // humans (or their agents) review and merge in the morning
  if (improvedRounds > 0) {
    // Push the branch so it's available for review
    const push = gitExec(["push", "-u", "origin", session.branch], session.worktreePath)
    if (push.ok) {
      summary.branchUrl = `https://github.com/402goose/${session.worktreePath.split('/').pop()}/tree/${session.branch}`
    }

    // Emit scope:impact events for each produces pattern
    // This triggers downstream agents that consume these patterns
    for (const pattern of session.config.context_scope.produces) {
      emitScopeImpact(session, pattern, totalDelta, summary)
    }
  }

  // Clean up worktree — the branch persists on remote for review
  gitExec(["worktree", "remove", session.worktreePath, "--force"], session.projectRoot)
  gitExec(["worktree", "prune"], session.projectRoot)

  return summary
}

async function createPR(session: AgentSession, summary: SessionSummary): Promise<string | undefined> {
  // Push branch from worktree
  const push = gitExec(["push", "-u", "origin", session.branch], session.worktreePath)
  if (!push.ok) {
    return undefined
  }

  // Create PR
  const title = `Agent(${session.agentName}): +${summary.totalDelta.toFixed(4)} ${session.config.metric}`
  const body = [
    `## Scoped Agent Result`,
    "",
    `**Agent:** ${session.agentName}`,
    `**Metric:** ${session.config.metric}`,
    `**Baseline:** ${summary.baseline.toFixed(4)}`,
    `**Final:** ${summary.finalMetric.toFixed(4)}`,
    `**Delta:** +${summary.totalDelta.toFixed(4)}`,
    "",
    `### Rounds`,
    `- Total: ${summary.rounds}`,
    `- Improved: ${summary.improvedRounds}`,
    `- Best delta: +${summary.bestDelta.toFixed(4)}`,
    "",
    "---",
    "*Generated by JFL scoped agent*",
  ].join("\n")

  const prResult = spawnSync("gh", [
    "pr", "create",
    "--title", title,
    "--body", body,
    "--base", session.baseBranch,
    "--head", session.branch,
    "--label", "agent-generated",
  ], {
    cwd: session.worktreePath,
    encoding: "utf-8",
    stdio: "pipe",
  })

  if (prResult.status === 0) {
    return prResult.stdout.trim()
  }

  // Try without label
  const prRetry = spawnSync("gh", [
    "pr", "create",
    "--title", title,
    "--body", body,
    "--base", session.baseBranch,
    "--head", session.branch,
  ], {
    cwd: session.worktreePath,
    encoding: "utf-8",
    stdio: "pipe",
  })

  return prRetry.status === 0 ? prRetry.stdout.trim() : undefined
}

// ============================================================================
// Session Recovery
// ============================================================================

export function loadSessionState(projectRoot: string, sessionId: string): AgentSession | null {
  const sessionDir = join(projectRoot, ".jfl", "sessions", sessionId)
  const statePath = join(sessionDir, "state.json")

  if (!existsSync(statePath)) return null

  try {
    const state = JSON.parse(readFileSync(statePath, "utf-8"))
    return state as AgentSession
  } catch {
    return null
  }
}

export function saveSessionState(session: AgentSession): void {
  const sessionDir = join(session.projectRoot, ".jfl", "sessions", session.id)
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true })
  }

  const statePath = join(sessionDir, "state.json")
  writeFileSync(statePath, JSON.stringify(session, null, 2))
}

export function listActiveSessions(projectRoot: string): string[] {
  const sessionsDir = join(projectRoot, ".jfl", "sessions")
  if (!existsSync(sessionsDir)) return []

  const { readdirSync } = require("fs")
  const sessions: string[] = []

  for (const entry of readdirSync(sessionsDir)) {
    const statePath = join(sessionsDir, entry, "state.json")
    if (existsSync(statePath)) {
      try {
        const state = JSON.parse(readFileSync(statePath, "utf-8"))
        if (state.status === "active") {
          sessions.push(entry)
        }
      } catch {}
    }
  }

  return sessions
}
