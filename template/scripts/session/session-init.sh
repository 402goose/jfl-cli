#!/usr/bin/env bash
#
# session-init.sh - Initialize a JFL session properly
#
# Called by SessionStart hook. Does:
# 1. Quick doctor check (warn only, don't block)
# 2. Clean up stale sessions if > 5
# 3. Create new worktree for this session
# 4. Output path for Claude to cd into
#
# @purpose Session initialization with worktree creation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${JFL_REPO_DIR:-$(pwd)}"
WORKTREES_DIR="$REPO_DIR/worktrees"

cd "$REPO_DIR" || exit 1

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ==============================================================================
# Step 1: Quick health check (warn only)
# ==============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  JFL Session Init"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Count stale sessions (no PID or PID not running)
stale_count=0
active_count=0

if [[ -d "$WORKTREES_DIR" ]]; then
    for worktree in "$WORKTREES_DIR"/session-*; do
        if [[ -d "$worktree" ]]; then
            pid_file="$worktree/.jfl/auto-commit.pid"
            if [[ -f "$pid_file" ]]; then
                pid=$(cat "$pid_file" 2>/dev/null)
                if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
                    active_count=$((active_count + 1))
                    continue
                fi
            fi
            stale_count=$((stale_count + 1))
        fi
    done
fi

# Report status
if [[ $stale_count -gt 0 ]]; then
    echo -e "${YELLOW}⚠${NC}  $stale_count stale sessions, $active_count active"
else
    echo -e "${GREEN}✓${NC}  $active_count active sessions"
fi

# ==============================================================================
# Step 2: Auto-cleanup if too many stale sessions
# ==============================================================================

if [[ $stale_count -gt 5 ]]; then
    echo -e "${YELLOW}→${NC}  Cleaning up stale sessions (> 5)..."
    "$SCRIPT_DIR/jfl-doctor.sh" --fix 2>/dev/null | grep -E "^  (Cleaning|✓)" || true
fi

# ==============================================================================
# Step 3: Create new worktree
# ==============================================================================

# Generate session name with collision protection
user=$(git config user.name 2>/dev/null | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-' || echo "user")
# Truncate long usernames to prevent path issues
user="${user:0:30}"
date_str=$(date +%Y%m%d)
time_str=$(date +%H%M)

# Generate unique session name, retry if collision detected
max_attempts=5
attempt=0
while [[ $attempt -lt $max_attempts ]]; do
    random_id=$(openssl rand -hex 3 2>/dev/null || printf "%06x" $RANDOM$RANDOM)
    session_name="session-${user}-${date_str}-${time_str}-${random_id}"

    # Check for collision: journal file or worktree already exists
    if [[ -f "$REPO_DIR/.jfl/journal/${session_name}.jsonl" ]] || [[ -d "$WORKTREES_DIR/$session_name" ]]; then
        echo -e "${YELLOW}⚠${NC}  Session name collision, regenerating..."
        attempt=$((attempt + 1))
        sleep 0.1  # Brief pause before retry
    else
        break
    fi
done

if [[ $attempt -ge $max_attempts ]]; then
    echo -e "${RED}✗${NC}  Failed to generate unique session name after $max_attempts attempts"
    exit 1
fi

worktree_path="$WORKTREES_DIR/$session_name"

echo ""
echo "Creating session: $session_name"

# Create worktree
if git worktree add "$worktree_path" -b "$session_name" 2>&1 | head -3; then
    echo -e "${GREEN}✓${NC}  Worktree created"
else
    echo -e "${RED}✗${NC}  Failed to create worktree"
    # Fall back to main branch
    echo "main" > "$REPO_DIR/.jfl/current-worktree.txt"
    echo "main" > "$REPO_DIR/.jfl/current-session-branch.txt"
    exit 0
fi

# Initialize submodules in worktree (quick, no network)
cd "$worktree_path"
if [[ -f ".gitmodules" ]]; then
    if [[ ! -d "product/.git" ]] && [[ ! -f "product/.git" ]]; then
        echo "→  Initializing submodules..."
        git submodule update --init --depth 1 product 2>/dev/null || true
    fi
fi

# Create session directories
mkdir -p .jfl/logs

# CRITICAL: Symlink journal to main repo so entries persist after worktree cleanup
# Without this, journal entries written in worktree are lost when worktree is removed!
rm -rf .jfl/journal 2>/dev/null || true
ln -sf "$REPO_DIR/.jfl/journal" .jfl/journal
echo -e "${GREEN}✓${NC}  Journal symlinked to main repo"

# Start auto-commit in background
if [[ -x "$SCRIPT_DIR/auto-commit.sh" ]]; then
    "$SCRIPT_DIR/auto-commit.sh" start >> .jfl/logs/auto-commit.log 2>&1 &
    echo -e "${GREEN}✓${NC}  Auto-commit started"
fi

cd "$REPO_DIR"

# ==============================================================================
# Step 4: Save state and output instructions
# ==============================================================================

# Save paths
echo "$worktree_path" > "$REPO_DIR/.jfl/current-worktree.txt"
echo "$session_name" > "$REPO_DIR/.jfl/current-session-branch.txt"

# Also save in worktree
echo "$session_name" > "$worktree_path/.jfl/current-session-branch.txt"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${CYAN}CLAUDE: You MUST run:${NC} cd $worktree_path"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
