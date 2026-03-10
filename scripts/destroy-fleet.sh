#!/usr/bin/env bash
# destroy-fleet.sh — Tear down all VMs in a wave
#
# Usage:
#   ./scripts/destroy-fleet.sh [WAVE_ID]
#
# Stops and deletes all agent-WAVEID-* VMs.
# Run collect-tuples.sh FIRST to save training data.

set -euo pipefail

WAVE_ID=${1:-""}

if [ -z "${WAVE_ID}" ]; then
  echo "Usage: ./scripts/destroy-fleet.sh <WAVE_ID>"
  echo ""
  echo "Active waves:"
  prlctl list -a 2>/dev/null | grep "agent-" | sed 's/.*agent-\([0-9]*\)-.*/  \1/' | sort -u
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Destroying fleet — Wave ${WAVE_ID}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

DESTROYED=0
for vm in $(prlctl list -a 2>/dev/null | grep "agent-${WAVE_ID}-" | awk '{print $1}'); do
  echo -n "  [${vm}] "
  prlctl stop "${vm}" --kill 2>/dev/null || true
  prlctl delete "${vm}" 2>/dev/null || true
  echo "destroyed"
  DESTROYED=$((DESTROYED + 1))
done

echo ""
echo "  Destroyed ${DESTROYED} VMs"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
