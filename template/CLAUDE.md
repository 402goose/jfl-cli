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

**1. Verify session branch** (from hook output)

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

### CRITICAL: Verify Session Branch

**After SessionStart hook runs, verify you're on the session branch.**

The hook creates a session branch and outputs:
```
═══════════════════════════════════════════════════════════
  Session: session-*
═══════════════════════════════════════════════════════════
```

**Verify you're on session branch:**
```bash
git branch --show-current
```

Should show `session-*`, NOT `main`.

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

**When anyone asks "what happened?" use synopsis:**

```bash
cd product/packages/memory && node dist/journal/cli.js synopsis [hours] [author]

# Examples:
node dist/journal/cli.js synopsis 24           # Last 24 hours
node dist/journal/cli.js synopsis 24 hathbanger # Specific author
```

Aggregates journal entries, git commits, file headers, and time audit with category breakdown.

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

| Mode | Structure | Behavior |
|------|-----------|----------|
| **Building Product** | `product/` submodule → product repo | Code to `product/`, GTM to main repo. Commit to submodule first, then update reference. |
| **GTM Only** | No code, just `knowledge/`, `content/` | Focus on content/brand/outreach. Never suggest code changes. |
| **Contributor** | Has `suggestions/{name}.md` | Work within scope. Route suggestions through proper channels. |

**Detecting mode changes:**
- "I need to update the code" → Add product submodule if missing
- "I'm taking over the product" → Switch to building-product mode
- Update `.jfl/config.json` when mode changes

---

## Starting a New Project (Foundation Empty)

When knowledge docs are empty, pull them through foundation in order. Don't ask open-ended "What do you want to build?"

**Foundation checklist:**

1. **VISION.md** - What are you building? Who is it for? What problem does it solve? One-liner?
2. **ROADMAP.md** - When do you want to ship? MVP? Phases? Hard deadlines?
3. **NARRATIVE.md** - Casual pitch? Before/after? Key words? Emotional hook?
4. **THESIS.md** - Why will YOU win? What insight? Unfair advantage? Why now?

**Key principles:**
- Ask role-specific questions (don't ask non-technical founders about stack)
- Write to files immediately as they answer
- Provide examples/suggestions to guide them
- Allow "emergent" status - vision clarifies through building
- Don't skip docs - complete all four before building

**After foundation:**
- Check if ALL FOUR docs have real content (not templates)
- Then ask: "Foundation is set. Want to work on brand/design next, or jump into building?"

---

## Before Building Any UI/Frontend

**⚠️ ALWAYS establish brand direction before writing UI code**

**Check for brand decisions:**
1. `knowledge/BRAND_DECISIONS.md` - finalized choices
2. `knowledge/BRAND_BRIEF.md` - brand inputs
3. `knowledge/VOICE_AND_TONE.md` - personality/feel

**If no explicit brand docs, INFER from foundation:**
- Read NARRATIVE.md and VISION.md
- Extract tone, audience, positioning
- Propose direction and confirm

**Gather references:**
- Aesthetic refs: Sites they like
- Functional refs: Similar products done well
- Anti-refs: What to avoid
- Store in `references/` or note in `product/SPEC.md`

**NEVER:**
- Use another project's styling as default
- Assume dark theme without reason
- Pick random colors without basis
- Build UI "to get started" and "refine later"

Brand direction exists in foundation docs. Extract it, confirm it, build with intention.

---

## Product Specs: The Living Build Document

When building a product, maintain `product/SPEC.md` as the source of truth for implementation.

**Template sections:** What We're Building | Who It's For | Core Features (table) | Tech Stack | Current Focus | Decisions Made (table) | Open Questions | References (table)

See `templates/` folder for full spec template.

**When to use:**
- Before starting: Read spec for decisions already made
- While building: Update feature status, add decisions, note questions
- After building: Mark features done, document tech choices

**Spec vs Foundation:**
| Doc | Purpose | Updates |
|-----|---------|---------|
| VISION.md | Why we're building | Rarely |
| NARRATIVE.md | How we talk about it | Evolves |
| product/SPEC.md | What we're building | Every session |

**Before building, ensure foundation is complete:**
- Check VISION.md, ROADMAP.md, NARRATIVE.md, THESIS.md all have real content
- If any are missing, complete them first before asking "what to build?"
- Date handling: Dates without year assume future (next year if passed this year)

---

## Session Feedback

Every few sessions, ask: "How's JFL doing this session? (0-5)"

- **0-2:** Ask what went wrong, log to `.jfl/feedback.jsonl` with details
- **3-5:** Log rating only

Don't ask every session - maybe every 3rd or after major milestones.

Then:
1. Get right into building
2. Capture what they said into VISION.md in the background
3. As decisions are made, record them in the appropriate docs
4. Context compounds over time

---

## After Planning

Before building, ask clarifying questions:
1. Specific question about their use case
2. Question about scope/priorities
3. Question about integrations/APIs
4. Any references or examples to pull in?

If foundation docs are empty, offer to capture what you learned into VISION.md, ROADMAP.md, etc.

Accept any format: pictures, documents, voice notes, links, stream of consciousness.

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

**Owner** (full edit access - must authenticate via `jfl login`):
- **Name:** {owner_name}
- **GitHub Username:** {owner_github_username}
- **x402 Address:** {owner_wallet_address}

**Core Team** (authenticated access):
| Name | GitHub Username | x402 Address | Role |
|------|-----------------|--------------|------|
| | | | |

**Contributors:** Identified by `suggestions/{name}.md` file. New users onboarded as contributors.

---

## Onboarding Flows

**New Contributor:** Orient → Profile → Assign
1. Explain VISION.md and NARRATIVE.md
2. Capture their strengths, role, time commitment in `suggestions/{name}.md`
3. Assign tasks from `knowledge/TASKS.md`

**Returning (> 7 days):** Show updates since last visit, remind them what they were working on

**Regular (< 7 days):** Show /hud dashboard, ask what to work on

---

## Knowledge Sources

**Check VISION.md status:** If `EMERGENT` → synthesize from living docs. If `DECLARED` → use declared vision.

**When EMERGENT, synthesize from:** Product specs → GTM strategy → `content/articles/` → `drafts/` → CRM notes → `knowledge/VISION.md`

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

| Skill | Purpose | Key Commands |
|-------|---------|--------------|
| `/hud` | Project dashboard | `(default)` full dashboard, `--compact` one-line |
| `/brand-architect` | Brand creation | `(default)` full workflow, `marks`, `colors` |
| `/web-architect` | Asset implementation | `audit`, `implement all` |
| `/content` | Content creation | `thread [topic]`, `post [topic]`, `article [topic]`, `one-pager [topic]` |
| `/video` | Founder video scripts | `idea [topic]`, `script [topic]`, `hook [topic]`, `story [exp]`, `batch [theme]` |
| `/startup` | Startup guidance | `(default)` assess stage, `next`, `validate [idea]`, `mvp [idea]`, `customers`, `launch` |

See `skills/` folder for detailed documentation on each skill.

---

## The Workflow Phases

1. **Foundation** - Copy templates to `knowledge/`, fill VISION/NARRATIVE/THESIS/ROADMAP
2. **Collaboration Setup** - Edit Team section, create `suggestions/` files, set up `./crm`
3. **Brand** - Fill `BRAND_BRIEF.md`, run `/brand-architect`, record decisions, run `/web-architect implement all`
4. **Content** - Use `/content` for threads/posts/articles, preview in `previews/content/`
5. **Launch** - Track with `/hud`, execute tasks, ship it

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