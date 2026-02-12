# Updating Existing Services with New /end Skill

The new `/end` skill includes knowledge & content sync. Here's how to update existing services.

## Option 1: Update Script (Recommended for Your Services)

Update a single service:

```bash
./update-services.sh ~/code/my-service
```

Update all services in a directory:

```bash
for dir in ~/code/services/*/; do
    ./update-services.sh "$dir"
done
```

Update specific services:

```bash
./update-services.sh ~/code/stratus-api
./update-services.sh ~/code/worker-service
./update-services.sh ~/code/admin-dashboard
```

## Option 2: Manual Copy

If you prefer to do it manually:

```bash
# From jfl-cli directory
cd /Users/andrewhathaway/code/goose/jfl/jfl-cli

# Copy to your service
cp -r template/.claude/skills/end ~/code/my-service/.claude/skills/end
```

## Option 3: Global Distribution (Future)

For distributing to all JFL users globally, the template needs to be synced to the jfl-template repo:

```bash
# From jfl-cli directory
./scripts/sync-template.sh "feat: knowledge & content sync on /end"
```

Then users would run:
```bash
cd their-service
jfl update
```

**Note:** This requires access to the 402goose/jfl-template repo.

## After Updating: Enable Content Sync

Once the skill is updated, enable content sync in each service's `.jfl/config.json`:

```bash
cd ~/code/my-service

# Add sync_to_parent config
jq '.sync_to_parent = {
  journal: true,
  knowledge: true,
  content: true
}' .jfl/config.json > tmp && mv tmp .jfl/config.json

# Verify
cat .jfl/config.json | jq .sync_to_parent
```

**Or manually edit:**

```json
{
  "name": "my-service",
  "type": "service",
  "gtm_parent": "/path/to/gtm",
  "sync_to_parent": {
    "journal": true,
    "knowledge": true,
    "content": true
  }
}
```

## Verify Update

Test the updated skill:

```bash
cd ~/code/my-service

# Start a session
git checkout -b test-session

# Make some changes
echo "# Test Decision" > knowledge/TEST.md
git add . && git commit -m "test"

# Test phone-home manually
jfl services phone-home /path/to/gtm test-session

# Should show content_synced in output
```

Look for:
```json
{
  "content_synced": {
    "knowledge_files": ["knowledge/TEST.md"],
    ...
  }
}
```

## Selective Sync

You can customize what syncs per service:

**Knowledge only:**
```json
{
  "sync_to_parent": {
    "journal": true,
    "knowledge": true,
    "content": false
  }
}
```

**Content only:**
```json
{
  "sync_to_parent": {
    "journal": true,
    "knowledge": false,
    "content": true
  }
}
```

**Disable sync:**
```json
{
  "sync_to_parent": {
    "journal": true,
    "knowledge": false,
    "content": false
  }
}
```

## Rollback

If you need to rollback:

```bash
cd ~/code/my-service

# Restore backup (created automatically by update script)
mv .claude/skills/end.backup.YYYYMMDD-HHMMSS .claude/skills/end

# Or disable sync
jq '.sync_to_parent.knowledge = false | .sync_to_parent.content = false' \
   .jfl/config.json > tmp && mv tmp .jfl/config.json
```

## Troubleshooting

**Skill not found:**
```bash
# Check if skill exists
ls -la ~/code/my-service/.claude/skills/end/

# If missing, run update script
./update-services.sh ~/code/my-service
```

**Sync not working:**
```bash
# Verify config
cat ~/code/my-service/.jfl/config.json | jq .sync_to_parent

# Verify GTM path
cat ~/code/my-service/.jfl/config.json | jq -r .gtm_parent
ls -la "$(cat ~/code/my-service/.jfl/config.json | jq -r .gtm_parent)"

# Test manually
cd ~/code/my-service
jfl services phone-home /path/to/gtm $(git branch --show-current)
```

**Old skill still running:**
- Make sure you're in the service directory when running `/end`
- Restart Claude session to reload skills
- Check `.claude/skills/end/SKILL.md` has the new content (search for "content_synced")

## Finding Services to Update

List all services on your machine:

```bash
# Find all JFL services
find ~ -name ".jfl" -type d -exec sh -c '
  if [ -f "$1/config.json" ]; then
    TYPE=$(jq -r .type "$1/config.json" 2>/dev/null)
    NAME=$(jq -r .name "$1/config.json" 2>/dev/null)
    if [ "$TYPE" = "service" ]; then
      echo "$(dirname "$1") - $NAME"
    fi
  fi
' _ {} \;
```

Then update each one:

```bash
./update-services.sh /path/to/service
```

## Validation

After updating, validate the service configuration:

```bash
cd ~/code/my-service
jfl services validate

# Should show:
# ✓ Service type is valid
# ✓ GTM parent path exists and is valid
# ✓ Sync configuration is valid
```
