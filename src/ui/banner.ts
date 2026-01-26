/**
 * JFL Banner & Taglines
 * Beautiful ASCII art banner with rotating taglines (Clawdbot-style)
 */

import chalk from "chalk"
import { theme, colors, getTerminalWidth, center } from "./theme.js"

// ============================================================================
// ASCII BANNER (Clawdbot-style with block characters)
// ============================================================================

// Box-drawing style "GTM" with "JUST*LAUNCH" subtitle
const BANNER_ART = [
  "    ██████╗ ████████╗███╗   ███╗",
  "   ██╔════╝ ╚══██╔══╝████╗ ████║",
  "   ██║  ███╗   ██║   ██╔████╔██║",
  "   ██║   ██║   ██║   ██║╚██╔╝██║",
  "   ╚██████╔╝   ██║   ██║ ╚═╝ ██║",
  "    ╚═════╝    ╚═╝   ╚═╝     ╚═╝",
  "       JUST * LAUNCH              ",
  "   🚀 CONTEXT COMPOUNDS 🚀       ",
]

// Simpler version for medium terminals
const BANNER_MEDIUM = [
  "   ██████╗ ████████╗███╗   ███╗",
  "  ██╔════╝ ╚══██╔══╝████╗ ████║",
  "  ██║  ███╗   ██║   ██╔████╔██║",
  "  ██║   ██║   ██║   ██║╚██╔╝██║",
  "  ╚██████╔╝   ██║   ██║ ╚═╝ ██║",
  "   ╚═════╝    ╚═╝   ╚═╝     ╚═╝",
  "      JUST * LAUNCH             ",
  "  🚀 CONTEXT COMPOUNDS 🚀      ",
]

// Compact for narrow terminals
const BANNER_COMPACT = [
  " ██████╗ ████████╗███╗   ███╗",
  "██╔════╝ ╚══██╔══╝████╗ ████║",
  "██║  ███╗   ██║   ██╔████╔██║",
  "╚██████╔╝   ██║   ██║ ╚═╝ ██║",
  " ╚═════╝    ╚═╝   ╚═╝     ╚═╝",
  "    JUST * LAUNCH            ",
  "🚀 CONTEXT COMPOUNDS 🚀     ",
]

// Minimal fallback
const BANNER_MINIMAL = "🚀 JFL — Just Fucking Launch"

// ============================================================================
// TAGLINES (70+ like Clawdbot)
// ============================================================================

const TAGLINES = [
  // Core philosophy
  "Ship it or it didn't happen.",
  "Your context layer for shipping.",
  "Vision emerges from doing, not declaring.",
  "Stop planning. Start shipping.",
  "The best launch is the one that happens.",
  "Context compounds. Ship daily.",
  "Ideas are cheap. Execution is everything.",
  "Built different. Ships different.",

  // Motivational
  "Less roadmap, more road.",
  "Your MVP is ready when you are.",
  "Perfect is the enemy of shipped.",
  "Launch first. Iterate forever.",
  "The market doesn't care about your Notion.",
  "Features ship. Decks don't.",
  "Momentum > perfection.",
  "Your competition shipped while you were planning.",
  "The best time to launch was yesterday. The second best is now.",
  "Shipped beats perfect every single time.",
  "Nobody ever got funded by a roadmap alone.",

  // Technical / Dev humor
  "AI-powered shipping.",
  "From zero to shipped.",
  "Claude Code's best friend.",
  "GTM on autopilot.",
  "git push origin main && celebrate",
  "We ship on Fridays. Assert dominance.",
  "Your TODO list, automated.",
  "Less JIRA, more shipped.",
  "Prod is the best QA environment.",
  "Works on my machine → Works in production.",
  "The only standup that matters is the one where you shipped.",
  "Agile, but like... actually agile.",

  // Cheeky
  "Because 'next quarter' is not a date.",
  "We don't do beta.",
  "README-driven development.",
  "The only vaporware is the one you don't ship.",
  "Funded by impatience.",
  "Moving fast, breaking nothing.",
  "Your pitch deck is not a product.",
  "Stealth mode is just fear with better branding.",
  "Traction > Slideware.",
  "The market doesn't wait for your feelings.",
  "Launch anxiety is just excitement wearing a mask.",
  "Your competitors don't have a \"launch committee\".",
  "Analysis paralysis is the enemy of progress.",
  "Ship now, apologize never.",
  "Done is better than perfect. Shipped is better than done.",

  // Startup culture
  "Zero to one, one commit at a time.",
  "Your users want the feature, not the spec.",
  "Build in public, ship in peace.",
  "The lean startup, but make it leaner.",
  "PMF is a verb, not a milestone.",
  "Iterate until it hurts, then iterate more.",
  "Feedback loops > focus groups.",
  "Launch small, dream big, ship constantly.",
  "Revenue is the ultimate validation.",
  "Growth hacking is just shipping with analytics.",

  // Meta / Self-aware
  "I can't write your code, but I can make sure it ships.",
  "Your context, my context, our context.",
  "Less planning docs, more doing docs.",
  "Strategy is what happens after you ship.",
  "Press enter and find out.",
  "Your keyboard's best friend.",
  "Making founders dangerous since 2026.",
  "Because your co-founder is tired of your excuses.",
  "The bot that believes in you (and your deploy button).",
]

// Holiday-specific taglines
const HOLIDAY_TAGLINES: Record<string, string[]> = {
  "new-year": [
    "New year, new ship date. This time it's real.",
    "2026: The year you actually launch.",
    "Resolution: Ship more, plan less.",
  ],
  halloween: [
    "The scariest thing is not launching.",
    "Don't be afraid to ship.",
    "Bugs are temporary. Not shipping is forever.",
  ],
  christmas: [
    "The best gift is a shipped product.",
    "'Tis the season to deploy.",
    "All I want for Christmas is a production URL.",
  ],
  thanksgiving: [
    "Grateful for that deploy button.",
    "Thanks for shipping.",
  ],
  "july-4": [
    "Independence from feature creep.",
    "Freedom to ship.",
  ],
  friday: [
    "Deploy on Friday. Assert dominance.",
    "TGIF: Thank God It's Finally shipped.",
  ],
}

// ============================================================================
// HOLIDAY DETECTION
// ============================================================================

interface Holiday {
  name: string
  taglines: string[]
}

function getActiveHoliday(): Holiday | null {
  const now = new Date()
  const month = now.getMonth() + 1 // 1-12
  const day = now.getDate()
  const dayOfWeek = now.getDay() // 0 = Sunday

  // Check specific dates
  if (month === 1 && day <= 7) {
    return { name: "new-year", taglines: HOLIDAY_TAGLINES["new-year"] }
  }
  if (month === 10 && day >= 25 && day <= 31) {
    return { name: "halloween", taglines: HOLIDAY_TAGLINES["halloween"] }
  }
  if (month === 12 && day >= 20 && day <= 26) {
    return { name: "christmas", taglines: HOLIDAY_TAGLINES["christmas"] }
  }
  if (month === 11 && day >= 22 && day <= 28) {
    return { name: "thanksgiving", taglines: HOLIDAY_TAGLINES["thanksgiving"] }
  }
  if (month === 7 && day >= 1 && day <= 4) {
    return { name: "july-4", taglines: HOLIDAY_TAGLINES["july-4"] }
  }

  // Friday special (10% chance)
  if (dayOfWeek === 5 && Math.random() < 0.1) {
    return { name: "friday", taglines: HOLIDAY_TAGLINES["friday"] }
  }

  return null
}

// ============================================================================
// BANNER FUNCTIONS
// ============================================================================

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function getTagline(): string {
  const holiday = getActiveHoliday()
  if (holiday) {
    return pickRandom(holiday.taglines)
  }
  return pickRandom(TAGLINES)
}

export function getBannerArt(): string[] {
  const width = getTerminalWidth()

  if (width >= 50) {
    return BANNER_ART
  } else if (width >= 40) {
    return BANNER_MEDIUM
  } else if (width >= 35) {
    return BANNER_COMPACT
  }
  return [BANNER_MINIMAL]
}

// Color a character based on what it is (Clawdbot-style)
function colorChar(ch: string): string {
  if (ch === "█") return chalk.hex(colors.accent)(ch)      // Bright gold for solid
  if (ch === "░") return chalk.hex(colors.accentDim)(ch)   // Dim gold for shade
  if (ch === "▀" || ch === "▄") return chalk.hex(colors.accentSoft)(ch) // Orange for half-blocks
  if (ch === "🚀") return ch  // Keep emoji as-is
  return chalk.hex(colors.dim)(ch)  // Dim for other chars
}

// Color a whole line of ASCII art
function colorLine(line: string): string {
  // Special handling for the tagline/slogan line
  if (line.includes("🚀") && (line.includes("SHIP") || line.includes("JFL") || line.includes("LAUNCH"))) {
    // Extract the text between rockets
    const match = line.match(/^(\s*)(🚀\s*)(.+?)(\s*🚀)(\s*)$/)
    if (match) {
      const [, leadingSpace, leftRocket, text, rightRocket, trailingSpace] = match
      return (
        chalk.hex(colors.dim)(leadingSpace) +
        leftRocket +
        chalk.hex(colors.accentSoft)(text) +
        rightRocket +
        chalk.hex(colors.dim)(trailingSpace)
      )
    }
  }

  // Color each character
  return Array.from(line).map(colorChar).join("")
}

export interface BannerOptions {
  version?: string
  tagline?: string
  showTagline?: boolean
  centered?: boolean
}

export function renderBanner(options: BannerOptions = {}): string {
  const {
    version,
    tagline = getTagline(),
    showTagline = true,
    centered = true,
  } = options

  const width = getTerminalWidth()
  const lines: string[] = []

  // Get appropriate banner art
  const artLines = getBannerArt()
  const isMinimal = artLines.length === 1 && artLines[0] === BANNER_MINIMAL

  if (isMinimal) {
    // Minimal banner for very narrow terminals
    const versionStr = version ? ` v${version}` : ""
    lines.push("")
    lines.push(theme.accentBold(`🚀 JFL${versionStr}`) + theme.dim(" — Just Fucking Launch"))
    if (showTagline) {
      lines.push(theme.soft(`"${tagline}"`))
    }
    lines.push("")
  } else {
    // Full ASCII art banner
    lines.push("")

    // Color and center each line
    for (const line of artLines) {
      const coloredLine = colorLine(line)
      lines.push(centered ? center(coloredLine, width) : coloredLine)
    }

    lines.push("")

    // Version line (smaller, below art)
    if (version) {
      const versionLine = theme.dim(`v${version}`)
      lines.push(centered ? center(versionLine, width) : versionLine)
    }

    // Tagline
    if (showTagline) {
      const taglineFormatted = theme.soft(`"${tagline}"`)
      lines.push(centered ? center(taglineFormatted, width) : taglineFormatted)
    }

    lines.push("")
  }

  return lines.join("\n")
}

// ============================================================================
// QUICK ACCESS
// ============================================================================

export function showBanner(version?: string): void {
  console.log(renderBanner({ version }))
}

// One-liner status banner (for after commands)
export function showStatus(message: string): void {
  console.log(`\n${theme.accent("🚀")} ${theme.text(message)}\n`)
}

// Section header
export function showSection(title: string): void {
  const width = Math.min(getTerminalWidth(), 60)
  console.log("")
  console.log(theme.accentBold(title))
  console.log(theme.dimmer("─".repeat(width)))
}

// ============================================================================
// HOW IT WORKS NOTICE (Clawdbot-style)
// ============================================================================

export function showHowItWorksNotice(): void {
  const width = Math.min(getTerminalWidth(), 70)

  console.log("")
  console.log(theme.accentBold("How JFL Works"))
  console.log(theme.dimmer("─".repeat(width)))
  console.log("")
  console.log(theme.text("JFL creates isolated work sessions that sync automatically:"))
  console.log("")
  console.log(theme.success("  ✓") + theme.text(" Your session runs in its own workspace (git worktree)"))
  console.log(theme.success("  ✓") + theme.text(" Changes auto-commit every 2 minutes (never lose work)"))
  console.log(theme.success("  ✓") + theme.text(" Context compounds across sessions (journal + knowledge docs)"))
  console.log(theme.success("  ✓") + theme.text(" Multiple teammates can work in parallel (see who's active)"))
  console.log(theme.success("  ✓") + theme.text(" Works with any AI (Claude Code, Clawdbot, Aider, etc.)"))
  console.log("")
  console.log(theme.dimmer("Your AI agent can:"))
  console.log(theme.dim("  • Read/write files in your project"))
  console.log(theme.dim("  • Run git commands (isolated to your session)"))
  console.log(theme.dim("  • Execute bash commands"))
  console.log(theme.dim("  • Search and modify code"))
  console.log("")
  console.log(theme.dimmer("Safety features:"))
  console.log(theme.dim("  • All work happens in isolated branches"))
  console.log(theme.dim("  • Auto-commit backs up constantly"))
  console.log(theme.dim("  • Easy to review changes before merging"))
  console.log(theme.dim("  • Team presence shows overlap warnings"))
  console.log("")
  console.log(theme.dim("Learn more: ") + theme.accent("https://docs.jfl.run/how-it-works"))
  console.log("")
}
