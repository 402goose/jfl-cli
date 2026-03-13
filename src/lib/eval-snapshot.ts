/**
 * Eval Snapshot
 *
 * Content-addressed immutable eval system. Ensures eval code and data
 * cannot change during an agent session, making all experiments comparable.
 *
 * @purpose Create and manage immutable eval snapshots for reproducible experiments
 */

import { existsSync, readFileSync, mkdirSync, copyFileSync, chmodSync, readdirSync, statSync } from "fs"
import { join, dirname, basename, relative } from "path"
import { createHash } from "crypto"
import { spawn, spawnSync } from "child_process"
import { homedir } from "os"

// ============================================================================
// Types
// ============================================================================

export interface EvalSnapshot {
  hash: string               // SHA256 of script + data content
  scriptPath: string         // Original script path (relative to project)
  dataPath: string           // Original data path (relative to project)
  snapshotDir: string        // Absolute path to snapshot directory
  scriptSnapshot: string     // Absolute path to snapshotted script
  dataSnapshot: string       // Absolute path to snapshotted data
  createdAt: string          // ISO timestamp
  frozen: boolean            // Whether files are read-only
}

export interface EvalResult {
  metric: number             // Single scalar metric value
  raw_output?: string        // Raw output from eval script
  duration_ms: number        // Time to run eval
  success: boolean           // Whether eval completed without error
  error?: string             // Error message if failed
}

// ============================================================================
// Implementation
// ============================================================================

function computeFileHash(filePath: string): string {
  const content = readFileSync(filePath)
  return createHash("sha256").update(content).digest("hex")
}

function computeCombinedHash(scriptPath: string, dataPath: string): string {
  const scriptContent = readFileSync(scriptPath)
  const dataContent = readFileSync(dataPath)
  const combined = Buffer.concat([scriptContent, dataContent])
  return createHash("sha256").update(combined).digest("hex")
}

function getSnapshotCacheDir(): string {
  const cacheDir = join(homedir(), ".cache", "jfl", "eval-snapshots")
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
  }
  return cacheDir
}

export function createEvalSnapshot(
  projectRoot: string,
  evalScript: string,
  evalData: string
): EvalSnapshot {
  const scriptPath = join(projectRoot, evalScript)
  const dataPath = join(projectRoot, evalData)

  if (!existsSync(scriptPath)) {
    throw new Error(`Eval script not found: ${scriptPath}`)
  }
  if (!existsSync(dataPath)) {
    throw new Error(`Eval data not found: ${dataPath}`)
  }

  // Compute content-addressed hash
  const hash = computeCombinedHash(scriptPath, dataPath)

  // Create snapshot directory
  const cacheDir = getSnapshotCacheDir()
  const snapshotDir = join(cacheDir, hash)

  // If snapshot already exists, just return it
  if (existsSync(snapshotDir)) {
    const snapshot: EvalSnapshot = {
      hash,
      scriptPath: evalScript,
      dataPath: evalData,
      snapshotDir,
      scriptSnapshot: join(snapshotDir, basename(evalScript)),
      dataSnapshot: join(snapshotDir, basename(evalData)),
      createdAt: new Date().toISOString(),
      frozen: true,
    }
    return snapshot
  }

  // Create new snapshot
  mkdirSync(snapshotDir, { recursive: true })

  const scriptSnapshot = join(snapshotDir, basename(evalScript))
  const dataSnapshot = join(snapshotDir, basename(evalData))

  // Copy files to snapshot
  copyFileSync(scriptPath, scriptSnapshot)
  copyFileSync(dataPath, dataSnapshot)

  const snapshot: EvalSnapshot = {
    hash,
    scriptPath: evalScript,
    dataPath: evalData,
    snapshotDir,
    scriptSnapshot,
    dataSnapshot,
    createdAt: new Date().toISOString(),
    frozen: false,
  }

  return snapshot
}

export function freezeEvalSnapshot(snapshot: EvalSnapshot): void {
  if (snapshot.frozen) return

  // Make files read-only (0444)
  chmodSync(snapshot.scriptSnapshot, 0o444)
  chmodSync(snapshot.dataSnapshot, 0o444)
  snapshot.frozen = true
}

export function verifyEvalSnapshot(
  snapshot: EvalSnapshot,
  projectRoot: string
): { valid: boolean; reason?: string } {
  const scriptPath = join(projectRoot, snapshot.scriptPath)
  const dataPath = join(projectRoot, snapshot.dataPath)

  // Check if original files still exist
  if (!existsSync(scriptPath)) {
    return { valid: false, reason: `Original script no longer exists: ${snapshot.scriptPath}` }
  }
  if (!existsSync(dataPath)) {
    return { valid: false, reason: `Original data no longer exists: ${snapshot.dataPath}` }
  }

  // Check if content has changed
  const currentHash = computeCombinedHash(scriptPath, dataPath)
  if (currentHash !== snapshot.hash) {
    return {
      valid: false,
      reason: `Eval content changed since snapshot. Original: ${snapshot.hash.slice(0, 8)}, Current: ${currentHash.slice(0, 8)}`
    }
  }

  // Check if snapshot files still exist
  if (!existsSync(snapshot.scriptSnapshot)) {
    return { valid: false, reason: `Snapshot script missing: ${snapshot.scriptSnapshot}` }
  }
  if (!existsSync(snapshot.dataSnapshot)) {
    return { valid: false, reason: `Snapshot data missing: ${snapshot.dataSnapshot}` }
  }

  return { valid: true }
}

/**
 * Run the eval script and return the metric value.
 * The eval script should export a function: evaluate(dataPath: string) => Promise<number>
 */
export async function runEvalSnapshot(
  snapshot: EvalSnapshot,
  projectRoot: string,
  timeout: number = 120000
): Promise<EvalResult> {
  const startTime = Date.now()

  // Verify snapshot before running
  const verification = verifyEvalSnapshot(snapshot, projectRoot)
  if (!verification.valid) {
    return {
      metric: 0,
      duration_ms: Date.now() - startTime,
      success: false,
      error: verification.reason,
    }
  }

  return new Promise((resolve) => {
    // Detect eval script type: .sh = bash, .ts/.js = TypeScript/Node module
    const isShellScript = snapshot.scriptSnapshot.endsWith(".sh")

    console.error(`  [eval-debug] script=${snapshot.scriptSnapshot} cwd=${projectRoot} timeout=${timeout}ms`)

    let child
    if (isShellScript) {
      // Shell scripts: exec directly, expect JSON output with metric-name fields
      // Use 'ignore' for stdin to prevent hanging, pipe stdout/stderr for output
      child = spawn("bash", [snapshot.scriptSnapshot], {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
        detached: false,
        env: { ...process.env, EVAL_DATA_PATH: snapshot.dataSnapshot },
      })
    } else {
      // TypeScript/JS: import and call evaluate() function
      const evalRunner = `
        import { evaluate } from '${snapshot.scriptSnapshot}';
        const result = await evaluate('${snapshot.dataSnapshot}');
        console.log(JSON.stringify({ metric: result }));
      `
      child = spawn("npx", ["tsx", "-e", evalRunner], {
        cwd: projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
        timeout,
      })
    }

    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (data) => {
      stdout += data.toString()
    })

    child.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    const timeoutId = setTimeout(() => {
      child.kill("SIGKILL")
    }, timeout)

    child.on("exit", (code, signal) => {
      clearTimeout(timeoutId)
      const duration_ms = Date.now() - startTime
      console.error(`  [eval-debug] exit: code=${code} signal=${signal} duration=${duration_ms}ms stdout=${stdout.length}b stderr=${stderr.length}b`)
      if (stderr) console.error(`  [eval-debug] stderr: ${stderr.slice(0, 200)}`)

      if (code !== 0) {
        resolve({
          metric: 0,
          raw_output: stderr || stdout,
          duration_ms,
          success: false,
          error: `Eval exited with code ${code}: ${stderr}`,
        })
        return
      }

      try {
        // Find the JSON output line
        const lines = stdout.trim().split("\n")
        let metric = 0
        for (const line of lines) {
          if (line.startsWith("{")) {
            const parsed = JSON.parse(line)
            if (typeof parsed.metric === "number") {
              metric = parsed.metric
              break
            }
            // Shell scripts output metric by name (e.g. {"hub_crash_rate": 0.33})
            const numericValues = Object.values(parsed).filter((v): v is number => typeof v === "number")
            if (numericValues.length > 0 && metric === 0) {
              metric = numericValues[0]
              break
            }
          }
        }

        resolve({
          metric,
          raw_output: stdout,
          duration_ms,
          success: true,
        })
      } catch (err: any) {
        resolve({
          metric: 0,
          raw_output: stdout,
          duration_ms,
          success: false,
          error: `Failed to parse eval output: ${err.message}`,
        })
      }
    })

    child.on("error", (err) => {
      clearTimeout(timeoutId)
      resolve({
        metric: 0,
        duration_ms: Date.now() - startTime,
        success: false,
        error: `Failed to spawn eval process: ${err.message}`,
      })
    })
  })
}

/**
 * Alternative: Run eval via Jest or other test runners
 */
export async function runJestEval(
  projectRoot: string,
  testPattern?: string
): Promise<EvalResult> {
  const startTime = Date.now()

  return new Promise((resolve) => {
    const args = ["jest", "--json", "--silent"]
    if (testPattern) {
      args.push(testPattern)
    }

    const result = spawnSync("npx", args, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 120000,
    })

    const duration_ms = Date.now() - startTime

    try {
      const json = JSON.parse(result.stdout || "{}")
      const passed = json.numPassedTests || 0
      const total = json.numTotalTests || 1
      const passRate = total > 0 ? passed / total : 0

      resolve({
        metric: passRate,
        raw_output: result.stdout,
        duration_ms,
        success: result.status === 0,
        error: result.status !== 0 ? `Jest exited with code ${result.status}` : undefined,
      })
    } catch {
      resolve({
        metric: 0,
        raw_output: result.stdout + result.stderr,
        duration_ms,
        success: false,
        error: "Failed to parse Jest output",
      })
    }
  })
}

// ============================================================================
// Snapshot Management
// ============================================================================

export function listEvalSnapshots(): Array<{ hash: string; createdAt: string; size: number }> {
  const cacheDir = getSnapshotCacheDir()
  if (!existsSync(cacheDir)) return []

  const snapshots: Array<{ hash: string; createdAt: string; size: number }> = []

  for (const entry of readdirSync(cacheDir)) {
    const snapshotDir = join(cacheDir, entry)
    const stat = statSync(snapshotDir)
    if (stat.isDirectory()) {
      snapshots.push({
        hash: entry,
        createdAt: stat.mtime.toISOString(),
        size: stat.size,
      })
    }
  }

  return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function cleanupOldSnapshots(maxAge: number = 30 * 24 * 60 * 60 * 1000): number {
  const cacheDir = getSnapshotCacheDir()
  if (!existsSync(cacheDir)) return 0

  const now = Date.now()
  let cleaned = 0

  for (const entry of readdirSync(cacheDir)) {
    const snapshotDir = join(cacheDir, entry)
    const stat = statSync(snapshotDir)
    if (stat.isDirectory() && now - stat.mtime.getTime() > maxAge) {
      // Remove old snapshot (recursive)
      const { rmSync } = require("fs")
      rmSync(snapshotDir, { recursive: true, force: true })
      cleaned++
    }
  }

  return cleaned
}
