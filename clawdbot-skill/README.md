# JFL GTM Clawdbot Skill

Access your JFL GTMs from Telegram, Slack, or Discord with full session isolation.

## Architecture

Clawdbot skills are markdown instruction files (SKILL.md) that teach Clawdbot how to use tools. This skill:

1. Uses `jfl session` commands for proper isolation (worktrees)
2. Each Telegram thread = isolated session with auto-commit
3. Executes via `jfl session exec` (syncs repos before every command)
4. Button UI for GTM picker and command menus
5. Formats output for chat (strips ANSI, converts to Markdown)

**Critical:** Every thread gets its own git worktree with journaling and auto-commit daemon.

## Local Testing

### 1. Verify JFL CLI is installed

```bash
jfl --version
# Should show version 0.1.0 or later

# If not installed:
cd ../jfl-cli && npm link
```

### 2. Link skill to Clawdbot

```bash
cd product/clawdbot-skill

# Create symlink in Clawdbot's managed skills directory
ln -sf $(pwd) ~/.clawdbot/skills/jfl-gtm

# Verify - should point to this directory
ls -la ~/.clawdbot/skills/jfl-gtm
```

### 3. Restart Clawdbot to load the skill

```bash
# If running as daemon:
clawdbot restart

# Or kill and restart Telegram/Slack session
```

### 4. Test session commands directly

Before testing in Telegram, verify the session commands work:

```bash
# Create a test session
TEST_SESSION=$(jfl session create --platform telegram --thread test-123)
echo "Created: $TEST_SESSION"

# Execute command through session
jfl session exec $TEST_SESSION "jfl hud"

# List active sessions
jfl session list

# Clean up
jfl session destroy $TEST_SESSION
```

### 5. Test in Telegram

```
You: /jfl

Clawdbot:
🚀 JFL - Just Fucking Launch

Your team's context layer. Any AI. Any task.

Open a project:

[📂 JFL-GTM]
[📂 Kodiak]
[+ Create new]
```

Click a GTM → Clawdbot creates session → shows command menu → execute commands

### 4. Test commands

```
/hud        → Dashboard
/crm list   → Pipeline
/brand      → Brand menu
/content    → Content menu
/gtm        → Switch GTM
```

## How It Works

### On First Message in Thread

1. **Find GTMs**: Scan for directories with `.jfl/`
2. **Show picker**: Button UI listing available GTMs
3. **Wait for selection**

### On GTM Selection

1. **Create isolated session**:
   ```bash
   jfl session create --platform telegram --thread ${THREAD_ID}
   # Returns: session-telegram-${THREAD_ID}
   ```

   This creates:
   - Git worktree at `worktrees/session-telegram-${THREAD_ID}/`
   - Auto-commit daemon (commits every 2 minutes)
   - Journal file at `.jfl/journal/session-telegram-${THREAD_ID}.jsonl`
   - Session metadata in `.jfl/sessions.json`

2. **Store session mapping**: Thread ID → Session ID
3. **Show command menu**: Dashboard, CRM, Brand, Content

### On Command Execution

1. **Lookup session ID** for this thread
2. **Execute through session**:
   ```bash
   jfl session exec ${SESSION_ID} "jfl hud"
   ```

   This:
   - Runs `session-sync.sh` (syncs repos with remotes)
   - CDs to worktree
   - Executes command in isolated context
   - Returns output

3. **Format output**: Strip ANSI, convert to Markdown
4. **Return to Telegram**

### Session Lifecycle

- **Created**: On first GTM selection in thread
- **Persists**: Across messages (doesn't recreate every time)
- **Auto-commits**: Every 2 minutes while active
- **Journals**: All commands logged to `.jfl/journal/`
- **Destroyed**: Optional cleanup (or let it persist)

## Local Development

### Test functions directly

```bash
# Install deps
npm install

# Test GTM detection
node -e "import('./index.js').then(m => m.findGTMs().then(console.log))"

# Test command execution
node -e "import('./index.js').then(m => m.runJFLCommand({gtmPath: '/Users/you/JFL-GTM'}, 'hud').then(console.log))"
```

### Debug mode

Set `DEBUG=1` to see command execution:

```bash
export DEBUG=1
# Then use Clawdbot normally
```

## Publishing (Later)

### To ClawdHub

```bash
# Build
npm run build

# Publish
clawdbot skill publish

# Or to npm
npm publish --access public
```

### To npm (bundled with CLI)

The skill will be bundled in `jfl-cli` package:

```
jfl-cli/
├── skills/
│   └── clawdbot/         ← This skill
│       ├── skill.json
│       └── index.ts
└── package.json
```

Post-install script detects Clawdbot and auto-registers.

## Requirements

- `jfl` CLI installed (`npm install -g jfl` or local dev)
- Clawdbot installed and configured
- At least one GTM created (`jfl init`)

## File Structure

```
product/clawdbot-skill/
├── skill.json      # ClawdHub metadata
├── index.ts        # Skill implementation
├── package.json    # npm metadata
└── README.md       # This file
```

## Key Functions

| Function | What It Does |
|----------|--------------|
| `onBoot()` | Shows GTM picker on first run |
| `onCallback()` | Handles button clicks |
| `onCommand()` | Handles `/` commands |
| `findGTMs()` | Scans for `.jfl` directories |
| `runJFLCommand()` | Executes actual `jfl` commands |
| `formatForTelegram()` | Strips ANSI, converts to Markdown |

## Examples

### Dashboard in Telegram

```
User: /hud

Clawdbot:
━━━━━━━━━━━━━━━━━━━━━━━━
JFL - Just Fucking Launch
━━━━━━━━━━━━━━━━━━━━━━━━

Phase: CLI Launch Prep
Version: 0.1.0

PIPELINE
🟠 Jack (Nascent) - IN_CONVO
🟠 Luca - IN_CONVO
✅ Wes - COMMITTED

NEXT: Publish CLI to npm
━━━━━━━━━━━━━━━━━━━━━━━━
```

### CRM in Telegram

```
User: /crm list

Clawdbot:
DEALS (22)

🟠 Jack (Nascent) - IN_CONVO
🟠 Luca - IN_CONVO
🟡 Avi (Coinfund) - REACHED_OUT
✅ Wes (Formation) - COMMITTED
```

### Button UI

```
User: [clicks 📂 JFL-GTM]

Clawdbot:
✓ Opened JFL-GTM

[📊 Dashboard] [👥 CRM]
[🎨 Brand] [✍️ Content]
[🔄 Sync] [📝 Status]
```

## Troubleshooting

### "JFL CLI not found"

```bash
# Check if jfl is installed
jfl --version

# If not:
npm install -g jfl

# Or use local dev build:
cd jfl-cli && npm link
```

### "No GTMs found"

```bash
# Create a GTM
jfl init

# Or check paths in findGTMs()
# Default search paths:
# - ~/CascadeProjects
# - ~/Projects
# - ~/code
```

### Skill not showing in Clawdbot

```bash
# Check symlink
ls -la ~/.clawdbot/skills/jfl-gtm

# Should point to:
# product/clawdbot-skill

# Restart Clawdbot
clawdbot restart
```

## Next Steps

- [ ] Test in Telegram
- [ ] Test in Slack
- [ ] Add voice note support
- [ ] Add image attachment support
- [ ] Publish to ClawdHub
- [ ] Bundle with CLI
