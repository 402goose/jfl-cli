# Quick Start: Skill → Product Launch

> You built a Claude Code skill. Now you want to monetize it.
> This guide gets you from skill to paid product launch.

---

## The Pattern

```
SKILL (free)                    PRODUCT (paid)
────────────                    ──────────────
github.com/you/skill     →      yourproduct.io

Open source                     Web app / better UX
Builds awareness                Paywall ($5-$50)
Shows it works                  Monetizes
```

---

## Step 1: Foundation (30 min)

### Fill out your vision

Copy `templates/strategic/VISION.md` to `knowledge/VISION.md`:

```markdown
## The One-Liner
{What does your skill do in one sentence?}

## The Problem
{What pain does this solve?}
{Who has this problem?}

## The Solution
{How does your skill fix it?}

## Why Paid?
{What does the paid version add?}
- Better UX?
- More features?
- Convenience?
- Support?
```

### Fill out your narrative

Copy `templates/strategic/NARRATIVE.md` to `knowledge/NARRATIVE.md`:

```markdown
## Tagline
{5 words max}

## Tweet
{280 chars - the hook}

## Elevator Pitch
{30 seconds - problem, solution, why now}
```

---

## Step 2: Brand (1 hour)

### Fill out brand brief

Copy `templates/brand/BRAND_BRIEF.md` to `knowledge/BRAND_BRIEF.md`:

```markdown
## Identity
Name: {your product name}
Tagline: {from narrative}
Domain: {yourproduct.io}

## Personality
- Voice: {casual? professional? playful?}
- Aesthetic: {minimal? bold? terminal?}

## Mark Preferences
- Type: {symbol? wordmark? lettermark?}
- Constraints: {must work at 16px? specific colors?}
```

### Generate brand assets

```bash
claude
/brand-architect
```

This creates:
- Mark options in `outputs/svg/mark/`
- Preview in `previews/brand/twitter-profile.html`

### Make decisions

Pick your mark, colors, typography. Record in `knowledge/BRAND_DECISIONS.md`.

### Generate final assets

```bash
/web-architect implement all
```

This creates:
- Favicons (all sizes)
- OG image (for link previews)
- Twitter banner
- CSS tokens

---

## Step 3: Content (1-2 hours)

### Launch thread

```bash
/content thread "launching {product name}"
```

Preview in `previews/content/twitter-thread.html`.

### One-pager

```bash
/content one-pager "{product name}"
```

Preview in `previews/print/one-pager.html` - can export to PDF.

### Landing page copy

```bash
/content landing-page "{product name}"
```

Gets you:
- Hero headline
- Problem/solution sections
- Feature list
- CTA copy

---

## Step 4: Launch Checklist

### Pre-launch
- [ ] Skill repo is public and README is good
- [ ] Product is live (even if basic)
- [ ] OG image set (link previews work)
- [ ] Twitter profile updated (PFP, banner)
- [ ] Launch thread drafted and reviewed

### Launch day
- [ ] Post launch thread
- [ ] Pin tweet
- [ ] Share in relevant communities
- [ ] Reply to comments
- [ ] Track metrics

### Post-launch
- [ ] Follow up thread (results, learnings)
- [ ] Iterate based on feedback
- [ ] Consider Product Hunt, Hacker News

---

## Example: JustCancel

**Skill:** [just-fucking-cancel](https://github.com/rohunvora/just-fucking-cancel)
- Claude Code skill
- Upload CSVs, find subscriptions
- Free, open source

**Product:** [justcancel.io](https://justcancel.io)
- Web app (same functionality)
- $5 for full list with cancel links
- Better UX, no CLI needed

**Launch:**
- Pinned tweet with demo video
- Clear value prop: "Find subscriptions in 90 seconds"
- Simple paywall: free preview, $5 for full access

---

## Timeline

| Day | Activity |
|-----|----------|
| 0 | Fill out foundation docs |
| 1 | Generate brand, make decisions |
| 2 | Generate content, review |
| 3 | Final prep, test everything |
| 4 | **Launch** |
| 5+ | Iterate, engage, follow up |

---

## Commands Reference

```bash
# Brand
/brand-architect              # Full workflow
/web-architect implement all  # Generate assets

# Content
/content thread [topic]       # Launch thread
/content one-pager [topic]    # PDF summary
/content post [topic]         # Single post

# Status
/hud                          # Campaign dashboard
```

---

## Pricing

| Product Type | Price Range | Notes |
|--------------|-------------|-------|
| Micro-tool | $5-$20 | One-time, impulse buy |
| **Utility product** | **$50-$100** | **Solves real problem** |
| Pro tool | $100-$200 | Power users, businesses |
| SaaS | $20-$200/mo | Recurring, ongoing value |

**Don't underprice.** If you built something useful, charge for it. $50-$200 is reasonable for a product that saves time or makes money.

---

## Tips

1. **Keep it simple** - Your first launch doesn't need to be perfect
2. **Show, don't tell** - Demo video > feature list
3. **Price it right** - $50-$200 for real products, not $5
4. **Launch fast** - Momentum matters more than polish
5. **Engage** - Reply to every comment on launch day

---

Go ship it.
