---
name: jfl-gtm
description: Access JFL GTMs from Telegram/Slack with full session isolation, journaling, and auto-commit
metadata: {"clawdbot":{"emoji":"🚀","requires":{"bins":["jfl"]},"install":[{"id":"npm","kind":"node","package":"jfl","bins":["jfl"],"label":"Install JFL CLI (npm)"}]}}
---

# JFL GTM (Just Fucking Launch)

Your team's context layer. Any AI. Any task.

Use JFL to access GTM workspaces from Telegram/Slack with proper session isolation and journaling.

## ⚠️ Session Isolation is Critical

Each Telegram thread/Slack channel should get its own isolated JFL session (git worktree). This prevents conflicts when multiple threads work on the same GTM simultaneously.

**Always use `jfl session` commands** - they handle:
- Worktree creation and cleanup
- Auto-commit daemon (commits every 2 minutes)
- Journal file management (tracks all work)
- Session hooks (init, sync, end)

## Session Management Pattern

### 1. Create session on first message in thread

```bash
# Create session for this Telegram thread
SESSION_ID=$(jfl session create --platform telegram --thread ${THREAD_ID} --user ${USERNAME})

# Store session ID for this thread (in memory or config)
echo "$SESSION_ID"
```

The session ID format is: `session-telegram-${THREAD_ID}` (or similar for other platforms)

### 2. Execute ALL commands through session

```bash
# ALWAYS use session exec - never run jfl commands directly
jfl session exec ${SESSION_ID} "jfl hud"
jfl session exec ${SESSION_ID} "jfl crm list"
jfl session exec ${SESSION_ID} "./crm prep Jack"
```

**Why this matters:**
- Session exec runs `session-sync.sh` before every command (syncs repos)
- Commands run in isolated worktree (won't conflict with other threads)
- Auto-commit daemon saves work every 2 minutes
- Journal captures all activity

### 3. List active sessions

```bash
jfl session list
```

Shows all active sessions across platforms (CLI, Telegram, Slack, Web) with:
- Session ID
- Platform and thread
- Status (active/idle - based on auto-commit daemon PID)
- Last active time

### 4. Clean up when done (optional)

```bash
# Destroy session (commits, runs session-end hook, removes worktree)
jfl session destroy ${SESSION_ID}

# Or force destroy even with uncommitted changes
jfl session destroy ${SESSION_ID} --force
```

**Note:** Session cleanup is optional. Sessions can persist across conversations. The auto-commit daemon keeps work safe.

## Finding GTMs

```bash
# Scan common locations for JFL GTMs
find ~/CascadeProjects ~/Projects ~/code -maxdepth 2 -name ".jfl" -type d 2>/dev/null | sed 's#/.jfl##'
```

GTMs are identified by the presence of `.jfl/` directory.

## Common Commands

All commands should be executed via `jfl session exec`:

### Dashboard
```bash
jfl session exec ${SESSION_ID} "jfl hud"           # Full dashboard
jfl session exec ${SESSION_ID} "jfl hud --compact" # One-line status
```

### CRM Operations
```bash
jfl session exec ${SESSION_ID} "jfl crm list"      # List all deals
jfl session exec ${SESSION_ID} "jfl crm stale"     # Deals needing attention
jfl session exec ${SESSION_ID} "jfl crm prep Jack" # Full context before call
jfl session exec ${SESSION_ID} "jfl crm touch Jack" # Log activity
```

Note: CRM is Google Sheets backend, accessed via `./crm` CLI wrapper

### Brand & Content
```bash
# These run as skills in Claude Code - provide instructions
jfl session exec ${SESSION_ID} "echo 'Run /brand-architect in Claude Code'"
jfl session exec ${SESSION_ID} "echo 'Run /content thread [topic] in Claude Code'"
```

## Button UI Pattern (Telegram/Slack)

### On first message: Show GTM picker

```typescript
// Find available GTMs
const gtms = findGTMs()

// Show buttons
return {
  text: "🚀 JFL - Just Fucking Launch\n\n" +
        "Your team's context layer. Any AI. Any task.\n\n" +
        "Open a project:",
  buttons: gtms.map(g => ({
    text: `📂 ${g.name}`,
    callbackData: `select:${g.path}`
  }))
}
```

### On GTM selection: Create session & show commands

```typescript
// Create session
const threadId = message.chat.id.toString()
const sessionId = await exec(`jfl session create --platform telegram --thread ${threadId}`)

// Show command menu
return {
  text: `✓ Opened ${gtmName}\n\nWhat would you like to do?`,
  buttons: [
    [{ text: "📊 Dashboard", callbackData: "cmd:hud" }],
    [{ text: "👥 CRM", callbackData: "cmd:crm" }],
    [{ text: "🎨 Brand", callbackData: "cmd:brand" }],
    [{ text: "✍️ Content", callbackData: "cmd:content" }]
  ]
}
```

### On command: Execute through session

```typescript
// Execute command through session
const output = await exec(`jfl session exec ${sessionId} "jfl ${command}"`)

// Format for Telegram (strip ANSI, convert to Markdown)
return formatForTelegram(output)
```

## Long-Running Operations (Background Mode)

For operations that take time (content generation, brand creation), use bash background mode:

```bash
# Start in background with PTY
bash pty:true workdir:${WORKTREE_PATH} background:true \
  command:"jfl content thread 'launch announcement' && \
           clawdbot gateway wake --text 'Done: Created launch thread' --mode now"

# Returns sessionId for monitoring
# User gets notified via gateway wake when complete
```

## Output Formatting

JFL CLI uses ANSI colors. For Telegram/Slack:
- Strip ANSI codes
- Convert to Markdown
- Keep structure (headers, lists, tables)

Example:
```typescript
function formatForTelegram(output: string): string {
  // Strip ANSI
  let text = output.replace(/\x1b\[[0-9;]*m/g, '')

  // Convert to Markdown
  // Headers: ━━━━ lines become bold
  text = text.replace(/━━━━.*━━━━\n(.+?)\n━━━━.*━━━━/g, '**$1**')

  // Status indicators
  text = text.replace(/🟠/g, '🟠').replace(/🟡/g, '🟡').replace(/✅/g, '✅')

  return text
}
```

## Session State Tracking

Store session mapping in memory or config:

```json
{
  "telegram": {
    "123456": {
      "sessionId": "session-telegram-123456",
      "gtmPath": "/Users/you/Projects/my-gtm",
      "gtmName": "My GTM",
      "created": "2026-01-26T14:00:00Z",
      "lastActive": "2026-01-26T15:30:00Z"
    }
  }
}
```

## Safety Guarantees

When using `jfl session` commands, you get:
1. **Isolation** - Each thread has its own worktree
2. **Journaling** - All work logged to `.jfl/journal/${sessionId}.jsonl`
3. **Auto-commit** - Changes committed every 2 minutes
4. **Sync** - Repos synced before every command
5. **Hooks** - Session init, sync, and end hooks run automatically

## Requirements

- JFL CLI installed (`npm install -g jfl` or local)
- GTM workspaces with `.jfl/` directory
- Git repo (GTMs are git repos with submodules)

## Troubleshooting

### Session not found
If `jfl session exec` fails with "Session not found":
```bash
# Check active sessions
jfl session list

# Recreate if needed
jfl session create --platform telegram --thread ${THREAD_ID}
```

### Auto-commit daemon not running
If session shows as "idle" in list:
```bash
# Get session info
jfl session info ${SESSION_ID}

# The auto-commit daemon may have stopped
# Creating a new session will restart it
```

### Worktree conflicts
If you see "worktree already exists" errors:
```bash
# Force destroy the old session
jfl session destroy ${SESSION_ID} --force

# Create fresh session
jfl session create --platform telegram --thread ${THREAD_ID}
```

## Integration with Clawdbot

This skill is designed to work with Clawdbot's:
- **bash tool** - for executing jfl commands
- **process tool** - for background operations
- **memory** - for storing session state per thread

No custom tools needed - just bash + session management pattern.

## Examples

### Full conversation flow

```
User: /jfl

Clawdbot:
🚀 JFL - Just Fucking Launch

Your team's context layer. Any AI. Any task.

Open a project:
[📂 JFL-GTM]
[📂 Kodiak]
[📂 Legal]

User: [clicks JFL-GTM]

Clawdbot:
✓ Opened JFL-GTM

[📊 Dashboard] [👥 CRM]
[🎨 Brand] [✍️ Content]

User: [clicks Dashboard]

Clawdbot:
━━━━━━━━━━━━━━━━━━━━━━━━
JFL - Just Fucking Launch
━━━━━━━━━━━━━━━━━━━━━━━━

Phase: Foundation (in progress)
Version: 0.1.0
Launch: Jan 31, 2026 (5 days)

PIPELINE
🟠 Jack (Nascent) - IN_CONVO
🟠 Luca - IN_CONVO
✅ Wes - COMMITTED

RECENT WORK
- Built session management
- Created Clawdbot integration
- Added auto-commit daemon

NEXT ACTION
Follow up with Jack on timing
```

## Notes

- **CRM is NOT a markdown file** - it's Google Sheets accessed via `./crm` CLI
- **Skills run in Claude Code** - Brand and Content are `/brand-architect` and `/content` skills
- **Auto-commit is critical** - Ensures no work is lost even if thread/session crashes
- **Session sync is mandatory** - Repos can drift if not synced before commands

## Learn More

- CLI repo: https://github.com/402goose/just-fucking-launch
- Documentation: https://jfl.run/docs
- Issues/feedback: https://github.com/402goose/just-fucking-launch/issues
