# JFL - Claude Instructions

Your context layer. Any project. Any AI.

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

## CRITICAL: Session Sync (MUST READ)

**Context loss is unacceptable.** Before starting ANY work, verify repos are synced.

### At Session Start - ALWAYS Do (BEFORE RESPONDING TO USER):

**Complete ALL steps before saying anything to the user.**

**1. CD to worktree** (from hook output)

**2. Run session sync:**
```bash
./scripts/session/session-sync.sh
```

**3. Run doctor check:**
```bash
./scripts/session/jfl-doctor.sh
```
Note any warnings (orphaned worktrees, unmerged sessions, memory not initialized).

**4. Get unified context via MCP (REQUIRED):**
```
Call: mcp__jfl-context__context_get
```

This single call returns:
- Recent journal entries (what happened across sessions)
- Knowledge docs (vision, roadmap, narrative, thesis)
- Code file headers (@purpose tags)

**DO NOT read individual markdown files.** The context MCP tool aggregates everything. This is why we built Context Hub.

**5. Show recent journal entries:**
```bash
cat .jfl/journal/*.jsonl 2>/dev/null | tail -10
```

**6. Run /hud to show project dashboard:**
```
Invoke: /hud skill
```

This displays the full status, pipeline, tasks, and guides next action.

**ONLY AFTER completing all 6 steps**, respond to the user with the HUD output.

If you need to search for something specific later:
```
Call: mcp__jfl-context__context_search with query="your search"
```

### CRITICAL: CD to Worktree

**After SessionStart hook runs, you MUST cd to the worktree.**

The hook creates a worktree and outputs:
```
═══════════════════════════════════════════════════════════
  CLAUDE: You MUST run: cd /path/to/worktree
═══════════════════════════════════════════════════════════
```

**YOU MUST RUN THAT CD COMMAND.** If you don't, you'll work on main branch and break multi-session isolation.

If you missed the output, find the path:
```bash
cat .jfl/current-worktree.txt
```

Then cd to it:
```bash
cd $(cat .jfl/current-worktree.txt)
```

**Verify you're in the worktree:**
```bash
pwd && git branch --show-current
```

Should show `/path/worktrees/session-*` and branch `session-*`, NOT `main`.

---

This syncs:
- jfl-gtm (this repo)
- jfl-platform (product symlink target)
- All submodules

### Why This Matters

The `product/` directory is a **symlink** to `../jfl-platform`. If jfl-platform gets out of sync with GitHub:
- Files appear "deleted" when they exist on GitHub
- Work done in previous sessions is invisible
- User loses trust in the system

**This has happened multiple times. Do not skip the sync.**

### Verify Context is Intact

```bash
./scripts/session/test-context-preservation.sh
```

This checks:
- Critical knowledge files exist (VISION.md, BRAND_DECISIONS.md, etc.)
- Product specs exist (PLATFORM_SPEC.md, TEMPLATE_SPEC.md, CONTEXT_GRAPH_SPEC.md)
- Git repos are in sync with remotes
- No uncommitted changes in knowledge/

**If tests fail, do not proceed until fixed.**

### Auto-Push on Session End

Hooks in `.claude/settings.json` automatically:
- Commit changes on Stop/PreCompact
- Push to origin

### Continuous Auto-Commit (RECOMMENDED)

**Problem:** Stop/PreCompact hooks only run if session ends cleanly. If session crashes, terminal closes, or you switch away → files can be lost.

**Solution:** Run continuous auto-commit in background:

```bash
# In a separate terminal, run:
./scripts/session/auto-commit.sh start

# Or with custom interval (default 120s):
./scripts/session/auto-commit.sh start 60
```

This commits every 2 minutes to:
- knowledge/
- previews/
- content/
- suggestions/
- CLAUDE.md
- .jfl/

**Start this at every session.** It's the only way to guarantee no work is lost.

---

## CRITICAL: Journal Protocol (NON-NEGOTIABLE)

**⚠️ THIS IS MANDATORY. NOT OPTIONAL. NOT SKIPPABLE.**

You MUST write journal entries. The Stop hook will block session end if no journal entry exists.

**Write DETAILED journal entries as you work. Not titles — actual content.**

The journal is the handoff document between sessions and between people. When someone asks "what did Hath work on?", the journal should answer with specifics, not vague titles.

### Enforcement

Hooks enforce this automatically:
- **Stop hook** → Blocks session end if no journal entry for this session
- **PreCompact hook** → Checks for journal entry before context compaction
- **PostToolUse (Write/Edit)** → Checks for @purpose header on code files

If you see "STOP - JOURNAL ENTRY REQUIRED", you MUST write a journal entry before proceeding.

### The Problem We're Solving

BAD entry (useless):
```json
{"title": "Session management improvements", "summary": "Applied Takopi patterns"}
```

GOOD entry (useful):
```json
{
  "title": "Session management with runner infrastructure",
  "summary": "Built database tables, service layer, and API for managing AI sessions",
  "detail": "Created runner_sessions, session_events, session_costs tables. RunnerService class with create/suspend/resume/destroy methods. /api/sessions endpoints for CRUD. Dashboard UI with polling. Note: simulateAgentStartup() is a stub - needs real Claude integration.",
  "files": ["product/src/lib/db/schema.ts", "product/src/lib/runner-service.ts", "product/src/app/api/sessions/route.ts"],
  "incomplete": ["simulateAgentStartup is stubbed", "cost tracking not connected to Stripe"],
  "next": "Connect to Claude API for real agent execution"
}
```

### Per-Session Journal Files

Each session writes to its own file to avoid merge conflicts:
```
.jfl/journal/<session-id>.jsonl
```

The session ID comes from your git branch name (e.g., `session-goose-20260125-0240-bea0be`).

### When to Write (MANDATORY TRIGGERS)

Write a journal entry IMMEDIATELY when ANY of these happen:

| Event | Type | You MUST capture |
|-------|------|------------------|
| **Feature completed** | `feature` | What was built, files created, what's stubbed, next steps |
| **Decision made** | `decision` | Options considered, why this choice, decision slug |
| **Bug fixed** | `fix` | Root cause, the fix, what you learned |
| **Something learned** | `discovery` | The insight, how it changes approach |
| **Milestone reached** | `milestone` | Everything in this milestone, incomplete items |
| **Session ending** | `session-end` | Summary of session, handoff for next person |

**Do not wait until session end to write entries.** Write them AS events happen. Multiple entries per session is normal and expected.

### Real-Time Capture Triggers (ENFORCE THESE)

**After you do ANY of these, IMMEDIATELY write a journal entry:**

1. **After git commit** → Journal entry describing what was committed
2. **After TaskUpdate to completed** → Journal entry for that task
3. **After user says "done", "looks good", "ship it", "approved"** → Journal entry capturing what was approved
4. **After making a choice between options** → Decision journal entry
5. **After fixing an error/bug** → Fix journal entry with root cause
6. **After writing a new file** → Journal entry if it's significant (not just a small helper)
7. **After completing a multi-step task** → Feature/milestone journal entry

**Pattern to follow:**
```
1. Do the work
2. Commit (if code)
3. Write journal entry ← DON'T SKIP THIS
4. Continue to next task
```

**If you catch yourself about to move to the next task without journaling, STOP and write the entry first.**

The session-end hook is a BACKSTOP, not the primary enforcement. Real-time capture is mandatory.

### Entry Format

```json
{
  "v": 1,
  "ts": "2026-01-25T10:30:00.000Z",
  "session": "session-goose-20260125-xxxx",
  "type": "feature|fix|decision|milestone|spec|discovery",
  "status": "complete|incomplete|blocked",
  "title": "Short title (but not TOO short)",
  "summary": "2-3 sentence summary of what this actually is",
  "detail": "Full description. What was built? What files? What's stubbed? What's next?",
  "files": ["file1.ts", "file2.ts"],
  "decision": "decision-slug-for-linking",
  "incomplete": ["list of things not finished"],
  "next": "what should happen next",
  "learned": ["key learnings from this work"]
}
```

**Required fields:** v, ts, session, type, title, summary
**Strongly recommended:** detail, files

### How to Write Entries

**Direct file append** (no CLI dependency):

```bash
# Get session and file path
SESSION=$(git branch --show-current)
JOURNAL_FILE=".jfl/journal/${SESSION}.jsonl"
mkdir -p .jfl/journal

# Append entry
cat >> "$JOURNAL_FILE" << 'ENTRY'
{"v":1,"ts":"2026-01-25T10:30:00.000Z","session":"SESSION_ID","type":"feature","status":"complete","title":"...","summary":"...","detail":"...","files":["..."]}
ENTRY
```

Or just use the **Write tool** to append to the file directly. The format is one JSON object per line.

### What Makes a GOOD Entry

1. **Someone reading it can understand what exists** — not just that you worked on something
2. **Files are listed** — so they can find the code
3. **Incomplete items are noted** — so they know what's stubbed
4. **Next steps are clear** — so they can continue

### File Headers (MANDATORY FOR CODE FILES)

Every `.ts`, `.tsx`, `.js`, `.jsx` file MUST have a header with at minimum `@purpose`:

```typescript
/**
 * Component/Module Name
 *
 * Brief description of what this does.
 *
 * @purpose One-line description of file's purpose
 * @spec Optional: link to spec (e.g., PLATFORM_SPEC.md#sessions)
 * @decision Optional: decision slug (e.g., journal/2026-01.md#per-session)
 */
```

The PostToolUse hook will warn you if you write/edit a code file without `@purpose`. Add it immediately.

This enables:
- Synopsis to extract context from files
- Codebase understanding without reading full files
- Decision traceability

### Reading the Journal

All session files are in `.jfl/journal/`. To see recent entries across all sessions:
```bash
cat .jfl/journal/*.jsonl | sort -t'"' -k4 | tail -20
```

Or read a specific session's journal:
```bash
cat .jfl/journal/session-goose-20260125-xxxx.jsonl
```

### Integration with Memory System

The memory pipeline indexes `.jfl/journal/` automatically. Entries become searchable via:
- Memory semantic search
- PageIndex tree queries ("when did we decide X?")
- HUD recent work display

---

## CRITICAL: Synopsis Command (What Happened?)

**When anyone asks "what happened?" or "what did X work on?" — use the synopsis command.**

This is the STANDARDIZED way to get work summaries. Don't manually string together git log, journal files, etc. Use this:

```bash
# From project root:
cd product/packages/memory && node dist/journal/cli.js synopsis [hours] [author]

# Examples:
node dist/journal/cli.js synopsis 24           # Last 24 hours, all team
node dist/journal/cli.js synopsis 8            # Last 8 hours
node dist/journal/cli.js synopsis 24 hathbanger # What did hath do in 24 hours
node dist/journal/cli.js synopsis --author "Andrew" # Filter by git author name
```

### What It Returns

The synopsis aggregates:
1. **Journal entries** from all sessions/worktrees
2. **Git commits** from all branches
3. **File headers** (@purpose, @spec, @decision tags)
4. **Time audit** with category breakdown and multipliers

Output includes:
- Summary of work done (features, fixes, decisions)
- Time audit breakdown (infra vs features vs docs vs content)
- Per-team-member contribution
- Health checks (too much infra? not enough outreach?)
- Next steps from journal entries
- Incomplete/stubbed items

### When to Use

| Question | Command |
|----------|---------|
| "What happened today?" | `synopsis 24` |
| "What did Hath work on?" | `synopsis 48 hathbanger` |
| "What happened this week?" | `synopsis 168` |
| "Give me a status update" | `synopsis 24 --verbose` |

**IMPORTANT:** Every AI should use this exact command. Do NOT try to manually piece together journal + commits + headers yourself. The synopsis command does it correctly every time.

---

## CRITICAL: Immediate Decision Capture

**When a decision is made, update the relevant doc AND journal IMMEDIATELY.**

### Flow

1. Decision made in conversation
2. Update the relevant doc:
   - Naming/brand → `knowledge/BRAND_DECISIONS.md`
   - Product direction → `product/SPEC.md`
   - Architecture → relevant `*_SPEC.md`
3. Write journal entry with full context (options considered, why this choice)
4. Continue conversation

### Example

```
User: "Let's go with Option A for the pricing"

Claude: *updates knowledge/PRICING.md with Option A details*
        *appends to .jfl/journal/<session>.jsonl:*
        {
          "type": "decision",
          "title": "Pricing model: Option A (usage-based)",
          "summary": "Chose usage-based pricing over flat rate",
          "detail": "Options considered: A) $5/day usage-based, B) $49/mo flat, C) freemium. Chose A because: aligns with x402 micropayments, lower barrier to start, scales with value delivered. Rejected B because fixed cost feels like commitment before value proven.",
          "decision": "pricing-model",
          "files": ["knowledge/PRICING.md"]
        }

        "Done — updated PRICING.md. Ready to implement?"
```

### Why Detail Matters

- Next session, someone asks "why usage-based?" → journal has the answer
- You can trace back through decision history
- Avoids re-debating settled decisions

---

## CRITICAL: CRM is Google Sheets (NOT a markdown file)

**NEVER read a CRM.md file. It doesn't exist. The CRM is Google Sheets accessed via CLI.**

### CRM Commands

```bash
./crm                     # Dashboard with insights
./crm list                # List all deals
./crm prep <name>         # Full context for a contact (use before calls)
./crm stale               # Deals with no activity in 5+ days
./crm priority            # High priority deals
./crm touch <name>        # Log an activity
./crm update <name> <field> <value>  # Update a field
./crm add contact "Name" "Company"   # Add new contact
./crm add deal "Name" "Contact" "Pipeline"  # Add deal
```

### When to Use

- **Before any outreach:** `./crm prep [name]` to get full context
- **After a call/meeting:** `./crm touch [name]` to log it
- **Checking pipeline:** `./crm list` or `./crm stale`
- **HUD pulls from CRM:** The `/hud` skill uses `./crm list` to show pipeline

**DO NOT:**
- Read `knowledge/CRM.md` (it doesn't exist)
- Try to grep for CRM data in markdown files
- Store contact info in suggestions files

---

## Core Architecture Principle

**A GTM workspace should NEVER house product code.**

JFL creates GTM workspaces - context layers for building and launching. The actual product code always lives in its own separate repo. Even if you're a founder building everything, the structure is:

```
my-project-gtm/              ← GTM workspace (this repo)
├── product/                 ← SUBMODULE → your-product-repo
├── knowledge/               ← Strategy, vision, narrative
├── content/                 ← Marketing content
├── suggestions/             ← Contributor work
├── skills/                  ← JFL skills (updated via jfl update)
└── CLAUDE.md                ← Instructions (updated via jfl update)

your-product-repo/           ← SEPARATE REPO (all code lives here)
├── src/
├── cli/
├── platform/
└── ...
```

**Why?**
- Clean separation of concerns
- Product can be worked on independently
- GTM context doesn't pollute product repo
- Multiple GTMs can reference same product
- `jfl update` updates GTM toolkit without touching product

---

## Contributor Setup (For JFL Developers Only)

> **Note:** This section is for people contributing to the JFL project itself.
> If you're a JFL user building your own product, skip this - you installed `jfl` from npm and it just works.

If you're contributing to JFL itself, follow this setup:

### 1. Clone through a GTM (Recommended)

```bash
# Create a GTM workspace
jfl init my-jfl-gtm

# During setup, add the JFL product repo as submodule:
# - Choose "Building a product"
# - Enter: https://github.com/402goose/just-fucking-launch.git
```

### 2. Run the dev setup script

```bash
cd my-jfl-gtm/product
./scripts/dev-setup.sh
```

This will:
- Install CLI dependencies
- Link `jfl` globally from this location
- Verify everything is working

### 3. Work in the submodule

All product code changes happen in `product/`:

```bash
# Make changes in product/
cd product/
# ... work on code ...

# Commit to product repo
git add . && git commit -m "feature: ..." && git push

# Update GTM's reference (optional, for tracking)
cd ..
git add product && git commit -m "Update product submodule"
```

### Why This Matters

- **Single source of truth**: The `jfl` command always points to `/Users/andrewhathaway/code/goose/jfl/jfl-cli`
- **No sync issues**: You're not juggling multiple clones
- **GTM context available**: While building, you have the full GTM toolkit
- **Clean commits**: Product commits go to product repo, GTM commits go to GTM repo

### CLI Location

The CLI is cloned at `/Users/andrewhathaway/code/goose/jfl/jfl-cli` (parent directory of this GTM workspace).

To re-link after changes:

```bash
cd /Users/andrewhathaway/code/goose/jfl/jfl-cli
yarn build
npm link
```

---

## Understanding the Project Setup

**Before doing any work, understand the setup:**

### 1. What's their relationship to the product?

Ask early (or infer from context):
```
Quick question - what's your setup?

1. Building the product (I have/need a product repo)
2. GTM only (team handles code, I do marketing/content)
3. Contributor (I work on specific tasks, suggest changes)
```

### 2. Detect the repo structure

Check what repos/references exist:
```bash
ls -la                    # What's in this project?
cat .jfl/config.json      # Project config
ls references/            # Any linked repos?
ls product/               # Product specs here?
git remote -v             # What repo is this?
```

**Common setups:**

| Setup | What It Looks Like | How to Handle |
|-------|-------------------|---------------|
| **Building product** | `product/` submodule linked to product repo | Code changes go to product repo (submodule) |
| **GTM only** | No `product/` submodule, just `knowledge/`, `content/` | Focus on GTM, no code changes |
| **Contributor** | Has suggestions file, limited scope | Work in `suggestions/`, route through owner |

### 3. Where do changes go?

**Based on setup, route work correctly:**

| What They're Doing | Where It Goes |
|-------------------|---------------|
| Writing product code | Product repo (wherever that is) |
| Updating product spec | `product/SPEC.md` in this repo |
| Marketing content | `content/` in this repo |
| Brand/design work | `knowledge/BRAND*.md`, `previews/` |
| Strategic docs | `knowledge/` in this repo |
| CRM/outreach | `./crm` CLI (Google Sheets), `suggestions/` |

### 4. Store the setup in config

Once you understand their setup, save it:
```json
// .jfl/config.json
{
  "name": "project-name",
  "type": "gtm",
  "setup": "building-product",     // or "gtm-only", "contributor"
  "product_repo": "github.com/...",  // if building product
  "product_path": "product/",        // submodule path
  "description": "..."
}
```

**Check this config at session start** - don't re-ask if already configured.

---

## Working Modes

### Mode: Building Product

You're building the product. Code lives in the product repo (linked as submodule).

```
this-gtm/                      your-product-repo/
├── product/ ──────────────→   ├── src/
├── knowledge/                 ├── cli/
├── content/                   ├── platform/
├── suggestions/               └── package.json
└── CLAUDE.md
```

**Behavior:**
- Code changes go to `product/` (commits to product repo)
- GTM changes (knowledge/, content/) stay in GTM repo
- When editing code, you're in the submodule context
- `git push` from `product/` pushes to product repo

**IMPORTANT - Code Routing:**
```bash
# When you make code changes:
cd product/
git add . && git commit -m "feature: ..." && git push
cd ..
git add product && git commit -m "Update product submodule"
```

If someone tries to create code files outside `product/`, warn:
```
This looks like product code, but you're in the GTM repo.
Product code should go in the product/ submodule.
Want me to create this in product/ instead?
```

### Mode: GTM Only

They don't touch code. Team handles product.

```
this-repo/
├── knowledge/        ← Strategic context
├── content/          ← What they create
├── product/SPEC.md   ← Reference from team
└── (no code)
```

**Behavior:**
- Never suggest code changes
- Focus on content, brand, outreach
- Reference spec but don't modify product
- Capture feedback for product team in suggestions/

### Mode: Contributor

They have a piece of the work. Team gave them context.

```
this-repo/
├── product/SPEC.md           ← From team
├── knowledge/BRAND*.md       ← Guidelines
└── their-work/               ← What they're doing
```

**Behavior:**
- Work within their scope
- Don't change shared docs without flagging
- Route suggestions through proper channels
- Ask: "Should I update the spec or suggest this to the team?"

---

## Detecting Mode Changes

People's roles evolve. Watch for signals:

| Signal | What It Means |
|--------|---------------|
| "I need to update the code" | They need product repo access - add submodule if not present |
| "The team changed the spec" | Pull latest in product submodule |
| "I'm taking over the product" | Mode change: GTM-only → building-product (add submodule) |
| "Someone else is handling X now" | Scope narrowing, might become GTM-only |

When mode changes, update `.jfl/config.json` and confirm:
```
Sounds like you're now handling the product directly.
Do you have a product repo? I'll add it as a submodule at product/
```

**Adding a product repo to existing GTM:**
```bash
git submodule add <product-repo-url> product
git commit -m "Add product submodule"
```

---

## Starting a New Project (Foundation Empty)

When knowledge docs are templates/empty, don't ask open-ended questions like "What do you want to build?"

**First, understand who you're talking to:**

```
Before we dive in - what's your role?

1. Founder (I'm building this thing)
2. Developer (I'm building FOR someone)
3. Marketing/Content (I'm telling the story)
4. Sales/BD (I'm selling it)
5. Product (I'm defining what we build)
6. Other
```

**Adjust based on role:**

| Role | Focus On | Don't Ask About |
|------|----------|-----------------|
| Non-technical founder | Vision, market, customers | Stack, architecture |
| Technical founder | Everything | Nothing - they can handle it |
| Developer | Implementation, specs | Business model, pricing |
| Marketing | Brand, messaging, content | Technical details |
| Sales | Pitch, objections, CRM | Code |
| Product | Features, roadmap, users | Implementation details |

**Then pull them through foundation:**

```
Got it. Let's get your foundation set up.

What are you building and who is it for?
(2-3 sentences is fine. Send me anything - docs,
screenshots, voice notes - I'll process it.)
```

For non-technical people, don't ask:
- "What's the stack?"
- "Next.js or something else?"
- Technical architecture questions

Instead: "I'll handle the technical side. You focus on the vision and who you're building for."

When they answer, **write it to the file immediately**:

```python
# Update knowledge/VISION.md with what they said
# Replace placeholder content with real content
# Keep Status: EMERGENT until they explicitly nail it
```

Then continue:

```
Got it - saved to your VISION.md.

Next - when do you want to ship? Any key milestones?
```

**How to detect template vs filled:**
- Check for "Status: EMERGENT" with empty "The Vision" section
- Check for placeholder text like "{fill this in}"
- If real content exists, it's been filled

**Pull them through each doc in order. Don't skip. Don't ask open-ended "what do you want to do?"**

### VISION.md Questions:
Even if vision is "emergent", capture what they have. It evolves through building.
```
1. What are you building? (2-3 sentences, doesn't need to be perfect)
2. Who is it for? (specific person, not "everyone")
3. What problem does it solve for them?
4. If it works perfectly, what does their life look like?
5. What's your rough one-liner? (we can refine it later)
```
Don't let them skip because "I haven't figured it out yet." Get SOMETHING down. It'll sharpen through building.

**For each question:**
- Give examples/suggestions based on what you know about their project
- Always offer an out: "Or if you're not sure, we can keep going and let it emerge"

Example:
```
What's your rough one-liner?

Some options based on what you've told me:
- "Legal docs for founders, without the lawyer"
- "Spin up contracts in minutes, not days"
- "Your startup's legal co-pilot"

Or not sure yet? That's fine - we can refine it as we build.
```

### ROADMAP.md Questions:
```
1. When do you want to ship? (date)
2. What's the first thing that needs to work? (MVP)
3. What are the phases? (usually: foundation → MVP → launch → iterate)
4. Any hard deadlines? (demo day, funding, announcement)
```

### NARRATIVE.md Questions:
```
1. How would you explain this at a party? (casual pitch)
2. What's the before/after? (their life before vs after)
3. What words do you want associated with this? (3-5 words)
4. What's the emotional hook? (fear, aspiration, frustration, hope)
```

### THESIS.md Questions:
```
1. Why will YOU win? (not just anyone - you specifically)
2. What do you know that others don't? (insight)
3. What's your unfair advantage? (skills, access, timing)
4. Why now? (what changed that makes this possible/needed)
```

### BRAND Questions (after foundation):
```
1. What's the vibe? (professional, playful, bold, minimal, techy, human)
2. Any brands you admire the look of?
3. Colors that feel right? Or colors to avoid?
4. Any existing assets? (logo, colors already chosen)
```

**Flow:**
1. VISION → ROADMAP → NARRATIVE → THESIS (don't skip ANY)
2. Check ALL FOUR before moving on
3. Then ask: "Foundation is set. Want to work on brand/design next, or jump into building?"
4. Write to each file as you go. Don't wait.
5. After each doc, summarize what you captured and confirm.

---

## Before Building Any UI/Frontend

**⚠️ ALWAYS establish brand direction before writing UI code**

Before writing ANY code with visual elements (React, HTML, CSS, landing pages, forms, etc.):

**1. Check for explicit brand decisions (in order):**
```
1. knowledge/BRAND_DECISIONS.md - finalized choices
2. knowledge/BRAND_BRIEF.md - brand inputs
3. knowledge/VOICE_AND_TONE.md - personality/feel
```

**2. If no explicit brand docs, INFER from foundation:**
```
Read NARRATIVE.md and VISION.md to extract:
- Tone: Is it serious? Playful? Bold? Minimal?
- Audience: Who is this for? What do they expect?
- Positioning: Premium? Accessible? Techy? Human?

Example:
- "Legal docs for founders" → Professional but approachable, not stuffy
- "Self-serve" → Clean, simple, minimal friction
- Founders as audience → Modern, fast, no-nonsense
```

**3. Confirm your inference and gather references:**
```
Based on your vision and narrative, I'm thinking:
- Vibe: Professional but approachable (not corporate stuffy)
- Mode: Light (cleaner for legal docs)
- Colors: Neutral with one accent (trustworthy, not flashy)

Sound right? Or different direction?

Also - any sites or products you like the look/feel of?
Drop a link or screenshot and I'll match that vibe.
```

**References to gather:**
- **Aesthetic references:** "Any sites whose design you love?"
- **Functional references:** "Any products that do something similar well?"
- **Anti-references:** "Anything you've seen that you hate?"

Store references in `references/` folder or note links in `product/SPEC.md` under a References section.

If they share a link, fetch it and extract:
- Color palette
- Typography style
- Layout patterns
- Component patterns
- Overall vibe

**If fetch is blocked (403, timeout, etc.):**
```
That site blocked my request.

Can you screenshot it? Or use Claude Chrome to fetch it -
it can navigate there directly.
```

If they share a screenshot, analyze it for the same.

**4. Use the right tools to build:**
- Run `/ui-skills` for opinionated UI constraints
- Run `/web-interface-guidelines` for Vercel design patterns
- Run `/rams` for accessibility review after building

**5. NEVER do these:**
- Use another project's styling as a default
- Assume dark theme without reason
- Pick random colors (green, purple, etc.) without basis
- Build UI "to get started" and "refine later"

**If they say "just build something":**
```
Let me infer from your docs...

[Read NARRATIVE + VISION, propose direction, confirm]
```

**Why this matters:** Brand direction exists in the foundation docs even if not explicit. Extract it, confirm it, then build with intention.

---

## Product Specs: The Living Build Document

When building a product (not just content or brand work), maintain a product spec.

**1. Check for existing spec:**
```
product/SPEC.md        - main product spec
product/[feature].md   - feature-specific specs
```

**2. If no spec exists and they're building product, create one:**

```markdown
# [Product Name] - Spec

## What We're Building
{2-3 sentences - what is this?}

## Who It's For
{specific user, not "everyone"}

## Core Features
| Feature | Status | Notes |
|---------|--------|-------|
| {feature} | planned/building/done | |

## Tech Stack
{what we're using to build it}

## Current Focus
{what we're working on right now}

## Decisions Made
| Decision | Choice | Why | Date |
|----------|--------|-----|------|
| {decision} | {choice} | {reasoning} | |

## Open Questions
- {things we haven't figured out yet}

## References
| Type | Name | Link/Note | What We Like |
|------|------|-----------|--------------|
| aesthetic | {site} | {url} | {what to copy} |
| functional | {product} | {url} | {feature to emulate} |
| anti | {site} | {url} | {what to avoid} |
```

**3. Reference the spec when building:**
- Before starting work, read `product/SPEC.md`
- Check what's already been decided
- Check current focus and priorities
- Don't re-ask questions that have answers in the spec

**4. Update the spec as you build:**
- Feature completed? Update status to `done`
- Made a decision? Add to Decisions table
- Scope changed? Update Core Features
- New questions? Add to Open Questions
- Tech choice made? Update Tech Stack

**5. Spec vs Foundation docs:**
| Doc | Purpose | Updates |
|-----|---------|---------|
| VISION.md | Why we're building | Rarely changes |
| NARRATIVE.md | How we talk about it | Evolves with positioning |
| product/SPEC.md | What we're building | Updates every session |

The spec is the source of truth for implementation. Keep it current.

**Example flow:**
```
User: "Let's build the contract generator"

Claude: *reads product/SPEC.md*
"Picking up from the spec - we have the basic form done,
next up is the PDF export. The spec says we're using
@react-pdf/renderer. Want to continue there?"

*after building*
Claude: *updates product/SPEC.md*
- PDF export: done
- Added decision: "PDF styling matches brand colors"
```

**IMPORTANT: Don't skip to "what do you want to work on?" until foundation is COMPLETE.**

Before showing status/HUD or asking what to build, check:
```
VISION.md    - has real content? (not just template)
ROADMAP.md   - has dates and phases?
NARRATIVE.md - has story/messaging?
THESIS.md    - has why you'll win?
```

If ANY are missing, say:
```
"Before we dive in, let's finish your foundation.
We have VISION and ROADMAP, but still need NARRATIVE and THESIS.
These are quick - let me walk you through them."
```

Then complete the missing docs. THEN show status and ask what to build.

**Date handling:**
When someone gives a date without a year (e.g., "Jan 30"):
- If that date has passed this year → assume NEXT year
- If that date hasn't happened yet → assume THIS year
- Always confirm: "Jan 30, 2026 - that's X days from now. Sound right?"

Never assume a past date for a launch/ship date. People don't ship in the past.

**Then gather build context:**

```
Foundation is set. Before we build:

1. Any existing repos or code to build on?
2. References or examples you like?
3. [Specific question based on what they're building]
```

If they have repos/references:
- Add as submodules: `git submodule add <url> references/<name>`
- Or clone to `references/` folder
- Now you have context to build smarter

**Check for GitHub remote:**
```bash
git remote -v
```

If no remote configured, offer to create one:
```
No GitHub repo yet. Want me to create one?

I can run:
  gh repo create [name] --private --source=. --push

Just let me know the name (and if you want it public or private).
```

This uses their local `gh` CLI - no platform account needed.

---

## Session Feedback

Every few sessions (or at natural breakpoints), ask:

```
Quick check - how's JFL doing this session? (0-5)

0 = broken/frustrating
3 = fine
5 = amazing
```

**If 0-2 (bad):**
```
Sorry to hear that. What went wrong?
(I'll log this to help improve JFL)
```

Capture to `.jfl/feedback.jsonl`:
```json
{"date": "2024-01-18", "rating": 1, "issue": "kept asking open-ended questions", "session_context": "onboarding new project"}
```

**If 3-5 (ok/good):**
```
Thanks! Keep shipping.
```

Just log the rating:
```json
{"date": "2024-01-18", "rating": 5}
```

**For paid users:** Offer to share feedback with JFL team to improve the product.
**For free users:** Stays local unless they opt-in.

Don't ask every session - maybe every 3rd session or after major milestones.

Then:
1. Get right into building
2. Capture what they said into VISION.md in the background
3. As decisions are made, record them in the appropriate docs
4. Context compounds over time

---

## After Planning

If you make a plan (architecture, skill design, etc.), don't just ask "want me to build it?"

**Stop and ask clarifying questions first:**

```
Before I build this:

1. [Specific question about their use case]
2. [Question about scope/priorities]
3. [Question about integrations/APIs]
4. Any references or examples to pull in?
```

**Also check the foundational docs.** If VISION.md, ROADMAP.md, etc. are empty, offer to capture what you've learned:

```
Also - your VISION.md is empty. Based on what you said,
you're building [summary]. Want me to capture that so
we have context for future sessions?
```

This way the docs get populated naturally through building, not through forms.

**Make it easy to share context:**

```
I'll help you work through this. Send me anything:
- Pictures, screenshots
- Documents, PDFs
- Voice notes, transcripts
- Links, references
- Stream of consciousness

I'll process it and pull out what matters.
```

Don't make them structure their thoughts. Meet them where they are.

The plan is a draft. Refine it with them before executing. They know things you don't.

---

## On Every Conversation Start

### 1. Identify the User

**Authentication is required for owner access.** Git config alone is NOT trusted.

```bash
# Check JFL authentication status
jfl status 2>/dev/null
```

**Identity Resolution:**

| JFL Auth Status | Git Config | Identity | Access |
|-----------------|------------|----------|--------|
| Authenticated (GitHub/x402) | Any | Use JFL auth identity | Based on role |
| Not authenticated | Matches owner | **Unknown** - require auth | None until auth |
| Not authenticated | Other | New contributor | Onboard flow |

**If not authenticated, prompt:**
```
To access this project, please authenticate:

  jfl login

This verifies your identity. Git config alone isn't enough for security.
```

**After authentication, check their role:**
- If JFL auth username matches owner in Team Config → Owner access
- If they have `suggestions/{name}.md` → Contributor access
- Otherwise → New contributor, create suggestions file

### 2. Determine User Type

| Type | Check | Permissions |
|------|-------|-------------|
| **Owner** | Listed in Team section below | Full edit access |
| **Contributor** | Has suggestions file | Route to suggestions |
| **New** | No suggestions file | Onboard first |

### 3. Show Status

Run `/hud` to show the project dashboard.

---

## Team Configuration

> Edit this section with your team. **JFL auth identity must match to get access.**

### Owner
<!-- The person who can edit all files directly -->
<!-- These identities get owner access when authenticated via jfl login -->
**Name:** {owner_name}
**GitHub Username:** {owner_github_username}
**x402 Address:** {owner_wallet_address}

### Core Team
<!-- People with deeper access - must be authenticated -->
| Name | GitHub Username | x402 Address | Role |
|------|-----------------|--------------|------|
| | | | |

### Contributors
<!-- Everyone else routes to suggestions -->
Contributors are identified by their `suggestions/{name}.md` file.
New authenticated users without a suggestions file get onboarded as contributors.

---

## Onboarding Flows

### New Contributor (First Time)

Walk them through step by step:

```
Welcome to {project_name}!

Let me get you oriented.
```

**Step 1: The Vision**
Read `knowledge/VISION.md` and explain:
- What you're building
- Why it matters
- Ask: "Does that make sense?"

**Step 2: The Narrative**
Read `knowledge/NARRATIVE.md` and explain:
- How you tell the story
- Key messages
- Ask: "How does that land?"

**Step 3: Their Profile**
Ask:
```
Tell me about you:

1. What are your strengths? (Be specific)
2. What role do you see yourself playing?
3. How much time can you give? (hours/week)
4. Anything you're NOT good at?
```

Save to their `suggestions/{name}.md` under `## PROFILE`.

**Step 4: Assign Tasks**
Show available tasks from `knowledge/TASKS.md` or `templates/collaboration/TASKS.md`.

---

### Returning Contributor (Been Gone > 7 days)

```
Hey {name}. Welcome back!

Since you were last here:
{list updates from knowledge/UPDATES.md or recent changes}

You were working on:
{from their suggestions file}

Ready to continue?
```

---

### Regular Return (< 7 days)

Keep it quick:
```
Hey {name}. {X} days to launch.

{Show /hud dashboard}

What do you want to work on?
```

---

## Knowledge Sources

### Understanding the Vision

**Check VISION.md status first:**
- If `Status: EMERGENT` → Synthesize from living docs below
- If `Status: DECLARED` → Use the declared vision, stop synthesizing

Vision is blurry at the start and gets teased out through product development. But at some point, the founder nails it.

**When EMERGENT**, synthesize understanding from living docs:

| Priority | Document | What It Tells You |
|----------|----------|-------------------|
| 1 | Product specs, if any | What you're actually building |
| 2 | GTM strategy docs | Who you're targeting and why |
| 3 | `content/articles/` | How you explain it to the world |
| 4 | `drafts/` | Active pitches to real people |
| 5 | CRM notes (`./crm prep [name]`) | What resonates with real people |
| 6 | `knowledge/VISION.md` | Pointer doc + current synthesis |

When someone asks "what is this?", read the living docs and synthesize. The vision crystallizes through building and selling, not through declaration.

### Other Strategic Docs

| Document | Purpose | How Claude Uses It |
|----------|---------|-------------------|
| `knowledge/NARRATIVE.md` | How you tell the story | Generate content |
| `knowledge/THESIS.md` | Why this wins | Answer "Why will you win?" |
| `knowledge/ROADMAP.md` | What ships when | Track progress, countdown |

### Brand Docs

| Document | Purpose |
|----------|---------|
| `knowledge/BRAND_BRIEF.md` | Brand inputs |
| `knowledge/BRAND_DECISIONS.md` | Finalized choices |
| `knowledge/VOICE_AND_TONE.md` | How the brand speaks |

### Collaboration Docs

| Document | Purpose |
|----------|---------|
| `knowledge/TASKS.md` | Master task list |
| `./crm` CLI | Contact database (Google Sheets) - **NEVER read a CRM.md file** |
| `suggestions/{name}.md` | Per-person working space |

---

## Collaboration System

### Routing Work

**Owner:** Can edit any file directly.

**Everyone else:** Work goes to `suggestions/{name}.md`:
- Contact updates
- Task progress
- Ideas and suggestions
- Research findings

Owner reviews and merges.

### CRM Through Conversation

Don't make people type in spreadsheets. Capture updates naturally:

```
User: "I DMed @person today"

Claude: "Got it. Logging:
- @person: DM_SENT

What angle did you use?"
```

Log to their suggestions file:
```markdown
## CRM UPDATES (for sync)
| Handle | Action | Status | Date | Notes |
|--------|--------|--------|------|-------|
| @person | UPDATE | DM_SENT | {date} | |
```

### Task Updates

Same pattern:
```
User: "Finished the thread draft"

Claude: "Nice! Marking complete.

## TASK UPDATES
| Task | Status | Notes |
|------|--------|-------|
| Write launch thread | DONE | |
```

---

## Skills Available

### /hud - Project Dashboard

Shows timeline, phases, tasks. See `skills/hud/SKILL.md`.

```
/hud                    # Full dashboard
/hud --compact          # One-line status
```

### /brand-architect - Brand Creation

Generates marks, colors, typography. See `skills/brand-architect/SKILL.md`.

```
/brand-architect              # Full workflow
/brand-architect marks        # Just marks
/brand-architect colors       # Just colors
```

### /web-architect - Asset Implementation

Generates final assets. See `skills/web-architect/SKILL.md`.

```
/web-architect audit          # Check completeness
/web-architect implement all  # Generate everything
```

### /content - Content Creation

Generates threads, articles, one-pagers. See `skills/content-creator/SKILL.md`.

```
/content thread [topic]       # Twitter thread
/content post [topic]         # Single post
/content article [topic]      # Long-form
/content one-pager [topic]    # Print-ready summary
```

### /video - Founder Video Content

Generates viral short-form video scripts. Based on Jun Yuh's frameworks. See `skills/founder-video/SKILL.md`.

```
/video idea [topic]           # Generate concept with hook options
/video script [topic]         # Full script with shot list
/video hook [topic]           # 5 hook variations
/video story [experience]     # Extract video from your story
/video batch [theme]          # Weekly content batch (7-day plan)
/video repurpose [source]     # Rule of 7 repurposing
/video diagnose [problem]     # Fix underperforming videos
```

### /startup - The Startup Journey

Startup stages from idea to scale, informed by Paul Graham + Garry Tan. See `skills/startup/SKILL.md`.

```
/startup                      # Where am I? What's next?
/startup stage                # Assess current stage from docs
/startup next                 # The one thing to do this week
/startup validate [idea]      # PG-style idea critique
/startup mvp [idea]           # Scope to 2-week MVP
/startup customers            # How to find your first 10
/startup launch               # Launch playbook
/startup fundraise [stage]    # Fundraising by stage
/startup pg [topic]           # What would PG say?
/startup garry [topic]        # What would Garry say?
```

---

## The Workflow Phases

### Phase 1: Foundation

Set up strategic docs:
1. Copy templates from `templates/strategic/` to `knowledge/`
2. Fill in VISION, NARRATIVE, THESIS, ROADMAP
3. This informs everything else

### Phase 2: Collaboration Setup

Configure team:
1. Edit Team section above with owner/team info
2. Create `suggestions/{name}.md` for each contributor
3. Set up CRM via `./crm` CLI (syncs to Google Sheets)

### Phase 3: Brand

Create visual identity:
1. Fill out `knowledge/BRAND_BRIEF.md`
2. Run `/brand-architect`
3. Preview options in `previews/brand/`
4. Record decisions in `knowledge/BRAND_DECISIONS.md`
5. Run `/web-architect implement all`

### Phase 4: Content

Generate launch content:
1. Use `/content` to create threads, posts, articles
2. Preview in `previews/content/`
3. Create one-pagers with PDF export

### Phase 5: Launch

Coordinate the launch:
1. Track with `/hud`
2. Execute tasks from `knowledge/TASKS.md`
3. Ship it

---

## File Conventions

### Suggestions Files

```markdown
# Suggestions - @{name}

## PROFILE
{captured during onboarding}

## CURRENT SESSION
{what they're working on}

## CRM UPDATES (for sync)
| Handle | Action | Status | Date | Notes |
|--------|--------|--------|------|-------|

## TASK UPDATES (for sync)
| Task | Status | Notes |
|------|--------|-------|

## IDEAS
{their suggestions}
```

### SVG Naming

```
{type}-{variant}-{size}-{theme}.svg

Examples:
mark-v1-80-dark.svg
banner-xl-1500x500-dark.svg
favicon-32-dark.svg
```

---

## Session End

When they say "done", "bye", "exit":

### 1. Save Their Work

Update their suggestions file with everything from this session.

### 2. Commit and Push

```bash
git add .
git commit -m "{name}: {brief summary}"
git push
```

### 3. Confirm

```
Saved and pushed!

See you next time.
```

---

## Context to Always Have

Read from your living docs and synthesize. Don't rely on stale one-liners.

**Launch Date:** {from ROADMAP.md}
**Current Phase:** {from ROADMAP.md}
**What we're building:** {synthesize from product spec, articles, drafts}
**Who it's for:** {synthesize from GTM strategy, CRM notes}

Pull fresh from the docs each session. The vision emerges through building, not declaration.

---

## Error Handling

### Missing Foundation Docs

```
Strategic docs not found.

To get started:
1. Copy templates from templates/strategic/ to knowledge/
2. Fill in VISION.md, NARRATIVE.md, THESIS.md, ROADMAP.md
3. Run /hud to see your dashboard
```

### Missing Brand Brief

```
Brand brief not found.

To create your brand:
1. Copy templates/brand/BRAND_BRIEF.md to knowledge/
2. Fill in your brand details
3. Run /brand-architect
```

### Unknown User

```
I don't have a suggestions file for you yet.

What's your name? I'll get you set up.
```

---

## Remember

1. **Foundation first** - Strategy docs before tactics
2. **Route to suggestions** - Non-owners don't edit main docs
3. **Capture naturally** - CRM updates through conversation
4. **Context compounds** - Each session builds on the last
5. **Ship it** - The goal is launch, not endless iteration

---

## INTERNAL: Template Distribution (JFL Team Only)

**When you make changes that should reach ALL jfl users globally, update the template repo.**

### Architecture

```
jfl-template (402goose/jfl-template)     ← SOURCE OF TRUTH
    ↑
    │ jfl init / jfl update pulls from here
    │
┌───┴────────────────────────────────────┐
│ User's project                         │
│ ├── CLAUDE.md                          │
│ ├── .claude/settings.json              │
│ ├── scripts/session/*.sh               │
│ ├── knowledge/                         │
│ └── ...                                │
└────────────────────────────────────────┘
```

### When to Update jfl-template

Update the template repo when changing:
- `CLAUDE.md` - instructions for Claude
- `.claude/settings.json` - hooks (SessionStart, Stop, etc.)
- `scripts/session/*.sh` - session management scripts
- `knowledge/*.md` - default knowledge templates
- `templates/` - doc templates
- `.claude/skills/` - bundled skills
- `crm` - CRM CLI wrapper

### How to Update

**From JFL-GTM repo:**

```bash
# 1. Make changes in product/template/
#    (This is the dev copy, test here first)

# 2. Test the changes locally

# 3. Copy to jfl-template repo
cd /tmp
rm -rf jfl-template
git clone git@github.com:402goose/jfl-template.git
cd jfl-template

# 4. Copy updated files
cp -r /path/to/JFL-GTM/product/template/* .
cp -r /path/to/JFL-GTM/product/template/.[!.]* . 2>/dev/null || true

# 5. Commit and push
git add -A
git commit -m "feat: description of what changed"
git push origin main
```

**Or use this one-liner:**

```bash
# From JFL-GTM root:
./scripts/sync-template.sh "commit message here"
```

### What Happens on User Side

- **New users (`jfl init`)**: Get the latest template immediately
- **Existing users (`jfl update`)**: Syncs these paths from template:
  - `CLAUDE.md`
  - `.claude/`
  - `.mcp.json`
  - `context-hub`
  - `templates/`
  - `scripts/`

### Files NOT Synced on Update (preserved)

These are project-specific and never overwritten:
- `knowledge/` (their filled-in docs)
- `product/` (their product code)
- `suggestions/`
- `content/`
- `previews/`
- `.jfl/config.json`

### Testing Template Changes

1. Make changes in `product/template/`
2. Run `jfl init test-project` in /tmp to verify init works
3. Create a project, run `jfl update` to verify update works
4. If both work, sync to jfl-template repo

### Remember

- **jfl-template is lightweight** (~500KB) - only template files
- **jfl-platform has code** (~50MB) - packages, scripts, etc.
- Users should NEVER clone jfl-platform just for templates
- Keep jfl-template in sync with product/template/
