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
# Step 0: Sync repos to latest (prevent context loss)
# ==============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  JFL Session Init"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Sync repos before creating worktree (ensures worktree is from latest main)
if [[ -x "$SCRIPT_DIR/session-sync.sh" ]]; then
    echo ""
    "$SCRIPT_DIR/session-sync.sh" || {
        echo -e "${YELLOW}⚠${NC}  Session sync failed, continuing with local state"
    }
fi

# ==============================================================================
# Step 1: Quick health check (warn only)
# ==============================================================================

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
# Step 2.5: Crash Reconciliation - Check for uncommitted work in stale sessions
# ==============================================================================

if [[ -d "$WORKTREES_DIR" ]]; then
    worktrees_with_changes=""
    change_count=0

    for worktree in "$WORKTREES_DIR"/session-*; do
        if [[ -d "$worktree" ]]; then
            # Check if worktree has uncommitted changes
            cd "$worktree"
            if [[ -n $(git status --porcelain 2>/dev/null) ]]; then
                session_name=$(basename "$worktree")
                worktrees_with_changes="$worktrees_with_changes $session_name"
                change_count=$((change_count + 1))
            fi
            cd "$REPO_DIR"
        fi
    done

    if [[ $change_count -gt 0 ]]; then
        echo ""
        echo -e "${RED}⚠${NC}  Found $change_count session(s) with uncommitted work"
        echo ""

        for session in $worktrees_with_changes; do
            worktree_path="$WORKTREES_DIR/$session"
            cd "$worktree_path"
            files=$(git status --porcelain | wc -l | tr -d ' ')
            echo "  • $session ($files files)"
            cd "$REPO_DIR"
        done

        echo ""
        echo -e "${YELLOW}This work needs to be saved before continuing.${NC}"
        echo ""

        # Check if running non-interactively (hook context)
        if [[ ! -t 0 ]]; then
            # Non-interactive - auto-commit (safest)
            echo "Running non-interactively - auto-committing all changes..."
            choice="1"
        else
            # Interactive - ask user
            echo "Options:"
            echo "  1) Auto-commit all and continue (safest - no work lost)"
            echo "  2) Show me the changes (for review)"
            echo "  3) Skip for now (manual cleanup)"
            echo ""
            read -p "Choose [1-3]: " choice
        fi

        case "$choice" in
            1)
                echo ""
                echo -e "${CYAN}→${NC}  Auto-committing all changes..."
                for session in $worktrees_with_changes; do
                    worktree_path="$WORKTREES_DIR/$session"
                    cd "$worktree_path"

                    if [[ -n $(git status --porcelain 2>/dev/null) ]]; then
                        # Critical paths
                        git add knowledge/ previews/ content/ suggestions/ CLAUDE.md .jfl/ 2>/dev/null || true

                        if git commit -m "crash recovery: auto-save uncommitted work from $session" 2>/dev/null; then
                            echo -e "  ${GREEN}✓${NC} $session - committed and saved"
                            git push origin "$(git branch --show-current)" 2>/dev/null || true
                        fi
                    fi

                    cd "$REPO_DIR"
                done
                echo ""
                echo -e "${GREEN}✓${NC} All changes saved. Continuing..."
                ;;
            2)
                echo ""
                for session in $worktrees_with_changes; do
                    worktree_path="$WORKTREES_DIR/$session"
                    echo "─────────────────────────────────────"
                    echo "$session:"
                    echo ""
                    cd "$worktree_path"
                    git status --short
                    cd "$REPO_DIR"
                    echo ""
                done
                echo "─────────────────────────────────────"
                echo ""
                read -p "Commit these changes? [y/N]: " commit_choice
                if [[ "$commit_choice" =~ ^[Yy]$ ]]; then
                    for session in $worktrees_with_changes; do
                        worktree_path="$WORKTREES_DIR/$session"
                        cd "$worktree_path"
                        git add knowledge/ previews/ content/ suggestions/ CLAUDE.md .jfl/ 2>/dev/null || true
                        git commit -m "crash recovery: manual save from $session" 2>/dev/null || true
                        git push origin "$(git branch --show-current)" 2>/dev/null || true
                        cd "$REPO_DIR"
                    done
                    echo -e "${GREEN}✓${NC} Changes committed"
                fi
                ;;
            3)
                echo ""
                echo -e "${YELLOW}Skipping crash recovery.${NC}"
                echo "You can manually handle these sessions later."
                echo ""
                ;;
            *)
                echo ""
                echo -e "${RED}Invalid choice. Skipping.${NC}"
                ;;
        esac
    fi
fi

# ==============================================================================
# Step 2.9: Check for concurrent sessions via jfl-services
# ==============================================================================

# Generate session details first
user=$(git config user.name 2>/dev/null | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-' || echo "user")
user="${user:0:30}"
date_str=$(date +%Y%m%d)
time_str=$(date +%H%M)
random_id=$(openssl rand -hex 3 2>/dev/null || printf "%06x" $RANDOM$RANDOM)
session_name="session-${user}-${date_str}-${time_str}-${random_id}"

# Get working branch (from config or current branch)
working_branch=$(jq -r '.working_branch // empty' .jfl/config.json 2>/dev/null)
if [[ -z "$working_branch" ]]; then
    working_branch=$(git branch --show-current)
fi

# Check for concurrent sessions via jfl-services API
use_worktree=false
api_response=""
if command -v curl >/dev/null 2>&1; then
    api_response=$(curl -s -X GET "http://localhost:3401/sessions/active?projectPath=$(pwd)" 2>/dev/null || echo "")

    if [[ -n "$api_response" ]] && echo "$api_response" | jq -e '.count' >/dev/null 2>&1; then
        session_count=$(echo "$api_response" | jq -r '.count // 0')

        if [[ $session_count -gt 0 ]]; then
            use_worktree=true
            echo -e "${YELLOW}→${NC}  Multiple sessions detected ($session_count active) - using worktree for isolation"
        else
            echo -e "${GREEN}→${NC}  Single session - working directly on branch $working_branch"
        fi
    else
        # API unavailable - fall back to local detection
        echo -e "${YELLOW}→${NC}  jfl-services unavailable - checking locally..."
        local_sessions=$(ps aux | grep -c "claude.*$(pwd)" 2>/dev/null || echo "1")
        if [[ $local_sessions -gt 2 ]]; then
            use_worktree=true
            echo -e "${YELLOW}→${NC}  Multiple processes detected - using worktree for isolation"
        fi
    fi
else
    # No curl - assume single session
    echo -e "${GREEN}→${NC}  Working directly on branch $working_branch"
fi

# Register this session with jfl-services
if command -v curl >/dev/null 2>&1; then
    curl -s -X POST "http://localhost:3401/sessions/start" \
        -H "Content-Type: application/json" \
        -d "{\"id\":\"$session_name\",\"projectPath\":\"$(pwd)\",\"branch\":\"$working_branch\",\"user\":\"$user\",\"pid\":$$,\"worktree\":\"$use_worktree\"}" \
        >/dev/null 2>&1 || true
fi

# ==============================================================================
# Step 3: Create worktree (if needed) or work directly
# ==============================================================================

if [[ "$use_worktree" == "true" ]]; then
    # WORKTREE MODE: Multiple sessions detected
    echo ""
    echo "Creating worktree session: $session_name"

    worktree_path="$WORKTREES_DIR/$session_name"

    # Create worktree
    if git worktree add "$worktree_path" -b "$session_name" 2>&1 | head -3; then
        echo -e "${GREEN}✓${NC}  Worktree created"
    else
        echo -e "${RED}✗${NC}  Failed to create worktree"
        # Fall back to direct branch mode
        use_worktree=false
    fi

    if [[ "$use_worktree" == "true" ]]; then
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
        rm -rf .jfl/journal 2>/dev/null || true
        ln -sf "$REPO_DIR/.jfl/journal" .jfl/journal
        echo -e "${GREEN}✓${NC}  Journal symlinked to main repo"

        # Start auto-commit in background
        if [[ -x "$SCRIPT_DIR/auto-commit.sh" ]]; then
            "$SCRIPT_DIR/auto-commit.sh" start >> .jfl/logs/auto-commit.log 2>&1 &
            echo -e "${GREEN}✓${NC}  Auto-commit started"
        fi

        cd "$REPO_DIR"

        # Save paths
        echo "$worktree_path" > "$REPO_DIR/.jfl/current-worktree.txt"
        echo "$session_name" > "$REPO_DIR/.jfl/current-session-branch.txt"
        echo "$session_name" > "$worktree_path/.jfl/current-session-branch.txt"

        echo ""
        echo -e "${GREEN}✓${NC}  Session ready in worktree: $worktree_path"
        echo ""
    fi
fi

if [[ "$use_worktree" != "true" ]]; then
    # DIRECT MODE: Single session, work on current branch
    echo ""
    echo "Direct session mode: $session_name"

    # Ensure we're on working branch
    current_branch=$(git branch --show-current)
    if [[ "$current_branch" != "$working_branch" ]]; then
        echo "→  Switching to working branch: $working_branch"
        git checkout "$working_branch" 2>&1 | head -3
    fi

    # Create session branch from working branch
    if git checkout -b "$session_name" 2>&1 | head -3; then
        echo -e "${GREEN}✓${NC}  Session branch created: $session_name"
    else
        echo -e "${YELLOW}⚠${NC}  Continuing on branch: $current_branch"
        session_name="$current_branch"
    fi

    # Create session directories
    mkdir -p .jfl/logs

    # Start auto-commit in background
    if [[ -x "$SCRIPT_DIR/auto-commit.sh" ]]; then
        "$SCRIPT_DIR/auto-commit.sh" start >> .jfl/logs/auto-commit.log 2>&1 &
        echo -e "${GREEN}✓${NC}  Auto-commit started"
    fi

    # Save session info (no worktree path in direct mode)
    echo "direct" > "$REPO_DIR/.jfl/current-worktree.txt"
    echo "$session_name" > "$REPO_DIR/.jfl/current-session-branch.txt"

    echo ""
    echo -e "${GREEN}✓${NC}  Session ready on branch: $session_name"
    echo ""
fi
