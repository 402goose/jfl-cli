#!/usr/bin/env bash
#
# Build Quality Eval Script
#
# Measures TypeScript type errors and test pass rate.
# Returns: quality_score = (1 / (1 + type_errors)) * test_pass_rate
#
# @purpose Eval script for build quality measurement (type safety + tests)

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
cd "$PROJECT_ROOT"

# Count TypeScript type errors
type_errors=0
tsc_output=$(npx tsc --noEmit 2>&1 || true)
if [[ -n "$tsc_output" ]]; then
  type_errors=$(echo "$tsc_output" | grep -c "error TS" || echo "0")
fi

# Run tests and get results
test_passed=0
test_total=1
test_output=$(npx jest --json --silent 2>/dev/null || echo '{}')

if [[ -n "$test_output" && "$test_output" != "{}" ]]; then
  test_passed=$(echo "$test_output" | jq -r '.numPassedTests // 0')
  test_total=$(echo "$test_output" | jq -r '.numTotalTests // 1')
fi

# Avoid division by zero
if [[ $test_total -eq 0 ]]; then
  test_total=1
fi

# Calculate metrics
# type_error_score = 1 / (1 + type_errors)
# test_pass_rate = passed / total
# quality_score = type_error_score * test_pass_rate

# Use awk for floating point math
quality_score=$(awk "BEGIN {
  type_error_score = 1 / (1 + $type_errors)
  test_pass_rate = $test_passed / $test_total
  quality = type_error_score * test_pass_rate
  printf \"%.6f\", quality
}")

# Output JSON for parsing
echo "{\"quality_score\": $quality_score, \"type_errors\": $type_errors, \"test_passed\": $test_passed, \"test_total\": $test_total}"
