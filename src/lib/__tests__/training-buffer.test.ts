/**
 * Tests for Training Buffer Utilities
 *
 * @purpose Test pure hash entry function for RL training tuples
 */

import { hashEntry } from '../training-buffer'
import type { RLState, RLAction } from '../training-buffer'

describe('hashEntry', () => {
  const createState = (overrides: Partial<RLState> = {}): RLState => ({
    composite_score: 0.95,
    dimension_scores: { test: 0.9, lint: 0.85 },
    tests_passing: 100,
    tests_total: 100,
    trajectory_length: 5,
    recent_deltas: [0.01, 0.02, -0.01],
    agent: 'test-agent',
    ...overrides,
  })

  const createAction = (overrides: Partial<RLAction> = {}): RLAction => ({
    type: 'fix',
    description: 'Fixed a bug',
    files_affected: ['src/test.ts'],
    scope: 'small',
    branch: 'main',
    ...overrides,
  })

  it('returns a 12-character hex string', () => {
    const hash = hashEntry(createState(), createAction())

    expect(hash.length).toBe(12)
    expect(hash).toMatch(/^[0-9a-f]{12}$/)
  })

  it('returns deterministic results for same inputs', () => {
    const state = createState()
    const action = createAction()

    const hash1 = hashEntry(state, action)
    const hash2 = hashEntry(state, action)
    const hash3 = hashEntry(state, action)

    expect(hash1).toBe(hash2)
    expect(hash2).toBe(hash3)
  })

  it('returns different hashes for different composite scores', () => {
    const action = createAction()
    const state1 = createState({ composite_score: 0.95 })
    const state2 = createState({ composite_score: 0.85 })

    const hash1 = hashEntry(state1, action)
    const hash2 = hashEntry(state2, action)

    expect(hash1).not.toBe(hash2)
  })

  it('returns different hashes for different action descriptions', () => {
    const state = createState()
    const action1 = createAction({ description: 'Fixed bug A' })
    const action2 = createAction({ description: 'Fixed bug B' })

    const hash1 = hashEntry(state, action1)
    const hash2 = hashEntry(state, action2)

    expect(hash1).not.toBe(hash2)
  })

  it('returns different hashes for different action types', () => {
    const state = createState()
    const action1 = createAction({ type: 'fix' })
    const action2 = createAction({ type: 'refactor' })

    const hash1 = hashEntry(state, action1)
    const hash2 = hashEntry(state, action2)

    expect(hash1).not.toBe(hash2)
  })

  it('ignores non-hashed state fields', () => {
    const action = createAction()

    // These fields are not included in the hash content
    const state1 = createState({ trajectory_length: 5 })
    const state2 = createState({ trajectory_length: 10 })

    const hash1 = hashEntry(state1, action)
    const hash2 = hashEntry(state2, action)

    // Hash only uses composite_score from state, so these should be equal
    expect(hash1).toBe(hash2)
  })

  it('ignores non-hashed action fields', () => {
    const state = createState()

    // Only type and description are hashed, not files_affected or scope
    const action1 = createAction({ scope: 'small' })
    const action2 = createAction({ scope: 'large' })

    const hash1 = hashEntry(state, action1)
    const hash2 = hashEntry(state, action2)

    expect(hash1).toBe(hash2)
  })

  it('handles edge case values', () => {
    const state = createState({ composite_score: 0 })
    const action = createAction({ description: '' })

    const hash = hashEntry(state, action)

    expect(hash.length).toBe(12)
    expect(hash).toMatch(/^[0-9a-f]{12}$/)
  })

  it('handles very long descriptions', () => {
    const state = createState()
    const action = createAction({ description: 'a'.repeat(10000) })

    const hash = hashEntry(state, action)

    expect(hash.length).toBe(12)
    expect(hash).toMatch(/^[0-9a-f]{12}$/)
  })

  it('handles special characters in description', () => {
    const state = createState()
    const action = createAction({ description: 'Fixed bug: "issue" with <tags> & symbols' })

    const hash = hashEntry(state, action)

    expect(hash.length).toBe(12)
    expect(hash).toMatch(/^[0-9a-f]{12}$/)
  })
})
