#!/bin/bash
#
# collect-tuples.sh — Collect training tuples from fleet VMs
#
# Copies training buffer files from all running VMs, merges them
# with deduplication, and stores in the host's training buffer.
#
# Usage:
#   ./collect-tuples.sh                    # Collect from all VMs
#   ./collect-tuples.sh --dry-run          # Show what would be collected
#   ./collect-tuples.sh --output /path     # Custom output directory
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COLLECT_DIR="$PROJECT_ROOT/.jfl/vm-fleet/collected"
MERGED_FILE="$PROJECT_ROOT/.jfl/training-buffer.jsonl"

# Options
DRY_RUN=false
OUTPUT_DIR=""

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
error() { echo -e "${RED}[$(date '+%H:%M:%S')] ✗${NC} $1"; }

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run|-d)
            DRY_RUN=true
            shift
            ;;
        --output|-o)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --dry-run, -d         Show what would be collected"
            echo "  --output, -o <dir>    Custom output directory"
            echo ""
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            exit 1
            ;;
    esac
done

if [[ -n "$OUTPUT_DIR" ]]; then
    COLLECT_DIR="$OUTPUT_DIR"
fi

# Get all running agent VMs
get_running_vms() {
    prlctl list -o name,status 2>/dev/null | grep 'running' | grep 'jfl-agent-' | awk '{print $1}' | sort -V
}

# Copy training buffer from a single VM
copy_from_vm() {
    local vm_name=$1
    local vm_index
    vm_index=$(echo "$vm_name" | grep -oE '[0-9]+$' || echo "0")
    local output_file="$COLLECT_DIR/tuples-${vm_name}.jsonl"

    log "Collecting from $vm_name..."

    if [[ "$DRY_RUN" == true ]]; then
        log "  [DRY RUN] Would copy .jfl/training-buffer.jsonl"
        return 0
    fi

    # Try multiple possible locations
    local buffer_paths=(
        "/workspace/jfl-cli/.jfl/training-buffer.jsonl"
        "/workspace/jfl-platform/.jfl/training-buffer.jsonl"
        "$HOME/.jfl/training-buffer.jsonl"
    )

    for buffer_path in "${buffer_paths[@]}"; do
        if prlctl exec "$vm_name" test -f "$buffer_path" 2>/dev/null; then
            log "  Found buffer at: $buffer_path"

            # Copy file content
            prlctl exec "$vm_name" cat "$buffer_path" > "$output_file" 2>/dev/null

            local count
            count=$(wc -l < "$output_file" | tr -d ' ')

            if [[ "$count" -gt 0 ]]; then
                success "  Collected $count tuples from $vm_name"
                return 0
            fi
        fi
    done

    # Also check for any autoresearch results
    local ar_results
    ar_results=$(prlctl exec "$vm_name" /bin/bash -c '
        find /workspace -name "autoresearch-*.log" -type f 2>/dev/null | head -5
    ' 2>/dev/null || true)

    if [[ -n "$ar_results" ]]; then
        log "  Found autoresearch logs: $ar_results"
    fi

    warn "  No training buffer found in $vm_name"
    return 1
}

# Merge all collected files with deduplication
merge_tuples() {
    log "Merging collected tuples..."

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would merge files from $COLLECT_DIR"
        return 0
    fi

    local collected_files
    collected_files=$(find "$COLLECT_DIR" -name "tuples-*.jsonl" -type f 2>/dev/null)

    if [[ -z "$collected_files" ]]; then
        warn "No tuple files to merge"
        return 0
    fi

    local temp_file
    temp_file=$(mktemp)

    # Combine all files
    for file in $collected_files; do
        if [[ -f "$file" ]]; then
            cat "$file" >> "$temp_file"
        fi
    done

    # Deduplicate by id field
    local before_count
    before_count=$(wc -l < "$temp_file" | tr -d ' ')

    # Use jq if available for proper deduplication, otherwise simple sort -u
    if command -v jq &> /dev/null; then
        # Extract id, sort by id, dedupe
        sort -t'"' -k4 "$temp_file" | uniq > "${temp_file}.sorted"
        mv "${temp_file}.sorted" "$temp_file"
    else
        sort -u "$temp_file" > "${temp_file}.sorted"
        mv "${temp_file}.sorted" "$temp_file"
    fi

    local after_count
    after_count=$(wc -l < "$temp_file" | tr -d ' ')
    local dupes=$((before_count - after_count))

    # Append to main buffer (avoiding duplicates with existing entries)
    if [[ -f "$MERGED_FILE" ]]; then
        # Combine with existing and dedupe again
        cat "$MERGED_FILE" "$temp_file" > "${temp_file}.combined"

        if command -v jq &> /dev/null; then
            # Dedupe by id field
            sort -t'"' -k4 "${temp_file}.combined" | uniq > "$MERGED_FILE"
        else
            sort -u "${temp_file}.combined" > "$MERGED_FILE"
        fi

        rm -f "${temp_file}.combined"
    else
        mkdir -p "$(dirname "$MERGED_FILE")"
        mv "$temp_file" "$MERGED_FILE"
    fi

    local final_count
    final_count=$(wc -l < "$MERGED_FILE" | tr -d ' ')

    success "Merged tuples: $after_count new entries ($dupes duplicates removed)"
    success "Total in buffer: $final_count entries"

    rm -f "$temp_file"
}

# Also collect logs and other artifacts
collect_artifacts() {
    local vms=$1

    log "Collecting additional artifacts..."

    if [[ "$DRY_RUN" == true ]]; then
        log "[DRY RUN] Would collect logs and artifacts"
        return 0
    fi

    local artifacts_dir="$COLLECT_DIR/artifacts"
    mkdir -p "$artifacts_dir"

    while IFS= read -r vm_name; do
        [[ -n "$vm_name" ]] || continue

        # Collect autoresearch logs
        prlctl exec "$vm_name" /bin/bash -c '
            find /workspace -name "autoresearch-*.log" -type f 2>/dev/null
        ' 2>/dev/null | while read -r log_path; do
            if [[ -n "$log_path" ]]; then
                local basename
                basename=$(basename "$log_path")
                prlctl exec "$vm_name" cat "$log_path" > "$artifacts_dir/${vm_name}-${basename}" 2>/dev/null || true
            fi
        done

        # Collect fuzz test results
        prlctl exec "$vm_name" /bin/bash -c '
            find /workspace -name "fuzz-*.log" -type f 2>/dev/null
        ' 2>/dev/null | while read -r log_path; do
            if [[ -n "$log_path" ]]; then
                local basename
                basename=$(basename "$log_path")
                prlctl exec "$vm_name" cat "$log_path" > "$artifacts_dir/${vm_name}-${basename}" 2>/dev/null || true
            fi
        done

    done <<< "$vms"

    local artifact_count
    artifact_count=$(find "$artifacts_dir" -type f 2>/dev/null | wc -l | tr -d ' ')

    if [[ "$artifact_count" -gt 0 ]]; then
        success "Collected $artifact_count artifacts"
    fi
}

print_summary() {
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    success "Collection complete!"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "Collected files: $COLLECT_DIR/"

    if [[ -d "$COLLECT_DIR" ]] && [[ "$DRY_RUN" != true ]]; then
        echo ""
        echo "Contents:"
        ls -la "$COLLECT_DIR/" 2>/dev/null | head -10
    fi

    if [[ -f "$MERGED_FILE" ]]; then
        local count
        count=$(wc -l < "$MERGED_FILE" | tr -d ' ')
        echo ""
        echo "Merged buffer: $MERGED_FILE ($count entries)"
    fi

    echo ""
    echo "Next steps:"
    echo "  • View tuples: jfl training stats"
    echo "  • Export for training: jfl training export"
    echo "  • Run evaluation: jfl eval run"
    echo ""
}

main() {
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  JFL Fleet Tuple Collector"
    echo "═══════════════════════════════════════════════════════════"
    echo ""

    if ! command -v prlctl &> /dev/null; then
        error "prlctl not found. Install Parallels Desktop Pro."
        exit 1
    fi

    local vms
    vms=$(get_running_vms)

    if [[ -z "$vms" ]]; then
        warn "No running jfl-agent VMs found"
        echo ""
        echo "Start a fleet first:"
        echo "  ./spawn-fleet.sh 5 jfl-agent-base autoresearch"
        echo ""
        exit 0
    fi

    local vm_count
    vm_count=$(echo "$vms" | wc -l | tr -d ' ')

    log "Found $vm_count running agent VMs"

    # Create collection directory
    if [[ "$DRY_RUN" != true ]]; then
        mkdir -p "$COLLECT_DIR"
    fi

    # Collect from each VM
    local collected=0
    while IFS= read -r vm_name; do
        [[ -n "$vm_name" ]] || continue

        if copy_from_vm "$vm_name"; then
            collected=$((collected + 1))
        fi
    done <<< "$vms"

    echo ""

    # Merge all collected tuples
    merge_tuples

    # Collect additional artifacts
    collect_artifacts "$vms"

    print_summary
}

main
