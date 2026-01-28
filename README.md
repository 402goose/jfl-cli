# JFL - Just Fucking Launch

**The context layer for AI-native teams.**

Context is the bottleneck. AI agents can do the work—but they forget everything between sessions. They don't know what you're building, who you're building it for, or what you decided yesterday.

JFL solves this. It's persistent context that lives in git, accumulates over time, and lets any AI pick up exactly where the last one left off.

**Quick Links:** [Website](https://jfl.run) · [Docs](https://jfl.run/docs) · [Getting Started](https://jfl.run/start) · [GitHub](https://github.com/402goose/jfl-cli)

---

## The Problem

The $300B SaaS economy is a patch for human coordination failures:

- **Notion** exists because people forget context
- **Asana** exists because people forget tasks
- **Slack** exists because email is too slow
- **HubSpot** exists because people forget to follow up
- **Zapier** exists because tools don't talk to each other

And here's the punchline: **it doesn't even work.**

No one reads your product spec. No one maintains your CRM. No one respects the kanban. You create all these artifacts to coordinate humans, and then humans don't use them.

**AI changes this.** Perfect memory. Infinite patience. Zero context-switching cost. LLMs are better coordinators than humans—if they have the context.

---

## What JFL Does

JFL is the context layer that makes AI actually useful for real work.

**Context Hub** — Unified context aggregating journal entries, knowledge docs, and code headers. Any AI can query it to understand what happened across sessions, what decisions were made, and what code does. It's a daemon (port 4242) with MCP integration.

**Synopsis** — Work summaries that roll up journal + commits + file headers into readable reports. Ask "what happened this week?" or "what did Alex work on?" and get structured answers with time audit breakdowns.

**Session Management** — Git worktree-based isolation for parallel work. Each session auto-commits, auto-merges, and cleans up. No more lost work or merge conflicts. Hooks enforce journal entries and handle cleanup automatically.

**Plus:** Brand generation, content creation, x402 crypto micropayments, and a growing skill library.

---

## The Unlock

**Solo operators can run like a full team.** One founder with JFL can coordinate product, GTM, content, brand, and ops—all with perfect context, no meetings, no handoffs.

**Teams scale without the overhead.** Add a new person, they inherit the full context graph. No onboarding docs. No "shadow someone for a week." They're productive day one.

**The system maintains itself.** Context accumulates automatically. CRM updates through conversation. Decisions are captured as you make them. The agent handles maintenance. You handle taste.

---

## Installation

```bash
npm install -g jfl
```

**Requirements:** Node ≥18

JFL automatically installs dependencies including Context Hub MCP and x402 payment tools.

---

## Quick Start (TL;DR)

```bash
# Initialize a GTM workspace
jfl init my-product-gtm

# Check status
cd my-product-gtm
jfl status

# View campaign dashboard
jfl hud

# See what happened recently
jfl synopsis 24

# Start interactive session (auto-updates on first run)
jfl
```

---

## Core Commands

| Command | Description |
|---------|-------------|
| `jfl` | Interactive session (auto-updates GTM template + npm package) |
| `jfl init [name]` | Initialize new GTM workspace |
| `jfl status` | Show project status and auth |
| `jfl hud` | Campaign dashboard (ship date, phases, pipeline) |
| `jfl synopsis [hours] [author]` | Work summary (journal + commits + code) |
| `jfl update` | Pull latest skills and templates |
| `jfl context-hub [action]` | Manage Context Hub daemon (start/stop/status) |
| `jfl session [action]` | Session management (create/list/end) |
| `jfl repair` | Fix .jfl/config.json if corrupted |

### Platform Commands

| Command | Description |
|---------|-------------|
| `jfl login` | Authenticate to JFL platform |
| `jfl login --x402` | Use x402 Day Pass ($5/day crypto) |
| `jfl wallet` | Show wallet and day pass status |
| `jfl deploy` | Deploy to JFL platform |
| `jfl agents [action]` | Manage parallel agents (list/create/start/stop) |
| `jfl feedback` | Rate your session |

---

## How It Works

**The system lives in git. Everything is files.**

No proprietary database. No lock-in. Your company's knowledge graph is version-controlled and portable.

```
my-project-gtm/              ← GTM workspace (strategy, content, brand)
├── .jfl/
│   ├── config.json          ← Project settings
│   ├── journal/             ← Session journals (JSONL)
│   └── context-hub.pid      ← Context Hub daemon
├── product/                 ← SUBMODULE → your-product-repo
├── knowledge/               ← Strategy docs (VISION, ROADMAP, etc.)
├── content/                 ← Generated marketing content
├── suggestions/             ← Contributor workspaces
├── .claude/skills/          ← JFL skills
└── CLAUDE.md                ← AI instructions

your-product-repo/           ← SEPARATE REPO (all code)
├── src/
├── cli/
└── ...
```

**When you start a session:**
1. The agent loads your full context (via Context Hub)
2. You work (code, content, strategy, whatever)
3. Decisions and learnings are captured automatically
4. Session ends, context persists
5. Next session picks up exactly where you left off

**It compounds.** The more you use it, the more it knows. Six months in, the agent understands your business better than most employees would.

**Why GTM workspace is separate from product code:**
- Clean separation of concerns
- Product code doesn't get polluted with GTM docs
- Multiple GTMs can reference the same product
- `jfl update` updates GTM toolkit without touching product code
- Team can work on product independently

---

## Context Hub

Context Hub is a local daemon (port 4242) that provides unified context to any AI:

```bash
# Start Context Hub
jfl context-hub start

# Check status
jfl context-hub status

# Stop daemon
jfl context-hub stop
```

**What it aggregates:**
- **Journal entries** — What happened across sessions (`.jfl/journal/*.jsonl`)
- **Knowledge docs** — Strategy, vision, roadmap (`knowledge/*.md`)
- **Code headers** — `@purpose`, `@spec`, `@decision` tags from files

**MCP Integration:**
Context Hub exposes MCP tools that Claude Code and other AIs can use:
- `context_get` — Get unified context (journal + knowledge + code)
- `context_search` — Semantic search across all sources
- `context_status` — Check daemon status
- `context_sessions` — See activity from other sessions

Add to your `.mcp.json`:
```json
{
  "jfl-context": {
    "command": "jfl-context-hub-mcp"
  }
}
```

---

## Synopsis - Work Summaries

Synopsis aggregates journal entries, git commits, and code file headers to answer "what happened?"

```bash
# Last 24 hours, all authors
jfl synopsis 24

# Last 8 hours
jfl synopsis 8

# What did Alex work on in last 48 hours?
jfl synopsis 48 alex

# Filter by git author name
jfl synopsis 24 --author "Andrew"
```

**Output includes:**
- Summary of features, fixes, decisions
- Time audit breakdown (infra vs features vs docs)
- Per-team-member contributions
- Health checks (too much infra? not enough outreach?)
- Next steps from journal entries
- Incomplete/stubbed items

---

## Session Management

Work in isolated git worktrees with automatic commit/merge:

```bash
# Create new session (creates worktree + branch)
jfl session create

# List active sessions
jfl session list

# End session (merges to main, removes worktree)
jfl session end [session-name]

# Auto-commit running in background (every 2 min)
./scripts/session/auto-commit.sh start
```

**Each session:**
- Isolated git worktree (parallel work without conflicts)
- Auto-commits knowledge/, content/, suggestions/ every 2 minutes
- Auto-merges to main on session end
- Removes worktree and branch when merged
- Writes journal entries (enforced by hooks)

**SessionStart hook:**
- CD to worktree
- Sync repos (jfl-gtm + product submodule)
- Run doctor check (detect issues)
- Start Context Hub
- Show HUD dashboard

**Stop hook:**
- Auto-commit uncommitted changes
- Merge to main (with conflict handling)
- Cleanup worktree and branch
- Validate journal entry exists

---

## Authentication

**GitHub OAuth:**
```bash
jfl login
```

**x402 Crypto Wallet ($5/day micropayments):**
```bash
jfl login --x402
```

Enables:
- Gasless USDC transfers (no ETH needed)
- $5/day Day Pass payments
- httpcat-cli bundled and configured

View auth status:
```bash
jfl status
jfl wallet
```

---

## Pricing

| Plan | Price | What You Get |
|------|-------|--------------|
| **Trial** | $0 | Full toolkit, foundation + brand setup. Use with Claude Code. |
| **Day Pass** | $5/day | Pay only days you use. AI included. Chat in Telegram/Slack/Discord. Pay with USDC (gasless). |
| **Solo** | $49/mo | Just you. AI included. Best if you use it most days. |
| **Team** | $199/mo | Up to 5 seats (+$25/seat after). AI for everyone. Parallel agents. Team analytics. |

---

## Skills Library

JFL includes skills for Claude Code:

| Skill | Description |
|-------|-------------|
| `/hud` | Campaign dashboard with countdown and tasks |
| `/brand-architect` | Generate brand identity (marks, colors, typography) |
| `/web-architect` | Implement assets (SVG, favicon, OG images) |
| `/content` | Create content (threads, posts, articles, one-pagers) |
| `/x-algorithm` | Optimize tweets for X For You feed |
| `/video` | Founder video scripts (viral short-form) |
| `/startup` | Startup journey guidance (idea to scale) |
| `/agent-browser` | Headless browser automation |
| `/search` | Semantic search across GTM knowledge base |
| `/spec` | Multi-agent adversarial spec refinement |
| `/react-best-practices` | React/Next.js performance optimization |
| `/remotion-best-practices` | Remotion video creation in React |

Run in Claude Code after `jfl init`.

---

## Knowledge Layer

JFL structures your GTM knowledge:

```
knowledge/
├── VISION.md              # What you're building
├── NARRATIVE.md           # How you tell the story
├── THESIS.md              # Why you'll win
├── ROADMAP.md             # What ships when
├── BRAND_BRIEF.md         # Brand inputs
├── BRAND_DECISIONS.md     # Finalized brand choices
├── VOICE_AND_TONE.md      # How the brand speaks
└── TASKS.md               # Master task list
```

These docs are the source of truth. AIs read them to generate content, make decisions, and maintain consistency.

---

## Auto-Update

JFL automatically checks for updates on session start (24-hour cache):

- **Minor/patch versions** — Auto-updates silently
- **Major versions** — Prompts for approval

**Skip auto-update:**
```bash
jfl --no-update
```

**Manual update:**
```bash
jfl update                   # Pull latest skills and CLAUDE.md
jfl update --dry             # Preview changes first
```

**What gets updated:**
- `.claude/skills/` — Latest skill implementations
- `CLAUDE.md` — Latest AI instructions
- `scripts/` — Session management scripts
- `templates/` — Doc templates

**What's preserved:**
- `knowledge/` — Your strategy docs
- `content/` — Your generated content
- `product/` — Your product code
- `.jfl/config.json` — Project settings

---

## Journal Protocol

Every session MUST write journal entries. The Stop hook blocks if no entry exists.

**Entry format:**
```json
{
  "v": 1,
  "ts": "2026-01-28T10:00:00.000Z",
  "session": "session-goose-20260128-1014-00cec4",
  "type": "feature|fix|decision|milestone|discovery",
  "status": "complete|incomplete|blocked",
  "title": "Short title",
  "summary": "2-3 sentence summary",
  "detail": "Full description with context",
  "files": ["file1.ts", "file2.ts"],
  "incomplete": ["what's not done"],
  "next": "what should happen next"
}
```

**Write entries when:**
- Feature completed
- Decision made
- Bug fixed
- Milestone reached
- Session ending

Journal entries become searchable via Context Hub and Synopsis.

---

## File Headers (Required for Code)

Every `.ts`, `.tsx`, `.js`, `.jsx` file MUST have a header with `@purpose`:

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

Enables:
- Synopsis to extract context from files
- Codebase understanding without reading full files
- Decision traceability

---

## Contributing to JFL

```bash
# Clone via GTM structure
jfl init my-jfl-gtm
# During setup, add: https://github.com/402goose/just-fucking-launch.git

# Run dev setup
cd my-jfl-gtm/product
./scripts/dev-setup.sh

# Work in the CLI submodule
cd cli
npm install
npm run build

# Link globally for testing
npm link
```

---

## Environment Variables

```bash
CRM_SHEET_ID=your-sheet-id   # Google Sheets CRM integration
```

---

## Files You'll Work With

```
.jfl/
├── config.json              # Project configuration
├── journal/                 # Session journals (JSONL)
├── context-hub.pid          # Context Hub daemon PID
└── logs/                    # Session logs

knowledge/                    # Strategy docs (you fill these)
content/                      # Generated content
suggestions/{name}.md         # Per-person working space
previews/                     # Generated assets
```

---

## Help & Support

```bash
jfl help                      # Show all commands
jfl --version                 # Show version
```

**Issues & Feedback:**
- GitHub: https://github.com/402goose/jfl-cli/issues
- Docs: https://jfl.run
- X: [@taggaoyl](https://x.com/taggaoyl)

---

## What's New in 0.1.0

- ✨ Auto-update on session start (checks npm registry, 24h cache)
- 🔍 Synopsis command (`jfl synopsis [hours] [author]`)
- 🏥 Improved doctor checks with categorized output
- 🐛 Fixed auto-merge failure that caused branch pileup
- 📊 Context Hub productization improvements

---

## License

MIT License - see LICENSE file for details.

---

## Credits

Built by [@tagga](https://x.com/taggaoyl) (Alec Taggart)

Powered by:
- [Claude](https://claude.ai) (Anthropic)
- [x402](https://402.com) (crypto micropayments)
- Commander.js, Inquirer, Chalk, and more

