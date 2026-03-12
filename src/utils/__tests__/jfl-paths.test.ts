/**
 * @purpose Unit tests for JFL path management utilities
 */

import { JFL_PATHS, JFL_FILES, getProjectJflDir, getProjectJflFile, hasLegacyJflDir, getMigrationStatus } from '../jfl-paths'
import { homedir } from 'os'
import { join } from 'path'
import * as fs from 'fs'

// Mock fs and os modules
jest.mock('fs')
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/home/testuser'),
  platform: jest.fn(() => 'darwin'),
}))

const mockedFs = fs as jest.Mocked<typeof fs>
const mockedHomedir = homedir as jest.Mock

describe('JFL_PATHS', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Reset environment variables
    delete process.env.XDG_CONFIG_HOME
    delete process.env.XDG_DATA_HOME
    delete process.env.XDG_CACHE_HOME
  })

  it('has config path', () => {
    expect(JFL_PATHS.config).toBeDefined()
    expect(typeof JFL_PATHS.config).toBe('string')
    expect(JFL_PATHS.config).toContain('jfl')
  })

  it('has data path', () => {
    expect(JFL_PATHS.data).toBeDefined()
    expect(typeof JFL_PATHS.data).toBe('string')
    expect(JFL_PATHS.data).toContain('jfl')
  })

  it('has cache path', () => {
    expect(JFL_PATHS.cache).toBeDefined()
    expect(typeof JFL_PATHS.cache).toBe('string')
    expect(JFL_PATHS.cache).toContain('jfl')
  })

  it('has legacy path pointing to ~/.jfl', () => {
    expect(JFL_PATHS.legacy).toBeDefined()
    expect(JFL_PATHS.legacy).toContain('.jfl')
  })

  it('all paths are different', () => {
    const paths = [JFL_PATHS.config, JFL_PATHS.data, JFL_PATHS.cache, JFL_PATHS.legacy]
    const uniquePaths = new Set(paths)
    expect(uniquePaths.size).toBe(4)
  })
})

describe('JFL_FILES', () => {
  it('has config file path', () => {
    expect(JFL_FILES.config).toBeDefined()
    expect(JFL_FILES.config).toContain('config.json')
    expect(JFL_FILES.config).toContain(JFL_PATHS.config)
  })

  it('has auth file path', () => {
    expect(JFL_FILES.auth).toBeDefined()
    expect(JFL_FILES.auth).toContain('auth.json')
    expect(JFL_FILES.auth).toContain(JFL_PATHS.config)
  })

  it('has sessions file path', () => {
    expect(JFL_FILES.sessions).toBeDefined()
    expect(JFL_FILES.sessions).toContain('sessions.json')
    expect(JFL_FILES.sessions).toContain(JFL_PATHS.data)
  })

  it('has services directory path', () => {
    expect(JFL_FILES.servicesDir).toBeDefined()
    expect(JFL_FILES.servicesDir).toContain('services')
    expect(JFL_FILES.servicesDir).toContain(JFL_PATHS.data)
  })

  it('has services registry path', () => {
    expect(JFL_FILES.servicesRegistry).toBeDefined()
    expect(JFL_FILES.servicesRegistry).toContain('registry.json')
  })

  it('has services logs path', () => {
    expect(JFL_FILES.servicesLogs).toBeDefined()
    expect(JFL_FILES.servicesLogs).toContain('logs')
  })

  it('has services pids path', () => {
    expect(JFL_FILES.servicesPids).toBeDefined()
    expect(JFL_FILES.servicesPids).toContain('pids')
  })

  it('has update check cache path', () => {
    expect(JFL_FILES.updateCheck).toBeDefined()
    expect(JFL_FILES.updateCheck).toContain('last-update-check')
    expect(JFL_FILES.updateCheck).toContain(JFL_PATHS.cache)
  })

  it('has telemetry queue path', () => {
    expect(JFL_FILES.telemetryQueue).toBeDefined()
    expect(JFL_FILES.telemetryQueue).toContain('telemetry-queue.jsonl')
    expect(JFL_FILES.telemetryQueue).toContain(JFL_PATHS.cache)
  })

  it('has telemetry archive path', () => {
    expect(JFL_FILES.telemetryArchive).toBeDefined()
    expect(JFL_FILES.telemetryArchive).toContain('telemetry-archive.jsonl')
    expect(JFL_FILES.telemetryArchive).toContain(JFL_PATHS.data)
  })
})

describe('getProjectJflDir', () => {
  it('returns .jfl directory path for project root', () => {
    const projectRoot = '/home/user/my-project'
    const result = getProjectJflDir(projectRoot)
    expect(result).toBe('/home/user/my-project/.jfl')
  })

  it('handles trailing slash in project root', () => {
    const projectRoot = '/home/user/my-project'
    const result = getProjectJflDir(projectRoot)
    expect(result).toBe(join(projectRoot, '.jfl'))
  })

  it('works with windows-style paths', () => {
    const projectRoot = 'C:\\Users\\user\\project'
    const result = getProjectJflDir(projectRoot)
    expect(result).toContain('.jfl')
  })
})

describe('getProjectJflFile', () => {
  it('returns file path within project .jfl directory', () => {
    const projectRoot = '/home/user/my-project'
    const result = getProjectJflFile(projectRoot, 'config.json')
    expect(result).toBe('/home/user/my-project/.jfl/config.json')
  })

  it('handles nested filenames', () => {
    const projectRoot = '/home/user/my-project'
    const result = getProjectJflFile(projectRoot, 'journal/main.jsonl')
    expect(result).toBe(join(projectRoot, '.jfl', 'journal/main.jsonl'))
  })

  it('handles empty filename', () => {
    const projectRoot = '/home/user/my-project'
    const result = getProjectJflFile(projectRoot, '')
    expect(result).toBe(join(projectRoot, '.jfl', ''))
  })
})

describe('hasLegacyJflDir', () => {
  it('returns true when legacy directory exists', () => {
    mockedFs.existsSync.mockReturnValue(true)
    const result = hasLegacyJflDir()
    expect(result).toBe(true)
    expect(mockedFs.existsSync).toHaveBeenCalledWith(JFL_PATHS.legacy)
  })

  it('returns false when legacy directory does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false)
    const result = hasLegacyJflDir()
    expect(result).toBe(false)
  })
})

describe('getMigrationStatus', () => {
  it('returns "none" when neither legacy nor new directories exist', () => {
    mockedFs.existsSync.mockReturnValue(false)
    const result = getMigrationStatus()
    expect(result).toBe('none')
  })

  it('returns "needed" when legacy exists but new does not', () => {
    mockedFs.existsSync.mockImplementation((path: fs.PathLike) => {
      const pathStr = path.toString()
      if (pathStr === JFL_PATHS.legacy) return true
      if (pathStr === JFL_PATHS.config) return false
      return false
    })
    const result = getMigrationStatus()
    expect(result).toBe('needed')
  })

  it('returns "complete" when new directory exists', () => {
    mockedFs.existsSync.mockImplementation((path: fs.PathLike) => {
      const pathStr = path.toString()
      if (pathStr === JFL_PATHS.legacy) return true
      if (pathStr === JFL_PATHS.config) return true
      return false
    })
    const result = getMigrationStatus()
    expect(result).toBe('complete')
  })

  it('returns "complete" when only new directory exists (no legacy)', () => {
    mockedFs.existsSync.mockImplementation((path: fs.PathLike) => {
      const pathStr = path.toString()
      if (pathStr === JFL_PATHS.legacy) return false
      if (pathStr === JFL_PATHS.config) return true
      return false
    })
    const result = getMigrationStatus()
    expect(result).toBe('complete')
  })
})
