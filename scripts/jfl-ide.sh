#!/usr/bin/env bash
# JFL Agent IDE Launcher
# Usage: jfl ide [layout]
#   jfl ide         → default dev layout
#   jfl ide dev     → developer layout
#   jfl ide lead    → engineering lead layout
#   jfl ide portfolio → portfolio owner layout
#   jfl ide onboard → onboarding layout

set -e

LAYOUT="${1:-dev}"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
LAYOUTS_DIR="$PROJECT_ROOT/.jfl/layouts"

# Check tmux-ide is installed
if ! command -v tmux-ide &>/dev/null; then
  echo "tmux-ide not found. Installing..."
  npm install -g tmux-ide
fi

# Check layout exists
if [ "$LAYOUT" = "default" ] || [ -f "$PROJECT_ROOT/ide.yml" ] && [ "$LAYOUT" = "dev" ] && [ ! -f "$LAYOUTS_DIR/$LAYOUT.yml" ]; then
  echo "🚀 Launching JFL IDE (default layout)"
  cd "$PROJECT_ROOT"
  tmux-ide
  exit 0
fi

LAYOUT_FILE="$LAYOUTS_DIR/$LAYOUT.yml"
if [ ! -f "$LAYOUT_FILE" ]; then
  echo "❌ Layout not found: $LAYOUT"
  echo ""
  echo "Available layouts:"
  for f in "$LAYOUTS_DIR"/*.yml; do
    name=$(basename "$f" .yml)
    echo "  - $name"
  done
  exit 1
fi

echo "🚀 Launching JFL IDE ($LAYOUT layout)"

# Copy layout to project root as ide.yml (tmux-ide expects it there)
cp "$LAYOUT_FILE" "$PROJECT_ROOT/ide.yml"

cd "$PROJECT_ROOT"
tmux-ide
