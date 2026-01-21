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

Read these files:
- `knowledge/VISION.md` - What you're building
- `knowledge/ROADMAP.md` - Timeline and phases
- `knowledge/NARRATIVE.md` - How you tell the story
- `knowledge/THESIS.md` - Why you'll win
- `knowledge/TASKS.md` - Current tasks

**Pull CRM status:**
- Run `./crm list` to get current pipeline
- Note any CALL_SCHEDULED, IN_CONVO, or REACHED_OUT that need attention

**Assess state:**
- Are docs filled in or still templates?
- Is there a launch date set?
- What phase are they in?
- Any active CRM convos that need follow-up?

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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PIPELINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{Show active CRM contacts - CALL_SCHEDULED, IN_CONVO, REACHED_OUT}
{For each: name, status, what's needed (prep, follow-up, etc.)}

Anything to add or update?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THIS WEEK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{priority tasks}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEXT ACTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{specific next thing to do, not "what do you want to work on?"}
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
   - If they were mid-flow, pick up where they left off
   - "Last time we were working on your narrative. Want to continue?"

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
