#!/bin/bash
#
# Verification script for hook fixes
# Run this to verify all fixes are working correctly
#

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  JFL Hook Fixes - Verification Script"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test 1: Validate production settings
echo "✓ Test 1: Production settings validation"
if jfl validate-settings > /dev/null 2>&1; then
  echo "  ✓ Production settings are valid"
else
  echo "  ✗ Production settings failed validation"
  exit 1
fi
echo ""

# Test 2: Check matcher fields exist
echo "✓ Test 2: Matcher fields present"
if grep -q '"matcher": ""' .claude/settings.json; then
  MATCHER_COUNT=$(grep -c '"matcher": ""' .claude/settings.json)
  echo "  ✓ Found $MATCHER_COUNT matcher fields"
else
  echo "  ✗ No matcher fields found"
  exit 1
fi
echo ""

# Test 3: Verify context-hub stop removed
echo "✓ Test 3: Context-hub stop removed"
if grep -q "jfl context-hub stop" .claude/settings.json; then
  echo "  ✗ context-hub stop still present in settings"
  exit 1
else
  echo "  ✓ context-hub stop successfully removed"
fi
echo ""

# Test 4: Validate template settings
echo "✓ Test 4: Template settings validation"
CURRENT_DIR=$(pwd)
cd template
if [ -f .claude/settings.json ]; then
  if jfl validate-settings > /dev/null 2>&1; then
    echo "  ✓ Template settings are valid"
  else
    echo "  ✗ Template settings failed validation"
    cd "$CURRENT_DIR"
    exit 1
  fi
else
  echo "  ⚠  Template settings not found (skipping)"
fi
cd "$CURRENT_DIR"
echo ""

# Test 5: Check template context-hub stop removed
echo "✓ Test 5: Template context-hub stop removed"
if grep -q "jfl context-hub stop" template/.claude/settings.json 2>/dev/null; then
  echo "  ✗ context-hub stop still present in template"
  exit 1
else
  echo "  ✓ Template context-hub stop successfully removed"
fi
echo ""

# Test 6: Test detection of broken settings
echo "✓ Test 6: Detection of broken settings"
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/.claude"
cat > "$TMPDIR/.claude/settings.json" << 'EOF'
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{"type": "command", "command": "echo test"}]
      }
    ]
  }
}
EOF

cd "$TMPDIR"
if ! jfl validate-settings > /dev/null 2>&1; then
  echo "  ✓ Correctly detected missing matcher field"
else
  echo "  ✗ Failed to detect missing matcher field"
  rm -rf "$TMPDIR"
  cd "$CURRENT_DIR"
  exit 1
fi
cd "$CURRENT_DIR"
rm -rf "$TMPDIR"
echo ""

# Test 7: Test auto-fix
echo "✓ Test 7: Auto-fix functionality"
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/.claude"
cat > "$TMPDIR/.claude/settings.json" << 'EOF'
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {"type": "command", "command": "jfl context-hub stop"}
        ]
      }
    ]
  }
}
EOF

cd "$TMPDIR"
if jfl validate-settings --fix > /dev/null 2>&1; then
  if ! grep -q "jfl context-hub stop" .claude/settings.json; then
    echo "  ✓ Auto-fix successfully removed context-hub stop"
  else
    echo "  ✗ Auto-fix failed to remove context-hub stop"
    rm -rf "$TMPDIR"
    cd "$CURRENT_DIR"
    exit 1
  fi
else
  echo "  ✗ Auto-fix failed"
  rm -rf "$TMPDIR"
  cd "$CURRENT_DIR"
  exit 1
fi
cd "$CURRENT_DIR"
rm -rf "$TMPDIR"
echo ""

# Test 8: Build succeeded
echo "✓ Test 8: Build artifacts present"
if [ -f dist/commands/validate-settings.js ]; then
  echo "  ✓ validate-settings command built"
else
  echo "  ✗ validate-settings command not found"
  exit 1
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ All verifications passed!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Summary:"
echo "  • Production settings: Valid"
echo "  • Template settings: Valid"
echo "  • Matcher fields: Present"
echo "  • Context-hub stop: Removed"
echo "  • Validation command: Working"
echo "  • Auto-fix: Working"
echo "  • Build: Complete"
echo ""
echo "✓ Safe to commit and deploy"
echo ""
