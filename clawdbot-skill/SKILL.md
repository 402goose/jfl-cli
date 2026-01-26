---
name: jfl-gtm
description: Access your JFL GTMs from Telegram/Slack - view status, update CRM, run commands on the go
metadata: {"clawdbot":{"emoji":"🚀","requires":{"bins":["jfl"]}}}
---

# JFL GTM

Access your JFL GTM workspaces from Telegram/Slack.

## On `/jfl` command

Find available GTMs and show picker:

```bash
# Find all JFL GTMs
find ~/CascadeProjects ~/Projects ~/code -maxdepth 2 -type d -name ".jfl" 2>/dev/null | sed 's#/.jfl##'
```

Show buttons for each GTM found:
- Button text: `📂 [GTM name]`
- Callback data: `gtm:[full-path]`

Add a "Create new" button at the bottom.

## When user selects a GTM

Store the GTM path for this conversation.

Run dashboard:
```bash
cd [gtm-path] && jfl hud
```

Show the output + these command buttons:
- `📊 Dashboard` → callback: `cmd:hud`
- `👥 CRM` → callback: `cmd:crm`
- `🔄 Sync` → callback: `cmd:sync`
- `🔀 Switch` → callback: `cmd:switch`

## Commands

### Dashboard (`cmd:hud`)
```bash
cd [gtm-path] && jfl hud
```

### CRM (`cmd:crm`)
```bash
cd [gtm-path] && ./crm list
```

Show CRM output + these buttons:
- `🔥 Hot deals` → callback: `crm:hot`
- `👤 Prep for call` → callback: `crm:prep`
- `📝 Log activity` → callback: `crm:touch`

### Sync (`cmd:sync`)
```bash
cd [gtm-path] && git pull && git submodule update --remote
```

### Switch (`cmd:switch`)
Clear stored GTM path and show picker again (same as `/jfl`).

## CRM Sub-commands

### Hot deals (`crm:hot`)
```bash
cd [gtm-path] && ./crm list | grep "🔴\|🟠"
```

### Prep for call (`crm:prep`)
Ask: "Who are you meeting with?"

Then run:
```bash
cd [gtm-path] && ./crm prep [name]
```

### Log activity (`crm:touch`)
Ask: "Who did you talk to?"

Then run:
```bash
cd [gtm-path] && ./crm touch [name]
```

## Output Formatting

JFL uses ANSI colors. For Telegram/Slack:
1. Strip ANSI codes: `sed 's/\x1b\[[0-9;]*m//g'`
2. Keep emoji status indicators (🟠🟡✅🔴)
3. Convert headers (━━━ lines) to **bold**
4. Preserve line breaks

## Error Handling

If GTM not found:
```
❌ GTM not found at [path]

Run /jfl to select a different GTM.
```

If command fails:
```
⚠️ Command failed: [error]

This might mean the GTM needs updating.
Try: /jfl → [gtm] → Sync
```

## Notes

- Keep responses short for mobile
- Always show action buttons (don't just dump text)
- GTM path is stored per-conversation (not globally)
- Commands run in GTM directory (cd first, then command)
