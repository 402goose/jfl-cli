/**
 * JFL Banner & Taglines
 * Beautiful ASCII art banner with rotating taglines (Clawdbot-style)
 */

import chalk from "chalk"
import { theme, colors, getTerminalWidth, center } from "./theme.js"

// ============================================================================
// ASCII BANNER (Clawdbot-style with block characters)
// ============================================================================

// Block-style JFL logo with rocket
const BANNER_ART = [
  "░████░█░░░░░█████░░░░░█░░░░░░░░░░░░░░░░░░░░░░",
  "░░░█░░█░░░░░█░░░░░░░░░█░░░░░█░░░█░█░░█░░█████░",
  "░░░█░░█░░░░░████░░░░░░█░░░░░█░░░█░██░█░░█░░░░░",
  "░░░█░░█░░░░░█░░░░░░░░░█░░░░░█░░░█░█░██░░█░░░░░",
  "░████░█████░█░░░░░░░░░█████░░███░░█░░█░░█████░",
  "             🚀 SHIP IT OR IT DIDN'T HAPPEN 🚀",
]

// Simpler version for medium terminals
const BANNER_MEDIUM = [
  "░██░█░░█████░░█░░░░█░░█░░█░█░░█░░█████",
  "░░█░█░░█░░░░░░█░░░░█░░█░░█░██░█░░█░░░░",
  "░░█░█░░████░░░█░░░░█░░█░░█░█░██░░█░░░░",
  "░██░██░█░░░░░░████░░██░░░█░░█░░░█████░",
  "          🚀 JUST FUCKING LAUNCH 🚀",
]

// Compact for narrow terminals
const BANNER_COMPACT = [
  "░██░█░░██░░█░░░█░░█░░█░█░█░█████",
  "░░█░█░░█░░░█░░░█░░█░░█░██░░█░░░░",
  "░██░██░█░░░███░░██░░░█░░█░░█████",
  "       🚀 JFL — SHIP IT 🚀",
]

// Minimal fallback
const BANNER_MINIMAL = "🚀 JFL — Just Fucking Launch"

// ============================================================================
// TAGLINES
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

  // Technical
  "AI-powered shipping.",
  "From zero to shipped.",
  "Claude Code's best friend.",
  "GTM on autopilot.",

  // Cheeky
  "Because 'next quarter' is not a date.",
  "We don't do beta.",
  "README-driven development.",
  "The only vaporware is the one you don't ship.",
  "Funded by impatience.",
  "Moving fast, breaking nothing.",
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

export function getBannerArt(): string {
  const width = getTerminalWidth()

  if (width >= 60) {
    return BANNER_BLOCKS
  } else if (width >= 30) {
    return BANNER_COMPACT
  }
  return BANNER_MINIMAL
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
  const art = getBannerArt()
  const isMinimal = art === BANNER_MINIMAL

  if (isMinimal) {
    // Minimal banner for very narrow terminals
    const versionStr = version ? ` v${version}` : ""
    lines.push("")
    lines.push(theme.accentBold(`🚀 JFL${versionStr}`))
    lines.push(theme.dim("Just Fucking Launch"))
    if (showTagline) {
      lines.push("")
      lines.push(theme.soft(`"${tagline}"`))
    }
    lines.push("")
  } else {
    // Full ASCII art banner
    lines.push("")

    // Color the banner art with gradient effect
    const artLines = art.split("\n")
    for (let i = 0; i < artLines.length; i++) {
      // Gradient from gold to orange
      const ratio = i / (artLines.length - 1)
      const color = interpolateColor(colors.accent, colors.accentSoft, ratio)
      const coloredLine = chalk.hex(color)(artLines[i])
      lines.push(centered ? center(coloredLine, width) : coloredLine)
    }

    lines.push("")

    // Title line
    const title = "JUST FUCKING LAUNCH"
    const versionStr = version ? theme.dim(` v${version}`) : ""
    const titleLine = theme.accentBold(title) + versionStr
    lines.push(centered ? center(titleLine, width) : titleLine)

    // Tagline
    if (showTagline) {
      const taglineFormatted = theme.soft(`"${tagline}"`)
      lines.push(centered ? center(taglineFormatted, width) : taglineFormatted)
    }

    lines.push("")
  }

  return lines.join("\n")
}

// Simple color interpolation
function interpolateColor(color1: string, color2: string, ratio: number): string {
  const hex1 = color1.replace("#", "")
  const hex2 = color2.replace("#", "")

  const r1 = parseInt(hex1.slice(0, 2), 16)
  const g1 = parseInt(hex1.slice(2, 4), 16)
  const b1 = parseInt(hex1.slice(4, 6), 16)

  const r2 = parseInt(hex2.slice(0, 2), 16)
  const g2 = parseInt(hex2.slice(2, 4), 16)
  const b2 = parseInt(hex2.slice(4, 6), 16)

  const r = Math.round(r1 + (r2 - r1) * ratio)
  const g = Math.round(g1 + (g2 - g1) * ratio)
  const b = Math.round(b1 + (b2 - b1) * ratio)

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
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
