#!/usr/bin/env bash
# collect-tuples.sh — Pull training data from all VMs in a wave
#
# Usage:
#   ./scripts/collect-tuples.sh [WAVE_ID]
#
# Collects from each agent VM:
#   - training-buffer.jsonl (RL tuples)
#   - eval.jsonl (eval results)
#   - journal/ (experiment logs)
#
# Merges all tuples into a single buffer and optionally retrains policy head.

set -euo pipefail

WAVE_ID=${1:-$(prlctl list -a 2>/dev/null | grep "agent-" | head -1 | sed 's/.*agent-\([0-9]*\)-.*/\1/' || echo "")}

if [ -z "${WAVE_ID}" ]; then
  echo "Usage: ./scripts/collect-tuples.sh <WAVE_ID>"
  echo "  or ensure agent VMs are running (agent-WAVEID-N)"
  exit 1
fi

TUPLES_DIR="/tmp/jfl-fleet-${WAVE_ID}/tuples"
mkdir -p "${TUPLES_DIR}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Collecting tuples — Wave ${WAVE_ID}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

COLLECTED=0
TOTAL_TUPLES=0

for vm in $(prlctl list -a --json 2>/dev/null | python3 -c "import sys,json; [print(v['name']) for v in json.load(sys.stdin) if v['name'].startswith('agent-${WAVE_ID}-')]" 2>/dev/null); do
  echo -n "  [${vm}] "

  # Check if VM is running
  STATUS=$(prlctl status "${vm}" 2>/dev/null | grep -o "running\|stopped" || echo "unknown")
  if [ "${STATUS}" != "running" ] && [ "${STATUS}" != "stopped" ]; then
    echo "SKIP (${STATUS})"
    continue
  fi

  # Copy training tuples
  prlctl copy-from "${vm}" \
    /tmp/workspace/.jfl/training-buffer.jsonl \
    "${TUPLES_DIR}/${vm}-tuples.jsonl" 2>/dev/null || true

  # Copy eval results
  prlctl copy-from "${vm}" \
    /tmp/workspace/.jfl/eval.jsonl \
    "${TUPLES_DIR}/${vm}-evals.jsonl" 2>/dev/null || true

  # Copy journals
  mkdir -p "${TUPLES_DIR}/${vm}-journals"
  prlctl copy-from "${vm}" \
    /tmp/workspace/.jfl/journal/ \
    "${TUPLES_DIR}/${vm}-journals/" 2>/dev/null || true

  # Copy autoresearch log
  prlctl copy-from "${vm}" \
    /tmp/autoresearch.log \
    "${TUPLES_DIR}/${vm}-autoresearch.log" 2>/dev/null || true

  if [ -f "${TUPLES_DIR}/${vm}-tuples.jsonl" ]; then
    COUNT=$(wc -l < "${TUPLES_DIR}/${vm}-tuples.jsonl" | tr -d ' ')
    TOTAL_TUPLES=$((TOTAL_TUPLES + COUNT))
    echo "${COUNT} tuples"
  else
    echo "no tuples"
  fi

  COLLECTED=$((COLLECTED + 1))
done

# Merge all tuples
MERGED="${TUPLES_DIR}/merged.jsonl"
cat "${TUPLES_DIR}"/*-tuples.jsonl 2>/dev/null | sort -u > "${MERGED}" || true
MERGED_COUNT=$(wc -l < "${MERGED}" 2>/dev/null | tr -d ' ' || echo "0")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Collected from ${COLLECTED} VMs"
echo "  Total tuples: ${TOTAL_TUPLES} (${MERGED_COUNT} unique)"
echo "  Merged file: ${MERGED}"
echo ""

# Append to local training buffer
if [ "${MERGED_COUNT}" -gt 0 ]; then
  LOCAL_BUFFER=".jfl/training-buffer.jsonl"
  BEFORE=$(wc -l < "${LOCAL_BUFFER}" 2>/dev/null | tr -d ' ' || echo "0")

  # Dedup: only append tuples with IDs not already in local buffer
  if [ -f "${LOCAL_BUFFER}" ]; then
    EXISTING_IDS=$(grep -o '"id":"[^"]*"' "${LOCAL_BUFFER}" | sort -u)
    while IFS= read -r line; do
      TUPLE_ID=$(echo "${line}" | grep -o '"id":"[^"]*"' || echo "")
      if ! echo "${EXISTING_IDS}" | grep -qF "${TUPLE_ID}"; then
        echo "${line}" >> "${LOCAL_BUFFER}"
      fi
    done < "${MERGED}"
  else
    cat "${MERGED}" >> "${LOCAL_BUFFER}"
  fi

  AFTER=$(wc -l < "${LOCAL_BUFFER}" | tr -d ' ')
  NEW=$((AFTER - BEFORE))

  echo "  Appended ${NEW} new tuples to ${LOCAL_BUFFER}"
  echo "  Total local buffer: ${AFTER} tuples"

  # Check if retrain is warranted
  TRAINED_ON=$(python3 -c "import json; print(json.load(open('.jfl/policy-weights.json'))['trained_on'])" 2>/dev/null || echo "0")
  DELTA=$((AFTER - TRAINED_ON))

  if [ "${DELTA}" -ge 20 ]; then
    echo ""
    echo "  ${DELTA} new tuples since last train (threshold: 20)"
    echo "  Retrain: python3 scripts/train-policy-head.py --epochs 200"
  fi
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
