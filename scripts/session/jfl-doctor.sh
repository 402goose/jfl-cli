#!/usr/bin/env bash
#
# jfl-doctor.sh - Health check for JFL projects
# Inspired by Takopi's doctor command
#
# Usage:
#   ./scripts/session/jfl-doctor.sh           # Run health checks
#   ./scripts/session/jfl-doctor.sh --fix     # Auto-fix issues
#   ./scripts/session/jfl-doctor.sh --json    # Output as JSON

set -e

# Require bash 4+ for associative arrays, or work around it
if [[ "${BASH_VERSINFO[0]}" -lt 4 ]]; then
    # Fallback for older bash - just track counts
    USE_ASSOC_ARRAYS=false
else
    USE_ASSOC_ARRAYS=true
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Find main repo root
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    REPO_DIR="$(git rev-parse --show-toplevel)"
else
    REPO_DIR="$(pwd)"
fi

SESSIONS_DIR="$REPO_DIR/.jfl/sessions"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse args
FIX_MODE=false
JSON_MODE=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --fix|-f)
            FIX_MODE=true
            shift
            ;;
        --json|-j)
            JSON_MODE=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# Check results (simple approach for bash 3 compatibility)
ISSUES=0
WARNINGS=0
FIXED=0
CHECK_RESULTS=""  # Will store "name:status" pairs

# Check if a PID is still running
is_pid_running() {
    local pid="$1"
    # Validate PID is a positive integer
    if [[ -z "$pid" ]]; then
        return 1
    fi
    # Check if it's a number
    if ! [[ "$pid" =~ ^[0-9]+$ ]]; then
        return 1
    fi
    if [[ "$pid" -le 0 ]]; then
        return 1
    fi
    kill -0 "$pid" 2>/dev/null
}

# Report check result
report() {
    local name="$1"
    local status="$2"  # ok, warning, error
    local message="$3"
    local detail="${4:-}"

    # Store for JSON output
    CHECK_RESULTS="${CHECK_RESULTS}${name}:${status};"

    if $JSON_MODE; then
        return
    fi

    case $status in
        ok)
            echo -e "${GREEN}✓${NC} $name: $message"
            ;;
        warning)
            echo -e "${YELLOW}⚠${NC} $name: $message"
            WARNINGS=$((WARNINGS + 1))
            ;;
        error)
            echo -e "${RED}✗${NC} $name: $message"
            ISSUES=$((ISSUES + 1))
            ;;
    esac

    if [[ -n "$detail" ]] && $VERBOSE; then
        echo "  $detail"
    fi
}

# Check: Git status
check_git() {
    cd "$REPO_DIR"

    # Check if we're in a git repo
    if ! git rev-parse --git-dir &>/dev/null; then
        report "git" "error" "Not a git repository"
        return
    fi

    # Check for uncommitted changes
    local changes=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    if [[ $changes -gt 0 ]]; then
        report "git" "warning" "$changes uncommitted changes"
    else
        report "git" "ok" "clean working tree"
    fi
}

# Check: Submodules
check_submodules() {
    cd "$REPO_DIR"

    if [[ ! -f ".gitmodules" ]]; then
        report "submodules" "ok" "none configured"
        return
    fi

    local submodule_paths=$(grep "path = " .gitmodules 2>/dev/null | sed 's/.*path = //')
    local issues=0
    local details=""

    for submodule_path in $submodule_paths; do
        local full_path="$REPO_DIR/$submodule_path"

        # Resolve symlink
        if [[ -L "$full_path" ]]; then
            full_path=$(cd "$full_path" 2>/dev/null && pwd) || continue
        fi

        if [[ ! -d "$full_path" ]]; then
            issues=$((issues + 1))
            details="$details $submodule_path (missing)"
            continue
        fi

        # Check if submodule is initialized
        if [[ ! -d "$full_path/.git" ]] && [[ ! -f "$full_path/.git" ]]; then
            issues=$((issues + 1))
            details="$details $submodule_path (not initialized)"
            continue
        fi

        # Check for uncommitted changes in submodule
        cd "$full_path"
        local sub_changes=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
        if [[ $sub_changes -gt 0 ]]; then
            issues=$((issues + 1))
            details="$details $submodule_path ($sub_changes uncommitted)"
        fi
        cd "$REPO_DIR"
    done

    if [[ $issues -gt 0 ]]; then
        report "submodules" "warning" "$issues issue(s):$details"
    else
        report "submodules" "ok" "all synced"
    fi
}

# Check: Session branches and auto-commit daemon
check_stale_sessions() {
    # Check if auto-commit daemon is running
    local pid_file="$REPO_DIR/.jfl/auto-commit.pid"

    if [[ -f "$pid_file" ]]; then
        local pid=$(cat "$pid_file" 2>/dev/null)
        if is_pid_running "$pid"; then
            report "sessions" "ok" "auto-commit daemon running"
        else
            report "sessions" "warning" "auto-commit daemon not running (stale PID)"
        fi
    else
        # Check if we're on a session branch
        local current_branch=$(git branch --show-current 2>/dev/null)
        if [[ "$current_branch" == session-* ]]; then
            report "sessions" "warning" "on session branch but no auto-commit daemon"
        else
            report "sessions" "ok" "not in active session"
        fi
    fi
}

# Global variables for branch data (used in summary)
UNMERGED_BRANCHES_COUNT=0
UNMERGED_BRANCHES_LIST=""
MERGED_BRANCHES_COUNT=0

# Check: Old session branches that have been merged
check_orphaned_branches() {
    cd "$REPO_DIR"

    # Find session branches and check if they're merged
    local merged_orphans=0
    local unmerged_orphans=0
    local merged_list=""
    local unmerged_list=""

    for branch in $(git branch --list 'session-*' 2>/dev/null | tr -d ' *+'); do
        # Check if branch has unmerged commits
        local commits_ahead=$(git rev-list --count main.."$branch" 2>/dev/null || echo "0")
        if [[ "$commits_ahead" -gt 0 ]]; then
            unmerged_orphans=$((unmerged_orphans + 1))
            unmerged_list="$unmerged_list $branch:$commits_ahead"
        else
            merged_orphans=$((merged_orphans + 1))
            merged_list="$merged_list $branch"
        fi
    done

    # Store for summary display
    UNMERGED_BRANCHES_COUNT=$unmerged_orphans
    UNMERGED_BRANCHES_LIST="$unmerged_list"
    MERGED_BRANCHES_COUNT=$merged_orphans

    # Also check submodules for orphan branches
    local submodule_orphans=0
    if [[ -f ".gitmodules" ]]; then
        local submodule_paths=$(grep "path = " .gitmodules 2>/dev/null | sed 's/.*path = //')
        for submodule_path in $submodule_paths; do
            local full_path="$REPO_DIR/$submodule_path"
            if [[ -L "$full_path" ]]; then
                full_path=$(cd "$full_path" 2>/dev/null && pwd) || continue
            fi
            if [[ -d "$full_path/.git" ]] || [[ -f "$full_path/.git" ]]; then
                cd "$full_path"
                local sub_orphans=$(git branch --list 'session-*' 2>/dev/null | wc -l | tr -d ' ')
                submodule_orphans=$((submodule_orphans + sub_orphans))
                cd "$REPO_DIR"
            fi
        done
    fi

    # Report based on what we found
    local total_orphans=$((merged_orphans + unmerged_orphans + submodule_orphans))

    if [[ $total_orphans -eq 0 ]]; then
        report "branches" "ok" "no orphans"
        return
    fi

    # Report unmerged branches (WARNING - never auto-delete these)
    if [[ $unmerged_orphans -gt 0 ]]; then
        report "branches" "warning" "$unmerged_orphans with UNMERGED work, $merged_orphans merged, $submodule_orphans submodule"

        if $VERBOSE; then
            echo "    ⚠️  UNMERGED (do NOT delete):"
            for entry in $unmerged_list; do
                branch="${entry%%:*}"
                commits="${entry##*:}"
                echo "      • $branch ($commits commits NOT in main)"
            done

            if [[ $merged_orphans -gt 0 ]]; then
                echo "    ✓ MERGED (safe to delete):"
                for branch in $merged_list; do
                    echo "      • $branch (all work in main)"
                done
            fi
        fi
    elif [[ $merged_orphans -gt 0 ]]; then
        # Only merged orphans exist
        report "branches" "warning" "$merged_orphans merged orphans (+ $submodule_orphans submodule)"
    else
        # Only submodule orphans
        report "branches" "warning" "$submodule_orphans submodule orphans"
    fi

    # Clean up ONLY merged branches (safe regardless of unmerged branches)
    if $FIX_MODE && [[ $merged_orphans -gt 0 ]]; then
        echo -e "${BLUE}→${NC} Deleting merged orphan branches (unmerged branches kept)..."
        for branch in $merged_list; do
            if git branch -D "$branch" 2>/dev/null; then
                echo "    ✓ Deleted: $branch (was fully merged to main)"
                FIXED=$((FIXED + 1))
            fi
        done
    fi
}

# Check: Lock files
check_locks() {
    local stale_locks=0
    local lock_list=""

    # Check for .lock files with stale PIDs
    local lock_files=$(find "$REPO_DIR/.jfl" -name "*.lock" 2>/dev/null || true)
    for lock_file in $lock_files; do
        if [[ -f "$lock_file" ]]; then
            # Try to parse PID from lock file
            local pid=$(grep -o '"pid":[[:space:]]*[0-9]*' "$lock_file" 2>/dev/null | grep -o '[0-9]*')
            if [[ -n "$pid" ]] && ! is_pid_running "$pid"; then
                stale_locks=$((stale_locks + 1))
                lock_list="$lock_list $lock_file"
            fi
        fi
    done

    if [[ $stale_locks -gt 0 ]]; then
        report "locks" "warning" "$stale_locks stale lock(s)"

        if $FIX_MODE; then
            echo -e "${BLUE}→${NC} Removing stale locks..."
            for lock in $lock_list; do
                rm -f "$lock"
                echo "    ✓ Removed: $(basename $lock)"
                FIXED=$((FIXED + 1))
            done
        fi
    else
        report "locks" "ok" "no stale locks"
    fi
}

# Check: Memory MCP
check_memory() {
    local memory_db="$REPO_DIR/.jfl/memory.db"

    if [[ ! -f "$memory_db" ]]; then
        report "memory" "warning" "not initialized"

        if $FIX_MODE; then
            echo -e "${BLUE}→${NC} Initializing memory system..."
            jfl memory init > /dev/null 2>&1
            if [[ $? -eq 0 ]]; then
                # Get count after initialization
                if command -v sqlite3 &>/dev/null; then
                    local count=$(sqlite3 "$memory_db" "SELECT COUNT(*) FROM memories;" 2>/dev/null || echo 0)
                    report "memory" "ok" "initialized ($count memories indexed)"
                else
                    report "memory" "ok" "initialized"
                fi
                FIXED=$((FIXED + 1))
            fi
        fi
        return
    fi

    # Try to get memory count if sqlite3 is available
    if command -v sqlite3 &>/dev/null; then
        local count=$(sqlite3 "$memory_db" "SELECT COUNT(*) FROM memories;" 2>/dev/null || echo 0)
        report "memory" "ok" "$count memories indexed"
    else
        local size=$(ls -lh "$memory_db" 2>/dev/null | awk '{print $5}')
        report "memory" "ok" "database exists ($size)"
    fi
}

# Check: Current session branch for unmerged work
check_unmerged_sessions() {
    local current_branch=$(git branch --show-current 2>/dev/null)

    # Only check if we're on a session branch
    if [[ "$current_branch" != session-* ]]; then
        report "merge" "ok" "not on session branch"
        return
    fi

    # Check if current branch has unmerged commits
    local commits_ahead=$(git rev-list --count main.."$current_branch" 2>/dev/null || echo "0")

    if [[ "$commits_ahead" -gt 0 ]]; then
        report "merge" "warning" "$commits_ahead commits not merged to main"
    else
        report "merge" "ok" "session up to date with main"
    fi
}

# Check: Session state files
check_session_state() {
    mkdir -p "$SESSIONS_DIR"

    local state_files=$(ls "$SESSIONS_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')
    local orphan_states=0

    for state_file in "$SESSIONS_DIR"/*.json; do
        if [[ -f "$state_file" ]]; then
            local session_name=$(basename "$state_file" .json)
            # Check if session branch exists
            if ! git rev-parse --verify "$session_name" >/dev/null 2>&1; then
                orphan_states=$((orphan_states + 1))

                if $FIX_MODE; then
                    rm -f "$state_file"
                    FIXED=$((FIXED + 1))
                fi
            fi
        fi
    done

    if [[ $orphan_states -gt 0 ]]; then
        if $FIX_MODE; then
            report "state" "ok" "cleaned $orphan_states orphan state files"
        else
            report "state" "warning" "$orphan_states orphan state files"
        fi
    else
        report "state" "ok" "$state_files session state files"
    fi
}

# Main
main() {
    if ! $JSON_MODE; then
        echo ""
        echo "jfl doctor"
        echo "─────────────────────────────────────"
    fi

    check_git
    check_submodules
    check_stale_sessions
    check_orphaned_branches
    check_unmerged_sessions
    check_locks
    check_memory
    check_session_state

    # Show categorized summary (human-friendly)
    if ! $JSON_MODE && [[ $ISSUES -gt 0 || $WARNINGS -gt 0 ]]; then
        echo ""
        echo "─────────────────────────────────────"

        # Check what warnings/errors we have from CHECK_RESULTS
        local has_unmerged_branches=false
        local has_merged_orphans=false
        local has_uncommitted=false
        local has_memory_init=false
        local has_submodule_init=false

        IFS=';' read -ra PAIRS <<< "$CHECK_RESULTS"
        for pair in "${PAIRS[@]}"; do
            [[ -z "$pair" ]] && continue
            local key="${pair%%:*}"
            local status="${pair#*:}"

            case "$key" in
                branches)
                    if [[ "$status" == "warning" ]]; then
                        # Check last output to see what kind of branch warning
                        has_unmerged_branches=true
                    fi
                    ;;
                git)
                    [[ "$status" == "warning" ]] && has_uncommitted=true
                    ;;
                memory)
                    [[ "$status" == "warning" ]] && has_memory_init=true
                    ;;
                submodules)
                    [[ "$status" == "warning" ]] && has_submodule_init=true
                    ;;
            esac
        done

        # Print categorized sections
        if $has_uncommitted; then
            echo ""
            echo -e "${YELLOW}⚠️  Needs Review${NC}"
            echo "   • Uncommitted changes in working tree"
            echo "   Run: git status"
        fi

        if $has_unmerged_branches; then
            echo ""
            if [[ $UNMERGED_BRANCHES_COUNT -gt 0 ]]; then
                echo -e "${YELLOW}⚠️  Needs Review${NC} (branches with unmerged work)"
                echo "   • $UNMERGED_BRANCHES_COUNT GTM branches have unmerged commits"

                # Show first unmerged branch as example
                if [[ -n "$UNMERGED_BRANCHES_LIST" ]]; then
                    local first_entry=$(echo "$UNMERGED_BRANCHES_LIST" | awk '{print $1}')
                    local first_branch="${first_entry%%:*}"
                    local first_commits="${first_entry##*:}"
                    echo "   • Including: $first_branch ($first_commits commits)"
                fi

                if $VERBOSE; then
                    echo ""
                    echo "   All unmerged branches:"
                    for entry in $UNMERGED_BRANCHES_LIST; do
                        local branch="${entry%%:*}"
                        local commits="${entry##*:}"
                        echo "   • $branch ($commits commits ahead of main)"
                    done
                else
                    echo "   Run with --verbose to see all branches"
                fi
                echo ""
                echo "   To review: git log main..<branch-name>"
                echo "   To merge: git checkout main && git merge <branch-name>"
            elif [[ $MERGED_BRANCHES_COUNT -gt 0 ]]; then
                echo -e "${YELLOW}⚠️  Needs Review${NC} (branches with unmerged work)"
                echo "   • $MERGED_BRANCHES_COUNT merged orphans (+ 0 submodule)"
                echo ""
                echo "   These branches are fully merged to main and can be deleted:"
                echo "   Run: jfl-doctor.sh --fix"
            fi
        fi

        if $has_memory_init || $has_submodule_init; then
            echo ""
            echo -e "${CYAN}ℹ️  Info${NC} (not critical)"
            [[ $has_memory_init ]] && echo "   • Memory system not initialized (optional)"
            [[ $has_submodule_init ]] && echo "   • 402_cat_rust submodule not initialized (optional)"
        fi

        echo ""
        echo "─────────────────────────────────────"
    fi

    if $JSON_MODE; then
        # Output JSON (parse CHECK_RESULTS string)
        echo "{"
        echo '  "checks": {'
        local first=true
        IFS=';' read -ra PAIRS <<< "$CHECK_RESULTS"
        for pair in "${PAIRS[@]}"; do
            if [[ -n "$pair" ]]; then
                local key="${pair%%:*}"
                local value="${pair#*:}"
                if ! $first; then echo ","; fi
                first=false
                echo -n "    \"$key\": \"$value\""
            fi
        done
        echo ""
        echo "  },"
        echo "  \"issues\": $ISSUES,"
        echo "  \"warnings\": $WARNINGS,"
        echo "  \"fixed\": $FIXED"
        echo "}"
    else
        echo ""
        if [[ $ISSUES -gt 0 ]] || [[ $WARNINGS -gt 0 ]]; then
            if $FIX_MODE; then
                echo -e "Fixed $FIXED issue(s). Remaining: $ISSUES error(s), $WARNINGS warning(s)"
            else
                echo -e "$ISSUES error(s), $WARNINGS warning(s)"
                echo ""
                echo "Run 'jfl-doctor.sh --fix' to auto-fix issues"
            fi
        else
            echo -e "${GREEN}All checks passed!${NC}"
        fi
        echo ""
    fi

    # Exit with error code if issues found
    if [[ $ISSUES -gt 0 ]]; then
        exit 1
    fi
}

main "$@"
