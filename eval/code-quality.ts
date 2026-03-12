/**
 * Code Quality Eval
 *
 * Evaluates code quality by running TypeScript compiler and counting errors.
 * Returns inverse: 1 / (1 + errors) so higher is better.
 *
 * @purpose Eval script for code-quality agent - returns tsc_errors_inverse metric
 */

import { spawnSync } from "child_process"

export async function evaluate(dataPath: string): Promise<number> {
  // Run tsc with noEmit to check for errors
  const result = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 120000,
  })

  // Count error lines
  const output = (result.stdout || "") + (result.stderr || "")
  const errorLines = output.split("\n").filter(line =>
    line.includes(": error TS") || line.includes("error TS")
  )

  const errorCount = errorLines.length

  // Metric: inverse of errors (1 / (1 + errors))
  // 0 errors → 1.0
  // 1 error → 0.5
  // 9 errors → 0.1
  // This makes higher scores better and gives diminishing returns to error reduction
  return 1 / (1 + errorCount)
}

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const dataPath = process.argv[2] || ""
  evaluate(dataPath).then(metric => {
    console.log(JSON.stringify({ metric }))
  })
}
