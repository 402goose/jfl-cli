#!/bin/bash
#
# monitor-fleet.sh — Monitor status of running agent fleet
#
# Shows status, current task, and scores for each VM in the fleet.
# Can run in continuous mode for live monitoring.
#
# Usage:
#   ./monitor-fleet.sh              # One-time status check
#   ./monitor-fleet.sh --watch      # Continuous monitoring (2s refresh)
#   ./monitor-fleet.sh --watch 5    # Custom refresh interval
#   ./monitor-fleet.sh --verbose    # Show more details per VM
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_ROOT/.jfl/vm-fleet"

# Options
WATCH_MODE=false
REFRESH_INTERVAL=2
VERBOSE=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --watch|-w)
            WATCH_MODE=true
            if [[ "${2:-}" =~ ^[0-9]+$ ]]; then
                REFRESH_INTERVAL="$2"
                shift
            fi
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --watch, -w [seconds]  Continuous monitoring (default: 2s)"
            echo "  --verbose, -v          Show more details per VM"
            echo ""
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Get all agent VMs (running and stopped)
get_all_vms() {
    prlctl list --all -o name,status 2>/dev/null | grep 'jfl-agent-' | sort -V
}

# Get VM status
get_vm_status() {
    local vm_name=$1
    prlctl status "$vm_name" 2>/dev/null | grep -oE 'running|stopped|suspended|paused' || echo "unknown"
}

# Get task info from running tasks file
get_task_info() {
    local vm_name=$1

    if [[ -f "$LOG_DIR/running-tasks" ]]; then
        grep "^$vm_name:" "$LOG_DIR/running-tasks" 2>/dev/null | cut -d: -f2- | head -1
    else
        echo "-"
    fi
}

# Get latest score/progress from VM
get_vm_score() {
    local vm_name=$1
    local status=$2

    if [[ "$status" != "running" ]]; then
        echo "-"
        return
    fi

    # Try to get score from training buffer or eval results
    local score
    score=$(prlctl exec "$vm_name" /bin/bash -c '
        if [[ -f /workspace/jfl-cli/.jfl/training-buffer.jsonl ]]; then
            tail -1 /workspace/jfl-cli/.jfl/training-buffer.jsonl 2>/dev/null | \
                grep -oE "composite_delta\":[0-9.-]+" | cut -d: -f2 | head -1
        fi
    ' 2>/dev/null || echo "")

    if [[ -n "$score" ]]; then
        echo "$score"
    else
        echo "-"
    fi
}

# Get tuple count from VM
get_tuple_count() {
    local vm_name=$1
    local status=$2

    if [[ "$status" != "running" ]]; then
        echo "-"
        return
    fi

    local count
    count=$(prlctl exec "$vm_name" /bin/bash -c '
        if [[ -f /workspace/jfl-cli/.jfl/training-buffer.jsonl ]]; then
            wc -l < /workspace/jfl-cli/.jfl/training-buffer.jsonl 2>/dev/null | tr -d " "
        else
            echo "0"
        fi
    ' 2>/dev/null || echo "0")

    echo "$count"
}

# Get process status in VM
get_process_status() {
    local vm_name=$1

    prlctl exec "$vm_name" /bin/bash -c '
        # Check for running jfl/node processes
        procs=$(ps aux | grep -E "jfl|node|npm" | grep -v grep | wc -l | tr -d " ")
        echo "$procs processes"
    ' 2>/dev/null || echo "?"
}

# Format status with color
format_status() {
    local status=$1

    case "$status" in
        running)
            echo -e "${GREEN}●${NC} running"
            ;;
        stopped)
            echo -e "${RED}○${NC} stopped"
            ;;
        suspended)
            echo -e "${YELLOW}◐${NC} suspended"
            ;;
        paused)
            echo -e "${YELLOW}◑${NC} paused"
            ;;
        *)
            echo -e "${DIM}?${NC} $status"
            ;;
    esac
}

# Format score with color
format_score() {
    local score=$1

    if [[ "$score" == "-" ]]; then
        echo -e "${DIM}${score}${NC}"
        return
    fi

    # Color based on positive/negative
    if [[ "$score" =~ ^- ]]; then
        echo -e "${RED}${score}${NC}"
    else
        echo -e "${GREEN}+${score}${NC}"
    fi
}

# Print header
print_header() {
    clear
    echo ""
    echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}  JFL Agent Fleet Monitor${NC}"
    echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # Show fleet start time if available
    if [[ -f "$LOG_DIR/fleet-started" ]]; then
        local started
        started=$(cat "$LOG_DIR/fleet-started")
        echo -e "  ${DIM}Fleet started: $started${NC}"
        echo ""
    fi
}

# Print fleet summary
print_summary() {
    local vms=$1

    local total=0
    local running=0
    local stopped=0

    while IFS= read -r line; do
        [[ -n "$line" ]] || continue
        total=$((total + 1))

        if echo "$line" | grep -q 'running'; then
            running=$((running + 1))
        else
            stopped=$((stopped + 1))
        fi
    done <<< "$vms"

    echo -e "  ${CYAN}Total VMs:${NC} $total  ${GREEN}Running:${NC} $running  ${RED}Stopped:${NC} $stopped"
    echo ""
}

# Print VM table
print_vm_table() {
    local vms=$1

    # Table header
    printf "  ${BOLD}%-16s %-14s %-20s %-10s %-8s${NC}\n" \
        "VM" "STATUS" "TASK" "SCORE" "TUPLES"
    echo -e "  ${DIM}$(printf '─%.0s' {1..70})${NC}"

    while IFS= read -r line; do
        [[ -n "$line" ]] || continue

        local vm_name
        vm_name=$(echo "$line" | awk '{print $1}')
        local status
        status=$(echo "$line" | awk '{print $NF}')

        local task_info
        task_info=$(get_task_info "$vm_name")
        local score
        score=$(get_vm_score "$vm_name" "$status")
        local tuples
        tuples=$(get_tuple_count "$vm_name" "$status")

        # Truncate task info if too long
        if [[ ${#task_info} -gt 18 ]]; then
            task_info="${task_info:0:15}..."
        fi

        printf "  %-16s " "$vm_name"
        printf "%-14b " "$(format_status "$status")"
        printf "%-20s " "$task_info"
        printf "%-10b " "$(format_score "$score")"
        printf "%-8s\n" "$tuples"

        # Verbose mode: show more details
        if [[ "$VERBOSE" == true ]] && [[ "$status" == "running" ]]; then
            local procs
            procs=$(get_process_status "$vm_name")
            echo -e "    ${DIM}├─ Processes: $procs${NC}"

            if [[ -f "$LOG_DIR/vm-${vm_name##*-}.log" ]]; then
                local last_log
                last_log=$(tail -1 "$LOG_DIR/vm-${vm_name##*-}.log" 2>/dev/null | cut -c1-60)
                if [[ -n "$last_log" ]]; then
                    echo -e "    ${DIM}└─ Last log: ${last_log}...${NC}"
                fi
            fi
        fi

    done <<< "$vms"
}

# Print actions
print_actions() {
    echo ""
    echo -e "  ${DIM}Actions:${NC}"
    echo -e "    ${CYAN}c${NC} - Collect tuples    ${CYAN}k${NC} - Kill fleet"
    echo -e "    ${CYAN}l${NC} - View logs         ${CYAN}q${NC} - Quit"
    echo ""
}

# Print footer in watch mode
print_footer() {
    echo ""
    echo -e "  ${DIM}Refreshing every ${REFRESH_INTERVAL}s. Press Ctrl+C to exit.${NC}"
}

# Main display function
display() {
    local vms
    vms=$(get_all_vms)

    print_header

    if [[ -z "$vms" ]]; then
        echo -e "  ${YELLOW}No jfl-agent VMs found${NC}"
        echo ""
        echo "  Start a fleet:"
        echo "    ./spawn-fleet.sh 5 jfl-agent-base autoresearch"
        echo ""
        return
    fi

    print_summary "$vms"
    print_vm_table "$vms"

    if [[ "$WATCH_MODE" != true ]]; then
        print_actions
    else
        print_footer
    fi
}

# Watch mode loop
watch_loop() {
    trap 'echo ""; echo "Exiting..."; exit 0' INT

    while true; do
        display
        sleep "$REFRESH_INTERVAL"
    done
}

main() {
    if ! command -v prlctl &> /dev/null; then
        echo "prlctl not found. Install Parallels Desktop Pro."
        exit 1
    fi

    if [[ "$WATCH_MODE" == true ]]; then
        watch_loop
    else
        display
    fi
}

main
