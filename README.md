# JFL - Just Fucking Launch

Your team's context layer for shipping products. Any AI. Any task.

JFL is a CLI toolkit that powers go-to-market campaigns from zero to launch. It creates structured GTM workspaces where product code, strategy, brand, and content all work together.

## What JFL Does

- **Initialize GTM workspaces** with proper architecture
- **Manage your launch dashboard** with countdown, phases, and tasks
- **Authenticate and manage billing** ($5/day per person, crypto-first)
- **Deploy to platform** for team collaboration
- **Orchestrate parallel agents** for Pro tier
- **Track feedback** and iterate

## Installation

```bash
npm install -g jfl
```

## Quick Start

```bash
# Create a new GTM workspace
jfl init my-project-gtm

# Check status
cd my-project-gtm
jfl status

# View launch dashboard
jfl hud

# Start a session
jfl
```

## Architecture

JFL creates GTM workspaces that are **separate from your product code**:

```
my-project-gtm/              ← GTM workspace (strategy, content, brand)
├── product/                 ← SUBMODULE → your-product-repo
├── knowledge/               ← Strategy, vision, narrative
├── content/                 ← Marketing content
├── suggestions/             ← Contributor work
├── skills/                  ← JFL skills (updated via jfl update)
└── CLAUDE.md                ← AI instructions

your-product-repo/           ← SEPARATE REPO (all code lives here)
├── src/
├── cli/
└── ...
```

**Why?**
- Clean separation of concerns
- Product can be worked on independently
- GTM context doesn't pollute product repo
- Multiple GTMs can reference same product
- `jfl update` updates GTM toolkit without touching product

## Commands

### Core Commands

```bash
jfl                          # Start interactive session (with optional --update)
jfl init [template]          # Initialize new GTM workspace
jfl status                   # Show project status
jfl hud                      # Show campaign dashboard
jfl hud --compact            # One-line status
jfl update                   # Pull latest JFL updates
jfl update --dry             # Preview updates without applying
```

### Platform Commands

```bash
jfl login                    # Authenticate to JFL platform
jfl login --x402             # Use x402 Day Pass ($5/day, crypto)
jfl login --solo             # Use Solo plan ($49/mo)
jfl login --team             # Use Team plan ($199/mo)
jfl login --free             # Stay on trial
jfl logout                   # Logout from platform
jfl wallet                   # Show wallet and day pass status
jfl deploy                   # Deploy to JFL platform
jfl deploy --force           # Force deploy even if no changes
jfl agents [action]          # Manage parallel agents (list, create, start, stop)
jfl feedback                 # Rate your session
```

### Skill Shortcuts

These skills run in your Claude Code session:

```bash
jfl brand [subcommand]       # Run /brand-architect skill
jfl content <type> [topic]   # Run /content skill (thread, post, article, one-pager)
```

## Authentication

JFL supports two authentication methods:

**GitHub OAuth**
```bash
jfl login
```

**x402 Crypto Wallet**
```bash
jfl login --x402
```

View your auth status:
```bash
jfl wallet
```

## Pricing

**Trial - $0**
- Full JFL toolkit
- Foundation + brand setup
- Bring your own AI key
- Ends when you get value or add teammates

**Day Pass - $5/day per person**
- Only pay the days you use it
- AI included (no API key needed)
- Chat in Telegram, Slack, Discord
- Dashboard + Deploy at jfl.run
- Pay with crypto (x402)

**Solo - $49/mo**
- Just you (1 seat)
- AI included
- Everything in Day Pass
- Best if you use it most days

**Team - $199/mo**
- Up to 5 seats (+$25/seat after)
- AI included for everyone
- Team dashboard + analytics
- Parallel agents
- Priority support

## Project Setup Types

When initializing a project, JFL asks about your setup:

**Building a product**
- You're writing code
- Product repo linked as submodule at `product/`
- Code changes go to product repo

**GTM only**
- Team handles code
- You focus on content, brand, outreach
- No code changes, just marketing

**Contributor**
- Working on specific tasks
- Changes go to `suggestions/{name}.md`
- Owner reviews and merges

## Skills Available

JFL includes powerful skills for Claude Code:

- `/hud` - Campaign dashboard with countdown and tasks
- `/brand-architect` - Generate brand identity (marks, colors, typography)
- `/web-architect` - Implement assets (SVG, favicon, OG images)
- `/content` - Create content (threads, posts, articles, one-pagers)
- `/video` - Founder video scripts (viral short-form)
- `/startup` - Startup journey guidance (idea to scale)

Run these in Claude Code after initializing your project.

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
├── TASKS.md               # Master task list
└── CRM.md                 # Contact database
```

These docs are the source of truth that AI reads to generate content, make decisions, and maintain consistency.

## Updating JFL

JFL updates independently of your project:

```bash
jfl update                   # Pull latest skills and CLAUDE.md
jfl update --dry             # Preview changes first
```

This updates:
- `skills/` - Latest skill implementations
- `CLAUDE.md` - Latest AI instructions
- Templates for new docs

Your project content (knowledge/, content/, product/) is never touched.

## Session Management

**Default:** Single session, direct in repo.

**Advanced:** For parallel work across multiple sessions, use worktrees:

```bash
./scripts/worktree-session.sh create [username]    # Create isolated session
./scripts/worktree-session.sh list                 # List active sessions
./scripts/worktree-session.sh end [session-name]   # End session
```

Each worktree session has:
- Isolated git worktree
- Auto-commit (every 5 min)
- Auto-merge to main (every 15 min)
- Own branch for changes

## Development

Contributing to JFL itself:

```bash
# Clone through GTM structure
jfl init my-jfl-gtm
# During setup, add: https://github.com/402goose/just-fucking-launch.git

# Run dev setup
cd my-jfl-gtm/product
./scripts/dev-setup.sh

# Work in the submodule
cd product/cli
npm install
npm run build

# Link globally for testing
npm link
```

## Environment Variables

```bash
CRM_SHEET_ID=your-sheet-id   # Google Sheets CRM integration
```

## Files You'll Work With

```
.jfl/config.json              # Project configuration
knowledge/                    # Strategy docs (you fill these)
content/                      # Generated content
suggestions/{name}.md         # Per-person working space
previews/                     # Generated assets
```

## Help

```bash
jfl help                      # Show all commands
jfl --version                 # Show version
```

For issues or feedback:
- GitHub: https://github.com/402goose/just-fucking-launch
- Docs: https://jfl.run

## License

MIT License - see LICENSE file for details.

## Credits

Built by [@402goose](https://github.com/402goose) (Alec Taggart)

Powered by:
- Claude (Anthropic)
- x402 (crypto micropayments)
- Commander.js, Inquirer, Chalk, and more
