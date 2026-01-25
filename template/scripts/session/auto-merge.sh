#!/bin/bash
#
# Auto-merge script for worktree sessions
# Periodically tries to merge session branch → main
#
# Usage:
#   ./scripts/auto-merge.sh start SESSION_NAME   # Start merging for a session
#   ./scripts/auto-merge.sh stop SESSION_NAME    # Stop merging
#   ./scripts/auto-merge.sh status SESSION_NAME  # Check merge status
#   ./scripts/auto-merge.sh once SESSION_NAME    # Try merge once

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(pwd)"
LOG_FILE="$REPO_DIR/.auto-merge.log"
INTERVAL=900  # 15 minutes
MAX_CONSECUTIVE_FAILURES=3

SESSION_NAME="${2:-}"
WORKTREE_DIR="$REPO_DIR/worktrees/$SESSION_NAME"
PID_FILE="$WORKTREE_DIR/.auto-merge.pid"
CONFLICT_FILE="$WORKTREE_DIR/.merge-conflict"
STATUS_FILE="$WORKTREE_DIR/.last-merge-status"
FAILURE_COUNT_FILE="$WORKTREE_DIR/.merge-failure-count"

cd "$REPO_DIR" || exit 1

validate_session() {
    if [[ -z "$SESSION_NAME" ]]; then
        echo "Error: SESSION_NAME required"
        echo "Usage: $0 {start|stop|status|once} SESSION_NAME"
        exit 1
    fi

    if [[ ! -d "$WORKTREE_DIR" ]]; then
        echo "Error: Worktree not found: $WORKTREE_DIR"
        exit 1
    fi
}

do_merge() {
    local session="$1"
    local timestamp="[$(date '+%Y-%m-%d %H:%M:%S')]"

    # Check if conflict marker exists (user hasn't resolved yet)
    if [[ -f "$CONFLICT_FILE" ]]; then
        echo "$timestamp Skipping merge - unresolved conflict exists" >> "$LOG_FILE"
        return 1
    fi

    # Save current branch
    local current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

    # Switch to main
    if ! git checkout main --quiet 2>> "$LOG_FILE"; then
        echo "$timestamp ✗ Failed to checkout main" >> "$LOG_FILE"
        return 1
    fi

    # Pull latest main
    if ! git pull --rebase --quiet 2>> "$LOG_FILE"; then
        echo "$timestamp ✗ Failed to pull main" >> "$LOG_FILE"
        git checkout "$current_branch" --quiet 2>/dev/null
        return 1
    fi

    # Try to merge the session branch
    if git merge "$session" --no-edit 2>&1 | tee /tmp/merge-output-$$.txt; then
        # Check if it was already up to date
        if grep -q "Already up to date" /tmp/merge-output-$$.txt; then
            echo "$timestamp No changes to merge from $session" >> "$LOG_FILE"
            rm /tmp/merge-output-$$.txt
            git checkout "$current_branch" --quiet 2>/dev/null
            echo "up-to-date" > "$STATUS_FILE"
            # Reset failure count
            echo "0" > "$FAILURE_COUNT_FILE"
            return 0
        fi

        # Merge succeeded! Push to remote
        if git push 2>> "$LOG_FILE"; then
            echo "$timestamp ✓ Merged $session → main and pushed" >> "$LOG_FILE"
            echo "merged" > "$STATUS_FILE"
            date '+%s' >> "$STATUS_FILE"  # Timestamp
            # Reset failure count
            echo "0" > "$FAILURE_COUNT_FILE"
            rm /tmp/merge-output-$$.txt
            git checkout "$current_branch" --quiet 2>/dev/null
            return 0
        else
            echo "$timestamp ✓ Merged $session → main but push failed (offline?)" >> "$LOG_FILE"
            echo "merged-unpushed" > "$STATUS_FILE"
            rm /tmp/merge-output-$$.txt
            git checkout "$current_branch" --quiet 2>/dev/null
            return 0
        fi
    else
        # Merge conflict! Try auto-resolution for template files
        echo "$timestamp Merge conflict detected, attempting auto-resolution..." >> "$LOG_FILE"

        # Get list of conflicting files
        local conflicting=$(git diff --name-only --diff-filter=U 2>/dev/null)
        local can_auto_resolve=true
        local non_template_conflicts=""

        # Check if all conflicts are in template files (safe to take session version)
        # Template files: CLAUDE.md, .claude/, .mcp.json, scripts/, templates/
        for file in $conflicting; do
            case "$file" in
                CLAUDE.md|.mcp.json)
                    # Template file - take session version
                    git checkout --theirs "$file" 2>/dev/null
                    git add "$file" 2>/dev/null
                    echo "$timestamp   Auto-resolved $file (took session version)" >> "$LOG_FILE"
                    ;;
                .claude/*|scripts/*|templates/*)
                    # Template directory - take session version
                    git checkout --theirs "$file" 2>/dev/null
                    git add "$file" 2>/dev/null
                    echo "$timestamp   Auto-resolved $file (took session version)" >> "$LOG_FILE"
                    ;;
                .jfl/journal/*)
                    # Journal files - take session version (they're per-session anyway)
                    git checkout --theirs "$file" 2>/dev/null
                    git add "$file" 2>/dev/null
                    echo "$timestamp   Auto-resolved $file (took session version)" >> "$LOG_FILE"
                    ;;
                knowledge/*|content/*|suggestions/*)
                    # User content - cannot auto-resolve, needs manual review
                    can_auto_resolve=false
                    non_template_conflicts="$non_template_conflicts $file"
                    ;;
                *)
                    # Unknown file type - be conservative, don't auto-resolve
                    can_auto_resolve=false
                    non_template_conflicts="$non_template_conflicts $file"
                    ;;
            esac
        done

        if $can_auto_resolve; then
            # All conflicts were auto-resolved, complete the merge
            if git commit --no-edit 2>> "$LOG_FILE"; then
                echo "$timestamp ✓ Auto-resolved all conflicts and merged" >> "$LOG_FILE"

                if git push 2>> "$LOG_FILE"; then
                    echo "$timestamp ✓ Pushed auto-resolved merge" >> "$LOG_FILE"
                    echo "auto-resolved" > "$STATUS_FILE"
                    date '+%s' >> "$STATUS_FILE"
                    echo "0" > "$FAILURE_COUNT_FILE"
                    rm /tmp/merge-output-$$.txt 2>/dev/null
                    git checkout "$current_branch" --quiet 2>/dev/null
                    return 0
                else
                    echo "$timestamp ✓ Auto-resolved but push failed" >> "$LOG_FILE"
                    echo "auto-resolved-unpushed" > "$STATUS_FILE"
                    rm /tmp/merge-output-$$.txt 2>/dev/null
                    git checkout "$current_branch" --quiet 2>/dev/null
                    return 0
                fi
            fi
        fi

        # Could not auto-resolve all conflicts - abort and mark for manual resolution
        git merge --abort 2>/dev/null

        # Increment failure count
        local failures=0
        if [[ -f "$FAILURE_COUNT_FILE" ]]; then
            failures=$(cat "$FAILURE_COUNT_FILE")
        fi
        failures=$((failures + 1))
        echo "$failures" > "$FAILURE_COUNT_FILE"

        echo "$timestamp ✗ CONFLICT: $session vs main (attempt $failures)" >> "$LOG_FILE"
        echo "$timestamp   Non-auto-resolvable conflicts:$non_template_conflicts" >> "$LOG_FILE"

        # Get list of conflicting files (for display)
        local conflicting_files=$(echo "$non_template_conflicts" | tr ' ' '\n' | grep -v '^$' | head -10)

        # Create conflict marker file
        cat > "$CONFLICT_FILE" <<EOF
MERGE CONFLICT DETECTED

Session: $session
Target: main
Time: $(date '+%Y-%m-%d %H:%M:%S')
Consecutive failures: $failures

Conflicting files (or files that differ):
$conflicting_files

What to do:
1. Resolve conflicts manually in your worktree
2. Commit the resolution to branch: $session
3. Delete this file when ready to retry merge: rm $CONFLICT_FILE

Or ask Claude to help resolve the conflict.
EOF

        # Check if we've hit max failures
        if [[ $failures -ge $MAX_CONSECUTIVE_FAILURES ]]; then
            echo "" >> "$CONFLICT_FILE"
            echo "⚠️  WARNING: $failures consecutive merge failures." >> "$CONFLICT_FILE"
            echo "Auto-merge is pausing. Resolve the conflict to resume." >> "$CONFLICT_FILE"
        fi

        rm /tmp/merge-output-$$.txt 2>/dev/null
        git checkout "$current_branch" --quiet 2>/dev/null
        return 1
    fi
}

start_daemon() {
    validate_session

    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "Auto-merge already running for $SESSION_NAME (PID: $(cat "$PID_FILE"))"
        return 1
    fi

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting auto-merge for $SESSION_NAME..." >> "$LOG_FILE"

    # Initialize failure count
    echo "0" > "$FAILURE_COUNT_FILE"

    # Run in background
    # Close inherited file descriptors so parent doesn't wait for us
    (
        exec </dev/null >/dev/null 2>&1
        while true; do
            # Check if conflict exists and max failures reached
            if [[ -f "$FAILURE_COUNT_FILE" ]]; then
                failures=$(cat "$FAILURE_COUNT_FILE")
                if [[ $failures -ge $MAX_CONSECUTIVE_FAILURES ]] && [[ -f "$CONFLICT_FILE" ]]; then
                    # Pause until conflict is resolved
                    sleep $INTERVAL
                    continue
                fi
            fi

            do_merge "$SESSION_NAME"
            sleep $INTERVAL
        done
    ) &

    echo $! > "$PID_FILE"
    echo "Auto-merge started for $SESSION_NAME (PID: $!)"
    echo "Interval: ${INTERVAL}s (15 minutes)"
}

stop_daemon() {
    validate_session

    if [[ -f "$PID_FILE" ]]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid"
            rm "$PID_FILE"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Stopped auto-merge for $SESSION_NAME" >> "$LOG_FILE"
            echo "Auto-merge stopped for $SESSION_NAME"
        else
            rm "$PID_FILE"
            echo "Process not running (cleaned up stale PID file)"
        fi
    else
        echo "Auto-merge not running for $SESSION_NAME"
    fi
}

status_daemon() {
    validate_session

    echo "Session: $SESSION_NAME"
    echo ""

    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "Auto-merge: RUNNING (PID: $(cat "$PID_FILE"))"
    else
        echo "Auto-merge: NOT RUNNING"
    fi

    if [[ -f "$CONFLICT_FILE" ]]; then
        echo "Status: CONFLICT (resolve manually)"
        echo ""
        cat "$CONFLICT_FILE"
    elif [[ -f "$STATUS_FILE" ]]; then
        local status=$(head -1 "$STATUS_FILE")
        echo "Last merge: $status"
        if [[ -f "$STATUS_FILE" ]] && [[ $(wc -l < "$STATUS_FILE") -gt 1 ]]; then
            local timestamp=$(tail -1 "$STATUS_FILE")
            local time_ago=$(($(date +%s) - timestamp))
            echo "Time ago: ${time_ago}s"
        fi
    else
        echo "Status: No merge attempts yet"
    fi

    if [[ -f "$FAILURE_COUNT_FILE" ]]; then
        local failures=$(cat "$FAILURE_COUNT_FILE")
        if [[ $failures -gt 0 ]]; then
            echo "Consecutive failures: $failures"
        fi
    fi
}

case "${1:-}" in
    start)
        start_daemon
        ;;
    stop)
        stop_daemon
        ;;
    status)
        status_daemon
        ;;
    once)
        validate_session
        do_merge "$SESSION_NAME"
        echo "Single merge attempt complete"
        ;;
    *)
        echo "Usage: $0 {start|stop|status|once} SESSION_NAME"
        exit 1
        ;;
esac
