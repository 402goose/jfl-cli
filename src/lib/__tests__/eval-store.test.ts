/**
 * @purpose Test eval-store read/write/query functions with mocked filesystem
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

import { appendEval, readEvals, getTrajectory, getLatestEval, listAgents } from '../eval-store'
import type { EvalEntry } from '../../types/eval'

function makeEntry(overrides: Partial<EvalEntry> = {}): EvalEntry {
  return {
    v: 1,
    ts: '2026-03-01T00:00:00.000Z',
    agent: 'peter-parker',
    run_id: 'run_001',
    metrics: { test_pass_rate: 1.0, tests_passed: 274, tests_total: 274 },
    composite: 1.0,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('readEvals', () => {
  it('returns empty array when file does not exist', () => {
    mockExistsSync.mockReturnValue(false)
    expect(readEvals('/fake/root')).toEqual([])
  })

  it('parses JSONL file into array of entries', () => {
    const e1 = makeEntry({ ts: '2026-03-01T00:00:00.000Z', agent: 'a1' })
    const e2 = makeEntry({ ts: '2026-03-02T00:00:00.000Z', agent: 'a2' })
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify(e1) + '\n' + JSON.stringify(e2) + '\n')

    const result = readEvals('/fake/root')
    expect(result).toHaveLength(2)
    expect(result[0].agent).toBe('a1')
    expect(result[1].agent).toBe('a2')
  })

  it('skips blank lines and malformed JSON', () => {
    const valid = makeEntry()
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(
      '\n' + JSON.stringify(valid) + '\n{bad json}\n\n'
    )

    const result = readEvals('/fake/root')
    expect(result).toHaveLength(1)
    expect(result[0].agent).toBe('peter-parker')
  })

  it('returns empty array for empty file', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('')
    expect(readEvals('/fake/root')).toEqual([])
  })
})

describe('appendEval', () => {
  it('creates directory and appends entry as JSON line', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes('config.json')) return false
      if (p.endsWith('.jfl')) return false
      return false
    })

    const entry = makeEntry()
    appendEval(entry, '/fake/root')

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.jfl'),
      { recursive: true }
    )
    expect(mockAppendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('eval.jsonl'),
      JSON.stringify(entry) + '\n'
    )
  })

  it('does not create directory if it already exists', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.includes('eval.jsonl')) return false
      return true
    })
    mockReadFileSync.mockReturnValue('{}')

    const entry = makeEntry()
    appendEval(entry, '/fake/root')

    expect(mockAppendFileSync).toHaveBeenCalled()
  })
})

describe('getTrajectory', () => {
  it('returns sorted trajectory for agent and metric', () => {
    const e1 = makeEntry({ ts: '2026-03-02T00:00:00.000Z', agent: 'pp', metrics: { score: 0.8 } })
    const e2 = makeEntry({ ts: '2026-03-01T00:00:00.000Z', agent: 'pp', metrics: { score: 0.7 } })
    const e3 = makeEntry({ ts: '2026-03-03T00:00:00.000Z', agent: 'other', metrics: { score: 0.9 } })

    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(
      [e1, e2, e3].map(e => JSON.stringify(e)).join('\n') + '\n'
    )

    const trajectory = getTrajectory('pp', 'score', '/fake/root')
    expect(trajectory).toHaveLength(2)
    expect(trajectory[0].value).toBe(0.7)
    expect(trajectory[1].value).toBe(0.8)
    expect(trajectory[0].ts < trajectory[1].ts).toBe(true)
  })

  it('returns composite when metric is "composite"', () => {
    const entry = makeEntry({ agent: 'pp', composite: 0.95 })
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify(entry) + '\n')

    const trajectory = getTrajectory('pp', 'composite', '/fake/root')
    expect(trajectory).toHaveLength(1)
    expect(trajectory[0].value).toBe(0.95)
  })

  it('skips entries where metric is missing', () => {
    const entry = makeEntry({ agent: 'pp', metrics: { other: 1.0 } })
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify(entry) + '\n')

    const trajectory = getTrajectory('pp', 'missing_metric', '/fake/root')
    expect(trajectory).toHaveLength(0)
  })

  it('returns empty array when no evals exist', () => {
    mockExistsSync.mockReturnValue(false)
    expect(getTrajectory('pp', 'score', '/fake/root')).toEqual([])
  })
})

describe('getLatestEval', () => {
  it('returns the most recent entry for an agent', () => {
    const older = makeEntry({ ts: '2026-03-01T00:00:00.000Z', agent: 'pp', run_id: 'old' })
    const newer = makeEntry({ ts: '2026-03-05T00:00:00.000Z', agent: 'pp', run_id: 'new' })
    const other = makeEntry({ ts: '2026-03-10T00:00:00.000Z', agent: 'other', run_id: 'x' })

    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(
      [older, newer, other].map(e => JSON.stringify(e)).join('\n') + '\n'
    )

    const latest = getLatestEval('pp', '/fake/root')
    expect(latest).not.toBeNull()
    expect(latest!.run_id).toBe('new')
  })

  it('returns null when agent has no entries', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(
      JSON.stringify(makeEntry({ agent: 'other' })) + '\n'
    )

    expect(getLatestEval('nonexistent', '/fake/root')).toBeNull()
  })

  it('returns null when eval file does not exist', () => {
    mockExistsSync.mockReturnValue(false)
    expect(getLatestEval('pp', '/fake/root')).toBeNull()
  })
})

describe('listAgents', () => {
  it('returns sorted unique agent names', () => {
    const entries = [
      makeEntry({ agent: 'charlie' }),
      makeEntry({ agent: 'alpha' }),
      makeEntry({ agent: 'charlie' }),
      makeEntry({ agent: 'bravo' }),
    ]

    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(
      entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    )

    expect(listAgents('/fake/root')).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('returns empty array when no evals', () => {
    mockExistsSync.mockReturnValue(false)
    expect(listAgents('/fake/root')).toEqual([])
  })
})
