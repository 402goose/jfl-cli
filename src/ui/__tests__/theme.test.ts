/**
 * @purpose Tests for theme system constants and utilities
 */

jest.mock("chalk", () => {
  const passthrough = (s: string) => s
  const createPassthrough = () => passthrough
  const chalk: any = new Proxy(passthrough, {
    get: (_target, prop) => {
      if (prop === "hex") return createPassthrough
      if (prop === "bold") return passthrough
      return chalk
    },
    apply: (_t: any, _this: any, args: any[]) => args[0],
  })
  return { default: chalk, __esModule: true }
})

import { colors, symbols, box, center, hr, getTerminalWidth } from "../theme.js"

describe("colors", () => {
  it("defines primary brand colors", () => {
    expect(colors.accent).toBe("#FFD700")
    expect(colors.accentSoft).toBe("#FFA500")
    expect(colors.accentDim).toBe("#B8860B")
  })

  it("defines text hierarchy colors", () => {
    expect(colors.text).toBe("#F5F5F5")
    expect(colors.textSoft).toBe("#C0C0C0")
    expect(colors.dim).toBe("#888888")
    expect(colors.dimmer).toBe("#555555")
  })

  it("defines semantic colors", () => {
    expect(colors.success).toBe("#00FF88")
    expect(colors.error).toBe("#FF4444")
    expect(colors.warning).toBe("#FFAA00")
    expect(colors.info).toBe("#4FC3F7")
  })

  it("defines special colors", () => {
    expect(colors.rocket).toBe("#FF6B6B")
    expect(colors.ship).toBe("#4ECDC4")
    expect(colors.code).toBe("#F0C987")
  })

  it("defines background colors", () => {
    expect(colors.bgDark).toBe("#1E1E1E")
    expect(colors.bgCard).toBe("#2B2F36")
  })
})

describe("symbols", () => {
  describe("status symbols", () => {
    it("defines status indicators", () => {
      expect(symbols.success).toBe("✓")
      expect(symbols.error).toBe("✗")
      expect(symbols.warning).toBe("⚠")
      expect(symbols.info).toBe("ℹ")
    })
  })

  describe("progress symbols", () => {
    it("defines spinner frames", () => {
      expect(symbols.spinner).toEqual(["◐", "◓", "◑", "◒"])
      expect(symbols.spinner).toHaveLength(4)
    })

    it("defines dot spinner frames", () => {
      expect(symbols.dots).toHaveLength(10)
      expect(symbols.dots[0]).toBe("⠋")
    })
  })

  describe("structure symbols", () => {
    it("defines bullet and arrow symbols", () => {
      expect(symbols.bullet).toBe("•")
      expect(symbols.arrow).toBe("→")
      expect(symbols.arrowRight).toBe("▸")
    })

    it("defines line drawing symbols", () => {
      expect(symbols.line).toBe("─")
      expect(symbols.corner).toBe("└")
      expect(symbols.tee).toBe("├")
      expect(symbols.pipe).toBe("│")
    })
  })

  describe("special symbols", () => {
    it("defines emoji symbols", () => {
      expect(symbols.rocket).toBe("🚀")
      expect(symbols.ship).toBe("🚢")
      expect(symbols.fire).toBe("🔥")
      expect(symbols.star).toBe("⭐")
      expect(symbols.sparkle).toBe("✨")
    })
  })
})

describe("box drawing characters", () => {
  it("defines corner characters", () => {
    expect(box.topLeft).toBe("┌")
    expect(box.topRight).toBe("┐")
    expect(box.bottomLeft).toBe("└")
    expect(box.bottomRight).toBe("┘")
  })

  it("defines line characters", () => {
    expect(box.horizontal).toBe("─")
    expect(box.vertical).toBe("│")
  })

  it("defines tee characters", () => {
    expect(box.teeRight).toBe("├")
    expect(box.teeLeft).toBe("┤")
  })

  it("defines heavy variants", () => {
    expect(box.heavyHorizontal).toBe("━")
    expect(box.heavyVertical).toBe("┃")
  })
})

describe("getTerminalWidth", () => {
  it("returns stdout columns or default of 80", () => {
    const width = getTerminalWidth()
    expect(typeof width).toBe("number")
    expect(width).toBeGreaterThan(0)
    // Should be at least 80 (the default)
    expect(width).toBeGreaterThanOrEqual(80)
  })
})

describe("center", () => {
  // Mock a fixed width for testing
  const fixedWidth = 40

  it("centers text within specified width", () => {
    const result = center("hello", fixedWidth)
    const paddingSize = Math.floor((40 - 5) / 2) // 17
    expect(result).toBe(" ".repeat(17) + "hello")
  })

  it("handles text equal to width", () => {
    const text = "x".repeat(40)
    const result = center(text, fixedWidth)
    // No padding when text fills width
    expect(result).toBe(text)
  })

  it("handles text longer than width", () => {
    const text = "x".repeat(50)
    const result = center(text, fixedWidth)
    // No negative padding
    expect(result).toBe(text)
  })

  it("handles empty string", () => {
    const result = center("", fixedWidth)
    const paddingSize = Math.floor(40 / 2) // 20
    expect(result).toBe(" ".repeat(paddingSize))
  })
})

describe("hr", () => {
  it("creates horizontal rule with default character", () => {
    const result = hr("─", 10)
    expect(result).toHaveLength(10)
    expect(result).toMatch(/─{10}/)
  })

  it("creates horizontal rule with custom character", () => {
    const result = hr("=", 5)
    expect(result).toHaveLength(5)
  })

  it("handles single character width", () => {
    const result = hr("-", 1)
    expect(result).toHaveLength(1)
  })

  it("falls back to terminal width when 0 is passed", () => {
    // hr uses || which treats 0 as falsy, falls back to terminal width
    const result = hr("-", 0)
    expect(result.length).toBeGreaterThan(0)
  })
})

describe("ANSI stripping logic", () => {
  // Test the internal stripAnsi function logic
  function stripAnsi(str: string): string {
    return str.replace(/\x1B\[[0-9;]*m/g, "")
  }

  it("removes ANSI color codes", () => {
    const colored = "\x1B[31mred text\x1B[0m"
    expect(stripAnsi(colored)).toBe("red text")
  })

  it("removes multiple ANSI codes", () => {
    const multicolored = "\x1B[1m\x1B[32mbold green\x1B[0m normal"
    expect(stripAnsi(multicolored)).toBe("bold green normal")
  })

  it("handles string with no ANSI codes", () => {
    expect(stripAnsi("plain text")).toBe("plain text")
  })

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("")
  })

  it("handles complex ANSI sequences", () => {
    const complex = "\x1B[38;5;196mextended color\x1B[0m"
    expect(stripAnsi(complex)).toBe("extended color")
  })
})
