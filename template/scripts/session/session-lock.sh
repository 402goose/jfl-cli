#!/usr/bin/env bash
#
# session-lock.sh — File-based session lock registry + merge sequencer
#
# Pure bash, no external dependencies beyond flock(1). Designed for use by
# session-init.sh and session-end.sh to coordinate multiple concurrent sessions.
#
# Usage:
#   session-lock.sh register <session-id> <branch> [worktree-path]
#   session-lock.sh heartbeat <session-id>
#   session-lock.sh unregister <session-id>
#   session-lock.sh active                          # list active sessions (JSON)
#   session-lock.sh count                           # count of active sessions
#   session-lock.sh stale                           # list stale sessions
#   session-lock.sh clean                           # remove stale lock files
#   session-lock.sh claim <session-id> <path,...>   # declare file claims
#   session-lock.sh check-claim <session-id> <path> # check for conflicts
#   session-lock.sh merge <session-branch> <target-branch> <session-id> [cwd]
#   session-lock.sh emit <session-id> <event-type> [key=value...]
#
# @purpose Bash session concurrency control (lock registry + merge sequencer)

set -euo pipefail

REPO_DIR="${JFL_REPO_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
SESSIONS_DIR="$REPO_DIR/.jfl/sessions"
HEARTBEAT_STALE_SECONDS=90
MERGE_LOCK_TIMEOUT_SECONDS=120
MERGE_RETRY_SECONDS=2

mkdir -p "$SESSIONS_DIR"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

now_iso() { date -u +"%Y-%m-%dT%H:%M:%S.000Z"; }

lock_file()   { echo "$SESSIONS_DIR/${1}.lock"; }
flock_file()  { echo "$SESSIONS_DIR/${1}.lock.flock"; }
merge_queue() { echo "$SESSIONS_DIR/merge-queue.jsonl"; }
merge_lock()  { echo "$SESSIONS_DIR/merge.lock"; }
events_file() { echo "$SESSIONS_DIR/events.jsonl"; }

pid_alive() {
  kill -0 "$1" 2>/dev/null
}

file_age_seconds() {
  local file="$1"
  if [[ ! -f "$file" ]]; then echo "999999"; return; fi
  if [[ "$(uname)" == "Darwin" ]]; then
    local mtime
    mtime=$(stat -f %m "$file" 2>/dev/null || echo 0)
    echo $(( $(date +%s) - mtime ))
  else
    local mtime
    mtime=$(stat -c %Y "$file" 2>/dev/null || echo 0)
    echo $(( $(date +%s) - mtime ))
  fi
}

flock_write() {
  local file="$1"
  local content="$2"
  local fl="${file}.flock"
  (
    flock -x 200 2>/dev/null || true
    printf '%s' "$content" > "$file"
  ) 200>"$fl"
}

flock_append() {
  local file="$1"
  local line="$2"
  local fl="${file}.flock"
  (
    flock -x 200 2>/dev/null || true
    echo "$line" >> "$file"
  ) 200>"$fl"
}

emit_event() {
  local session_id="${1:-unknown}"
  local event_type="${2:-unknown}"
  shift 2 || true
  local extra=""
  for kv in "$@"; do
    local key="${kv%%=*}"
    local val="${kv#*=}"
    extra="${extra},\"${key}\":\"${val}\""
  done
  local ev="{\"session\":\"${session_id}\",\"event\":\"${event_type}\"${extra},\"ts\":\"$(now_iso)\"}"
  flock_append "$(events_file)" "$ev"
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_register() {
  local session_id="$1"
  local branch="$2"
  local worktree="${3:-null}"
  local user
  user=$(git config user.name 2>/dev/null | tr ' ' '-' | tr '[:upper:]' '[:lower:]' || echo "unknown")

  if [[ "$worktree" != "null" ]]; then
    worktree="\"$worktree\""
  fi

  local lock_json
  lock_json=$(cat <<EOF
{
  "id": "${session_id}",
  "pid": $$,
  "branch": "${branch}",
  "worktree": ${worktree},
  "user": "${user}",
  "claiming": [],
  "started": "$(now_iso)",
  "heartbeat": "$(now_iso)"
}
EOF
)

  flock_write "$(lock_file "$session_id")" "$lock_json"
  emit_event "$session_id" "session:register" "branch=$branch" "user=$user"
  echo "registered: $session_id"
}

cmd_heartbeat() {
  local session_id="$1"
  local lf
  lf="$(lock_file "$session_id")"
  if [[ ! -f "$lf" ]]; then
    echo "error: no lock file for $session_id" >&2
    return 1
  fi

  # Update heartbeat timestamp in the JSON
  local content
  content=$(cat "$lf")
  local updated
  updated=$(echo "$content" | sed "s/\"heartbeat\": *\"[^\"]*\"/\"heartbeat\": \"$(now_iso)\"/")
  flock_write "$lf" "$updated"
}

cmd_unregister() {
  local session_id="$1"
  emit_event "$session_id" "session:unregister"
  rm -f "$(lock_file "$session_id")" "$(flock_file "$session_id")"
  echo "unregistered: $session_id"
}

cmd_active() {
  local active_json="["
  local first=true

  for lf in "$SESSIONS_DIR"/*.lock; do
    [[ -f "$lf" ]] || continue
    [[ "$lf" == *.flock ]] && continue

    local content
    content=$(cat "$lf" 2>/dev/null) || continue
    local pid
    pid=$(echo "$content" | grep -o '"pid": *[0-9]*' | grep -o '[0-9]*') || continue

    # Check heartbeat age
    local age
    age=$(file_age_seconds "$lf")
    if [[ $age -gt $HEARTBEAT_STALE_SECONDS ]]; then continue; fi

    # Check PID alive
    if ! pid_alive "$pid"; then continue; fi

    if [[ "$first" == "true" ]]; then
      first=false
    else
      active_json="${active_json},"
    fi
    active_json="${active_json}${content}"
  done

  active_json="${active_json}]"
  echo "$active_json"
}

cmd_count() {
  local count=0

  for lf in "$SESSIONS_DIR"/*.lock; do
    [[ -f "$lf" ]] || continue
    [[ "$lf" == *.flock ]] && continue

    local content
    content=$(cat "$lf" 2>/dev/null) || continue
    local pid
    pid=$(echo "$content" | grep -o '"pid": *[0-9]*' | grep -o '[0-9]*') || continue

    local age
    age=$(file_age_seconds "$lf")
    if [[ $age -gt $HEARTBEAT_STALE_SECONDS ]]; then continue; fi
    if ! pid_alive "$pid"; then continue; fi

    count=$((count + 1))
  done

  echo "$count"
}

cmd_stale() {
  local stale_json="["
  local first=true

  for lf in "$SESSIONS_DIR"/*.lock; do
    [[ -f "$lf" ]] || continue
    [[ "$lf" == *.flock ]] && continue

    local content
    content=$(cat "$lf" 2>/dev/null) || continue
    local pid
    pid=$(echo "$content" | grep -o '"pid": *[0-9]*' | grep -o '[0-9]*') || continue

    local age
    age=$(file_age_seconds "$lf")
    local alive=true
    pid_alive "$pid" || alive=false

    if [[ $age -gt $HEARTBEAT_STALE_SECONDS ]] || [[ "$alive" == "false" ]]; then
      if [[ "$first" == "true" ]]; then first=false; else stale_json="${stale_json},"; fi
      stale_json="${stale_json}${content}"
    fi
  done

  stale_json="${stale_json}]"
  echo "$stale_json"
}

cmd_clean() {
  local cleaned=0

  for lf in "$SESSIONS_DIR"/*.lock; do
    [[ -f "$lf" ]] || continue
    [[ "$lf" == *.flock ]] && continue

    local content
    content=$(cat "$lf" 2>/dev/null) || continue
    local pid session_id
    pid=$(echo "$content" | grep -o '"pid": *[0-9]*' | grep -o '[0-9]*') || continue
    session_id=$(echo "$content" | grep -o '"id": *"[^"]*"' | sed 's/"id": *"//;s/"//') || continue

    local age
    age=$(file_age_seconds "$lf")
    local alive=true
    pid_alive "$pid" || alive=false

    if [[ $age -gt $HEARTBEAT_STALE_SECONDS ]] || [[ "$alive" == "false" ]]; then
      rm -f "$lf" "${lf}.flock"
      emit_event "$session_id" "session:stale-cleaned"
      cleaned=$((cleaned + 1))
    fi
  done

  echo "cleaned: $cleaned"
}

cmd_claim() {
  local session_id="$1"
  local paths_csv="$2"
  local lf
  lf="$(lock_file "$session_id")"

  if [[ ! -f "$lf" ]]; then
    echo "error: no lock file for $session_id" >&2
    return 1
  fi

  # Build JSON array from CSV
  local json_arr="["
  local first=true
  IFS=',' read -ra PATHS <<< "$paths_csv"
  for p in "${PATHS[@]}"; do
    if [[ "$first" == "true" ]]; then first=false; else json_arr="${json_arr},"; fi
    json_arr="${json_arr}\"${p}\""
  done
  json_arr="${json_arr}]"

  local content
  content=$(cat "$lf")
  local updated
  updated=$(echo "$content" | sed "s/\"claiming\": *\[[^]]*\]/\"claiming\": ${json_arr}/")
  updated=$(echo "$updated" | sed "s/\"heartbeat\": *\"[^\"]*\"/\"heartbeat\": \"$(now_iso)\"/")
  flock_write "$lf" "$updated"
}

cmd_check_claim() {
  local session_id="$1"
  local check_path="$2"
  local conflicts=""

  for lf in "$SESSIONS_DIR"/*.lock; do
    [[ -f "$lf" ]] || continue
    [[ "$lf" == *.flock ]] && continue

    local content
    content=$(cat "$lf" 2>/dev/null) || continue
    local other_id
    other_id=$(echo "$content" | grep -o '"id": *"[^"]*"' | sed 's/"id": *"//;s/"//') || continue
    [[ "$other_id" == "$session_id" ]] && continue

    # Check PID alive and not stale
    local pid
    pid=$(echo "$content" | grep -o '"pid": *[0-9]*' | grep -o '[0-9]*') || continue
    local age
    age=$(file_age_seconds "$lf")
    if [[ $age -gt $HEARTBEAT_STALE_SECONDS ]]; then continue; fi
    pid_alive "$pid" || continue

    # Extract claiming array (simple grep, not full JSON parse)
    local claims
    claims=$(echo "$content" | grep -o '"claiming": *\[[^]]*\]' | sed 's/"claiming": *\[//;s/\]//;s/"//g;s/,/ /g')

    for claimed in $claims; do
      if [[ "$check_path" == "$claimed"* ]] || [[ "$claimed" == "$check_path"* ]]; then
        conflicts="${conflicts}${other_id}:${claimed} "
      fi
    done
  done

  if [[ -n "$conflicts" ]]; then
    echo "conflict: $conflicts"
    return 1
  else
    echo "clear"
    return 0
  fi
}

cmd_merge() {
  local session_branch="$1"
  local target_branch="$2"
  local session_id="$3"
  local work_dir="${4:-$REPO_DIR}"

  # Enqueue
  local entry="{\"session\":\"${session_id}\",\"branch\":\"${session_branch}\",\"targetBranch\":\"${target_branch}\",\"ts\":\"$(now_iso)\",\"status\":\"pending\"}"
  flock_append "$(merge_queue)" "$entry"
  emit_event "$session_id" "merge:enqueued" "branch=$session_branch" "target=$target_branch"

  # Acquire merge lock with timeout
  local ml
  ml="$(merge_lock)"
  local deadline=$(( $(date +%s) + MERGE_LOCK_TIMEOUT_SECONDS ))

  while true; do
    if (set -o noclobber; echo "{\"session\":\"${session_id}\",\"ts\":\"$(now_iso)\"}" > "$ml") 2>/dev/null; then
      break
    fi

    # Check if existing lock is stale
    if [[ -f "$ml" ]]; then
      local lock_age
      lock_age=$(file_age_seconds "$ml")
      if [[ $lock_age -gt $MERGE_LOCK_TIMEOUT_SECONDS ]]; then
        rm -f "$ml"
        continue
      fi
    fi

    if [[ $(date +%s) -ge $deadline ]]; then
      echo "error: merge lock timeout after ${MERGE_LOCK_TIMEOUT_SECONDS}s" >&2
      return 1
    fi

    sleep "$MERGE_RETRY_SECONDS"
  done

  # We have the lock — merge
  trap 'rm -f "$ml"' EXIT

  emit_event "$session_id" "merge:start" "branch=$session_branch" "target=$target_branch"

  cd "$work_dir"

  if ! git checkout "$target_branch" 2>&1; then
    echo "error: failed to checkout $target_branch" >&2
    rm -f "$ml"
    trap - EXIT
    return 1
  fi

  # Pull latest target
  git pull --rebase origin "$target_branch" 2>/dev/null || {
    git rebase --abort 2>/dev/null || true
    git pull origin "$target_branch" 2>/dev/null || true
  }

  # Merge session branch
  if git merge "$session_branch" --no-ff -m "merge: session ${session_id} (${session_branch})" 2>&1; then
    git push origin "$target_branch" 2>/dev/null || true
    emit_event "$session_id" "merge:complete" "branch=$session_branch" "target=$target_branch"
    echo "merged: $session_branch -> $target_branch"
    rm -f "$ml"
    trap - EXIT
    return 0
  else
    # Conflict
    local conflict_files
    conflict_files=$(git diff --name-only --diff-filter=U 2>/dev/null || echo "unknown")
    git merge --abort 2>/dev/null || true
    emit_event "$session_id" "merge:conflict" "branch=$session_branch" "target=$target_branch"
    echo "conflict: $conflict_files" >&2
    rm -f "$ml"
    trap - EXIT
    return 1
  fi
}

cmd_emit() {
  local session_id="$1"
  local event_type="$2"
  shift 2 || true
  emit_event "$session_id" "$event_type" "$@"
  echo "emitted: $event_type"
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

case "${1:-help}" in
  register)     cmd_register "${2:?session-id required}" "${3:?branch required}" "${4:-null}" ;;
  heartbeat)    cmd_heartbeat "${2:?session-id required}" ;;
  unregister)   cmd_unregister "${2:?session-id required}" ;;
  active)       cmd_active ;;
  count)        cmd_count ;;
  stale)        cmd_stale ;;
  clean)        cmd_clean ;;
  claim)        cmd_claim "${2:?session-id required}" "${3:?paths required}" ;;
  check-claim)  cmd_check_claim "${2:?session-id required}" "${3:?path required}" ;;
  merge)        cmd_merge "${2:?session-branch required}" "${3:?target-branch required}" "${4:?session-id required}" "${5:-}" ;;
  emit)         cmd_emit "${2:?session-id required}" "${3:?event-type required}" "${@:4}" ;;
  help|--help|-h)
    echo "Usage: session-lock.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  register <id> <branch> [worktree]   Register a new session"
    echo "  heartbeat <id>                       Update session heartbeat"
    echo "  unregister <id>                      Remove session lock"
    echo "  active                               List active sessions (JSON)"
    echo "  count                                Count active sessions"
    echo "  stale                                List stale sessions (JSON)"
    echo "  clean                                Remove stale lock files"
    echo "  claim <id> <path,path,...>            Declare file claims"
    echo "  check-claim <id> <path>              Check for claim conflicts"
    echo "  merge <branch> <target> <id> [cwd]   Sequenced merge with lock"
    echo "  emit <id> <event> [key=val...]        Emit event"
    ;;
  *)
    echo "Unknown command: $1 (try --help)" >&2
    exit 1
    ;;
esac
