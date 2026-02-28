import { estimateCost, MODEL_PRICING } from '../model-pricing'

describe('MODEL_PRICING', () => {
  it('has pricing for all expected models', () => {
    const expectedModels = [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5',
      'claude-haiku-3-5',
      'gpt-4o',
      'gpt-4o-mini',
    ]
    for (const model of expectedModels) {
      expect(MODEL_PRICING[model]).toBeDefined()
      expect(MODEL_PRICING[model].inputPer1kTokens).toBeGreaterThan(0)
      expect(MODEL_PRICING[model].outputPer1kTokens).toBeGreaterThan(0)
    }
  })

  it('output tokens cost more than input tokens for all models', () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.outputPer1kTokens).toBeGreaterThan(pricing.inputPer1kTokens)
    }
  })
})

describe('estimateCost', () => {
  it('calculates cost for exact model name', () => {
    const cost = estimateCost('claude-sonnet-4-6', 1000, 500)
    // input: 1000/1000 * 0.003 = 0.003
    // output: 500/1000 * 0.015 = 0.0075
    expect(cost).toBeCloseTo(0.0105, 4)
  })

  it('handles Stratus prefixed model names via substring match', () => {
    const cost = estimateCost('stratus-x1ac-base-claude-sonnet-4-6', 1000, 500)
    expect(cost).toBeCloseTo(0.0105, 4)
  })

  it('handles stratus-x1ac-huge-claude-opus-4-6', () => {
    const cost = estimateCost('stratus-x1ac-huge-claude-opus-4-6', 2000, 1000)
    // input: 2000/1000 * 0.015 = 0.03
    // output: 1000/1000 * 0.075 = 0.075
    expect(cost).toBeCloseTo(0.105, 4)
  })

  it('returns 0 for unknown models', () => {
    expect(estimateCost('unknown-model-xyz', 1000, 500)).toBe(0)
    expect(estimateCost('', 1000, 500)).toBe(0)
  })

  it('never throws, even with weird input', () => {
    expect(() => estimateCost('', 0, 0)).not.toThrow()
    expect(() => estimateCost('claude-opus-4-6', -1, -1)).not.toThrow()
    expect(estimateCost('claude-opus-4-6', 0, 0)).toBe(0)
  })

  it('is case-insensitive', () => {
    const lower = estimateCost('claude-opus-4-6', 1000, 500)
    const upper = estimateCost('CLAUDE-OPUS-4-6', 1000, 500)
    expect(lower).toBe(upper)
    expect(lower).toBeGreaterThan(0)
  })

  it('scales linearly with token count', () => {
    const cost1k = estimateCost('claude-sonnet-4-6', 1000, 1000)
    const cost2k = estimateCost('claude-sonnet-4-6', 2000, 2000)
    expect(cost2k).toBeCloseTo(cost1k * 2, 6)
  })

  it('haiku is cheapest, opus is most expensive', () => {
    const haiku = estimateCost('claude-haiku-3-5', 1000, 1000)
    const sonnet = estimateCost('claude-sonnet-4-6', 1000, 1000)
    const opus = estimateCost('claude-opus-4-6', 1000, 1000)
    expect(haiku).toBeLessThan(sonnet)
    expect(sonnet).toBeLessThan(opus)
  })
})
