#!/usr/bin/env bash
#
# session-init.sh - Initialize a JFL session properly
#
# Called by SessionStart hook. Does:
# 1. Quick health check (warn only)
# 2. Create new session branch
# 3. Start auto-commit
#
# @purpose Session initialization with branch creation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${JFL_REPO_DIR:-$(pwd)}"

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

# Sync repos before creating branch (ensures we start from latest main)
if [[ -x "$SCRIPT_DIR/session-sync.sh" ]]; then
    echo ""
    "$SCRIPT_DIR/session-sync.sh" || {
        echo -e "${YELLOW}⚠${NC}  Session sync failed, continuing with local state"
    }
fi

# ==============================================================================
# Step 1: Quick health check (warn only)
# ==============================================================================

# Check for uncommitted changes on main
if [[ -n $(git status --porcelain 2>/dev/null) ]]; then
    echo ""
    echo -e "${YELLOW}⚠${NC}  Uncommitted changes on main branch"
    echo ""

    # List changed files
    git status --short | head -10

    echo ""
    echo -e "${YELLOW}These changes should be committed before starting a session.${NC}"
    echo ""

    # Check if running non-interactively (hook context)
    if [[ ! -t 0 ]]; then
        # Non-interactive - auto-commit (safest)
        echo "Running non-interactively - auto-committing changes..."
        choice="1"
    else
        # Interactive - ask user
        echo "Options:"
        echo "  1) Auto-commit and continue"
        echo "  2) Skip and continue anyway"
        echo "  3) Cancel session start"
        echo ""
        read -p "Choose [1-3]: " choice
    fi

    case "$choice" in
        1)
            echo ""
            echo -e "${CYAN}→${NC}  Auto-committing changes..."
            # Critical paths
            git add knowledge/ previews/ content/ suggestions/ CLAUDE.md .jfl/ 2>/dev/null || true

            if git commit -m "auto: pre-session save" 2>/dev/null; then
                echo -e "  ${GREEN}✓${NC} Changes committed"
                git push origin main 2>/dev/null || true
            fi
            ;;
        2)
            echo ""
            echo -e "${YELLOW}Continuing with uncommitted changes...${NC}"
            ;;
        3)
            echo ""
            echo "Session start cancelled."
            exit 1
            ;;
        *)
            echo ""
            echo -e "${RED}Invalid choice. Continuing anyway.${NC}"
            ;;
    esac
fi

# ==============================================================================
# Step 2: Create new session branch
# ==============================================================================

# Generate session name with collision protection
user=$(git config user.name 2>/dev/null | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-' || echo "user")
# Truncate long usernames to prevent issues
user="${user:0:30}"
date_str=$(date +%Y%m%d)
time_str=$(date +%H%M)

# Generate unique session name, retry if collision detected
max_attempts=5
attempt=0
while [[ $attempt -lt $max_attempts ]]; do
    random_id=$(openssl rand -hex 3 2>/dev/null || printf "%06x" $RANDOM$RANDOM)
    session_name="session-${user}-${date_str}-${time_str}-${random_id}"

    # Check for collision: journal file or branch already exists
    if [[ -f "$REPO_DIR/.jfl/journal/${session_name}.jsonl" ]] || git rev-parse --verify "$session_name" >/dev/null 2>&1; then
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

echo ""
echo "Creating session: $session_name"

# Create session branch from main
if git checkout -b "$session_name" 2>&1 | head -3; then
    echo -e "${GREEN}✓${NC}  Session branch created"
else
    echo -e "${RED}✗${NC}  Failed to create session branch"
    exit 1
fi

# Create session directories
mkdir -p .jfl/logs
mkdir -p .jfl/journal

# Start auto-commit in background
if [[ -x "$SCRIPT_DIR/auto-commit.sh" ]]; then
    "$SCRIPT_DIR/auto-commit.sh" start >> .jfl/logs/auto-commit.log 2>&1 &
    echo -e "${GREEN}✓${NC}  Auto-commit started"
fi

# ==============================================================================
# Step 3: Save state and output instructions
# ==============================================================================

# Save session name
echo "$session_name" > "$REPO_DIR/.jfl/current-session-branch.txt"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${CYAN}Session:${NC} $session_name"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
