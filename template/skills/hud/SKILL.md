---
name: hud
description: Project dashboard that guides you through setup and tracks progress
---

# Project HUD

Shows status and **actively guides you** through what's next.

## Core Principle

**Vision emerges from doing, not declaring.**

Don't force users through setup forms. Let them build. Capture context into the knowledge docs AS you work together - the docs become a record, not a gate.

If they tell you what they want to build → get right into it, save context in background.
If they're lost → ask "What are you building?" and go from there.

## Usage

```
/hud                    # Full dashboard + guided next step
/hud --compact          # One-line status
```

## Workflow

### Step 1: Read Context & Assess State

**A. Query memory for recent context (FIRST):**
```bash
# Memory is the hub - query it for what we were working on
node product/packages/memory/dist/cli.js context "recent work current phase" --limit 5 2>/dev/null || true
```

**B. Read recent journal entries:**
```bash
# Journal captures decisions as they happen
# Read the last ~50 lines for recent context
tail -100 journal/2026-01.md 2>/dev/null || true
```

The journal has timestamped entries with `<!-- refs -->` tags linking to:
- `decision:` - named decisions
- `files:` - files affected
- `related_docs:` - specs and docs
- `status:` - implemented/planned/etc

**C. Pull CRM pipeline (REQUIRED):**
```bash
# Get current pipeline from Google Sheets
./crm list
```

Look for these statuses that need attention:
- 🟠 `IN_CONVO` - Active conversations, may need follow-up
- 🟡 `REACHED_OUT` - Waiting for response
- 🔴 `HOT` - Urgent action needed
- 📞 `CALL_SCHEDULED` - Prep needed

**D. Read knowledge files:**
- `knowledge/VISION.md` - What you're building
- `knowledge/ROADMAP.md` - Timeline and phases (get ship date!)
- `knowledge/TASKS.md` - Current tasks

**E. Assess state:**
- Is there a launch date? Calculate days remaining
- What phase are we in?
- Any active CRM convos that need follow-up?
- What decisions were made recently? (from journal)
- What's the current focus? (from memory query)

### Step 2: Route Based on State

```
IF foundation docs are templates/empty:
  → ONBOARDING MODE (guide through setup)

IF foundation is done but no brand:
  → BRAND MODE (guide to /brand-architect)

IF everything set up:
  → EXECUTION MODE (show status, next tasks)
```

### Step 3A: New Project (Foundation Empty)

Don't force setup. **Get them building.**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{PROJECT NAME}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

What are you building? Let's get into it.

(Vision emerges from doing, not declaring -
I'll capture context as we go.)
```

When they tell you:
- **Start building immediately** - use skills, write code, whatever they need
- **Capture context in background** - save what they said to VISION.md
- As you make decisions together, record them in appropriate docs
- Don't interrupt flow to "fill out forms"

### Step 3B: Brand Mode (Foundation Done, No Brand)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{PROJECT NAME}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Vision: ✓
Roadmap: ✓
Narrative: ✓

Next up: Brand identity.

Ready to create your visual identity?
I'll generate logo marks, colors, and typography.

Say "let's do it" or /brand-architect
```

### Step 3C: Execution Mode (Everything Set Up)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{PROJECT NAME}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Ship: {date} ({days} days)
Phase: {current phase}
Memory: {X} docs, {Y} memories indexed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PIPELINE (from ./crm list)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🟠 Jack (Nascent) - IN_CONVO - needs follow-up docs
🟠 Wes (Formation) - IN_CONVO - waiting on beta timing
🟡 Avi (Coinfund) - REACHED_OUT - no response yet

{Only show IN_CONVO, REACHED_OUT, HOT - skip COLD}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RECENT WORK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{from journal + memory query - recent decisions/work}
{what's next based on that context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THIS WEEK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{from knowledge/TASKS.md or inferred priorities}
1. {most urgent based on pipeline + context}
2. {second priority}
3. {third priority}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEXT ACTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{Pick ONE specific thing based on:
 - Urgent pipeline items (follow-ups due)
 - Recent journal entries (what's in progress)
 - This week's priorities from TASKS.md}

What do you want to tackle?
```

### Compact Mode (--compact)

```
{project} | {days}d | Phase: {phase} | Next: {action}
```

## Key Behaviors

1. **Never end with open questions** like "What do you want to work on?"
   - Instead: Suggest the specific next action
   - Or: Ask a specific question to move forward

2. **Detect returning users**
   - Check journal for recent work (last few entries)
   - Query memory for "recent decisions" or "current focus"
   - "You were working on X. Want to continue?"

3. **Guide, don't report**
   - Bad: "Your docs are templates. Fill them in."
   - Good: "What are you building? Tell me in 2-3 sentences."

4. **One thing at a time**
   - Don't overwhelm with all missing pieces
   - Focus on the immediate next step

## Dependencies

- Works with minimal setup (just CLAUDE.md)
- Better with `knowledge/` docs populated
- User context from `suggestions/{name}.md`
- **Memory is the hub** - all context comes from memory queries
- Memory CLI at `product/packages/memory/dist/cli.js`
- Journal at `journal/YYYY-MM.md` - decisions captured as they happen
- No context.md file - memory replaces it
