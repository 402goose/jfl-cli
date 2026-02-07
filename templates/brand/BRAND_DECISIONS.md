# Brand Decisions

> This file gets filled in as you make selections during the brand architect workflow.
>
> Last updated: {date}

---

## Quick Reference

| Decision | Value |
|----------|-------|
| **Primary Mark** | {not selected} |
| **Default Theme** | {dark / light} |
| **Primary Accent** | {color} |
| **Typography** | {font stack} |
| **Tagline** | "{tagline}" |

---

## THE MARK

### Selected Mark
- **File:** `{filename}`
- **Description:** {what it represents}
- **Why chosen:** {rationale}

### Mark Variants

| Context | Mark | File | Notes |
|---------|------|------|-------|
| Favicon (16-48px) | | | |
| Icon (80-160px) | | | |
| PFP (400px) | | | |
| Banner | | | |
| Hero | | | |

### Mark Files

**SVG:**
| File | Use |
|------|-----|
| `mark-{version}-transparent.svg` | Base mark |
| `mark-{version}-{size}-dark.svg` | Dark mode |
| `mark-{version}-{size}-light.svg` | Light mode |

### Usage Rules
- {Any rules about when to use what}
- {Spacing requirements}
- {What not to do}

---

## COLORS

### Dark Mode (Default)
```css
--brand-bg: #000000;
--brand-fg: #FFFFFF;
--brand-accent: {accent};
```

### Light Mode
```css
--brand-bg: #FFFFFF;
--brand-fg: #000000;
--brand-accent: {accent-light};
```

### Full Palette
| Token | Dark | Light | Use |
|-------|------|-------|-----|
| Background | | | Main bg |
| Foreground | | | Text |
| Accent | | | CTAs, highlights |
| Success | | | Positive states |
| Error | | | Errors |
| Warning | | | Warnings |
| Muted | | | Secondary text |

---

## TYPOGRAPHY

### Font Stack
```css
font-family: {stack};
```

### Weights
- **Body:** {weight}
- **Headings:** {weight}
- **Emphasis:** {weight}

### Sizes
| Use | Size |
|-----|------|
| Body | |
| H1 | |
| H2 | |
| Small | |

### Style Notes
- {Preferences: lowercase, uppercase, sentence case}
- {Letter spacing}
- {Line height}

---

## SOCIAL ASSETS

### Twitter Banner
| Size | Dark | Light |
|------|------|-------|
| Small | `banner-sm-1500x500-dark.svg` | |
| Medium | `banner-md-1500x500-dark.svg` | |
| Large | `banner-lg-1500x500-dark.svg` | |
| X-Large | `banner-xl-1500x500-dark.svg` | |

### OG Images
| Variant | File | Use |
|---------|------|-----|
| Default | `og-default-1200x630-dark.svg` | Homepage |
| Tagline | `og-tagline-1200x630-dark.svg` | Marketing |

### PFP
| Platform | File |
|----------|------|
| Twitter | `pfp-400-dark.svg` |

---

## FAVICONS

| Size | File | Use |
|------|------|-----|
| 16px | `favicon-16.png` | Browser tab |
| 32px | `favicon-32.png` | Browser tab @2x |
| 48px | `favicon-48.png` | Windows |
| 96px | `favicon-96.png` | Android Chrome |
| 180px | `favicon-180.png` | Apple Touch |
| 192px | `favicon-192.png` | Android Chrome |
| 512px | `favicon-512.png` | PWA |

---

## DO NOT USE

- {Deprecated marks}
- {Retired colors}
- {Old assets}

---

## FOR IMPLEMENTERS

When implementing this brand:

1. Use marks from `outputs/svg/mark/`
2. Use social assets from `outputs/svg/social/`
3. Reference this file for all decisions
4. Check `outputs/css/global.css` for CSS tokens

---

```
{mark preview here}
```
