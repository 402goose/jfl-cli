---
name: jfl-gtm
description: Full JFL CLI access from Telegram/Slack with session isolation, auto-commit, and journaling
metadata: {"clawdbot":{"emoji":"🚀","requires":{"bins":["jfl"]}}}
---

# JFL GTM

Full JFL CLI access from Telegram/Slack. Each conversation gets an isolated session with worktrees, auto-commit, and journaling.

## On `/jfl` command

Find available GTMs (not product repos):
```bash
for dir in ~/CascadeProjects ~/Projects ~/code; do
  find "$dir" -maxdepth 2 -type d -name ".jfl" 2>/dev/null | while read jfldir; do
    gtm="${jfldir%/.jfl}"
    # Filter: Must have knowledge/ and CLAUDE.md to be a GTM
    if [[ -d "$gtm/knowledge" && -f "$gtm/CLAUDE.md" ]]; then
      echo "$gtm"
    fi
  done
done
```

Show picker buttons for each GTM found.

## When user selects a GTM

1. **Get or create session for this conversation:**

```bash
# Use Telegram thread ID as session identifier
THREAD_ID="[telegram-thread-id]"
GTM_PATH="[selected-gtm-path]"

# Create session (or get existing)
cd "$GTM_PATH"
SESSION_ID=$(jfl session create --platform telegram --thread "$THREAD_ID")

# Session creates:
# - Git worktree at worktrees/session-telegram-$THREAD_ID
# - Auto-commit daemon (commits every 2 min)
# - Journal file at .jfl/journal/session-telegram-$THREAD_ID.jsonl
```

2. **Store session ID for this conversation** (in memory or Clawdbot state)

3. **Run dashboard:**
```bash
cd "$GTM_PATH"
jfl session exec "$SESSION_ID" "jfl hud"
```

Show output + command buttons.

## All Commands Use Session Exec

**NEVER run jfl commands directly.** Always use `jfl session exec`:

### Dashboard
```bash
jfl session exec "$SESSION_ID" "jfl hud"
```

### CRM List
```bash
jfl session exec "$SESSION_ID" "./crm list"
```

### CRM Prep
Ask user: "Who are you meeting with?"

Then:
```bash
jfl session exec "$SESSION_ID" "./crm prep [name]"
```

### CRM Touch (Log Activity)
Ask user: "Who did you talk to?"

Then:
```bash
jfl session exec "$SESSION_ID" "./crm touch [name]"
```

### Update CRM Field
Ask user: "What do you want to update?"

Examples:
```bash
jfl session exec "$SESSION_ID" "./crm update [name] status HOT"
jfl session exec "$SESSION_ID" "./crm update [name] stage COMMITTED"
```

### Sync Repos
```bash
jfl session exec "$SESSION_ID" "git pull && git submodule update --remote"
```

## Why Session Exec Matters

When you use `jfl session exec`, each command:
1. **Runs session-sync.sh** - syncs all repos with remotes
2. **Runs in isolated worktree** - no conflicts with other conversations
3. **Auto-commits every 2 min** - work never lost
4. **Logs to journal** - full audit trail

**Without session exec:**
- Commands run on main branch (conflicts!)
- No auto-commit (lose work if crash)
- No journaling (no audit trail)
- Repos can drift out of sync

## Session Management

### List Active Sessions
```bash
jfl session list
```

Shows all active sessions across platforms with status.

### Check Session Status
```bash
jfl session info "$SESSION_ID"
```

### Destroy Session (Cleanup)
```bash
jfl session destroy "$SESSION_ID"
```

Runs session-end hook, commits, removes worktree.

**Note:** You don't need to destroy sessions manually. They can persist across conversations. Auto-commit keeps work safe.

## Button Flows

### After selecting GTM:
- `📊 Dashboard`
- `👥 CRM`
- `🔄 Sync`
- `🔀 Switch Project`

### After CRM:
- `🔥 Show hot deals`
- `👤 Prep for call`
- `📝 Log activity`
- `✏️ Update field`

### After showing deal details:
- `📞 Mark as called`
- `✅ Mark as committed`
- `🔥 Mark as hot`
- `❄️ Mark as cold`

## Output Formatting

Strip ANSI codes:
```bash
sed 's/\x1b\[[0-9;]*m//g'
```

Keep emoji indicators: 🟠🟡✅🔴

Convert━━━ headers to **bold** in Markdown.

## Error Handling

If session create fails:
```
❌ Couldn't create session for this GTM.

This might mean the GTM isn't a git repo or .jfl is missing.
```

If session exec fails:
```
⚠️ Command failed in session.

Try: /jfl → [your-gtm] → Sync
```

## Notes

- Each Telegram conversation = one isolated session
- Sessions persist across app restarts
- All work auto-commits every 2 minutes
- Journal tracks everything for audit trail
- Session isolation prevents conflicts when multiple people use same GTM
