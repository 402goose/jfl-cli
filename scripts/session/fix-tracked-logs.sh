#!/bin/bash
#
# fix-tracked-logs.sh
#
# Removes .jfl runtime/log files from git tracking and ensures they're gitignored.
# Run this once in any existing JFL project that has these files committed.
#
# Usage:
#   ./scripts/session/fix-tracked-logs.sh

set -e

REPO_DIR="$(git rev-parse --show-toplevel 2>/dev/null)"
if [[ -z "$REPO_DIR" ]]; then
  echo "Error: not in a git repository"
  exit 1
fi
cd "$REPO_DIR"

echo "Checking for tracked runtime files..."

# Files/dirs that should never be in git
RUNTIME_PATTERNS=(
  ".jfl/logs/auto-commit.log"
  ".jfl/logs/session-cleanup.log"
  ".jfl/logs/"
  ".jfl/auto-commit.log"
  ".jfl/auto-commit.pid"
  ".jfl/context-hub.pid"
  ".jfl/.auto-merge.pid"
  ".jfl/memory.db"
  ".jfl/current-session-branch.txt"
  ".jfl/current-worktree.txt"
  ".jfl/worktree-path.txt"
)

UNTRACKED=0
for pattern in "${RUNTIME_PATTERNS[@]}"; do
  if git ls-files --error-unmatch "$pattern" &>/dev/null; then
    echo "  Untracking: $pattern"
    git rm --cached -r "$pattern" 2>/dev/null || true
    UNTRACKED=$((UNTRACKED + 1))
  fi
done

if [[ $UNTRACKED -eq 0 ]]; then
  echo "  Nothing tracked — you're clean."
else
  echo "  Untracked $UNTRACKED file(s)"
fi

# Ensure .gitignore has the right entries
GITIGNORE="$REPO_DIR/.gitignore"
touch "$GITIGNORE"

NEEDS_BLOCK=false
if ! grep -q "JFL runtime" "$GITIGNORE"; then
  NEEDS_BLOCK=true
fi

if [[ "$NEEDS_BLOCK" = true ]]; then
  echo "" >> "$GITIGNORE"
  cat >> "$GITIGNORE" << 'EOF'
# JFL runtime — never commit these
.jfl/logs/
.jfl/*.log
.jfl/*.pid
.jfl/memory.db

# JFL session metadata (ephemeral)
.jfl/current-session-branch.txt
.jfl/current-worktree.txt
.jfl/worktree-path.txt
EOF
  echo "  Added JFL runtime block to .gitignore"
else
  echo "  .gitignore already has JFL runtime entries"
fi

# Commit if there are changes
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  echo ""
  read -r -p "Commit these changes now? [y/N] " REPLY
  if [[ "$REPLY" =~ ^[Yy]$ ]]; then
    git add .gitignore
    git commit -m "chore: untrack jfl runtime files, update gitignore"
    echo "Committed."
  else
    echo "Changes staged but not committed. Run 'git commit' when ready."
  fi
else
  echo ""
  echo "No changes to commit."
fi

echo ""
echo "Done. Run 'jfl update' to push the updated template to this project."
