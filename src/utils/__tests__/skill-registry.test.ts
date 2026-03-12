/**
 * @purpose Unit tests for skill registry management
 */

import * as fs from 'fs'
import { join } from 'path'
import {
  getProjectSkills,
  saveProjectSkills,
  initProjectSkills,
  listInstalledSkills,
  isSkillInstalled,
  removeSkill,
  getAvailableUpdates,
  isJflWorkspace,
} from '../skill-registry'
import type { ProjectSkills, SkillRegistry } from '../../types/skills'

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  rmSync: jest.fn(),
}))

const mockedFs = fs as jest.Mocked<typeof fs>

describe('getProjectSkills', () => {
  const originalCwd = process.cwd

  beforeEach(() => {
    jest.clearAllMocks()
    process.cwd = jest.fn(() => '/test/project')
  })

  afterEach(() => {
    process.cwd = originalCwd
  })

  it('returns null when skills file does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false)
    const result = getProjectSkills()
    expect(result).toBeNull()
    expect(mockedFs.existsSync).toHaveBeenCalledWith('/test/project/.jfl/skills.json')
  })

  it('returns parsed skills when file exists', () => {
    const mockSkills: ProjectSkills = {
      installed: {
        'test-skill': {
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00Z',
          source: 'core',
        },
      },
      registryUrl: 'https://example.com/registry.json',
      lastUpdate: '2026-01-01T00:00:00Z',
    }

    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(mockSkills))

    const result = getProjectSkills()
    expect(result).toEqual(mockSkills)
  })

  it('returns null when file contains invalid JSON', () => {
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue('{ invalid json }')

    const result = getProjectSkills()
    expect(result).toBeNull()
  })

  it('returns null when readFileSync throws', () => {
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error('EACCES')
    })

    const result = getProjectSkills()
    expect(result).toBeNull()
  })
})

describe('saveProjectSkills', () => {
  const originalCwd = process.cwd

  beforeEach(() => {
    jest.clearAllMocks()
    process.cwd = jest.fn(() => '/test/project')
  })

  afterEach(() => {
    process.cwd = originalCwd
  })

  it('creates .jfl directory if it does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false)

    const skills: ProjectSkills = {
      installed: {},
      registryUrl: 'https://example.com',
      lastUpdate: '2026-01-01T00:00:00Z',
    }

    saveProjectSkills(skills)

    expect(mockedFs.mkdirSync).toHaveBeenCalledWith('/test/project/.jfl', { recursive: true })
  })

  it('does not create directory if it exists', () => {
    mockedFs.existsSync.mockReturnValue(true)

    const skills: ProjectSkills = {
      installed: {},
      registryUrl: 'https://example.com',
      lastUpdate: '2026-01-01T00:00:00Z',
    }

    saveProjectSkills(skills)

    expect(mockedFs.mkdirSync).not.toHaveBeenCalled()
  })

  it('writes skills to file with proper formatting', () => {
    mockedFs.existsSync.mockReturnValue(true)

    const skills: ProjectSkills = {
      installed: { 'test-skill': { version: '1.0.0', installedAt: '2026-01-01', source: 'core' } },
      registryUrl: 'https://example.com',
      lastUpdate: '2026-01-01T00:00:00Z',
    }

    saveProjectSkills(skills)

    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      '/test/project/.jfl/skills.json',
      JSON.stringify(skills, null, 2) + '\n'
    )
  })
})

describe('initProjectSkills', () => {
  const originalCwd = process.cwd

  beforeEach(() => {
    jest.clearAllMocks()
    process.cwd = jest.fn(() => '/test/project')
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-03-11T12:00:00Z'))
  })

  afterEach(() => {
    process.cwd = originalCwd
    jest.useRealTimers()
  })

  it('returns existing skills if present', () => {
    const existing: ProjectSkills = {
      installed: { 'existing-skill': { version: '2.0.0', installedAt: '2025-01-01', source: 'catalog' } },
      registryUrl: 'https://custom.registry.com',
      lastUpdate: '2025-01-01T00:00:00Z',
    }

    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(existing))

    const result = initProjectSkills()
    expect(result).toEqual(existing)
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled()
  })

  it('creates new skills config if none exists', () => {
    mockedFs.existsSync.mockImplementation((path) => {
      // First call checks skills file existence
      if (path === '/test/project/.jfl/skills.json') return false
      // Second call checks .jfl dir existence
      return false
    })

    const result = initProjectSkills()

    expect(result.installed).toEqual({})
    expect(result.registryUrl).toContain('githubusercontent.com')
    expect(result.lastUpdate).toBe('2026-03-11T12:00:00.000Z')
    expect(mockedFs.writeFileSync).toHaveBeenCalled()
  })
})

describe('listInstalledSkills', () => {
  const originalCwd = process.cwd

  beforeEach(() => {
    jest.clearAllMocks()
    process.cwd = jest.fn(() => '/test/project')
  })

  afterEach(() => {
    process.cwd = originalCwd
  })

  it('returns installed skills when present', () => {
    const skills: ProjectSkills = {
      installed: {
        'skill-a': { version: '1.0.0', installedAt: '2026-01-01', source: 'core' },
        'skill-b': { version: '2.0.0', installedAt: '2026-01-02', source: 'catalog' },
      },
      registryUrl: 'https://example.com',
      lastUpdate: '2026-01-02T00:00:00Z',
    }

    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(skills))

    const result = listInstalledSkills()
    expect(result).toEqual(skills.installed)
  })

  it('returns empty object when no skills file', () => {
    mockedFs.existsSync.mockReturnValue(false)

    const result = listInstalledSkills()
    expect(result).toEqual({})
  })
})

describe('isSkillInstalled', () => {
  const originalCwd = process.cwd

  beforeEach(() => {
    jest.clearAllMocks()
    process.cwd = jest.fn(() => '/test/project')
  })

  afterEach(() => {
    process.cwd = originalCwd
  })

  it('returns true when skill is installed', () => {
    const skills: ProjectSkills = {
      installed: {
        'my-skill': { version: '1.0.0', installedAt: '2026-01-01', source: 'core' },
      },
      registryUrl: 'https://example.com',
      lastUpdate: '2026-01-01T00:00:00Z',
    }

    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(skills))

    expect(isSkillInstalled('my-skill')).toBe(true)
  })

  it('returns false when skill is not installed', () => {
    const skills: ProjectSkills = {
      installed: {},
      registryUrl: 'https://example.com',
      lastUpdate: '2026-01-01T00:00:00Z',
    }

    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(skills))

    expect(isSkillInstalled('nonexistent')).toBe(false)
  })

  it('returns false when no skills file exists', () => {
    mockedFs.existsSync.mockReturnValue(false)

    expect(isSkillInstalled('any-skill')).toBe(false)
  })
})

describe('removeSkill', () => {
  const originalCwd = process.cwd

  beforeEach(() => {
    jest.clearAllMocks()
    process.cwd = jest.fn(() => '/test/project')
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-03-11T12:00:00Z'))
  })

  afterEach(() => {
    process.cwd = originalCwd
    jest.useRealTimers()
  })

  it('removes skill directory if it exists', () => {
    mockedFs.existsSync.mockImplementation((path) => {
      if (path === '/test/project/skills/test-skill') return true
      if (path === '/test/project/.jfl/skills.json') return true
      if (path === '/test/project/.jfl') return true
      return false
    })

    const skills: ProjectSkills = {
      installed: {
        'test-skill': { version: '1.0.0', installedAt: '2026-01-01', source: 'core' },
      },
      registryUrl: 'https://example.com',
      lastUpdate: '2026-01-01T00:00:00Z',
    }
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(skills))

    removeSkill('test-skill')

    expect(mockedFs.rmSync).toHaveBeenCalledWith('/test/project/skills/test-skill', { recursive: true, force: true })
  })

  it('updates project skills after removal', () => {
    mockedFs.existsSync.mockImplementation((path) => {
      if (path === '/test/project/skills/test-skill') return false
      if (path === '/test/project/.jfl/skills.json') return true
      if (path === '/test/project/.jfl') return true
      return false
    })

    const skills: ProjectSkills = {
      installed: {
        'test-skill': { version: '1.0.0', installedAt: '2026-01-01', source: 'core' },
        'other-skill': { version: '2.0.0', installedAt: '2026-01-02', source: 'catalog' },
      },
      registryUrl: 'https://example.com',
      lastUpdate: '2026-01-01T00:00:00Z',
    }
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(skills))

    removeSkill('test-skill')

    const writeCall = mockedFs.writeFileSync.mock.calls[0]
    const writtenSkills = JSON.parse(writeCall[1] as string)
    expect(writtenSkills.installed['test-skill']).toBeUndefined()
    expect(writtenSkills.installed['other-skill']).toBeDefined()
    expect(writtenSkills.lastUpdate).toBe('2026-03-11T12:00:00.000Z')
  })

  it('handles removing non-existent skill gracefully', () => {
    mockedFs.existsSync.mockReturnValue(false)

    // Should not throw
    expect(() => removeSkill('nonexistent')).not.toThrow()
  })
})

describe('getAvailableUpdates', () => {
  const originalCwd = process.cwd

  beforeEach(() => {
    jest.clearAllMocks()
    process.cwd = jest.fn(() => '/test/project')
  })

  afterEach(() => {
    process.cwd = originalCwd
  })

  it('returns updates for outdated skills', async () => {
    const skills: ProjectSkills = {
      installed: {
        'skill-a': { version: '1.0.0', installedAt: '2026-01-01', source: 'core' },
        'skill-b': { version: '1.5.0', installedAt: '2026-01-01', source: 'core' },
      },
      registryUrl: 'https://example.com',
      lastUpdate: '2026-01-01T00:00:00Z',
    }

    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(skills))

    const registry: SkillRegistry = {
      version: '1.0.0',
      updated: '2026-01-01T00:00:00Z',
      skills: {
        'skill-a': {
          id: 'skill-a',
          name: 'Skill A',
          description: 'Test',
          version: '2.0.0',
          size: 1024,
          tags: ['test'],
          url: 'https://example.com/skill-a.tar.gz',
          checksum: 'sha256:abc',
          category: 'core',
        },
        'skill-b': {
          id: 'skill-b',
          name: 'Skill B',
          description: 'Test',
          version: '1.5.0', // Same version - no update
          size: 1024,
          tags: ['test'],
          url: 'https://example.com/skill-b.tar.gz',
          checksum: 'sha256:def',
          category: 'core',
        },
      },
    }

    const updates = await getAvailableUpdates(registry)

    expect(updates).toEqual([
      { skillId: 'skill-a', current: '1.0.0', latest: '2.0.0' },
    ])
  })

  it('returns empty array when all skills are up to date', async () => {
    const skills: ProjectSkills = {
      installed: {
        'skill-a': { version: '2.0.0', installedAt: '2026-01-01', source: 'core' },
      },
      registryUrl: 'https://example.com',
      lastUpdate: '2026-01-01T00:00:00Z',
    }

    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(skills))

    const registry: SkillRegistry = {
      version: '1.0.0',
      updated: '2026-01-01T00:00:00Z',
      skills: {
        'skill-a': {
          id: 'skill-a',
          name: 'Skill A',
          description: 'Test',
          version: '2.0.0',
          size: 1024,
          tags: ['test'],
          url: 'https://example.com/skill-a.tar.gz',
          checksum: 'sha256:abc',
          category: 'core',
        },
      },
    }

    const updates = await getAvailableUpdates(registry)
    expect(updates).toEqual([])
  })

  it('returns empty array when no skills are installed', async () => {
    mockedFs.existsSync.mockReturnValue(false)

    const registry: SkillRegistry = {
      version: '1.0.0',
      updated: '2026-01-01T00:00:00Z',
      skills: {},
    }

    const updates = await getAvailableUpdates(registry)
    expect(updates).toEqual([])
  })

  it('ignores skills not in registry', async () => {
    const skills: ProjectSkills = {
      installed: {
        'local-skill': { version: '1.0.0', installedAt: '2026-01-01', source: 'core' },
      },
      registryUrl: 'https://example.com',
      lastUpdate: '2026-01-01T00:00:00Z',
    }

    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(skills))

    const registry: SkillRegistry = {
      version: '1.0.0',
      updated: '2026-01-01T00:00:00Z',
      skills: {},
    }

    const updates = await getAvailableUpdates(registry)
    expect(updates).toEqual([])
  })
})

describe('isJflWorkspace', () => {
  const originalCwd = process.cwd

  beforeEach(() => {
    jest.clearAllMocks()
    process.cwd = jest.fn(() => '/test/project')
  })

  afterEach(() => {
    process.cwd = originalCwd
  })

  it('returns true when .jfl directory exists', () => {
    mockedFs.existsSync.mockImplementation((path) => {
      return path === '/test/project/.jfl'
    })

    expect(isJflWorkspace()).toBe(true)
  })

  it('returns true when CLAUDE.md exists', () => {
    mockedFs.existsSync.mockImplementation((path) => {
      return path === '/test/project/CLAUDE.md'
    })

    expect(isJflWorkspace()).toBe(true)
  })

  it('returns true when both exist', () => {
    mockedFs.existsSync.mockReturnValue(true)

    expect(isJflWorkspace()).toBe(true)
  })

  it('returns false when neither exists', () => {
    mockedFs.existsSync.mockReturnValue(false)

    expect(isJflWorkspace()).toBe(false)
  })
})
