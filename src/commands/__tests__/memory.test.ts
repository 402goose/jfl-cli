/**
 * @purpose Tests for jfl memory command handlers
 */

jest.mock('chalk', () => {
  const passthrough = (s: string) => s
  const chalk: any = new Proxy(passthrough, {
    get: () => chalk,
    apply: (_t: any, _this: any, args: any[]) => args[0],
  })
  chalk.bold = passthrough
  chalk.gray = passthrough
  chalk.green = passthrough
  chalk.red = passthrough
  chalk.yellow = passthrough
  chalk.cyan = passthrough
  chalk.dim = passthrough
  return { default: chalk, __esModule: true }
})

jest.mock('ora', () => {
  const spinner = {
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  }
  return jest.fn(() => spinner)
})

jest.mock('../../lib/memory-db', () => ({
  initializeDatabase: jest.fn().mockResolvedValue(undefined),
  getMemoryStats: jest.fn().mockResolvedValue({
    total_memories: 10,
    by_type: { feature: 5, decision: 3, fix: 2 },
    date_range: {
      earliest: '2026-01-01T00:00:00.000Z',
      latest: '2026-03-12T00:00:00.000Z',
    },
    embeddings: { available: true, count: 10, model: 'text-embedding-ada-002' },
    last_index: '2026-03-12T10:00:00.000Z',
  }),
  getAllMemories: jest.fn().mockResolvedValue([]),
}))

jest.mock('../../lib/memory-indexer', () => ({
  indexJournalEntries: jest.fn().mockResolvedValue({
    added: 5,
    skipped: 3,
    errors: 0,
  }),
}))

jest.mock('../../lib/memory-search', () => ({
  searchMemories: jest.fn().mockResolvedValue([
    {
      memory: {
        id: '1',
        title: 'Test Feature',
        summary: 'Added new feature',
        type: 'feature',
        created_at: '2026-03-10T00:00:00.000Z',
        metadata: JSON.stringify({ files: ['src/index.ts'] }),
      },
      score: 0.95,
      relevance: 'high',
    },
    {
      memory: {
        id: '2',
        title: 'Bug Fix',
        summary: 'Fixed the bug',
        type: 'fix',
        created_at: '2026-03-11T00:00:00.000Z',
        metadata: null,
      },
      score: 0.75,
      relevance: 'medium',
    },
  ]),
}))

let logOutput: string[]
let mockExit: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  logOutput = []
  jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    logOutput.push(args.join(' '))
  })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit')
  })
})

afterAll(() => {
  jest.restoreAllMocks()
})

function getOutput() {
  return logOutput.join('\n')
}

describe('memoryInitCommand', () => {
  let memoryInitCommand: any

  beforeAll(async () => {
    const mod = await import('../memory')
    memoryInitCommand = mod.memoryInitCommand
  })

  it('initializes database and indexes entries', async () => {
    const { initializeDatabase } = require('../../lib/memory-db')
    const { indexJournalEntries } = require('../../lib/memory-indexer')

    await memoryInitCommand()

    expect(initializeDatabase).toHaveBeenCalled()
    expect(indexJournalEntries).toHaveBeenCalled()
  })

  it('shows success message on completion', async () => {
    await memoryInitCommand()

    const out = getOutput()
    expect(out).toContain('Memory system ready')
  })

  it('reports indexing errors if any', async () => {
    const { indexJournalEntries } = require('../../lib/memory-indexer')
    indexJournalEntries.mockResolvedValueOnce({
      added: 3,
      skipped: 1,
      errors: 2,
    })

    await memoryInitCommand()

    const out = getOutput()
    expect(out).toContain('2 errors during indexing')
  })

  it('exits on database error', async () => {
    const { initializeDatabase } = require('../../lib/memory-db')
    initializeDatabase.mockRejectedValueOnce(new Error('DB error'))

    await expect(memoryInitCommand()).rejects.toThrow('process.exit')
    expect(mockExit).toHaveBeenCalledWith(1)
  })
})

describe('memoryStatusCommand', () => {
  let memoryStatusCommand: any

  beforeAll(async () => {
    const mod = await import('../memory')
    memoryStatusCommand = mod.memoryStatusCommand
  })

  it('displays memory statistics', async () => {
    await memoryStatusCommand()

    const out = getOutput()
    expect(out).toContain('Memory System Status')
    expect(out).toContain('Total memories: 10')
  })

  it('shows breakdown by type', async () => {
    await memoryStatusCommand()

    const out = getOutput()
    expect(out).toContain('By type')
    expect(out).toContain('feature')
    expect(out).toContain('decision')
    expect(out).toContain('fix')
  })

  it('shows date range', async () => {
    await memoryStatusCommand()

    const out = getOutput()
    expect(out).toContain('Date range')
    expect(out).toContain('Earliest')
    expect(out).toContain('Latest')
  })

  it('shows embeddings status', async () => {
    await memoryStatusCommand()

    const out = getOutput()
    expect(out).toContain('Embeddings')
    expect(out).toContain('Available')
  })

  it('shows embeddings not available when disabled', async () => {
    const { getMemoryStats } = require('../../lib/memory-db')
    getMemoryStats.mockResolvedValueOnce({
      total_memories: 5,
      by_type: {},
      date_range: {},
      embeddings: { available: false, count: 0 },
    })

    await memoryStatusCommand()

    const out = getOutput()
    expect(out).toContain('Not available')
  })

  it('shows not initialized message when table missing', async () => {
    const { getMemoryStats } = require('../../lib/memory-db')
    getMemoryStats.mockRejectedValueOnce(new Error('no such table: memories'))

    await memoryStatusCommand()

    const out = getOutput()
    expect(out).toContain('Memory system not initialized')
    expect(out).toContain('jfl memory init')
  })
})

describe('memorySearchCommand', () => {
  let memorySearchCommand: any

  beforeAll(async () => {
    const mod = await import('../memory')
    memorySearchCommand = mod.memorySearchCommand
  })

  it('searches and displays results', async () => {
    await memorySearchCommand('test query', {})

    const out = getOutput()
    expect(out).toContain('Results for "test query"')
    expect(out).toContain('Test Feature')
    expect(out).toContain('Bug Fix')
  })

  it('shows relevance indicators', async () => {
    await memorySearchCommand('test query', {})

    const out = getOutput()
    expect(out).toContain('Relevance')
    expect(out).toContain('0.95')
  })

  it('shows file information from metadata', async () => {
    await memorySearchCommand('test query', {})

    const out = getOutput()
    expect(out).toContain('Files')
    expect(out).toContain('src/index.ts')
  })

  it('shows no results message when empty', async () => {
    const { searchMemories } = require('../../lib/memory-search')
    searchMemories.mockResolvedValueOnce([])

    await memorySearchCommand('no results query', {})

    const out = getOutput()
    expect(out).toContain('No results found')
  })

  it('passes max option to search', async () => {
    const { searchMemories } = require('../../lib/memory-search')

    await memorySearchCommand('test', { max: '5' })

    expect(searchMemories).toHaveBeenCalledWith('test', {
      maxItems: 5,
      type: undefined,
    })
  })

  it('passes type filter to search', async () => {
    const { searchMemories } = require('../../lib/memory-search')

    await memorySearchCommand('test', { type: 'feature' })

    expect(searchMemories).toHaveBeenCalledWith('test', {
      maxItems: 10,
      type: 'feature',
    })
  })

  it('shows not initialized message on table error', async () => {
    const { searchMemories } = require('../../lib/memory-search')
    searchMemories.mockRejectedValueOnce(new Error('no such table: memories'))

    await memorySearchCommand('test', {})

    const out = getOutput()
    expect(out).toContain('Memory system not initialized')
  })
})

describe('memoryIndexCommand', () => {
  let memoryIndexCommand: any

  beforeAll(async () => {
    const mod = await import('../memory')
    memoryIndexCommand = mod.memoryIndexCommand
  })

  it('runs indexing and shows statistics', async () => {
    await memoryIndexCommand({})

    const out = getOutput()
    expect(out).toContain('Index Statistics')
    expect(out).toContain('Added')
    expect(out).toContain('Skipped')
  })

  it('shows memory index updated message', async () => {
    await memoryIndexCommand({})

    const out = getOutput()
    expect(out).toContain('Memory index updated')
  })

  it('passes force option to indexer', async () => {
    const { indexJournalEntries } = require('../../lib/memory-indexer')

    await memoryIndexCommand({ force: true })

    expect(indexJournalEntries).toHaveBeenCalledWith(true)
  })

  it('shows errors count when present', async () => {
    const { indexJournalEntries } = require('../../lib/memory-indexer')
    indexJournalEntries.mockResolvedValueOnce({
      added: 2,
      skipped: 1,
      errors: 3,
    })

    await memoryIndexCommand({})

    const out = getOutput()
    expect(out).toContain('Errors')
    expect(out).toContain('3')
  })

  it('shows total memories after indexing', async () => {
    await memoryIndexCommand({})

    const out = getOutput()
    expect(out).toContain('Total memories in database')
    expect(out).toContain('10')
  })
})

describe('formatSearchResults', () => {
  let formatSearchResults: any

  beforeAll(async () => {
    const mod = await import('../memory')
    formatSearchResults = mod.formatSearchResults
  })

  it('returns no results message for empty array', () => {
    const result = formatSearchResults([])
    expect(result).toBe('No results found.')
  })

  it('formats results with title and type', () => {
    const results = [
      {
        memory: {
          id: '1',
          title: 'Test',
          type: 'feature',
          created_at: '2026-01-01T00:00:00.000Z',
        },
        score: 0.9,
        relevance: 'high',
      },
    ]

    const result = formatSearchResults(results)
    expect(result).toContain('Test')
    expect(result).toContain('feature')
    expect(result).toContain('high')
  })

  it('includes summary when present', () => {
    const results = [
      {
        memory: {
          id: '1',
          title: 'Test',
          summary: 'This is the summary',
          created_at: '2026-01-01T00:00:00.000Z',
        },
        score: 0.9,
        relevance: 'high',
      },
    ]

    const result = formatSearchResults(results)
    expect(result).toContain('This is the summary')
  })

  it('includes files from metadata', () => {
    const results = [
      {
        memory: {
          id: '1',
          title: 'Test',
          created_at: '2026-01-01T00:00:00.000Z',
          metadata: JSON.stringify({ files: ['a.ts', 'b.ts'] }),
        },
        score: 0.9,
        relevance: 'high',
      },
    ]

    const result = formatSearchResults(results)
    expect(result).toContain('Files')
    expect(result).toContain('a.ts')
    expect(result).toContain('b.ts')
  })
})
