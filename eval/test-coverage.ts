/**
 * Test Coverage Eval
 *
 * Evaluates test coverage by running Jest and counting passing tests.
 *
 * @purpose Eval script for test-coverage agent - returns test_pass_count metric
 */

import { spawnSync } from "child_process"
import { readFileSync } from "fs"

interface JestResult {
  numPassedTests: number
  numFailedTests: number
  numTotalTests: number
  success: boolean
}

export async function evaluate(dataPath: string): Promise<number> {
  // Run Jest with JSON output
  const result = spawnSync("npx", ["jest", "--json", "--silent", "--passWithNoTests"], {
    cwd: process.cwd(),
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 120000,
  })

  try {
    const output = result.stdout || "{}"
    const json: JestResult = JSON.parse(output)

    // Metric: number of passing tests
    // This rewards both fixing failing tests AND adding new passing tests
    return json.numPassedTests || 0
  } catch {
    // If Jest fails to parse, return 0
    return 0
  }
}

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const dataPath = process.argv[2] || ""
  evaluate(dataPath).then(metric => {
    console.log(JSON.stringify({ metric }))
  })
}
