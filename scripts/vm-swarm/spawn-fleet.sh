#!/bin/bash
#
# spawn-fleet.sh — Spawn a fleet of agent VMs from base template
#
# Clones the base template N times and runs specified task type in each.
#
# Usage:
#   ./spawn-fleet.sh [count] [template] [task-type]
#   ./spawn-fleet.sh 5 jfl-agent-base autoresearch
#   ./spawn-fleet.sh 3 jfl-agent-base fuzz
#   ./spawn-fleet.sh 2 jfl-agent-base eval
#
# Task types:
#   autoresearch - Each VM gets a different repo/service to research
#   fuzz         - Each VM runs a different fuzz test suite
#   eval         - Each VM runs evaluation with different parameters
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_ROOT/.jfl/vm-fleet"

# Defaults
DEFAULT_COUNT=5
DEFAULT_TEMPLATE="jfl-agent-base"
DEFAULT_TASK="autoresearch"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
success() { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠${NC} $1"; }
error() { echo -e "${RED}[$(date '+%H:%M:%S')] ✗${NC} $1"; exit 1; }

# Parse arguments
COUNT="${1:-$DEFAULT_COUNT}"
TEMPLATE="${2:-$DEFAULT_TEMPLATE}"
TASK_TYPE="${3:-$DEFAULT_TASK}"

# Autoresearch targets (different repos/services for each VM)
AUTORESEARCH_TARGETS=(
    "jfl-cli:src/commands"
    "jfl-cli:src/lib"
    "jfl-platform:packages/memory"
    "jfl-platform:packages/eval"
    "jfl-template:knowledge"
)

# Fuzz test suites (different tests for each VM)
FUZZ_SUITES=(
    "fuzz-scope"
    "fuzz-events"
    "fuzz-training"
    "fuzz-hub-api"
)

# Eval configurations
EVAL_CONFIGS=(
    "default"
    "quality-first"
    "cost-optimized"
)

check_prerequisites() {
    if ! command -v prlctl &> /dev/null; then
        error "prlctl not found. Install Parallels Desktop Pro."
    fi

    if ! prlctl list --all | grep -q "$TEMPLATE"; then
        error "Template '$TEMPLATE' not found. Run create-base-template.sh first."
    fi
}

create_log_dir() {
    mkdir -p "$LOG_DIR"
    # Create timestamp file for this fleet run
    echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "$LOG_DIR/fleet-started"
}

clone_vm() {
    local index=$1
    local vm_name="jfl-agent-${index}"

    log "Creating VM: $vm_name"

    # Check if VM already exists
    if prlctl list --all | grep -q "$vm_name"; then
        warn "VM $vm_name exists, stopping and deleting..."
        prlctl stop "$vm_name" --kill 2>/dev/null || true
        sleep 2
        prlctl delete "$vm_name" 2>/dev/null || true
    fi

    # Clone from template (linked clone for speed)
    prlctl clone "$TEMPLATE" --name "$vm_name" --linked

    success "Created $vm_name"
}

start_vm() {
    local vm_name=$1

    log "Starting VM: $vm_name"
    prlctl start "$vm_name"

    # Wait for VM to be ready
    local max_wait=60
    local waited=0
    while [[ $waited -lt $max_wait ]]; do
        if prlctl exec "$vm_name" echo "ready" &> /dev/null; then
            success "VM $vm_name is ready"
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
    done

    warn "VM $vm_name may not be fully ready"
}

run_task_in_vm() {
    local vm_name=$1
    local index=$2
    local log_file="$LOG_DIR/vm-${index}.log"

    log "Starting task '$TASK_TYPE' in $vm_name"

    case "$TASK_TYPE" in
        autoresearch)
            run_autoresearch "$vm_name" "$index" "$log_file"
            ;;
        fuzz)
            run_fuzz "$vm_name" "$index" "$log_file"
            ;;
        eval)
            run_eval "$vm_name" "$index" "$log_file"
            ;;
        *)
            error "Unknown task type: $TASK_TYPE"
            ;;
    esac
}

run_autoresearch() {
    local vm_name=$1
    local index=$2
    local log_file=$3

    # Get target for this VM (cycle through targets)
    local target_index=$((index % ${#AUTORESEARCH_TARGETS[@]}))
    local target="${AUTORESEARCH_TARGETS[$target_index]}"
    local repo="${target%%:*}"
    local focus="${target##*:}"

    log "VM $index: autoresearch on $repo ($focus)"

    # Run autoresearch in background inside VM
    prlctl exec "$vm_name" /bin/bash -c "
        export PATH=\"\$PATH:/opt/homebrew/bin\"
        cd /workspace/$repo

        # Run autoresearch with the focus area
        nohup jfl autoresearch --focus '$focus' \
            > /workspace/autoresearch-$index.log 2>&1 &
        echo \$! > /workspace/autoresearch-$index.pid

        echo 'Autoresearch started for $repo ($focus)'
    " > "$log_file" 2>&1 &

    echo "$vm_name:$target:$!" >> "$LOG_DIR/running-tasks"
}

run_fuzz() {
    local vm_name=$1
    local index=$2
    local log_file=$3

    # Get fuzz suite for this VM
    local suite_index=$((index % ${#FUZZ_SUITES[@]}))
    local suite="${FUZZ_SUITES[$suite_index]}"

    log "VM $index: running fuzz suite '$suite'"

    prlctl exec "$vm_name" /bin/bash -c "
        export PATH=\"\$PATH:/opt/homebrew/bin\"
        cd /workspace/jfl-cli

        # Run specific fuzz test suite
        nohup npx jest --testPathPattern='$suite' --silent \
            > /workspace/fuzz-$index.log 2>&1 &
        echo \$! > /workspace/fuzz-$index.pid

        echo 'Fuzz suite $suite started'
    " > "$log_file" 2>&1 &

    echo "$vm_name:fuzz:$suite:$!" >> "$LOG_DIR/running-tasks"
}

run_eval() {
    local vm_name=$1
    local index=$2
    local log_file=$3

    # Get eval config for this VM
    local config_index=$((index % ${#EVAL_CONFIGS[@]}))
    local config="${EVAL_CONFIGS[$config_index]}"

    log "VM $index: running eval with config '$config'"

    prlctl exec "$vm_name" /bin/bash -c "
        export PATH=\"\$PATH:/opt/homebrew/bin\"
        cd /workspace/jfl-cli

        # Run evaluation
        nohup jfl eval run --profile '$config' \
            > /workspace/eval-$index.log 2>&1 &
        echo \$! > /workspace/eval-$index.pid

        echo 'Eval started with profile $config'
    " > "$log_file" 2>&1 &

    echo "$vm_name:eval:$config:$!" >> "$LOG_DIR/running-tasks"
}

print_summary() {
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    success "Fleet spawned successfully!"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "VMs started: $COUNT"
    echo "Template:    $TEMPLATE"
    echo "Task type:   $TASK_TYPE"
    echo "Log dir:     $LOG_DIR"
    echo ""
    echo "Running VMs:"

    for i in $(seq 1 "$COUNT"); do
        local vm_name="jfl-agent-${i}"
        local status
        status=$(prlctl status "$vm_name" 2>/dev/null | grep -o 'running\|stopped' || echo "unknown")
        echo "  • $vm_name: $status"
    done

    echo ""
    echo "Commands:"
    echo "  Monitor:  ./monitor-fleet.sh"
    echo "  Collect:  ./collect-tuples.sh"
    echo "  Kill:     ./kill-fleet.sh"
    echo ""
    echo "View logs:"
    echo "  tail -f $LOG_DIR/vm-1.log"
    echo ""
}

main() {
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  JFL Agent Fleet Spawner"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "Count:    $COUNT"
    echo "Template: $TEMPLATE"
    echo "Task:     $TASK_TYPE"
    echo ""

    check_prerequisites
    create_log_dir

    # Clear previous running tasks
    rm -f "$LOG_DIR/running-tasks"
    touch "$LOG_DIR/running-tasks"

    # Clone and start each VM
    for i in $(seq 1 "$COUNT"); do
        clone_vm "$i"
    done

    echo ""

    # Start VMs (can be parallelized)
    for i in $(seq 1 "$COUNT"); do
        start_vm "jfl-agent-${i}"
    done

    echo ""

    # Run tasks in each VM
    for i in $(seq 1 "$COUNT"); do
        run_task_in_vm "jfl-agent-${i}" "$i"
    done

    print_summary
}

main
