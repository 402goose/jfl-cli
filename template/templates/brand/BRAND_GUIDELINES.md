# Brand Guidelines

> Usage rules and application guidance for the brand.
> Complements BRAND_DECISIONS.md (what we chose) with HOW to use it.

---

## Logo Usage

### Clear Space

Minimum clear space around the logo equals the height of the mark's "x-height" (or specify in pixels/rem).

```
    ┌─────────────────────┐
    │                     │
    │   ┌─────────────┐   │
    │   │    LOGO     │   │  ← Clear space = X on all sides
    │   └─────────────┘   │
    │                     │
    └─────────────────────┘
```

### Minimum Size

| Context | Minimum Width |
|---------|--------------|
| Digital | 32px |
| Print | 0.5in / 12mm |
| Favicon | 16px (simplified mark) |

### Logo Don'ts

- [ ] Don't stretch or distort
- [ ] Don't rotate
- [ ] Don't add effects (shadows, glows, gradients)
- [ ] Don't place on busy backgrounds without container
- [ ] Don't change the colors outside approved palette
- [ ] Don't outline or stroke the logo
- [ ] Don't recreate in different fonts

---

## Color Usage

### Primary Color

**Use for:**
- Primary CTAs and buttons
- Key interactive elements
- Links
- Selected states
- Brand moments

**Don't use for:**
- Large background areas (too intense)
- Body text
- Disabled states

### Secondary Color

**Use for:**
- Secondary buttons
- Accents and highlights
- Hover states
- Supporting graphics

### Neutral Colors

**Use for:**
- Body text
- Backgrounds
- Borders
- Disabled states
- Secondary text

### Color Accessibility

| Combination | Contrast Ratio | WCAG Level |
|-------------|----------------|------------|
| Primary on White | {ratio} | {AA/AAA} |
| Primary on Dark | {ratio} | {AA/AAA} |
| Body text on Background | {ratio} | {AA/AAA} |

**Minimum requirements:**
- Normal text: 4.5:1 (AA)
- Large text (18px+): 3:1 (AA)
- UI components: 3:1 (AA)

---

## Typography

### Hierarchy

| Level | Size | Weight | Line Height | Use For |
|-------|------|--------|-------------|---------|
| Display | 48-72px | Bold | 1.1 | Hero headlines |
| H1 | 36-48px | Bold | 1.2 | Page titles |
| H2 | 28-36px | Semibold | 1.25 | Section headers |
| H3 | 20-24px | Semibold | 1.3 | Subsections |
| Body | 16-18px | Regular | 1.5-1.6 | Paragraphs |
| Small | 14px | Regular | 1.4 | Captions, meta |
| Micro | 12px | Medium | 1.3 | Labels, tags |

### Font Weights

| Weight | Value | Use For |
|--------|-------|---------|
| Regular | 400 | Body text |
| Medium | 500 | Emphasis, labels |
| Semibold | 600 | Subheadings |
| Bold | 700 | Headlines, CTAs |

### Typography Don'ts

- [ ] Don't use more than 2 font families
- [ ] Don't use light weights under 16px
- [ ] Don't center-align long paragraphs
- [ ] Don't use all-caps for body text
- [ ] Don't exceed 75 characters per line

---

## Spacing

### Base Unit

All spacing derives from a base unit: **4px** (0.25rem)

### Scale

| Token | Value | Use For |
|-------|-------|---------|
| xs | 4px | Tight gaps, icon padding |
| sm | 8px | Inline elements, small gaps |
| md | 16px | Default spacing |
| lg | 24px | Section padding |
| xl | 32px | Large gaps |
| 2xl | 48px | Section margins |
| 3xl | 64px | Major sections |

### Component Spacing

| Component | Internal Padding | External Margin |
|-----------|-----------------|-----------------|
| Button | 8px 16px | - |
| Card | 16px-24px | 16px |
| Input | 12px 16px | 8px (between inputs) |
| Section | 48px-64px | 0 |

---

## Voice & Tone

### Brand Voice

**We are:**
- {adjective 1} - {what this means}
- {adjective 2} - {what this means}
- {adjective 3} - {what this means}

**We are NOT:**
- {anti-adjective 1} - {what to avoid}
- {anti-adjective 2} - {what to avoid}

### Tone by Context

| Context | Tone | Example |
|---------|------|---------|
| Errors | Helpful, not blaming | "Couldn't save. Check your connection." |
| Success | Brief, celebratory | "Done!" or "Saved" |
| Empty states | Encouraging | "No items yet. Create your first one." |
| Loading | Honest | "Loading..." (not "Just a moment...") |
| CTAs | Direct, active | "Start building" not "Click here to begin" |

### Writing Style

- Use sentence case for headings
- Use active voice
- Keep sentences short (under 20 words)
- Avoid jargon unless audience expects it
- Use "you" not "the user"

---

## Imagery

### Photography Style

- {describe style: candid vs posed, saturated vs muted, etc.}
- {describe subjects: people, objects, abstract}
- {describe mood: professional, playful, serious}

### Illustration Style

- {describe style: line art, filled, 3D, flat}
- {describe colors: brand colors only? accent allowed?}
- {describe complexity: minimal, detailed}

### Icon Style

- {describe: outlined, filled, rounded, sharp}
- {describe: stroke width}
- {describe: size increments}

---

## Motion

### Principles

1. **Purposeful** - Animation serves function, not decoration
2. **Quick** - Fast enough to not delay user
3. **Natural** - Physics-based easing, not linear

### Timing

| Type | Duration | Easing |
|------|----------|--------|
| Micro (hover, press) | 100-150ms | ease-out |
| Small (tooltips, dropdowns) | 150-200ms | ease-out |
| Medium (modals, panels) | 200-300ms | ease-in-out |
| Large (page transitions) | 300-400ms | ease-in-out |

### Don'ts

- [ ] Don't animate for more than 400ms
- [ ] Don't use bounce/elastic for functional UI
- [ ] Don't animate multiple things simultaneously
- [ ] Don't block interaction during animation

---

## Accessibility

### Requirements

- WCAG 2.1 AA compliance minimum
- Keyboard navigation for all interactive elements
- Screen reader support
- Reduced motion support

### Checklist

- [ ] All images have alt text
- [ ] Form inputs have labels
- [ ] Focus states are visible
- [ ] Color is not the only indicator
- [ ] Touch targets are 44x44px minimum
- [ ] Content is readable at 200% zoom
