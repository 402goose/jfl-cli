/**
 * @purpose Test TrainingBuffer class — append, read, stats, exportForTraining, and hashEntry
 */

const mockExistsSync = jest.fn()
const mockReadFileSync = jest.fn()
const mockAppendFileSync = jest.fn()
const mockMkdirSync = jest.fn()

jest.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  appendFileSync: mockAppendFileSync,
  mkdirSync: mockMkdirSync,
}))

import { TrainingBuffer, hashEntry, RLState, RLAction, RLReward, TrainingBufferEntry } from '../training-buffer'

function makeState(overrides: Partial<RLState> = {}): RLState {
  return {
    composite_score: 0.85,
    dimension_scores: { correctness: 0.9, coverage: 0.8 },
    tests_passing: 200,
    tests_total: 210,
    trajectory_length: 5,
    recent_deltas: [0.01, 0.02],
    agent: 'peter-parker',
    ...overrides,
  }
}

function makeAction(overrides: Partial<RLAction> = {}): RLAction {
  return {
    type: 'fix',
    description: 'Fix failing test in session manager',
    files_affected: ['src/lib/session.ts', 'src/lib/__tests__/session.test.ts'],
    scope: 'small',
    branch: 'pp/fix-session',
    ...overrides,
  }
}

function makeReward(overrides: Partial<RLReward> = {}): RLReward {
  return {
    composite_delta: 0.05,
    dimension_deltas: { correctness: 0.03, coverage: 0.02 },
    tests_added: 3,
    quality_score: 0.85,
    improved: true,
    ...overrides,
  }
}

function makeFullEntry(overrides: Partial<TrainingBufferEntry> = {}): TrainingBufferEntry {
  return {
    id: 'tb_abc123',
    v: 1,
    ts: '2026-03-01T00:00:00.000Z',
    agent: 'peter-parker',
    state: makeState(),
    action: makeAction(),
    reward: makeReward(),
    metadata: {
      branch: 'pp/fix-session',
      source: 'ci',
    },
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockExistsSync.mockReturnValue(false)
})

describe('hashEntry', () => {
  it('produces a 12-character hex string', () => {
    const hash = hashEntry(makeState(), makeAction())
    expect(hash).toMatch(/^[a-f0-9]{12}$/)
  })

  it('is deterministic for same inputs', () => {
    const state = makeState()
    const action = makeAction()
    expect(hashEntry(state, action)).toBe(hashEntry(state, action))
  })

  it('differs for different inputs', () => {
    const state = makeState()
    const a1 = makeAction({ description: 'task A' })
    const a2 = makeAction({ description: 'task B' })
    expect(hashEntry(state, a1)).not.toBe(hashEntry(state, a2))
  })

  it('differs for different composite scores', () => {
    const s1 = makeState({ composite_score: 0.5 })
    const s2 = makeState({ composite_score: 0.9 })
    const action = makeAction()
    expect(hashEntry(s1, action)).not.toBe(hashEntry(s2, action))
  })
})

describe('TrainingBuffer.read', () => {
  it('returns empty array when file does not exist', () => {
    mockExistsSync.mockReturnValue(false)
    const buffer = new TrainingBuffer('/fake/root')
    expect(buffer.read()).toEqual([])
  })

  it('parses JSONL entries correctly', () => {
    const e1 = makeFullEntry({ agent: 'agent-a' })
    const e2 = makeFullEntry({ agent: 'agent-b' })
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify(e1) + '\n' + JSON.stringify(e2) + '\n')

    const buffer = new TrainingBuffer('/fake/root')
    const entries = buffer.read()
    expect(entries).toHaveLength(2)
    expect(entries[0].agent).toBe('agent-a')
    expect(entries[1].agent).toBe('agent-b')
  })

  it('skips malformed lines', () => {
    const valid = makeFullEntry()
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('{bad\n' + JSON.stringify(valid) + '\n\n')

    const buffer = new TrainingBuffer('/fake/root')
    expect(buffer.read()).toHaveLength(1)
  })
})

describe('TrainingBuffer.append', () => {
  it('creates directory and appends entry', () => {
    mockExistsSync.mockReturnValue(false)

    const buffer = new TrainingBuffer('/fake/root')
    const result = buffer.append({
      agent: 'peter-parker',
      state: makeState(),
      action: makeAction(),
      reward: makeReward(),
      metadata: { branch: 'pp/test', source: 'ci' },
    })

    expect(result.id).toMatch(/^tb_[a-f0-9]{12}$/)
    expect(result.v).toBe(1)
    expect(result.ts).toBeDefined()
    expect(result.agent).toBe('peter-parker')
    expect(mockMkdirSync).toHaveBeenCalled()
    expect(mockAppendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('training-buffer.jsonl'),
      expect.stringContaining('"peter-parker"')
    )
  })

  it('generates consistent IDs for same state+action', () => {
    mockExistsSync.mockReturnValue(true)

    const buffer = new TrainingBuffer('/fake/root')
    const state = makeState()
    const action = makeAction()
    const r1 = buffer.append({
      agent: 'pp', state, action, reward: makeReward(),
      metadata: { branch: 'b1', source: 'ci' },
    })
    const r2 = buffer.append({
      agent: 'pp', state, action, reward: makeReward(),
      metadata: { branch: 'b2', source: 'ci' },
    })

    expect(r1.id).toBe(r2.id)
  })
})

describe('TrainingBuffer.stats', () => {
  it('returns zero stats for empty buffer', () => {
    mockExistsSync.mockReturnValue(false)
    const buffer = new TrainingBuffer('/fake/root')
    const stats = buffer.stats()
    expect(stats.total).toBe(0)
    expect(stats.avgReward).toBe(0)
    expect(stats.improvedRate).toBe(0)
    expect(stats.byAgent).toEqual({})
    expect(stats.bySource).toEqual({})
  })

  it('computes correct statistics', () => {
    const entries = [
      makeFullEntry({
        agent: 'pp',
        reward: makeReward({ composite_delta: 0.10, improved: true }),
        metadata: { branch: 'b1', source: 'ci' },
      }),
      makeFullEntry({
        agent: 'pp',
        reward: makeReward({ composite_delta: -0.02, improved: false }),
        metadata: { branch: 'b2', source: 'autoresearch' },
      }),
      makeFullEntry({
        agent: 'other',
        reward: makeReward({ composite_delta: 0.04, improved: true }),
        metadata: { branch: 'b3', source: 'ci' },
      }),
    ]

    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(
      entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    )

    const buffer = new TrainingBuffer('/fake/root')
    const stats = buffer.stats()

    expect(stats.total).toBe(3)
    expect(stats.byAgent).toEqual({ pp: 2, other: 1 })
    expect(stats.bySource).toEqual({ ci: 2, autoresearch: 1 })
    expect(stats.avgReward).toBeCloseTo(0.04, 4)
    expect(stats.improvedRate).toBeCloseTo(2 / 3, 4)
  })
})

describe('TrainingBuffer.exportForTraining', () => {
  it('returns empty array for empty buffer', () => {
    mockExistsSync.mockReturnValue(false)
    const buffer = new TrainingBuffer('/fake/root')
    expect(buffer.exportForTraining()).toEqual([])
  })

  it('formats state and action text correctly', () => {
    const entry = makeFullEntry({
      state: makeState({ composite_score: 0.85, tests_passing: 200, tests_total: 210 }),
      action: makeAction({ type: 'fix', description: 'Fix test', scope: 'small' }),
      reward: makeReward({ composite_delta: 0.05 }),
    })

    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify(entry) + '\n')

    const buffer = new TrainingBuffer('/fake/root')
    const exported = buffer.exportForTraining()

    expect(exported).toHaveLength(1)
    expect(exported[0].state_text).toContain('Composite: 0.8500')
    expect(exported[0].state_text).toContain('Tests: 200/210')
    expect(exported[0].action_text).toContain('Type: fix')
    expect(exported[0].action_text).toContain('Description: Fix test')
    expect(exported[0].action_text).toContain('Scope: small')
    expect(exported[0].reward).toBe(0.05)
  })

  it('includes dimension scores in state text', () => {
    const entry = makeFullEntry({
      state: makeState({ dimension_scores: { correctness: 0.9, coverage: 0.8 } }),
    })

    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify(entry) + '\n')

    const buffer = new TrainingBuffer('/fake/root')
    const exported = buffer.exportForTraining()

    expect(exported[0].state_text).toContain('correctness=0.9000')
    expect(exported[0].state_text).toContain('coverage=0.8000')
  })

  it('formats recent deltas with sign', () => {
    const entry = makeFullEntry({
      state: makeState({ recent_deltas: [0.01, -0.02, 0.0] }),
    })

    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify(entry) + '\n')

    const buffer = new TrainingBuffer('/fake/root')
    const exported = buffer.exportForTraining()

    expect(exported[0].state_text).toContain('+0.0100')
    expect(exported[0].state_text).toContain('-0.0200')
    expect(exported[0].state_text).toContain('+0.0000')
  })
})
