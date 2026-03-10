/**
 * @purpose Test PolicyHeadInference — math primitives, text formatting, weight loading, and forward pass
 */

const mockExistsSync = jest.fn()
const mockReadFileSync = jest.fn()

jest.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}))

import { PolicyHeadInference } from '../policy-head'
import type { RLState, RLAction } from '../training-buffer'

function makeState(overrides: Partial<RLState> = {}): RLState {
  return {
    composite_score: 0.85,
    dimension_scores: { correctness: 0.9, coverage: 0.8 },
    tests_passing: 200,
    tests_total: 210,
    trajectory_length: 5,
    recent_deltas: [0.01, -0.02],
    agent: 'peter-parker',
    ...overrides,
  }
}

function makeAction(overrides: Partial<RLAction> = {}): RLAction {
  return {
    type: 'fix',
    description: 'Fix flaky test in session manager',
    files_affected: ['src/lib/session.ts'],
    scope: 'small',
    branch: 'pp/fix-session',
    ...overrides,
  }
}

function makeTinyWeights(inputDim: number) {
  const hiddenDim = 4
  return {
    version: 1,
    architecture: 'q-network',
    embed_dim: inputDim / 2,
    mode: 'numeric' as const,
    trained_at: '2026-03-01T00:00:00.000Z',
    trained_on: 100,
    direction_accuracy: 0.75,
    rank_correlation: 0.6,
    target_mean: 0.05,
    target_std: 0.1,
    layers: {
      W1: Array.from({ length: inputDim }, (_, i) =>
        Array.from({ length: hiddenDim }, (_, j) => (i === j % inputDim ? 0.1 : 0.0))
      ),
      b1: new Array(hiddenDim).fill(0),
      W2: Array.from({ length: hiddenDim }, (_, i) =>
        Array.from({ length: hiddenDim }, (_, j) => (i === j ? 0.1 : 0.0))
      ),
      b2: new Array(hiddenDim).fill(0),
      W3: Array.from({ length: hiddenDim }, (_, i) =>
        Array.from({ length: 1 }, () => 0.1)
      ),
      b3: [0],
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('PolicyHeadInference constructor', () => {
  it('loads weights when file exists', () => {
    const weights = makeTinyWeights(8)
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify(weights))

    const policy = new PolicyHeadInference('/fake/root')
    expect(policy.isLoaded).toBe(true)
  })

  it('sets isLoaded false when no weights file', () => {
    mockExistsSync.mockReturnValue(false)

    const policy = new PolicyHeadInference('/fake/root')
    expect(policy.isLoaded).toBe(false)
  })

  it('reads from correct path', () => {
    mockExistsSync.mockReturnValue(false)
    new PolicyHeadInference('/my/project')

    expect(mockExistsSync).toHaveBeenCalledWith(
      expect.stringContaining('.jfl/policy-weights.json')
    )
  })
})

describe('PolicyHeadInference.stats', () => {
  it('returns null when no weights loaded', () => {
    mockExistsSync.mockReturnValue(false)
    const policy = new PolicyHeadInference('/fake')
    expect(policy.stats).toBeNull()
  })

  it('returns training stats from weights', () => {
    const weights = makeTinyWeights(8)
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify(weights))

    const policy = new PolicyHeadInference('/fake')
    const stats = policy.stats
    expect(stats).not.toBeNull()
    expect(stats!.trained_on).toBe(100)
    expect(stats!.direction_accuracy).toBe(0.75)
    expect(stats!.rank_correlation).toBe(0.6)
  })
})

describe('PolicyHeadInference.formatStateText', () => {
  it('formats state with all fields', () => {
    mockExistsSync.mockReturnValue(false)
    const policy = new PolicyHeadInference('/fake')
    const text = policy.formatStateText(makeState())

    expect(text).toContain('Agent: peter-parker')
    expect(text).toContain('Composite: 0.8500')
    expect(text).toContain('Tests: 200/210')
    expect(text).toContain('Trajectory: 5')
    expect(text).toContain('correctness=0.9000')
    expect(text).toContain('coverage=0.8000')
    expect(text).toContain('+0.0100')
    expect(text).toContain('-0.0200')
  })

  it('handles empty dimensions', () => {
    mockExistsSync.mockReturnValue(false)
    const policy = new PolicyHeadInference('/fake')
    const text = policy.formatStateText(makeState({ dimension_scores: {} }))
    expect(text).toContain('Dimensions: none')
  })

  it('handles empty recent_deltas', () => {
    mockExistsSync.mockReturnValue(false)
    const policy = new PolicyHeadInference('/fake')
    const text = policy.formatStateText(makeState({ recent_deltas: [] }))
    expect(text).toContain('Recent deltas: none')
  })
})

describe('PolicyHeadInference.formatActionText', () => {
  it('formats action with all fields', () => {
    mockExistsSync.mockReturnValue(false)
    const policy = new PolicyHeadInference('/fake')
    const text = policy.formatActionText(makeAction())

    expect(text).toContain('Type: fix')
    expect(text).toContain('Description: Fix flaky test')
    expect(text).toContain('Scope: small')
    expect(text).toContain('Files: src/lib/session.ts')
  })

  it('truncates description to 150 chars', () => {
    mockExistsSync.mockReturnValue(false)
    const policy = new PolicyHeadInference('/fake')
    const longDesc = 'A'.repeat(200)
    const text = policy.formatActionText(makeAction({ description: longDesc }))

    const descLine = text.split('\n').find(l => l.startsWith('Description:'))!
    expect(descLine.length).toBeLessThanOrEqual('Description: '.length + 150)
  })

  it('limits files to 5', () => {
    mockExistsSync.mockReturnValue(false)
    const policy = new PolicyHeadInference('/fake')
    const files = Array.from({ length: 10 }, (_, i) => `file${i}.ts`)
    const text = policy.formatActionText(makeAction({ files_affected: files }))

    const fileLine = text.split('\n').find(l => l.startsWith('Files:'))!
    const listedFiles = fileLine.replace('Files: ', '').split(', ')
    expect(listedFiles.length).toBe(5)
  })

  it('handles empty files list', () => {
    mockExistsSync.mockReturnValue(false)
    const policy = new PolicyHeadInference('/fake')
    const text = policy.formatActionText(makeAction({ files_affected: [] }))
    expect(text).toContain('Files: none')
  })
})

describe('PolicyHeadInference.predictReward', () => {
  it('throws when no weights loaded', async () => {
    mockExistsSync.mockReturnValue(false)
    const policy = new PolicyHeadInference('/fake')
    await expect(policy.predictReward(makeState(), makeAction())).rejects.toThrow(
      'No policy weights loaded'
    )
  })
})

describe('PolicyHeadInference.rankActions', () => {
  it('throws when no weights loaded', async () => {
    mockExistsSync.mockReturnValue(false)
    const policy = new PolicyHeadInference('/fake')
    await expect(policy.rankActions(makeState(), [makeAction()])).rejects.toThrow(
      'No policy weights loaded'
    )
  })
})
