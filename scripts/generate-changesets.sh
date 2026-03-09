#!/usr/bin/env bash
set -euo pipefail

# Generates changeset files from conventional commit messages.
#
# Reads commits since the last git tag (or since initial commit) and creates
# .changeset/<hash>.md files for each feat:/fix:/perf: commit.
#
# Commit message format → bump level:
#   feat!: ...          → major
#   fix!: ...           → major
#   BREAKING CHANGE     → major
#   feat: ...           → minor
#   fix: ...            → patch
#   perf: ...           → patch
#   docs: ...           → skipped
#   chore: ...          → skipped
#   ci: ...             → skipped
#   test: ...           → skipped
#   refactor: ...       → skipped (no user-facing change)
#   auto: ...           → skipped
#   save: ...           → skipped
#   session: ...        → skipped
#   merge: ...          → skipped
#
# Usage:
#   ./scripts/generate-changesets.sh          # auto-detect last tag
#   ./scripts/generate-changesets.sh v0.3.0   # explicit base ref
#   DRY_RUN=1 ./scripts/generate-changesets.sh  # preview without writing

PKG_NAME=$(node -p "require('./package.json').name")
CHANGESET_DIR=".changeset"

# Find the base ref (last tag, or root commit)
if [ -n "${1:-}" ]; then
  BASE_REF="$1"
elif git describe --tags --abbrev=0 HEAD 2>/dev/null; then
  BASE_REF=$(git describe --tags --abbrev=0 HEAD 2>/dev/null)
else
  BASE_REF=$(git rev-list --max-parents=0 HEAD)
fi

echo "Base: $BASE_REF"
echo "Package: $PKG_NAME"
echo "---"

CREATED=0
SKIPPED=0

while IFS= read -r line; do
  HASH=$(echo "$line" | cut -d' ' -f1)
  MSG=$(echo "$line" | cut -d' ' -f2-)

  # Determine bump level from commit message
  LEVEL=""
  SUMMARY=""

  # Check for breaking changes first
  if echo "$MSG" | grep -qiE '^(feat|fix|refactor|perf)!:'; then
    LEVEL="major"
    SUMMARY=$(echo "$MSG" | sed -E 's/^[a-z]+!:\s*//')
  elif echo "$MSG" | grep -qi 'BREAKING CHANGE'; then
    LEVEL="major"
    SUMMARY="$MSG"
  elif echo "$MSG" | grep -qE '^feat(\(.+\))?:'; then
    LEVEL="minor"
    SUMMARY=$(echo "$MSG" | sed -E 's/^feat(\([^)]+\))?:\s*//')
  elif echo "$MSG" | grep -qE '^fix(\(.+\))?:'; then
    LEVEL="patch"
    SUMMARY=$(echo "$MSG" | sed -E 's/^fix(\([^)]+\))?:\s*//')
  elif echo "$MSG" | grep -qE '^perf(\(.+\))?:'; then
    LEVEL="patch"
    SUMMARY=$(echo "$MSG" | sed -E 's/^perf(\([^)]+\))?:\s*//')
  fi

  # Skip non-release commits
  if [ -z "$LEVEL" ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Generate a short hash for the filename
  SHORT=$(echo "$HASH" | cut -c1-8)
  FILENAME="$CHANGESET_DIR/commit-$SHORT.md"

  # Skip if changeset already exists for this commit
  if [ -f "$FILENAME" ]; then
    echo "  skip (exists): $SHORT $MSG"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  if [ "${DRY_RUN:-}" = "1" ]; then
    echo "  would create ($LEVEL): $SUMMARY"
  else
    mkdir -p "$CHANGESET_DIR"
    cat > "$FILENAME" <<EOF
---
"$PKG_NAME": $LEVEL
---

$SUMMARY
EOF
    echo "  created ($LEVEL): $SUMMARY"
  fi

  CREATED=$((CREATED + 1))

done < <(git log --oneline "$BASE_REF"..HEAD --no-merges --reverse)

echo "---"
echo "Created: $CREATED changesets"
echo "Skipped: $SKIPPED commits"
