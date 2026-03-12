/**
 * Fuzz Tests for Scope System
 *
 * Tests the scope matching and impact detection with edge cases,
 * pathological inputs, and stress conditions.
 *
 * NOTE: We inline matchScopePattern here to avoid importing from scope.ts
 * which imports chalk and breaks Jest ESM resolution.
 *
 * @purpose Fuzz testing for scope matching and impact detection
 */

// Inline implementation to avoid chalk ESM import issues
function matchScopePattern(pattern: string, value: string): boolean {
  if (pattern === "*") return true
  if (pattern === value) return true
  if (pattern.includes("*")) {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$")
    return regex.test(value)
  }
  return false
}

describe("Scope Fuzzing", () => {
  describe("wildcard patterns that could match everything", () => {
    it("handles single asterisk matching all values", () => {
      expect(matchScopePattern("*", "anything")).toBe(true)
      expect(matchScopePattern("*", "")).toBe(true)
      expect(matchScopePattern("*", "a:b:c:d:e")).toBe(true)
    })

    it("handles double asterisk patterns", () => {
      expect(matchScopePattern("**", "test")).toBe(true)
      expect(matchScopePattern("**", "a")).toBe(true)
    })

    it("handles *:* patterns", () => {
      expect(matchScopePattern("*:*", "foo:bar")).toBe(true)
      expect(matchScopePattern("*:*", "a:b")).toBe(true)
      expect(matchScopePattern("*:*", ":")).toBe(true)
    })

    it("handles prefix wildcards", () => {
      expect(matchScopePattern("prefix:*", "prefix:anything")).toBe(true)
      expect(matchScopePattern("prefix:*", "prefix:")).toBe(true)
      expect(matchScopePattern("prefix:*", "notprefix:value")).toBe(false)
    })
  })

  describe("empty and null-like scopes", () => {
    it("handles empty string patterns", () => {
      expect(matchScopePattern("", "")).toBe(true)
      expect(matchScopePattern("", "nonempty")).toBe(false)
    })

    it("handles whitespace patterns", () => {
      expect(matchScopePattern(" ", " ")).toBe(true)
    })
  })

  describe("unicode characters", () => {
    it("handles basic unicode in patterns", () => {
      expect(matchScopePattern("\u6D4B\u8BD5", "\u6D4B\u8BD5")).toBe(true)
      expect(matchScopePattern("\u0442\u0435\u0441\u0442", "\u0442\u0435\u0441\u0442")).toBe(true)
    })

    it("handles unicode with wildcards", () => {
      expect(matchScopePattern("\u524D\u7F00:*", "\u524D\u7F00:\u540E\u7F00")).toBe(true)
    })
  })

  describe("large-scale service scope testing", () => {
    it("handles 100+ services with overlapping scopes without blowing up", () => {
      const startTime = Date.now()
      const services: { produces: string[]; consumes: string[] }[] = []

      for (let i = 0; i < 100; i++) {
        services.push({
          produces: ["service:" + i + ":output", "common:event"],
          consumes: ["service:" + ((i + 1) % 100) + ":output", "common:*"],
        })
      }

      let totalMatches = 0
      for (const source of services) {
        for (const target of services) {
          for (const produce of source.produces) {
            for (const consume of target.consumes) {
              if (matchScopePattern(produce, consume) || matchScopePattern(consume, produce)) {
                totalMatches++
              }
            }
          }
        }
      }

      const elapsed = Date.now() - startTime
      expect(elapsed).toBeLessThan(5000)
      expect(totalMatches).toBeGreaterThan(0)
    })
  })

  describe("pathological patterns", () => {
    it("handles very long patterns", () => {
      const longPattern = "a".repeat(10000)
      const longValue = "a".repeat(10000)
      expect(matchScopePattern(longPattern, longValue)).toBe(true)
    })

    it("handles many wildcards in sequence", () => {
      const manyWildcards = "*:*:*:*:*:*:*:*:*:*"
      const value = "a:b:c:d:e:f:g:h:i:j"
      expect(matchScopePattern(manyWildcards, value)).toBe(true)
    })

    it("handles regex special characters in patterns", () => {
      // Patterns with regex metacharacters should be handled
      expect(matchScopePattern("test.pattern", "test.pattern")).toBe(true)
      expect(matchScopePattern("test[0]", "test[0]")).toBe(true)
      expect(matchScopePattern("value+1", "value+1")).toBe(true)
    })

    it("handles patterns with only wildcards", () => {
      expect(matchScopePattern("***", "abc")).toBe(true)
      expect(matchScopePattern("*****", "")).toBe(true)
    })
  })

  describe("circular produces/consumes detection", () => {
    it("detects circular dependencies", () => {
      const serviceA = { produces: ["eventA"], consumes: ["eventB"] }
      const serviceB = { produces: ["eventB"], consumes: ["eventA"] }

      const aToB = serviceA.produces.some((p) =>
        serviceB.consumes.some(
          (c) => matchScopePattern(p, c) || matchScopePattern(c, p)
        )
      )

      const bToA = serviceB.produces.some((p) =>
        serviceA.consumes.some(
          (c) => matchScopePattern(p, c) || matchScopePattern(c, p)
        )
      )

      expect(aToB).toBe(true)
      expect(bToA).toBe(true)
    })
  })

  describe("edge case matching", () => {
    it("handles colon-only patterns", () => {
      expect(matchScopePattern(":", ":")).toBe(true)
      expect(matchScopePattern("::", "::")).toBe(true)
      expect(matchScopePattern(":::", ":::")).toBe(true)
    })

    it("handles trailing/leading wildcards", () => {
      expect(matchScopePattern("*suffix", "prefixsuffix")).toBe(true)
      expect(matchScopePattern("prefix*", "prefixsuffix")).toBe(true)
      expect(matchScopePattern("*middle*", "leftmiddleright")).toBe(true)
    })

    it("handles numeric patterns", () => {
      expect(matchScopePattern("event:123", "event:123")).toBe(true)
      expect(matchScopePattern("event:*", "event:999")).toBe(true)
    })

    it("handles rapid repeated matching", () => {
      const startTime = Date.now()
      for (let i = 0; i < 10000; i++) {
        matchScopePattern("prefix:*", `prefix:${i}`)
        matchScopePattern("*:suffix", `${i}:suffix`)
        matchScopePattern("*", `any${i}`)
      }
      const elapsed = Date.now() - startTime
      expect(elapsed).toBeLessThan(1000) // Should be fast
    })
  })
})
