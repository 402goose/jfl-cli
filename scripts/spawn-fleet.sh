#!/usr/bin/env bash
# spawn-fleet.sh — Spin up N agent VMs from template for parallel autoresearch
#
# Usage:
#   ./scripts/spawn-fleet.sh [FLEET_SIZE] [TARGET_REPO]
#
# Prerequisites:
#   - Parallels Desktop Pro (prlctl)
#   - Base VM "pi-base" with snapshot "clean-install"
#   - hv_apple_isa_vm_quota=255 boot arg (for >2 VMs)
#
# Each VM gets:
#   - Latest policy weights from .jfl/policy-weights.json
#   - Agent identity config
#   - Runs jfl peter autoresearch --rounds 5 autonomously

set -euo pipefail

FLEET_SIZE=${1:-5}
TARGET_REPO=${2:-$(git remote get-url origin 2>/dev/null || echo "")}
WAVE_ID=$(date +%s)
WEIGHTS_PATH=".jfl/policy-weights.json"
BASE_VM="pi-base"
SNAPSHOT="clean-install"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  JFL Agent Fleet — Wave ${WAVE_ID}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Fleet size: ${FLEET_SIZE}"
echo "  Target repo: ${TARGET_REPO}"
echo "  Base VM: ${BASE_VM}"
echo ""

# Verify prlctl
if ! command -v prlctl &>/dev/null; then
  echo "ERROR: prlctl not found. Install Parallels Desktop Pro."
  exit 1
fi

# Verify base VM exists
if ! prlctl list -a 2>/dev/null | grep -q "${BASE_VM}"; then
  echo "ERROR: Base VM '${BASE_VM}' not found."
  echo ""
  echo "Create it:"
  echo "  prlctl create '${BASE_VM}' --ostype macos --dist macos-tahoe"
  echo "  prlctl set '${BASE_VM}' --memsize 2048 --cpus 2"
  echo "  prlctl start '${BASE_VM}'"
  echo "  # Install: brew, node, git, jfl, ralph-tui"
  echo "  prlctl stop '${BASE_VM}'"
  echo "  prlctl snapshot '${BASE_VM}' --name '${SNAPSHOT}'"
  exit 1
fi

# Create shared directories
SHARED_DIR="/tmp/jfl-fleet-${WAVE_ID}"
mkdir -p "${SHARED_DIR}/tuples" "${SHARED_DIR}/config"

# Copy policy weights if they exist
if [ -f "${WEIGHTS_PATH}" ]; then
  cp "${WEIGHTS_PATH}" "${SHARED_DIR}/config/policy-weights.json"
  TRAINED_ON=$(python3 -c "import json; print(json.load(open('${WEIGHTS_PATH}'))['trained_on'])" 2>/dev/null || echo "?")
  echo "  Policy weights: trained on ${TRAINED_ON} tuples"
else
  echo "  No policy weights — agents will use heuristic selection"
fi

echo ""

# Spawn VMs
STARTED=0
for i in $(seq 1 "${FLEET_SIZE}"); do
  AGENT_NAME="agent-${WAVE_ID}-${i}"

  echo -n "  [${i}/${FLEET_SIZE}] Spawning ${AGENT_NAME}..."

  # Clone from template (linked clone = fast, CoW)
  if ! prlctl clone "${BASE_VM}" --name "${AGENT_NAME}" --linked --snapshot "${SNAPSHOT}" 2>/dev/null; then
    echo " FAILED (clone)"
    continue
  fi

  # Configure VM
  prlctl set "${AGENT_NAME}" --memsize 2048 --cpus 2 2>/dev/null

  # Start VM
  if ! prlctl start "${AGENT_NAME}" 2>/dev/null; then
    echo " FAILED (start)"
    prlctl delete "${AGENT_NAME}" 2>/dev/null || true
    continue
  fi

  # Wait for VM to boot
  sleep 5

  # Inject agent config
  prlctl exec "${AGENT_NAME}" -- bash -c "
    mkdir -p /tmp/agent-config
    cat > /tmp/agent-config/identity.json << EOF
{
  \"agent_id\": \"${AGENT_NAME}\",
  \"wave_id\": \"${WAVE_ID}\",
  \"fleet_index\": ${i},
  \"fleet_size\": ${FLEET_SIZE},
  \"target_repo\": \"${TARGET_REPO}\"
}
EOF
  " 2>/dev/null

  # Copy policy weights if available
  if [ -f "${SHARED_DIR}/config/policy-weights.json" ]; then
    prlctl copy-to "${AGENT_NAME}" \
      "${SHARED_DIR}/config/policy-weights.json" \
      /tmp/agent-config/policy-weights.json 2>/dev/null || true
  fi

  # Launch autoresearch inside VM
  prlctl exec "${AGENT_NAME}" -- bash -c "
    cd /tmp && git clone '${TARGET_REPO}' workspace 2>/dev/null
    cd /tmp/workspace

    # Load policy weights
    mkdir -p .jfl
    cp /tmp/agent-config/policy-weights.json .jfl/policy-weights.json 2>/dev/null || true
    cp /tmp/agent-config/identity.json .jfl/agent-identity.json

    # Run autoresearch (detached so exec returns)
    nohup jfl peter autoresearch --rounds 5 > /tmp/autoresearch.log 2>&1 &
    echo \$! > /tmp/autoresearch.pid
  " 2>/dev/null &

  STARTED=$((STARTED + 1))
  echo " OK"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Fleet started: ${STARTED}/${FLEET_SIZE} agents"
echo "  Wave ID: ${WAVE_ID}"
echo "  Shared dir: ${SHARED_DIR}"
echo ""
echo "  Collect tuples:  ./scripts/collect-tuples.sh ${WAVE_ID}"
echo "  Monitor:         prlctl list -a | grep agent-${WAVE_ID}"
echo "  Destroy fleet:   ./scripts/destroy-fleet.sh ${WAVE_ID}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
