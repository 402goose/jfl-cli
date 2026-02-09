#!/bin/bash
#
# Session Cleanup - Auto-merge and remove worktree if safe
#
# Called by Stop hook to clean up session branches automatically.
# Only keeps branches that have real conflicts or uncommitted work.

set -e

# Stop background processes first
echo "Stopping background processes..."

# Stop auto-commit if running
if [ -f ".jfl/auto-commit.pid" ]; then
  PID=$(cat ".jfl/auto-commit.pid")
  if kill -0 "$PID" 2>/dev/null; then
    echo "  Stopping auto-commit (PID: $PID)..."
    kill -TERM "$PID" 2>/dev/null || true
    sleep 1
    # Force kill if still running
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f ".jfl/auto-commit.pid"
fi

# Stop auto-merge if running
if [ -f ".auto-merge.pid" ]; then
  PID=$(cat ".auto-merge.pid")
  if kill -0 "$PID" 2>/dev/null; then
    echo "  Stopping auto-merge (PID: $PID)..."
    kill -TERM "$PID" 2>/dev/null || true
    sleep 1
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f ".auto-merge.pid"
fi

# Stop context-hub if running (already handled by Stop hook, but be defensive)
if [ -f ".jfl/context-hub.pid" ]; then
  PID=$(cat ".jfl/context-hub.pid")
  if kill -0 "$PID" 2>/dev/null; then
    echo "  Stopping context-hub (PID: $PID)..."
    kill -TERM "$PID" 2>/dev/null || true
    sleep 1
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f ".jfl/context-hub.pid"
fi

# Get current session info
BRANCH=$(git branch --show-current 2>/dev/null || echo "")
if [ -z "$BRANCH" ]; then
  echo "Not on a branch, skipping cleanup"
  exit 0
fi

# Skip if not a session branch
if [[ ! "$BRANCH" =~ ^session- ]]; then
  echo "Not a session branch, skipping cleanup"
  exit 0
fi

# Auto-commit any uncommitted changes first
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Auto-committing changes..."

  # Check if last commit is already "session: end" (make idempotent)
  LAST_MSG=$(git log -1 --pretty=%s 2>/dev/null || echo "")
  if [[ "$LAST_MSG" =~ ^session:\ end ]]; then
    echo "Last commit already is 'session: end', skipping duplicate commit"
  else
    git add -A
    # Unstage session metadata files that should never be committed
    git reset HEAD .jfl/current-session-branch.txt 2>/dev/null || true
    git reset HEAD .jfl/current-worktree.txt 2>/dev/null || true
    git reset HEAD .jfl/worktree-path.txt 2>/dev/null || true
    git commit -m "session: end $(date +%Y-%m-%d\ %H:%M)" || true
  fi
fi

# Detect main repo location (we're in a worktree)
MAIN_REPO=$(git rev-parse --git-common-dir 2>/dev/null | sed 's|/\.git$||')
if [ -z "$MAIN_REPO" ] || [ ! -d "$MAIN_REPO" ]; then
  # Fallback: find parent directory
  MAIN_REPO=$(git worktree list | grep "(bare)" | awk '{print $1}' | head -1)
  if [ -z "$MAIN_REPO" ]; then
    MAIN_REPO=$(git worktree list | head -1 | awk '{print $1}')
  fi
fi

# Pre-merge cleanup: Remove files that will definitely conflict
echo "Pre-merge cleanup..."
git rm -f .jfl/current-session-branch.txt 2>/dev/null || true
git rm -f .jfl/current-worktree.txt 2>/dev/null || true
git rm -f .jfl/worktree-path.txt 2>/dev/null || true

# Remove any git conflict artifacts from previous failed merges
find .jfl -name "journal~*" -type f -delete 2>/dev/null || true

# Commit cleanup if there are changes
if ! git diff --quiet HEAD 2>/dev/null; then
  git commit -m "cleanup: remove session metadata before merge" 2>/dev/null || true
fi

# Try to merge to main
echo "Attempting to merge $BRANCH to main..."
cd "$MAIN_REPO"

# Checkout main in the main repo
if ! git checkout main 2>/dev/null; then
  echo "⚠ Could not checkout main, skipping merge"
  echo "  Session branch $BRANCH preserved for manual merge"
  exit 0
fi

# Attempt merge with auto-resolve for .jfl/ conflicts
MERGE_OUTPUT=$(git merge --no-edit -X ours "$BRANCH" 2>&1)
MERGE_STATUS=$?

if [ $MERGE_STATUS -eq 0 ]; then
  echo "✓ Merged $BRANCH to main"

  # Push to origin
  git push origin main 2>/dev/null || echo "⚠ Push failed - run manually: git push origin main"

  # Remove worktree if it exists
  WORKTREE_PATH=$(git worktree list | grep "$BRANCH" | awk '{print $1}' | head -1)
  if [ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ]; then
    echo "Removing worktree at $WORKTREE_PATH..."
    rm -rf "$WORKTREE_PATH" 2>/dev/null || true
    git worktree prune 2>/dev/null || true
  fi

  # Delete the branch
  echo "Deleting branch $BRANCH..."
  git branch -D "$BRANCH" 2>/dev/null || true

  echo "✓ Session cleanup complete - merged to main and pushed"
else
  # Merge failed - try auto-resolving common conflicts
  echo "Initial merge failed, attempting auto-resolve..."

  # Check what conflicts we have
  CONFLICTS=$(git diff --name-only --diff-filter=U 2>/dev/null)

  AUTO_RESOLVED=true
  while IFS= read -r file; do
    if [[ -z "$file" ]]; then
      continue
    fi

    case "$file" in
      .jfl/current-session-branch.txt|.jfl/current-worktree.txt|.jfl/worktree-path.txt)
        # Session metadata - just remove it
        echo "  Auto-resolving: $file (removing)"
        git rm -f "$file" 2>/dev/null || true
        ;;
      .jfl/journal~*)
        # Git conflict artifact - remove it
        echo "  Auto-resolving: $file (removing artifact)"
        git rm -f "$file" 2>/dev/null || true
        ;;
      product)
        # Product directory conflict (likely symlink vs dir)
        # Keep main's version (which should be platform symlink or nothing)
        echo "  Auto-resolving: $file (keeping main's version)"
        git checkout --ours "$file" 2>/dev/null || git rm -f "$file" 2>/dev/null || true
        ;;
      platform|cli|runner)
        # Submodule conflicts - keep main's version
        echo "  Auto-resolving: $file (keeping main's submodule state)"
        git checkout --ours "$file" 2>/dev/null || true
        ;;
      *)
        # Unknown conflict - can't auto-resolve
        echo "  ⚠ Cannot auto-resolve: $file"
        AUTO_RESOLVED=false
        ;;
    esac
  done <<< "$CONFLICTS"

  if [ "$AUTO_RESOLVED" = true ]; then
    # All conflicts resolved, complete the merge
    echo "All conflicts auto-resolved, completing merge..."
    git add -A
    git commit --no-edit 2>/dev/null || true

    echo "✓ Merged $BRANCH to main (with auto-resolution)"

    # Push to origin
    git push origin main 2>/dev/null || echo "⚠ Push failed - run manually: git push origin main"

    # Remove worktree
    WORKTREE_PATH=$(git worktree list | grep "$BRANCH" | awk '{print $1}' | head -1)
    if [ -n "$WORKTREE_PATH" ] && [ -d "$WORKTREE_PATH" ]; then
      echo "Removing worktree at $WORKTREE_PATH..."
      rm -rf "$WORKTREE_PATH" 2>/dev/null || true
      git worktree prune 2>/dev/null || true
    fi

    # Delete the branch
    echo "Deleting branch $BRANCH..."
    git branch -D "$BRANCH" 2>/dev/null || true

    echo "✓ Session cleanup complete - merged to main and pushed"
  else
    # Still have unresolved conflicts
    echo "⚠ Merge conflicts remain, keeping branch $BRANCH"
    echo "  Review later with: git log main..$BRANCH"
    echo "  Conflicting files:"
    git diff --name-only --diff-filter=U 2>/dev/null | sed 's/^/    - /'
    git merge --abort 2>/dev/null || true
  fi
fi

exit 0
