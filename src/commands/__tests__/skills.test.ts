/**
 * @purpose Tests for jfl skills command handlers
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
  chalk.blue = passthrough
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

jest.mock('inquirer', () => ({
  prompt: jest.fn().mockResolvedValue({ confirm: true }),
}))

const mockRegistry = {
  version: '1.0.0',
  skills: {
    'test-skill': {
      name: 'test-skill',
      description: 'A test skill',
      version: '1.0.0',
      category: 'catalog',
      tags: ['test', 'demo'],
      size: 1024,
    },
    'another-skill': {
      name: 'another-skill',
      description: 'Another skill for testing',
      version: '2.0.0',
      category: 'core',
      tags: ['core', 'essential'],
      size: 2048,
    },
    hud: {
      name: 'hud',
      description: 'Project dashboard',
      version: '1.0.0',
      category: 'core',
      tags: ['dashboard'],
      size: 512,
    },
  },
}

jest.mock('../../utils/skill-registry', () => ({
  fetchRegistry: jest.fn().mockResolvedValue(mockRegistry),
  listInstalledSkills: jest.fn().mockReturnValue({}),
  isSkillInstalled: jest.fn().mockReturnValue(false),
  installSkill: jest.fn().mockResolvedValue(undefined),
  removeSkill: jest.fn(),
  getAvailableUpdates: jest.fn().mockResolvedValue([]),
  isJflWorkspace: jest.fn().mockReturnValue(true),
}))

let logOutput: string[]

beforeEach(() => {
  jest.clearAllMocks()
  logOutput = []
  jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    logOutput.push(args.join(' '))
  })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  // Reset mocks to default values
  const { isJflWorkspace, listInstalledSkills, isSkillInstalled, getAvailableUpdates } = require('../../utils/skill-registry')
  isJflWorkspace.mockReturnValue(true)
  listInstalledSkills.mockReturnValue({})
  isSkillInstalled.mockReturnValue(false)
  getAvailableUpdates.mockResolvedValue([])
})

afterAll(() => {
  jest.restoreAllMocks()
})

function getOutput() {
  return logOutput.join('\n')
}

describe('listSkillsCommand', () => {
  let listSkillsCommand: any

  beforeAll(async () => {
    const mod = await import('../skills')
    listSkillsCommand = mod.listSkillsCommand
  })

  it('shows no skills installed message when empty', async () => {
    await listSkillsCommand()

    const out = getOutput()
    expect(out).toContain('Installed Skills')
    expect(out).toContain('No skills installed')
  })

  it('shows installed skills with version', async () => {
    const { listInstalledSkills } = require('../../utils/skill-registry')
    listInstalledSkills.mockReturnValue({
      'test-skill': { version: '1.0.0' },
    })

    await listSkillsCommand()

    const out = getOutput()
    expect(out).toContain('test-skill')
    expect(out).toContain('1.0.0')
    expect(out).toContain('A test skill')
  })

  it('shows update available indicator', async () => {
    const { listInstalledSkills } = require('../../utils/skill-registry')
    listInstalledSkills.mockReturnValue({
      'test-skill': { version: '0.9.0' },
    })

    await listSkillsCommand()

    const out = getOutput()
    expect(out).toContain('0.9.0')
    expect(out).toContain('1.0.0')
  })

  it('shows available skills with --available flag', async () => {
    await listSkillsCommand({ available: true })

    const out = getOutput()
    expect(out).toContain('Available Skills')
    expect(out).toContain('test-skill')
    expect(out).toContain('another-skill')
  })

  it('filters by category when provided', async () => {
    await listSkillsCommand({ available: true, category: 'core' })

    const out = getOutput()
    expect(out).toContain('another-skill')
    expect(out).toContain('hud')
  })

  it('filters by tag when provided', async () => {
    await listSkillsCommand({ available: true, tag: 'test' })

    const out = getOutput()
    expect(out).toContain('test-skill')
  })

  it('shows error when not in JFL workspace', async () => {
    const { isJflWorkspace } = require('../../utils/skill-registry')
    isJflWorkspace.mockReturnValue(false)

    await listSkillsCommand()

    const out = getOutput()
    expect(out).toContain('Not a JFL workspace')
  })

  it('marks core skills with [core] label', async () => {
    const { listInstalledSkills } = require('../../utils/skill-registry')
    listInstalledSkills.mockReturnValue({
      hud: { version: '1.0.0' },
    })

    await listSkillsCommand()

    const out = getOutput()
    expect(out).toContain('[core]')
  })
})

describe('installSkillCommand', () => {
  let installSkillCommand: any

  beforeAll(async () => {
    const mod = await import('../skills')
    installSkillCommand = mod.installSkillCommand
  })

  it('shows usage when no skill names provided', async () => {
    await installSkillCommand([])

    const out = getOutput()
    expect(out).toContain('Usage')
    expect(out).toContain('jfl skills install')
  })

  it('installs a skill successfully', async () => {
    const { installSkill } = require('../../utils/skill-registry')

    await installSkillCommand(['test-skill'])

    expect(installSkill).toHaveBeenCalledWith(
      'test-skill',
      mockRegistry.skills['test-skill'],
      undefined
    )
    const out = getOutput()
    expect(out).toContain('All skills installed')
  })

  it('shows error for unknown skill', async () => {
    await installSkillCommand(['nonexistent'])

    const out = getOutput()
    expect(out).toContain('not found in registry')
  })

  it('shows warning if skill already installed', async () => {
    const { isSkillInstalled } = require('../../utils/skill-registry')
    isSkillInstalled.mockReturnValue(true)

    await installSkillCommand(['test-skill'])

    const out = getOutput()
    expect(out).toContain('already installed')
  })

  it('installs multiple skills', async () => {
    const { installSkill, isSkillInstalled } = require('../../utils/skill-registry')
    isSkillInstalled.mockReturnValue(false)

    await installSkillCommand(['test-skill', 'another-skill'])

    expect(installSkill).toHaveBeenCalledTimes(2)
  })

  it('parses version from skill@version format', async () => {
    const { installSkill, isSkillInstalled } = require('../../utils/skill-registry')
    isSkillInstalled.mockReturnValue(false)

    await installSkillCommand(['test-skill@0.9.0'])

    expect(installSkill).toHaveBeenCalledWith(
      'test-skill',
      mockRegistry.skills['test-skill'],
      '0.9.0'
    )
  })

  it('shows error when not in JFL workspace', async () => {
    const { isJflWorkspace } = require('../../utils/skill-registry')
    isJflWorkspace.mockReturnValue(false)

    await installSkillCommand(['test-skill'])

    const out = getOutput()
    expect(out).toContain('Not a JFL workspace')
  })
})

describe('removeSkillCommand', () => {
  let removeSkillCommand: any

  beforeAll(async () => {
    const mod = await import('../skills')
    removeSkillCommand = mod.removeSkillCommand
  })

  it('shows usage when no skill names provided', async () => {
    await removeSkillCommand([])

    const out = getOutput()
    expect(out).toContain('Usage')
    expect(out).toContain('jfl skills remove')
  })

  it('removes installed skill', async () => {
    const { removeSkill, isSkillInstalled } = require('../../utils/skill-registry')
    isSkillInstalled.mockReturnValue(true)

    await removeSkillCommand(['test-skill'])

    expect(removeSkill).toHaveBeenCalledWith('test-skill')
  })

  it('prevents removal of core skills', async () => {
    await removeSkillCommand(['hud'])

    const out = getOutput()
    expect(out).toContain('Cannot remove core skill')
  })

  it('shows warning if skill not installed', async () => {
    const { isSkillInstalled } = require('../../utils/skill-registry')
    isSkillInstalled.mockReturnValue(false)

    await removeSkillCommand(['test-skill'])

    const out = getOutput()
    expect(out).toContain('not installed')
  })

  it('shows error when not in JFL workspace', async () => {
    const { isJflWorkspace } = require('../../utils/skill-registry')
    isJflWorkspace.mockReturnValue(false)

    await removeSkillCommand(['test-skill'])

    const out = getOutput()
    expect(out).toContain('Not a JFL workspace')
  })
})

describe('updateSkillsCommand', () => {
  let updateSkillsCommand: any

  beforeAll(async () => {
    const mod = await import('../skills')
    updateSkillsCommand = mod.updateSkillsCommand
  })

  it('shows all up to date when no updates', async () => {
    await updateSkillsCommand()

    const out = getOutput()
    expect(out).toContain('All skills are up to date')
  })

  it('shows available updates', async () => {
    const { getAvailableUpdates } = require('../../utils/skill-registry')
    getAvailableUpdates.mockResolvedValue([
      { skillId: 'test-skill', current: '0.9.0', latest: '1.0.0' },
    ])

    await updateSkillsCommand({ dry: true })

    const out = getOutput()
    expect(out).toContain('Available Updates')
    expect(out).toContain('test-skill')
    expect(out).toContain('0.9.0')
    expect(out).toContain('1.0.0')
  })

  it('performs update when confirmed', async () => {
    const { getAvailableUpdates, removeSkill, installSkill } = require('../../utils/skill-registry')
    getAvailableUpdates.mockResolvedValue([
      { skillId: 'test-skill', current: '0.9.0', latest: '1.0.0' },
    ])

    await updateSkillsCommand()

    expect(removeSkill).toHaveBeenCalledWith('test-skill')
    expect(installSkill).toHaveBeenCalled()
  })

  it('filters updates by skill name', async () => {
    const { getAvailableUpdates } = require('../../utils/skill-registry')
    getAvailableUpdates.mockResolvedValue([
      { skillId: 'test-skill', current: '0.9.0', latest: '1.0.0' },
      { skillId: 'another-skill', current: '1.9.0', latest: '2.0.0' },
    ])

    await updateSkillsCommand({ dry: true, skillName: 'test-skill' })

    const out = getOutput()
    expect(out).toContain('test-skill')
    expect(out).not.toContain('another-skill')
  })

  it('shows error when not in JFL workspace', async () => {
    const { isJflWorkspace } = require('../../utils/skill-registry')
    isJflWorkspace.mockReturnValue(false)

    await updateSkillsCommand()

    const out = getOutput()
    expect(out).toContain('Not a JFL workspace')
  })
})

describe('searchSkillsCommand', () => {
  let searchSkillsCommand: any

  beforeAll(async () => {
    const mod = await import('../skills')
    searchSkillsCommand = mod.searchSkillsCommand
  })

  it('searches skills by name', async () => {
    await searchSkillsCommand('test')

    const out = getOutput()
    expect(out).toContain('Search Results')
    expect(out).toContain('test-skill')
  })

  it('searches skills by description', async () => {
    await searchSkillsCommand('testing')

    const out = getOutput()
    expect(out).toContain('another-skill')
  })

  it('searches skills by tag', async () => {
    await searchSkillsCommand('dashboard')

    const out = getOutput()
    expect(out).toContain('hud')
  })

  it('shows no results message when not found', async () => {
    await searchSkillsCommand('nonexistent')

    const out = getOutput()
    expect(out).toContain('No skills found')
  })

  it('shows installed status in results', async () => {
    const { listInstalledSkills } = require('../../utils/skill-registry')
    listInstalledSkills.mockReturnValue({
      'test-skill': { version: '1.0.0' },
    })

    await searchSkillsCommand('test')

    const out = getOutput()
    expect(out).toContain('✓')
  })

  it('shows error when not in JFL workspace', async () => {
    const { isJflWorkspace } = require('../../utils/skill-registry')
    isJflWorkspace.mockReturnValue(false)

    await searchSkillsCommand('test')

    const out = getOutput()
    expect(out).toContain('Not a JFL workspace')
  })
})
