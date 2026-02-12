# Test Commands for Knowledge & Content Sync

## Quick Setup Test

### 1. Create Test GTM and Service

```bash
# Create test directory
mkdir -p /tmp/test-sync && cd /tmp/test-sync

# Initialize GTM workspace
mkdir test-gtm && cd test-gtm
git init
mkdir -p .jfl/journal
cat > .jfl/config.json << 'EOF'
{
  "name": "test-gtm",
  "type": "gtm",
  "description": "Test GTM workspace"
}
EOF
git add . && git commit -m "Initial GTM setup"
cd ..

# Initialize Service
mkdir test-service && cd test-service
git init
mkdir -p .jfl/journal knowledge content
cat > .jfl/config.json << EOF
{
  "name": "test-service",
  "type": "service",
  "service_type": "api",
  "description": "Test API service",
  "gtm_parent": "/tmp/test-sync/test-gtm",
  "working_branch": "main",
  "sync_to_parent": {
    "journal": true,
    "knowledge": true,
    "content": true
  }
}
EOF

# Create some content
echo "# Architecture Decisions" > knowledge/DECISIONS.md
echo "We use TypeScript for type safety." >> knowledge/DECISIONS.md

echo "# API Documentation" > content/api-docs.md
echo "REST API with JSON responses." >> content/api-docs.md

echo "# Service Instructions" > CLAUDE.md
echo "This service handles API requests." >> CLAUDE.md

git add . && git commit -m "Initial service setup"

# Create session branch
git checkout -b session-test-$(date +%Y%m%d-%H%M)-abc123
```

### 2. Make Changes in Session

```bash
# Add to knowledge
echo "" >> knowledge/DECISIONS.md
echo "## Database Choice" >> knowledge/DECISIONS.md
echo "We chose PostgreSQL for ACID compliance." >> knowledge/DECISIONS.md

# Add to content
echo "" >> content/api-docs.md
echo "## Endpoints" >> content/api-docs.md
echo "- GET /api/users" >> content/api-docs.md

# Update CLAUDE.md
echo "" >> CLAUDE.md
echo "Uses Express.js framework." >> CLAUDE.md

# Update config
jq '.description = "Test API service (updated)"' .jfl/config.json > .jfl/config.json.tmp
mv .jfl/config.json.tmp .jfl/config.json

# Commit changes
git add . && git commit -m "feat: add database decision and API docs"
```

### 3. Test Phone-Home (Manual)

```bash
# Run phone-home manually (for testing)
jfl services phone-home /tmp/test-sync/test-gtm $(git branch --show-current)
```

**Expected output:**
```json
{
  "service_name": "test-service",
  "content_synced": {
    "knowledge_files": ["knowledge/DECISIONS.md"],
    "content_files": ["content/api-docs.md"],
    "config_files": [".jfl/config.json"],
    "claude_md_synced": true,
    "total_bytes": 500+
  },
  "sync_config": {
    "knowledge_enabled": true,
    "content_enabled": true,
    "config_enabled": true
  }
}
```

### 4. Verify GTM Received Content

```bash
# Check GTM directory structure
ls -la /tmp/test-sync/test-gtm/services/test-service/

# Should show:
# - knowledge/
# - content/
# - config/
# - CLAUDE.md

# View synced knowledge
cat /tmp/test-sync/test-gtm/services/test-service/knowledge/DECISIONS.md

# View synced content
cat /tmp/test-sync/test-gtm/services/test-service/content/api-docs.md

# View synced CLAUDE.md
cat /tmp/test-sync/test-gtm/services/test-service/CLAUDE.md

# View synced config
cat /tmp/test-sync/test-gtm/services/test-service/config/config.json

# View GTM journal entry
cat /tmp/test-sync/test-gtm/.jfl/journal/main.jsonl | tail -1 | jq .

# View service events (for GTM agent)
cat /tmp/test-sync/test-gtm/.jfl/service-events.jsonl | tail -1 | jq .
```

### 5. Test with /end Skill (Real Flow)

```bash
# Instead of manual phone-home, use /end skill
# This would normally be done in Claude session, but you can simulate:

cd /tmp/test-sync/test-service

# The /end skill will:
# 1. Merge session branch to main
# 2. Phone home to GTM with content sync
# 3. Display sync stats
```

## Variations to Test

### Test 1: Knowledge Only

```bash
# Modify service config
jq '.sync_to_parent.content = false' .jfl/config.json > tmp && mv tmp .jfl/config.json

# Make changes and phone-home
echo "More decisions" >> knowledge/DECISIONS.md
git add . && git commit -m "More knowledge"
jfl services phone-home /tmp/test-sync/test-gtm $(git branch --show-current)

# Verify: knowledge synced, content NOT synced
```

### Test 2: Content Only

```bash
# Modify service config
jq '.sync_to_parent.knowledge = false | .sync_to_parent.content = true' .jfl/config.json > tmp && mv tmp .jfl/config.json

# Make changes
echo "More docs" >> content/api-docs.md
git add . && git commit -m "More content"
jfl services phone-home /tmp/test-sync/test-gtm $(git branch --show-current)

# Verify: content synced, knowledge NOT synced
```

### Test 3: No Sync (Disabled)

```bash
# Disable all sync
jq '.sync_to_parent.knowledge = false | .sync_to_parent.content = false' .jfl/config.json > tmp && mv tmp .jfl/config.json

# Make changes
echo "test" >> knowledge/DECISIONS.md
git add . && git commit -m "test"
jfl services phone-home /tmp/test-sync/test-gtm $(git branch --show-current)

# Verify: content_synced shows empty arrays
```

## Validation Commands

```bash
# Validate service configuration
cd /tmp/test-sync/test-service
jfl services validate

# Should pass all checks including sync config validation

# Check sync history
cat /tmp/test-sync/test-gtm/.jfl/service-syncs/test-service.jsonl | jq .

# View all syncs
cat /tmp/test-sync/test-gtm/.jfl/service-syncs/test-service.jsonl | jq -s .
```

## Cleanup

```bash
# Remove test directory
rm -rf /tmp/test-sync
```

## Real-World Usage

In a real service session with Claude:

```
User: /end

Claude:
  ✓ Session summary synced
  ✓ Git activity: 3 commits, 7 files
  ✓ Journal: 8 entries
  ✓ Duration: 45min

  📁 Content synced to GTM:
     • Knowledge: 2 files
     • Content: 1 files
     • Config: 1 files
     • CLAUDE.md
     Total: 3.2KB

  ✅ Phone home complete (GTM fully updated)
```

## Quick One-Liner Test

```bash
# Complete test in one command
cd /tmp && rm -rf test-sync && mkdir test-sync && cd test-sync && \
mkdir test-gtm && cd test-gtm && git init && mkdir -p .jfl/journal && \
echo '{"name":"test-gtm","type":"gtm"}' > .jfl/config.json && \
git add . && git commit -m "init" && cd .. && \
mkdir test-service && cd test-service && git init && mkdir -p .jfl/journal knowledge content && \
echo '{"name":"test-service","type":"service","gtm_parent":"/tmp/test-sync/test-gtm","sync_to_parent":{"journal":true,"knowledge":true,"content":true}}' > .jfl/config.json && \
echo "# Test" > knowledge/test.md && echo "# Content" > content/test.md && \
git add . && git commit -m "init" && \
git checkout -b test-session && \
echo "update" >> knowledge/test.md && git add . && git commit -m "update" && \
jfl services phone-home /tmp/test-sync/test-gtm test-session && \
echo "✅ Check GTM:" && ls -la /tmp/test-sync/test-gtm/services/test-service/
```
