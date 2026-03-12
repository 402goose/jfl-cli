#!/bin/bash
#
# kill-fleet.sh — Stop and optionally delete fleet VMs
#
# Stops all jfl-agent-* VMs. Optionally deletes clones (keeps template).
#
# Usage:
#   ./kill-fleet.sh              # Stop all VMs
#   ./kill-fleet.sh --delete     # Stop and delete all clones
#   ./kill-fleet.sh --force      # Force kill (--kill flag)
#   ./kill-fleet.sh --collect    # Collect tuples before killing
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_ROOT/.jfl/vm-fleet"

# Options
DELETE_CLONES=false
FORCE_KILL=false
COLLECT_FIRST=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
success() { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠${NC} $1"; }
error() { echo -e "${RED}[$(date '+%H:%M:%S')] ✗${NC} $1"; }

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --delete|-d)
            DELETE_CLONES=true
            shift
            ;;
        --force|-f)
            FORCE_KILL=true
            shift
            ;;
        --collect|-c)
            COLLECT_FIRST=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --delete, -d    Delete clones after stopping (keeps template)"
            echo "  --force, -f     Force kill VMs (use --kill flag)"
            echo "  --collect, -c   Collect training tuples before killing"
            echo ""
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Get all agent VMs (not the template)
get_all_agent_vms() {
    prlctl list --all -o name 2>/dev/null | grep 'jfl-agent-[0-9]' | sort -V
}

# Stop a VM
stop_vm() {
    local vm_name=$1

    local status
    status=$(prlctl status "$vm_name" 2>/dev/null | grep -o 'running\|stopped\|suspended' || echo "unknown")

    if [[ "$status" == "stopped" ]]; then
        log "$vm_name already stopped"
        return
    fi

    log "Stopping $vm_name..."

    if [[ "$FORCE_KILL" == true ]]; then
        prlctl stop "$vm_name" --kill 2>/dev/null || true
    else
        prlctl stop "$vm_name" 2>/dev/null || {
            warn "Graceful stop failed, force killing..."
            prlctl stop "$vm_name" --kill 2>/dev/null || true
        }
    fi

    success "$vm_name stopped"
}

# Delete a VM
delete_vm() {
    local vm_name=$1

    log "Deleting $vm_name..."

    # Make sure it's stopped
    prlctl stop "$vm_name" --kill 2>/dev/null || true

    # Delete
    if prlctl delete "$vm_name" 2>/dev/null; then
        success "$vm_name deleted"
    else
        warn "Failed to delete $vm_name"
    fi
}

# Collect tuples before killing
collect_tuples() {
    log "Collecting tuples before shutdown..."

    if [[ -x "$SCRIPT_DIR/collect-tuples.sh" ]]; then
        "$SCRIPT_DIR/collect-tuples.sh"
    else
        warn "collect-tuples.sh not found or not executable"
    fi
}

main() {
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  JFL Fleet Terminator"
    echo "═══════════════════════════════════════════════════════════"
    echo ""

    local vms
    vms=$(get_all_agent_vms)

    if [[ -z "$vms" ]]; then
        log "No jfl-agent VMs found"
        exit 0
    fi

    local vm_count
    vm_count=$(echo "$vms" | wc -l | tr -d ' ')

    log "Found $vm_count agent VMs:"
    echo "$vms" | sed 's/^/  • /'
    echo ""

    # Confirm if deleting
    if [[ "$DELETE_CLONES" == true ]]; then
        warn "This will DELETE all $vm_count agent VMs!"
        read -p "Are you sure? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log "Aborted"
            exit 0
        fi
    fi

    # Collect tuples if requested
    if [[ "$COLLECT_FIRST" == true ]]; then
        collect_tuples
        echo ""
    fi

    # Stop/delete each VM
    while IFS= read -r vm_name; do
        [[ -n "$vm_name" ]] || continue

        stop_vm "$vm_name"

        if [[ "$DELETE_CLONES" == true ]]; then
            sleep 1  # Brief pause between operations
            delete_vm "$vm_name"
        fi

    done <<< "$vms"

    # Clean up log files if deleting
    if [[ "$DELETE_CLONES" == true ]]; then
        log "Cleaning up log files..."
        rm -f "$LOG_DIR"/vm-*.log
        rm -f "$LOG_DIR/running-tasks"
        rm -f "$LOG_DIR/fleet-started"
    fi

    echo ""
    echo "═══════════════════════════════════════════════════════════"
    if [[ "$DELETE_CLONES" == true ]]; then
        success "All agent VMs stopped and deleted"
    else
        success "All agent VMs stopped"
        echo ""
        echo "VMs are preserved. To delete them:"
        echo "  $0 --delete"
    fi
    echo ""
    echo "Template 'jfl-agent-base' is preserved."
    echo "═══════════════════════════════════════════════════════════"
    echo ""
}

main
