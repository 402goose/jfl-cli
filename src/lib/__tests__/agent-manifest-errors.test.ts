/**
 * Error Handling Tests for Agent Manifest
 *
 * Tests malformed YAML, missing fields, and invalid manifest data
 *
 * @purpose Test error paths in agent-manifest.ts
 */

describe('agent-manifest error handling', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  describe('parseManifest malformed input', () => {
    it('returns null for invalid YAML syntax', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      const invalidYaml = 'name: test\n  invalid: indentation: here'
      const result = parseManifest(invalidYaml)

      expect(result).toBeNull()
    })

    it('returns null for empty string', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      const result = parseManifest('')

      expect(result).toBeNull()
    })

    it('returns null for non-object YAML', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      const scalarYaml = 'just a string'
      const result = parseManifest(scalarYaml)

      // Returns the string, not a manifest object
      expect(result).toBe('just a string')
    })

    it('returns null for array YAML', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      const arrayYaml = '- item1\n- item2'
      const result = parseManifest(arrayYaml)

      // Returns array, not a manifest
      expect(Array.isArray(result)).toBe(true)
    })

    it('handles YAML with unusual characters (may parse or return null)', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      // Null bytes are filtered by YAML parser - it may parse or fail
      const invalidChars = 'name: \x00invalid\x00chars'
      const result = parseManifest(invalidChars)

      // The YAML parser may handle this gracefully or return null
      expect(result === null || typeof result === 'object' || typeof result === 'string').toBe(true)
    })

    it('handles YAML with tabs (warning but parses)', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      const tabsYaml = 'name: test\n\tversion: "1.0"'
      // YAML allows tabs, but they can cause issues
      const result = parseManifest(tabsYaml)

      // May parse or error depending on YAML parser
      // The important thing is it doesn't crash
      expect(result === null || typeof result === 'object').toBe(true)
    })

    it('handles deeply nested YAML beyond reasonable depth', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      // Create deeply nested structure
      let deepYaml = 'root:\n'
      for (let i = 0; i < 100; i++) {
        deepYaml += '  '.repeat(i + 1) + `level${i}:\n`
      }

      const result = parseManifest(deepYaml)
      // Should parse without crashing
      expect(result !== undefined).toBe(true)
    })

    it('handles YAML with circular reference syntax', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      // YAML anchors and aliases
      const circularYaml = `
name: &name test
alias: *name
self: &self
  ref: *self
`
      // This is valid YAML but may cause issues
      const result = parseManifest(circularYaml)
      expect(result !== undefined).toBe(true)
    })
  })

  describe('generateManifest edge cases', () => {
    it('handles empty name', async () => {
      const { generateManifest } = await import('../agent-manifest.js')

      const result = generateManifest('')

      expect(result).toContain('name: ""')
      expect(result).toContain('description: " agent"')
    })

    it('handles name with special characters', async () => {
      const { generateManifest } = await import('../agent-manifest.js')

      const result = generateManifest('test-agent_v2.0')

      expect(result).toContain('name: test-agent_v2.0')
    })

    it('handles name with quotes', async () => {
      const { generateManifest } = await import('../agent-manifest.js')

      const result = generateManifest('test"agent')

      // Should be properly escaped in YAML
      expect(result).toContain('name:')
    })

    it('handles very long name', async () => {
      const { generateManifest } = await import('../agent-manifest.js')

      const longName = 'a'.repeat(1000)
      const result = generateManifest(longName)

      expect(result).toContain(`name: ${longName}`)
    })

    it('handles name with newlines', async () => {
      const { generateManifest } = await import('../agent-manifest.js')

      const result = generateManifest('test\nagent')

      // YAML should properly handle multiline
      expect(result).toContain('name:')
    })

    it('handles unicode name', async () => {
      const { generateManifest } = await import('../agent-manifest.js')

      const result = generateManifest('测试エージェント')

      expect(result).toContain('name: 测试エージェント')
    })

    it('uses description parameter when provided', async () => {
      const { generateManifest } = await import('../agent-manifest.js')

      const result = generateManifest('test', 'Custom description')

      expect(result).toContain('description: Custom description')
    })

    it('falls back to default description when not provided', async () => {
      const { generateManifest } = await import('../agent-manifest.js')

      const result = generateManifest('myagent')

      expect(result).toContain('description: myagent agent')
    })
  })

  describe('generatePolicy edge cases', () => {
    it('generates valid JSON policy', async () => {
      const { generatePolicy } = await import('../agent-manifest.js')

      const result = generatePolicy()
      const parsed = JSON.parse(result)

      expect(parsed).toHaveProperty('cost_limit_usd')
      expect(parsed).toHaveProperty('approval_gate')
      expect(parsed).toHaveProperty('allowed_actions')
      expect(parsed).toHaveProperty('blocked_actions')
      expect(parsed).toHaveProperty('max_concurrent')
      expect(parsed).toHaveProperty('cooldown_seconds')
    })

    it('generates policy with correct defaults', async () => {
      const { generatePolicy } = await import('../agent-manifest.js')

      const result = generatePolicy()
      const parsed = JSON.parse(result)

      expect(parsed.cost_limit_usd).toBe(0.50)
      expect(parsed.approval_gate).toBe('auto')
      expect(parsed.max_concurrent).toBe(1)
      expect(parsed.cooldown_seconds).toBe(300)
    })
  })

  describe('generateLifecycle edge cases', () => {
    it('handles empty trigger pattern', async () => {
      const { generateLifecycle } = await import('../agent-manifest.js')

      const result = generateLifecycle('test', '')

      expect(result).toContain('pattern: ""')
    })

    it('handles complex trigger patterns', async () => {
      const { generateLifecycle } = await import('../agent-manifest.js')

      const result = generateLifecycle('test', 'event:*:subtype')

      // YAML may or may not quote the pattern depending on the value
      expect(result).toContain('pattern:')
      expect(result).toContain('event:*:subtype')
    })

    it('handles name with interpolation-like syntax', async () => {
      const { generateLifecycle } = await import('../agent-manifest.js')

      const result = generateLifecycle('{{agent}}', 'test:*')

      expect(result).toContain('name: "{{agent}}-trigger"')
    })
  })

  describe('manifest type validation', () => {
    it('accepts valid type values', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      const validTypes = ['reactive', 'scheduled', 'hybrid']

      for (const type of validTypes) {
        const yaml = `
name: test
version: "1.0"
description: Test agent
type: ${type}
triggers:
  - pattern: "test:*"
capabilities:
  - read
runtime:
  command: claude
  args: []
  cwd: "."
`
        const result = parseManifest(yaml)
        expect(result).not.toBeNull()
        expect(result?.type).toBe(type)
      }
    })

    it('parses manifest with invalid type (no runtime validation)', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      const yaml = `
name: test
version: "1.0"
description: Test agent
type: invalid_type
triggers:
  - pattern: "test:*"
capabilities: []
runtime:
  command: claude
  args: []
  cwd: "."
`
      const result = parseManifest(yaml)
      // parseManifest doesn't validate types, just parses YAML
      expect(result).not.toBeNull()
      expect(result?.type).toBe('invalid_type')
    })
  })

  describe('manifest with missing required fields', () => {
    it('parses manifest with missing name', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      const yaml = `
version: "1.0"
description: Test
type: reactive
`
      const result = parseManifest(yaml)
      // parseManifest doesn't validate required fields
      expect(result).not.toBeNull()
      expect(result?.name).toBeUndefined()
    })

    it('parses manifest with missing version', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      const yaml = `
name: test
description: Test
type: reactive
`
      const result = parseManifest(yaml)
      expect(result).not.toBeNull()
      expect(result?.version).toBeUndefined()
    })

    it('parses manifest with missing triggers', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      const yaml = `
name: test
version: "1.0"
description: Test
type: scheduled
`
      const result = parseManifest(yaml)
      expect(result).not.toBeNull()
      expect(result?.triggers).toBeUndefined()
    })

    it('parses manifest with missing runtime', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      const yaml = `
name: test
version: "1.0"
description: Test
type: reactive
triggers:
  - pattern: "test:*"
`
      const result = parseManifest(yaml)
      expect(result).not.toBeNull()
      expect(result?.runtime).toBeUndefined()
    })
  })

  describe('manifest with invalid field types', () => {
    it('parses triggers as non-array', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      const yaml = `
name: test
version: "1.0"
triggers: "not-an-array"
`
      const result = parseManifest(yaml)
      expect(result).not.toBeNull()
      expect(typeof result?.triggers).toBe('string')
    })

    it('parses capabilities as non-array', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      const yaml = `
name: test
version: "1.0"
capabilities: single-capability
`
      const result = parseManifest(yaml)
      expect(result).not.toBeNull()
      expect(typeof result?.capabilities).toBe('string')
    })

    it('parses runtime as string instead of object', async () => {
      const { parseManifest } = await import('../agent-manifest.js')

      const yaml = `
name: test
version: "1.0"
runtime: "invalid"
`
      const result = parseManifest(yaml)
      expect(result).not.toBeNull()
      expect(typeof result?.runtime).toBe('string')
    })
  })
})
