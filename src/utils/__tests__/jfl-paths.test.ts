/**
 * Tests for jfl-paths utility
 *
 * @purpose Verify XDG-compliant path management and migration status detection
 */

import * as fs from 'fs'
import * as path from 'path'
import { tmpdir } from 'os'
import {
  JFL_PATHS,
  JFL_FILES,
  hasLegacyJflDir,
  getMigrationStatus,
  ensureJflDirs,
  getProjectJflDir,
  getProjectJflFile,
} from '../jfl-paths.js'

// Mock fs module
jest.mock('fs')

const mockFs = fs as jest.Mocked<typeof fs>

describe('jfl-paths', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('JFL_PATHS constants', () => {
    it('should have config path defined', () => {
      expect(JFL_PATHS.config).toBeDefined()
      expect(typeof JFL_PATHS.config).toBe('string')
      expect(JFL_PATHS.config).toContain('jfl')
    })

    it('should have data path defined', () => {
      expect(JFL_PATHS.data).toBeDefined()
      expect(typeof JFL_PATHS.data).toBe('string')
      expect(JFL_PATHS.data).toContain('jfl')
    })

    it('should have cache path defined', () => {
      expect(JFL_PATHS.cache).toBeDefined()
      expect(typeof JFL_PATHS.cache).toBe('string')
      expect(JFL_PATHS.cache).toContain('jfl')
    })

    it('should have legacy path pointing to ~/.jfl', () => {
      expect(JFL_PATHS.legacy).toBeDefined()
      expect(JFL_PATHS.legacy).toContain('.jfl')
    })
  })

  describe('JFL_FILES constants', () => {
    it('should have config file path', () => {
      expect(JFL_FILES.config).toBeDefined()
      expect(JFL_FILES.config).toContain('config.json')
    })

    it('should have auth file path', () => {
      expect(JFL_FILES.auth).toBeDefined()
      expect(JFL_FILES.auth).toContain('auth.json')
    })

    it('should have services directory path', () => {
      expect(JFL_FILES.servicesDir).toBeDefined()
      expect(JFL_FILES.servicesDir).toContain('services')
    })

    it('should have telemetry queue path', () => {
      expect(JFL_FILES.telemetryQueue).toBeDefined()
      expect(JFL_FILES.telemetryQueue).toContain('telemetry-queue.jsonl')
    })

    it('should have update check path in cache', () => {
      expect(JFL_FILES.updateCheck).toBeDefined()
      expect(JFL_FILES.updateCheck).toContain('last-update-check')
    })
  })

  describe('hasLegacyJflDir', () => {
    it('should return true when legacy directory exists', () => {
      mockFs.existsSync.mockReturnValue(true)
      expect(hasLegacyJflDir()).toBe(true)
      expect(mockFs.existsSync).toHaveBeenCalledWith(JFL_PATHS.legacy)
    })

    it('should return false when legacy directory does not exist', () => {
      mockFs.existsSync.mockReturnValue(false)
      expect(hasLegacyJflDir()).toBe(false)
      expect(mockFs.existsSync).toHaveBeenCalledWith(JFL_PATHS.legacy)
    })
  })

  describe('getMigrationStatus', () => {
    it('should return "none" when neither legacy nor new dirs exist', () => {
      mockFs.existsSync.mockReturnValue(false)
      expect(getMigrationStatus()).toBe('none')
    })

    it('should return "needed" when only legacy exists', () => {
      mockFs.existsSync.mockImplementation((p) => {
        // Legacy exists, new config does not
        return p === JFL_PATHS.legacy
      })
      expect(getMigrationStatus()).toBe('needed')
    })

    it('should return "complete" when new config exists', () => {
      mockFs.existsSync.mockImplementation((p) => {
        // Both exist or only new exists
        return p === JFL_PATHS.config || p === JFL_PATHS.legacy
      })
      expect(getMigrationStatus()).toBe('complete')
    })

    it('should return "complete" when only new config exists', () => {
      mockFs.existsSync.mockImplementation((p) => {
        return p === JFL_PATHS.config
      })
      expect(getMigrationStatus()).toBe('complete')
    })
  })

  describe('ensureJflDirs', () => {
    it('should create directories that do not exist', () => {
      mockFs.existsSync.mockReturnValue(false)
      mockFs.mkdirSync.mockImplementation(() => undefined)

      ensureJflDirs()

      // Should have checked and created multiple directories
      expect(mockFs.existsSync).toHaveBeenCalled()
      expect(mockFs.mkdirSync).toHaveBeenCalled()
    })

    it('should not create directories that already exist', () => {
      mockFs.existsSync.mockReturnValue(true)

      ensureJflDirs()

      // Should have checked but not created
      expect(mockFs.existsSync).toHaveBeenCalled()
      expect(mockFs.mkdirSync).not.toHaveBeenCalled()
    })

    it('should create directories with recursive option', () => {
      mockFs.existsSync.mockReturnValue(false)
      mockFs.mkdirSync.mockImplementation(() => undefined)

      ensureJflDirs()

      // Verify recursive option is used
      const mkdirCalls = mockFs.mkdirSync.mock.calls
      expect(mkdirCalls.length).toBeGreaterThan(0)
      mkdirCalls.forEach((call) => {
        expect(call[1]).toEqual({ recursive: true })
      })
    })
  })

  describe('getProjectJflDir', () => {
    it('should return .jfl directory within project root', () => {
      const projectRoot = '/home/user/my-project'
      const result = getProjectJflDir(projectRoot)
      expect(result).toBe(path.join(projectRoot, '.jfl'))
    })

    it('should handle paths with trailing slash', () => {
      const projectRoot = '/home/user/my-project/'
      const result = getProjectJflDir(projectRoot)
      // path.join normalizes this
      expect(result).toContain('.jfl')
    })

    it('should work with Windows-style paths', () => {
      const projectRoot = 'C:\\Users\\user\\my-project'
      const result = getProjectJflDir(projectRoot)
      expect(result).toContain('.jfl')
    })
  })

  describe('getProjectJflFile', () => {
    it('should return file path within .jfl directory', () => {
      const projectRoot = '/home/user/my-project'
      const filename = 'config.json'
      const result = getProjectJflFile(projectRoot, filename)
      expect(result).toBe(path.join(projectRoot, '.jfl', filename))
    })

    it('should handle nested filenames', () => {
      const projectRoot = '/home/user/my-project'
      const filename = 'journal/session.jsonl'
      const result = getProjectJflFile(projectRoot, filename)
      expect(result).toBe(path.join(projectRoot, '.jfl', filename))
    })

    it('should work with different file extensions', () => {
      const projectRoot = '/tmp/test-project'

      expect(getProjectJflFile(projectRoot, 'data.json')).toContain('data.json')
      expect(getProjectJflFile(projectRoot, 'log.txt')).toContain('log.txt')
      expect(getProjectJflFile(projectRoot, 'archive.jsonl')).toContain('archive.jsonl')
    })
  })
})
