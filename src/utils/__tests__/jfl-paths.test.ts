/**
 * @purpose Test JFL path utilities — XDG compliance, migration detection, dir creation
 */

const mockExistsSync = jest.fn()
const mockMkdirSync = jest.fn()

jest.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
}))

import {
  JFL_PATHS,
  JFL_FILES,
  hasLegacyJflDir,
  getMigrationStatus,
  ensureJflDirs,
  getProjectJflDir,
  getProjectJflFile,
} from '../jfl-paths'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('JFL_PATHS', () => {
  it('has config, data, cache, and legacy paths', () => {
    expect(JFL_PATHS.config).toBeDefined()
    expect(JFL_PATHS.data).toBeDefined()
    expect(JFL_PATHS.cache).toBeDefined()
    expect(JFL_PATHS.legacy).toBeDefined()
  })

  it('config path ends with /jfl', () => {
    expect(JFL_PATHS.config).toMatch(/jfl$/)
  })

  it('data path ends with /jfl', () => {
    expect(JFL_PATHS.data).toMatch(/jfl$/)
  })

  it('cache path ends with /jfl', () => {
    expect(JFL_PATHS.cache).toMatch(/jfl$/)
  })

  it('legacy path is ~/.jfl', () => {
    expect(JFL_PATHS.legacy).toMatch(/\.jfl$/)
  })

  it('all paths are absolute', () => {
    expect(JFL_PATHS.config).toMatch(/^\//)
    expect(JFL_PATHS.data).toMatch(/^\//)
    expect(JFL_PATHS.cache).toMatch(/^\//)
    expect(JFL_PATHS.legacy).toMatch(/^\//)
  })
})

describe('JFL_FILES', () => {
  it('config file is under config path', () => {
    expect(JFL_FILES.config).toContain(JFL_PATHS.config)
    expect(JFL_FILES.config).toMatch(/config\.json$/)
  })

  it('auth file is under config path', () => {
    expect(JFL_FILES.auth).toContain(JFL_PATHS.config)
    expect(JFL_FILES.auth).toMatch(/auth\.json$/)
  })

  it('sessions file is under data path', () => {
    expect(JFL_FILES.sessions).toContain(JFL_PATHS.data)
  })

  it('services registry is under data path', () => {
    expect(JFL_FILES.servicesRegistry).toContain(JFL_PATHS.data)
    expect(JFL_FILES.servicesRegistry).toMatch(/registry\.json$/)
  })

  it('telemetry queue is under cache path', () => {
    expect(JFL_FILES.telemetryQueue).toContain(JFL_PATHS.cache)
  })

  it('telemetry archive is under data path', () => {
    expect(JFL_FILES.telemetryArchive).toContain(JFL_PATHS.data)
  })
})

describe('hasLegacyJflDir', () => {
  it('returns true when legacy dir exists', () => {
    mockExistsSync.mockReturnValue(true)
    expect(hasLegacyJflDir()).toBe(true)
  })

  it('returns false when legacy dir does not exist', () => {
    mockExistsSync.mockReturnValue(false)
    expect(hasLegacyJflDir()).toBe(false)
  })
})

describe('getMigrationStatus', () => {
  it('returns "none" when neither legacy nor new exists', () => {
    mockExistsSync.mockReturnValue(false)
    expect(getMigrationStatus()).toBe('none')
  })

  it('returns "needed" when legacy exists but new does not', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === JFL_PATHS.legacy) return true
      if (p === JFL_PATHS.config) return false
      return false
    })
    expect(getMigrationStatus()).toBe('needed')
  })

  it('returns "complete" when new config exists (regardless of legacy)', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === JFL_PATHS.legacy) return true
      if (p === JFL_PATHS.config) return true
      return false
    })
    expect(getMigrationStatus()).toBe('complete')
  })

  it('returns "complete" when only new config exists', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p === JFL_PATHS.legacy) return false
      if (p === JFL_PATHS.config) return true
      return false
    })
    expect(getMigrationStatus()).toBe('complete')
  })
})

describe('ensureJflDirs', () => {
  it('creates all directories when none exist', () => {
    mockExistsSync.mockReturnValue(false)
    ensureJflDirs()

    expect(mockMkdirSync).toHaveBeenCalledTimes(6)
    for (const call of mockMkdirSync.mock.calls) {
      expect(call[1]).toEqual({ recursive: true })
    }
  })

  it('skips directories that already exist', () => {
    mockExistsSync.mockReturnValue(true)
    ensureJflDirs()
    expect(mockMkdirSync).not.toHaveBeenCalled()
  })

  it('creates specific expected directories', () => {
    mockExistsSync.mockReturnValue(false)
    ensureJflDirs()

    const createdPaths = mockMkdirSync.mock.calls.map((c: any) => c[0])
    expect(createdPaths).toContain(JFL_PATHS.config)
    expect(createdPaths).toContain(JFL_PATHS.data)
    expect(createdPaths).toContain(JFL_PATHS.cache)
  })
})

describe('getProjectJflDir', () => {
  it('returns .jfl directory under project root', () => {
    expect(getProjectJflDir('/my/project')).toBe('/my/project/.jfl')
  })

  it('works with trailing slash', () => {
    const result = getProjectJflDir('/my/project')
    expect(result).not.toContain('//')
  })
})

describe('getProjectJflFile', () => {
  it('returns file path under .jfl directory', () => {
    expect(getProjectJflFile('/my/project', 'config.json')).toBe('/my/project/.jfl/config.json')
  })

  it('handles nested filenames', () => {
    expect(getProjectJflFile('/root', 'journal/main.jsonl')).toBe('/root/.jfl/journal/main.jsonl')
  })
})
