#!/usr/bin/env bash
#
# Bundle Efficiency Eval Script
#
# Measures the size of the built dist/ directory after npm run build.
# Returns: inverse_bytes = 1 / bytes (smaller is better, so inverse is higher)
#
# @purpose Eval script for bundle size efficiency measurement

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
cd "$PROJECT_ROOT"

# Build the project
npm run build >/dev/null 2>&1 || true

# Measure dist/ size in bytes
if [[ -d "dist" ]]; then
  # Total size in bytes
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - use stat
    bytes=$(find dist -type f -exec stat -f%z {} + 2>/dev/null | awk '{sum+=$1} END {print sum}')
  else
    # Linux - use du
    bytes=$(du -sb dist 2>/dev/null | cut -f1)
  fi
else
  bytes=999999999
fi

# Ensure bytes is a number
if [[ -z "$bytes" || ! "$bytes" =~ ^[0-9]+$ ]]; then
  bytes=999999999
fi

# Calculate inverse (use awk for floating point)
# Multiply by 1000000 to get a reasonable scale
inverse_bytes=$(awk "BEGIN { printf \"%.10f\", 1000000.0 / $bytes }")

# Also calculate MB for readability
mb=$(awk "BEGIN { printf \"%.2f\", $bytes / 1048576 }")

# Output JSON for parsing
echo "{\"inverse_bytes\": $inverse_bytes, \"bytes\": $bytes, \"mb\": $mb}"
