/**
 * Tests for Kuva Terminal Plotting Utilities
 *
 * @purpose Test pure ASCII visualization functions (no kuva dependency)
 */

import { asciiBars, sparkline } from '../kuva'
import type { BarEntry } from '../kuva'

describe('asciiBars', () => {
  it('returns empty string for empty input', () => {
    expect(asciiBars([])).toBe('')
  })

  it('renders single entry correctly', () => {
    const entries: BarEntry[] = [{ label: 'test', value: 50 }]
    const result = asciiBars(entries)

    expect(result).toContain('test')
    expect(result).toContain('50')
    expect(result).toContain('\u2588') // Unicode block character
  })

  it('renders multiple entries', () => {
    const entries: BarEntry[] = [
      { label: 'foo', value: 100 },
      { label: 'bar', value: 50 },
      { label: 'baz', value: 25 },
    ]
    const result = asciiBars(entries)

    expect(result).toContain('foo')
    expect(result).toContain('bar')
    expect(result).toContain('baz')
    expect(result).toContain('100')
    expect(result).toContain('50')
    expect(result).toContain('25')
  })

  it('includes title when provided', () => {
    const entries: BarEntry[] = [{ label: 'item', value: 10 }]
    const result = asciiBars(entries, { title: 'My Chart' })

    expect(result).toContain('My Chart')
  })

  it('handles zero values', () => {
    const entries: BarEntry[] = [
      { label: 'full', value: 100 },
      { label: 'zero', value: 0 },
    ]
    const result = asciiBars(entries)

    expect(result).toContain('full')
    expect(result).toContain('zero')
    expect(result).toContain('0')
  })

  it('handles all zero values', () => {
    const entries: BarEntry[] = [
      { label: 'a', value: 0 },
      { label: 'b', value: 0 },
    ]
    const result = asciiBars(entries)

    expect(result).toContain('a')
    expect(result).toContain('b')
    // Should not throw with maxVal = 0
  })

  it('respects custom width option', () => {
    const entries: BarEntry[] = [{ label: 'test', value: 100 }]
    const narrow = asciiBars(entries, { width: 10 })
    const wide = asciiBars(entries, { width: 50 })

    // Wider chart should have more block characters
    const narrowBlocks = (narrow.match(/\u2588/g) || []).length
    const wideBlocks = (wide.match(/\u2588/g) || []).length

    expect(wideBlocks).toBeGreaterThan(narrowBlocks)
  })

  it('pads labels to align values', () => {
    const entries: BarEntry[] = [
      { label: 'short', value: 10 },
      { label: 'verylonglabel', value: 20 },
    ]
    const result = asciiBars(entries)
    const lines = result.split('\n')

    // Both lines should have similar structure after label padding
    expect(lines.length).toBe(2)
    // Each line should contain label, bars, and value
    for (const line of lines) {
      expect(line).toMatch(/^\s+\w+\s+.*\d+$/)
    }
  })
})

describe('sparkline', () => {
  it('returns empty string for empty input', () => {
    expect(sparkline([])).toBe('')
  })

  it('renders single value', () => {
    const result = sparkline([50])
    expect(result.length).toBe(1)
    // Should be one of the block characters
    expect(result).toMatch(/[\u2581-\u2588]/)
  })

  it('renders multiple values with correct length', () => {
    const values = [10, 20, 30, 40, 50]
    const result = sparkline(values)

    expect(result.length).toBe(values.length)
  })

  it('shows trend from low to high', () => {
    const ascending = sparkline([0, 25, 50, 75, 100])

    // Characters should be in ascending order based on Unicode value
    const chars = ascending.split('')
    for (let i = 1; i < chars.length; i++) {
      expect(chars[i].charCodeAt(0)).toBeGreaterThanOrEqual(chars[i - 1].charCodeAt(0))
    }
  })

  it('shows trend from high to low', () => {
    const descending = sparkline([100, 75, 50, 25, 0])

    const chars = descending.split('')
    for (let i = 1; i < chars.length; i++) {
      expect(chars[i].charCodeAt(0)).toBeLessThanOrEqual(chars[i - 1].charCodeAt(0))
    }
  })

  it('handles all same values', () => {
    const flat = sparkline([50, 50, 50, 50])

    // All characters should be the same
    const chars = flat.split('')
    const uniqueChars = new Set(chars)
    expect(uniqueChars.size).toBe(1)
  })

  it('handles negative values', () => {
    const result = sparkline([-100, -50, 0, 50, 100])
    expect(result.length).toBe(5)
    // Should still produce valid sparkline
    expect(result).toMatch(/^[\u2581-\u2588]+$/)
  })

  it('uses full range of block characters', () => {
    // With values spanning 0-100 in even steps, should use multiple block levels
    const result = sparkline([0, 14, 28, 42, 56, 70, 84, 100])

    const uniqueChars = new Set(result.split(''))
    // Should use at least a few different block characters
    expect(uniqueChars.size).toBeGreaterThan(3)
  })
})
