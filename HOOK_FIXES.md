# PreCompact/Stop Hook Fixes - Implementation Summary

## What Was Fixed

### Critical Issues Resolved

1. **Missing `matcher` fields** (Schema Violation)
   - **Impact:** Hooks were silently rejected by Claude Code
   - **Root Cause:** SessionStart, Stop, and PreCompact hooks missing required `matcher` field
   - **Fix:** Added `"matcher": ""` to all lifecycle hooks

2. **Context Hub Stop Bug** (Memory.md documented issue)
   - **Impact:** Stop hook killed shared Context Hub service
   - **Root Cause:** `jfl context-hub stop` command in Stop hook
   - **Fix:** Removed context-hub stop from both production and template

3. **Invalid Default Settings** (service-validate.ts)
   - **Impact:** Services created with broken settings
   - **Root Cause:** Flat object format instead of proper array structure
   - **Fix:** Updated default settings to use correct schema

4. **Validation Gaps**
   - **Impact:** No way to detect broken settings
   - **Root Cause:** No CLI command to validate settings
   - **Fix:** Created `jfl validate-settings` command with auto-fix

## Files Changed

### Production Settings
- **File:** `.claude/settings.json`
- **Changes:**
  - Added `"matcher": ""` to SessionStart (line 4)
  - Added `"matcher": ""` to Stop (line 60)
  - Added `"matcher": ""` to PreCompact (line 78)
  - Removed `jfl context-hub stop` command (was line 68)

### Template Settings
- **File:** `template/.claude/settings.json`
- **Changes:**
  - Removed `jfl context-hub stop` command (was line 70)
  - (Already had matcher fields correctly)

### Validation Utilities
- **File:** `src/utils/settings-validator.ts`
- **Changes:**
  - Added check for context-hub stop in Stop hook
  - Enhanced fixSettings() to remove context-hub stop automatically
  - Updated documentation comments

### Service Validation
- **File:** `src/commands/service-validate.ts`
- **Changes:**
  - Replaced broken default settings (lines 253-266)
  - Now generates proper array format with matcher fields
  - Includes all three lifecycle hooks (SessionStart, Stop, PreCompact)

### New Command
- **File:** `src/commands/validate-settings.ts` (NEW)
- **Purpose:** Validate and auto-repair .claude/settings.json
- **Features:**
  - Detects schema violations
  - Checks for common bugs (context-hub stop, etc.)
  - Auto-fix with --fix flag
  - JSON output with --json flag
  - Creates backup before fixing

### CLI Entry Point
- **File:** `src/index.ts`
- **Changes:**
  - Imported validateSettingsCommand
  - Registered `jfl validate-settings` command (line 94-99)
  - Added to help text (line 753)

### Documentation
- **File:** `template/CLAUDE.md`
- **Changes:**
  - Updated "Auto-Push on Session End" section (line 172+)
  - Clarified hooks cannot block operations
  - Updated "Enforcement" section (line 214+)
  - Changed "blocks" to "warns" throughout
  - Added note about auto-commit safety net

## How It Works Now

### Hook Execution Flow

```
SessionStart Hook
    ↓
Validates settings (warns if issues)
    ↓
Session runs normally
    ↓
PreCompact Hook (on context limit)
    ↓
Warns about missing journal
Auto-commits all changes (safety net)
    ↓
Context compacts (proceeds regardless)
    ↓
Stop Hook (on session end)
    ↓
Warns about missing journal
Runs cleanup scripts
    ↓
Session ends (proceeds regardless)
```

### What Hooks Can Do

✅ **Can:**
- Warn about missing journal entries
- Auto-commit changes before compaction
- Run cleanup scripts
- Display status information
- Log activities

❌ **Cannot:**
- Block session end
- Prevent context compaction
- Stop operations from proceeding
- Enforce mandatory requirements

**Why:** All hooks end with `exit 0` so Claude Code treats them as successful regardless of their output.

## Verification

### Test 1: Validate Production Settings

```bash
cd /path/to/jfl-cli
jfl validate-settings
```

**Expected:** `✓ Settings validation passed`

### Test 2: Detect Issues

```bash
# Create broken settings
cat > /tmp/test-broken.json << 'EOF'
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{"type": "command", "command": "echo test"}]
      }
    ],
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

# Test validation
mkdir -p /tmp/.claude
mv /tmp/test-broken.json /tmp/.claude/settings.json
cd /tmp
jfl validate-settings
```

**Expected:**
```
✗ Settings validation failed

  SessionStart:
    • Hook entry missing required "matcher" field

  Stop:
    • Stop hook should NOT stop context-hub (shared service)
```

### Test 3: Auto-Fix

```bash
cd /tmp
jfl validate-settings --fix
```

**Expected:**
```
✓ Settings auto-fixed successfully
  Fixed: /tmp/.claude/settings.json
  Backup: /tmp/.claude/settings.json.backup
```

**Verify Fix:**
```bash
cat /tmp/.claude/settings.json | jq .
```

**Expected:**
- SessionStart has `"matcher": ""`
- Stop hook has empty hooks array (context-hub stop removed)

### Test 4: Service Creation

```bash
# In a service project
jfl services validate --fix
```

**Expected:** Creates `.claude/settings.json` with correct format (array structure, matcher fields, all lifecycle hooks)

## Migration Guide for Users

### For Existing JFL Users

1. **Pull the latest version:**
   ```bash
   cd /path/to/jfl-cli
   git pull
   yarn build
   ```

2. **Validate your settings:**
   ```bash
   jfl validate-settings
   ```

3. **If issues found, auto-fix:**
   ```bash
   jfl validate-settings --fix
   ```

4. **Review changes:**
   ```bash
   git diff .claude/settings.json
   ```

5. **Restart Claude session** to pick up fixed settings

### For Services

1. **Run validation in each service:**
   ```bash
   cd /path/to/service
   jfl services validate --fix
   ```

2. **Commit fixed settings:**
   ```bash
   git add .claude/settings.json
   git commit -m "fix: Update settings.json schema (matcher fields)"
   ```

### For Template Distribution

When you run `jfl update`, it will:
- Pull fixed `template/.claude/settings.json`
- Update your local `.claude/settings.json` if you opt-in
- Not overwrite custom hooks you've added

## Testing Checklist

- [x] Production settings validate successfully
- [x] Template settings validate successfully
- [x] Validation detects missing matcher fields
- [x] Validation detects context-hub stop bug
- [x] Auto-fix adds missing matcher fields
- [x] Auto-fix removes context-hub stop
- [x] Service validation creates correct format
- [x] Build succeeds
- [x] Help text updated
- [x] Documentation updated (CLAUDE.md)

## Known Limitations

### Hooks Cannot Block Operations

**This is a Claude Code design constraint, not a bug.**

Hooks run with `exit 0` at the end, which means:
- They always succeed from Claude Code's perspective
- They can warn, but cannot prevent actions
- PreCompact auto-commit is the safety net for data loss

**Workaround:**
- Write journal entries proactively as you work
- Don't wait for PreCompact warning
- Treat hooks as reminders, not enforcement

### Exit 0 Is Intentional

We use `exit 0` to allow sessions to continue even if hooks have issues:
- Missing journal → warn but don't block session end
- Cleanup script fails → warn but don't crash session
- Context hub already stopped → warn but continue

**Alternative considered:** `exit 1` to block operations
**Rejected because:** Would cause session crashes when hooks fail

## Future Improvements

### Phase 3 (Not in this PR)

1. **Add SessionStart validation hook** (optional)
   - Run `jfl validate-settings` on session start
   - Display warning if issues found
   - Suggest running `--fix`

2. **Update distribution system**
   - Ensure `jfl update` validates settings after update
   - Offer to fix issues automatically
   - Show diff before applying fixes

3. **Enhanced validation**
   - Check hook commands reference existing scripts
   - Validate bash syntax in command strings
   - Warn about performance issues (synchronous hooks)

## Success Metrics

✅ **Hooks execute** - SessionStart/Stop/PreCompact all run without errors
✅ **No silent failures** - Validation catches schema violations before execution
✅ **Context hub persists** - Stop hook doesn't kill shared context hub
✅ **Auto-commit works** - PreCompact commits changes before compaction
✅ **Validation command exists** - `jfl validate-settings` catches issues
✅ **Service creation works** - `jfl services validate --fix` generates valid settings
✅ **Users informed** - CLAUDE.md accurately describes hook behavior

## Rollout Plan

### Immediate (Done in this PR)
- [x] Fix production settings
- [x] Fix template settings
- [x] Create validate-settings command
- [x] Enhance settings-validator
- [x] Fix service-validate defaults
- [x] Update documentation
- [x] Add help text
- [x] Build and test

### Next Steps
1. Commit changes to main branch
2. Create GitHub release notes
3. Announce in user channels
4. Update JFL website docs

### Announcement Template

```
🚨 CRITICAL FIX: PreCompact/Stop Hooks

Issue: Hooks were silently failing due to schema violations.
Result: No auto-commit before context compaction = work lost.

Fix:
1. Update: git pull && yarn build
2. Validate: jfl validate-settings
3. Fix: jfl validate-settings --fix (if issues)
4. Restart Claude session

This restores context preservation safety mechanisms.

Full details: HOOK_FIXES.md
```

## Contact

Questions or issues? File a GitHub issue:
https://github.com/402goose/jfl-cli/issues
