/**
 * JFL Theme System
 * Consistent colors and styling across the CLI
 */

import chalk from "chalk"

// ============================================================================
// COLOR PALETTE
// ============================================================================

export const colors = {
  // Primary brand
  accent: "#FFD700",        // Gold - main brand color
  accentSoft: "#FFA500",    // Orange - secondary
  accentDim: "#B8860B",     // Dark gold - subtle emphasis

  // Text hierarchy
  text: "#F5F5F5",          // Primary text
  textSoft: "#C0C0C0",      // Secondary text
  dim: "#888888",           // Muted/subtle
  dimmer: "#555555",        // Very subtle

  // Semantic
  success: "#00FF88",       // Green - success
  error: "#FF4444",         // Red - error
  warning: "#FFAA00",       // Amber - warning
  info: "#4FC3F7",          // Light blue - info

  // Special
  rocket: "#FF6B6B",        // Launch moments
  ship: "#4ECDC4",          // Ship references
  code: "#F0C987",          // Code/technical

  // Backgrounds (for supported terminals)
  bgDark: "#1E1E1E",
  bgCard: "#2B2F36",
}

// ============================================================================
// THEME HELPERS
// ============================================================================

export const theme = {
  // Text styles
  text: (s: string) => chalk.hex(colors.text)(s),
  soft: (s: string) => chalk.hex(colors.textSoft)(s),
  dim: (s: string) => chalk.hex(colors.dim)(s),
  dimmer: (s: string) => chalk.hex(colors.dimmer)(s),

  // Brand
  accent: (s: string) => chalk.hex(colors.accent)(s),
  accentSoft: (s: string) => chalk.hex(colors.accentSoft)(s),
  accentBold: (s: string) => chalk.hex(colors.accent).bold(s),

  // Semantic
  success: (s: string) => chalk.hex(colors.success)(s),
  error: (s: string) => chalk.hex(colors.error)(s),
  warning: (s: string) => chalk.hex(colors.warning)(s),
  info: (s: string) => chalk.hex(colors.info)(s),

  // Special
  rocket: (s: string) => chalk.hex(colors.rocket)(s),
  ship: (s: string) => chalk.hex(colors.ship)(s),
  code: (s: string) => chalk.hex(colors.code)(s),

  // Combinations
  bold: chalk.bold,
  italic: chalk.italic,
  underline: chalk.underline,

  // Utility
  check: chalk.hex(colors.success)("✓"),
  cross: chalk.hex(colors.error)("✗"),
  dot: chalk.hex(colors.dim)("•"),
  arrow: chalk.hex(colors.accent)("→"),
}

// ============================================================================
// SYMBOLS
// ============================================================================

export const symbols = {
  // Status
  success: "✓",
  error: "✗",
  warning: "⚠",
  info: "ℹ",

  // Progress
  spinner: ["◐", "◓", "◑", "◒"],
  dots: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],

  // Structure
  bullet: "•",
  arrow: "→",
  arrowRight: "▸",
  line: "─",
  corner: "└",
  tee: "├",
  pipe: "│",

  // Special
  rocket: "🚀",
  ship: "🚢",
  fire: "🔥",
  star: "⭐",
  sparkle: "✨",
}

// ============================================================================
// BOX DRAWING
// ============================================================================

export const box = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  teeRight: "├",
  teeLeft: "┤",

  // Heavy variant
  heavyHorizontal: "━",
  heavyVertical: "┃",
}

export function drawBox(content: string[], width?: number): string {
  const maxLen = width || Math.max(...content.map((l) => stripAnsi(l).length))
  const lines: string[] = []

  lines.push(theme.dim(box.topLeft + box.horizontal.repeat(maxLen + 2) + box.topRight))

  for (const line of content) {
    const stripped = stripAnsi(line)
    const padding = " ".repeat(Math.max(0, maxLen - stripped.length))
    lines.push(theme.dim(box.vertical) + " " + line + padding + " " + theme.dim(box.vertical))
  }

  lines.push(theme.dim(box.bottomLeft + box.horizontal.repeat(maxLen + 2) + box.bottomRight))

  return lines.join("\n")
}

// ============================================================================
// UTILITIES
// ============================================================================

// Strip ANSI codes for length calculation
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, "")
}

// Get terminal width safely
export function getTerminalWidth(): number {
  return process.stdout.columns || 80
}

// Center text
export function center(text: string, width?: number): string {
  const w = width || getTerminalWidth()
  const stripped = stripAnsi(text)
  const padding = Math.max(0, Math.floor((w - stripped.length) / 2))
  return " ".repeat(padding) + text
}

// Horizontal rule
export function hr(char = "─", width?: number): string {
  const w = width || getTerminalWidth()
  return theme.dimmer(char.repeat(w))
}
