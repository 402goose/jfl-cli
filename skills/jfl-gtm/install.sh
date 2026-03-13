#!/bin/bash
# Install jfl-gtm skill into OpenClaw
# Usage: ./install.sh
#
# Copies skill to ~/.openclaw/skills/jfl-gtm/ (managed tier)
# so OpenClaw discovers it automatically on next session.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${OPENCLAW_SKILLS_DIR:-$HOME/.openclaw/skills}/jfl-gtm"

echo "Installing jfl-gtm skill..."
echo "  Source: $SCRIPT_DIR"
echo "  Target: $TARGET_DIR"
echo ""

mkdir -p "$TARGET_DIR"

cp "$SCRIPT_DIR/SKILL.md" "$TARGET_DIR/"
cp "$SCRIPT_DIR/README.md" "$TARGET_DIR/"
cp "$SCRIPT_DIR/CONFIGURATION.md" "$TARGET_DIR/"
cp -r "$SCRIPT_DIR/bin" "$TARGET_DIR/"
cp -r "$SCRIPT_DIR/config" "$TARGET_DIR/"
[[ -d "$SCRIPT_DIR/test" ]] && cp -r "$SCRIPT_DIR/test" "$TARGET_DIR/"

chmod +x "$TARGET_DIR/bin/"*

echo "✅ Installed jfl-gtm skill to $TARGET_DIR"
echo ""

if command -v openclaw &>/dev/null; then
  echo "Verifying OpenClaw discovery..."
  if openclaw skills list 2>/dev/null | grep -q "jfl-gtm"; then
    echo "  ✅ OpenClaw sees jfl-gtm"
  else
    echo "  ⚠️  OpenClaw doesn't see it yet (restart or run: openclaw skills check)"
  fi
else
  echo "OpenClaw not installed — skill is ready for when it is."
fi

echo ""
echo "Quick start:"
echo "  1. Add workspace:  $TARGET_DIR/bin/config add ~/code/my-gtm"
echo "  2. Start session:  $TARGET_DIR/bin/session start"
echo "  3. Or in OpenClaw: /jfl_gtm"
