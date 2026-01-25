# JFL - Claude Instructions

Your context layer for building and launching.

## Project Identity

**Get project name from (in order):**
1. `.jfl/config.json` → `name` field
2. `knowledge/VISION.md` → first heading
3. Directory name

Use this name in status displays, greetings, and when referring to the project.

## Philosophy

**Vision emerges from doing, not declaring.**

Don't make users fill out forms before they can build. Let them start immediately. Capture context INTO the knowledge docs as you work together - the docs become a record of decisions, not a gate to getting started.

---

## On Session Start

### 1. Get Context

Read the foundation docs to understand the project:

```bash
# Check what exists
ls knowledge/
cat .jfl/config.json
```

Key docs:
- `knowledge/VISION.md` - What we're building and why
- `knowledge/ROADMAP.md` - When we're shipping
- `knowledge/NARRATIVE.md` - How we tell the story
- `knowledge/THESIS.md` - Why we'll win

### 2. Show Dashboard

Run `/hud` to display project status and guide next steps.

### 3. Identify User

Check who's working:
- **Owner**: Listed in `.jfl/config.json` → full edit access
- **Contributor**: Has `suggestions/{name}.md` → route work there
- **New**: No suggestions file → onboard first

---

## Core Architecture

**A GTM workspace is a context layer, not a code repo.**

```
my-project/
├── .claude/skills/   ← JFL skills
├── .jfl/             ← Project config
├── knowledge/        ← Strategy & context
├── content/          ← Marketing content
├── suggestions/      ← Contributor work
├── previews/         ← Generated assets
├── templates/        ← Doc templates
├── CLAUDE.md         ← These instructions
└── product/          ← Your code (submodule)
```

Product code lives in its own repo, linked as a submodule at `product/`.

---

## Working Modes

### Mode: Building Product

Code lives in the product submodule.

```bash
# Code changes go to product/
cd product/
git add . && git commit -m "feature: ..." && git push

# Update GTM reference
cd ..
git add product && git commit -m "Update product submodule"
```

### Mode: GTM Only

Focus on content, brand, and marketing. No code changes.

### Mode: Contributor

Work within scope, route changes through `suggestions/{name}.md`.

---

## Starting a New Project (Foundation Empty)

Don't ask open-ended questions. Pull them through the foundation:

### VISION.md Questions:
1. What are you building? (2-3 sentences)
2. Who is it for? (specific person, not "everyone")
3. What problem does it solve?
4. If it works perfectly, what does their life look like?
5. What's your rough one-liner?

### ROADMAP.md Questions:
1. When do you want to ship?
2. What's the first thing that needs to work? (MVP)
3. What are the phases?
4. Any hard deadlines?

### NARRATIVE.md Questions:
1. How would you explain this at a party?
2. What's the before/after?
3. What words do you want associated with this?
4. What's the emotional hook?

### THESIS.md Questions:
1. Why will YOU win?
2. What do you know that others don't?
3. What's your unfair advantage?
4. Why now?

**Flow:**
1. VISION → ROADMAP → NARRATIVE → THESIS (don't skip)
2. Write to each file as you go
3. Then ask: "Foundation is set. Want to work on brand next, or jump into building?"

---

## Before Building UI

**Always establish brand direction before writing UI code.**

Check for brand decisions:
1. `knowledge/BRAND_DECISIONS.md` - finalized choices
2. `knowledge/BRAND_BRIEF.md` - brand inputs
3. `knowledge/VOICE_AND_TONE.md` - personality

If no explicit brand docs, infer from NARRATIVE.md and VISION.md:
- Tone: Serious? Playful? Bold? Minimal?
- Audience: Who is this for?
- Positioning: Premium? Accessible? Techy? Human?

Confirm your inference before building.

---

## Skills Available

### /hud - Project Dashboard
```
/hud                    # Full dashboard
/hud --compact          # One-line status
```

### /brand-architect - Brand Creation
```
/brand-architect              # Full workflow
/brand-architect marks        # Just marks
/brand-architect colors       # Just colors
```

### /web-architect - Asset Implementation
```
/web-architect audit          # Check completeness
/web-architect implement all  # Generate everything
```

### /content - Content Creation
```
/content thread [topic]       # Twitter thread
/content post [topic]         # Single post
/content article [topic]      # Long-form
```

### /video - Founder Video Content
```
/video idea [topic]           # Generate concept
/video script [topic]         # Full script
/video hook [topic]           # Hook variations
```

---

## Collaboration System

### Routing Work

**Owner:** Can edit any file directly.

**Everyone else:** Work goes to `suggestions/{name}.md`:
- Contact updates
- Task progress
- Ideas and suggestions

Owner reviews and merges.

### CRM Through Conversation

Capture updates naturally:

```
User: "I DMed @person today"

Claude: "Got it. Logging to your suggestions file:
- @person: DM_SENT

What angle did you use?"
```

---

## Knowledge Sources

| Document | Purpose |
|----------|---------|
| `knowledge/VISION.md` | What we're building |
| `knowledge/ROADMAP.md` | When we ship |
| `knowledge/NARRATIVE.md` | How we tell the story |
| `knowledge/THESIS.md` | Why we'll win |
| `knowledge/BRAND_BRIEF.md` | Brand inputs |
| `knowledge/BRAND_DECISIONS.md` | Finalized brand choices |
| `knowledge/TASKS.md` | Task list |
| `suggestions/{name}.md` | Per-person workspace |

---

## Session End

When they say "done", "bye", "exit":

1. Save work to appropriate files
2. Commit and push:
```bash
git add .
git commit -m "{summary of work}"
git push
```
3. Confirm: "Saved and pushed!"

---

## Team Configuration

Team info is stored in `.jfl/config.json`:

```json
{
  "name": "project-name",
  "owner": {
    "name": "...",
    "github": "..."
  }
}
```

---

## Remember

1. **Foundation first** - Strategy docs before tactics
2. **Route to suggestions** - Non-owners don't edit main docs
3. **Capture naturally** - Updates through conversation
4. **Context compounds** - Each session builds on the last
5. **Ship it** - The goal is launch, not endless iteration
