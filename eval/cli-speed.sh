#!/usr/bin/env bash
#
# CLI Speed Eval Script
#
# Measures average command execution time across key JFL CLI commands.
# Returns: avg_ms (lower is better)
#
# @purpose Eval script for CLI performance measurement

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
RUNS=3

# Commands to time (fast commands that don't require external services)
COMMANDS=(
  "jfl status"
  "jfl hud --compact"
  "jfl context-hub status"
  "jfl telemetry status"
)

total_ms=0
count=0

for cmd in "${COMMANDS[@]}"; do
  for ((i=1; i<=RUNS; i++)); do
    # Time the command (suppress output)
    start_ns=$(date +%s%N)
    eval "$cmd" >/dev/null 2>&1 || true
    end_ns=$(date +%s%N)

    # Calculate duration in ms
    duration_ns=$((end_ns - start_ns))
    duration_ms=$((duration_ns / 1000000))

    total_ms=$((total_ms + duration_ms))
    count=$((count + 1))
  done
done

# Calculate average
if [[ $count -gt 0 ]]; then
  avg_ms=$((total_ms / count))
else
  avg_ms=9999
fi

# Output JSON for parsing
echo "{\"avg_ms\": $avg_ms, \"runs\": $count, \"total_ms\": $total_ms}"
