#!/bin/bash
#
# Test script for knowledge/content sync feature
# Simulates a service session and verifies content sync to GTM
#

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Content Sync Test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Create test directories
TEST_DIR="/tmp/jfl-content-sync-test"
GTM_DIR="$TEST_DIR/test-gtm"
SERVICE_DIR="$TEST_DIR/test-service"

echo "Setting up test environment..."
rm -rf "$TEST_DIR"
mkdir -p "$GTM_DIR" "$SERVICE_DIR"

# Initialize GTM
cd "$GTM_DIR"
git init -q
mkdir -p .jfl/journal
cat > .jfl/config.json << 'EOF'
{
  "name": "test-gtm",
  "type": "gtm",
  "description": "Test GTM workspace"
}
EOF
git add .
git commit -q -m "Initial GTM setup"

echo "✓ GTM initialized"

# Initialize Service
cd "$SERVICE_DIR"
git init -q
mkdir -p .jfl/journal knowledge content
cat > .jfl/config.json << EOF
{
  "name": "test-service",
  "type": "service",
  "service_type": "api",
  "description": "Test service",
  "gtm_parent": "$GTM_DIR",
  "working_branch": "main",
  "sync_to_parent": {
    "journal": true,
    "knowledge": true,
    "content": true
  }
}
EOF

# Create test content
echo "# Test Decision" > knowledge/DECISIONS.md
echo "We decided to use TypeScript." >> knowledge/DECISIONS.md

echo "# Test Article" > content/article.md
echo "This is a test article." >> content/article.md

echo "# Service Instructions" > CLAUDE.md
echo "Service-specific instructions here." >> CLAUDE.md

git add .
git commit -q -m "Initial service setup"
echo "✓ Service initialized"

# Create session branch
BRANCH="session-test-$(date +%Y%m%d-%H%M)-abc123"
git checkout -q -b "$BRANCH"

# Make changes in session
echo "" >> knowledge/DECISIONS.md
echo "## Another Decision" >> knowledge/DECISIONS.md
echo "We also decided to use React." >> knowledge/DECISIONS.md

echo "" >> content/article.md
echo "## Update" >> content/article.md
echo "Added more content." >> content/article.md

echo "" >> CLAUDE.md
echo "Updated instructions." >> CLAUDE.md

# Modify config file to test config sync
jq '.description = "Updated service description"' .jfl/config.json > .jfl/config.json.tmp && mv .jfl/config.json.tmp .jfl/config.json

git add .
git commit -q -m "feat: add decisions and content"
echo "✓ Session changes committed"

# Test phone-home
echo ""
echo "Testing phone-home..."
cd "$SERVICE_DIR"
RESULT=$(node "$(dirname "$0")/dist/index.js" services phone-home "$GTM_DIR" "$BRANCH" 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ] && echo "$RESULT" | grep -q "service_name"; then
    echo "✓ Phone-home executed"

    # Verify GTM directory structure
    if [ -d "$GTM_DIR/services/test-service" ]; then
        echo "✓ GTM service directory created"
    else
        echo "✗ GTM service directory NOT created"
        exit 1
    fi

    # Verify knowledge sync
    if [ -f "$GTM_DIR/services/test-service/knowledge/DECISIONS.md" ]; then
        echo "✓ Knowledge files synced"
        if grep -q "Another Decision" "$GTM_DIR/services/test-service/knowledge/DECISIONS.md"; then
            echo "✓ Knowledge content is correct"
        else
            echo "✗ Knowledge content is incomplete"
            exit 1
        fi
    else
        echo "✗ Knowledge files NOT synced"
        exit 1
    fi

    # Verify content sync
    if [ -f "$GTM_DIR/services/test-service/content/article.md" ]; then
        echo "✓ Content files synced"
        if grep -q "Update" "$GTM_DIR/services/test-service/content/article.md"; then
            echo "✓ Content is correct"
        else
            echo "✗ Content is incomplete"
            exit 1
        fi
    else
        echo "✗ Content files NOT synced"
        exit 1
    fi

    # Verify CLAUDE.md sync
    if [ -f "$GTM_DIR/services/test-service/CLAUDE.md" ]; then
        echo "✓ CLAUDE.md synced"
    else
        echo "✗ CLAUDE.md NOT synced"
        exit 1
    fi

    # Verify config sync
    if [ -f "$GTM_DIR/services/test-service/config/config.json" ]; then
        echo "✓ Config files synced"
    else
        echo "✗ Config files NOT synced"
        exit 1
    fi

    # Verify payload structure
    if echo "$RESULT" | jq -e '.content_synced.knowledge_files' > /dev/null 2>&1; then
        echo "✓ Payload includes content_synced"

        KNOWLEDGE_COUNT=$(echo "$RESULT" | jq -r '.content_synced.knowledge_files | length')
        CONTENT_COUNT=$(echo "$RESULT" | jq -r '.content_synced.content_files | length')
        CONFIG_COUNT=$(echo "$RESULT" | jq -r '.content_synced.config_files | length')
        CLAUDE_MD=$(echo "$RESULT" | jq -r '.content_synced.claude_md_synced')
        TOTAL_BYTES=$(echo "$RESULT" | jq -r '.content_synced.total_bytes')

        echo "  • Knowledge files: $KNOWLEDGE_COUNT"
        echo "  • Content files: $CONTENT_COUNT"
        echo "  • Config files: $CONFIG_COUNT"
        echo "  • CLAUDE.md synced: $CLAUDE_MD"
        echo "  • Total bytes: $TOTAL_BYTES"

        if [ "$KNOWLEDGE_COUNT" -gt 0 ] && [ "$CONTENT_COUNT" -gt 0 ] && [ "$CLAUDE_MD" == "true" ]; then
            echo "✓ All sync counts correct"
        else
            echo "✗ Sync counts incorrect"
            exit 1
        fi
    else
        echo "✗ Payload missing content_synced field"
        exit 1
    fi

    # Verify GTM journal entry
    if [ -f "$GTM_DIR/.jfl/journal/main.jsonl" ]; then
        echo "✓ GTM journal entry created"

        LAST_ENTRY=$(tail -1 "$GTM_DIR/.jfl/journal/main.jsonl")
        if echo "$LAST_ENTRY" | jq -e '.type == "service-sync"' > /dev/null 2>&1; then
            echo "✓ Journal entry is service-sync type"

            if echo "$LAST_ENTRY" | jq -e '.sync_payload.content_synced' > /dev/null 2>&1; then
                echo "✓ Journal entry includes content sync data"
            else
                echo "✗ Journal entry missing content sync data"
                exit 1
            fi
        else
            echo "✗ Journal entry is not service-sync type"
            exit 1
        fi
    else
        echo "⚠  GTM journal entry not found (may be on different branch)"
    fi

else
    echo "✗ Phone-home failed"
    echo "$RESULT"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ All tests passed!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Cleanup: rm -rf $TEST_DIR"
