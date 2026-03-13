/**
 * @purpose Tests for jfl status command
 */

import * as fs from 'fs'
import * as path from 'path'

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
  chalk.white = passthrough
  return { default: chalk, __esModule: true }
})

jest.mock('fs')
jest.mock('../login', () => ({
  isAuthenticated: jest.fn().mockReturnValue(false),
  getAuthMethod: jest.fn().mockReturnValue(null),
  getToken: jest.fn().mockReturnValue(null),
  getX402Address: jest.fn().mockReturnValue(null),
  getUser: jest.fn().mockReturnValue(null),
}))
jest.mock('../../utils/ensure-project', () => ({
  ensureInProject: jest.fn().mockResolvedValue(true),
}))
jest.mock('../../utils/ensure-context-hub', () => ({
  getContextHubConfig: jest.fn().mockReturnValue({ mode: 'local', port: 3410 }),
}))
jest.mock('../context-hub', () => ({
  isRunning: jest.fn().mockReturnValue({ running: false, pid: null }),
}))

const mockFs = fs as jest.Mocked<typeof fs>

let logOutput: string[]

beforeEach(() => {
  jest.clearAllMocks()
  logOutput = []
  jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    logOutput.push(args.join(' '))
  })
  // Default process.cwd mock
  jest.spyOn(process, 'cwd').mockReturnValue('/test/project')
})

afterAll(() => {
  jest.restoreAllMocks()
})

function getOutput() {
  return logOutput.join('\n')
}

function setupBasicProject() {
  mockFs.existsSync.mockImplementation((p: any) => {
    const s = String(p)
    if (s.endsWith('.git')) return true
    if (s.includes('knowledge')) return true
    if (s.includes('skills')) return false
    if (s.endsWith('package.json')) return true
    return false
  })
  mockFs.readFileSync.mockImplementation((p: any) => {
    const s = String(p)
    if (s.endsWith('package.json')) {
      return JSON.stringify({ name: 'test-project' })
    }
    return ''
  })
}

describe('statusCommand', () => {
  let statusCommand: any

  beforeAll(async () => {
    const mod = await import('../status')
    statusCommand = mod.statusCommand
  })

  it('displays project status header', async () => {
    setupBasicProject()
    await statusCommand()

    const out = getOutput()
    expect(out).toContain('JFL - Project Status')
  })

  it('shows project name from package.json', async () => {
    setupBasicProject()
    await statusCommand()

    const out = getOutput()
    expect(out).toContain('test-project')
    expect(out).toContain('Project')
  })

  it('shows git status when .git exists', async () => {
    setupBasicProject()
    await statusCommand()

    const out = getOutput()
    expect(out).toContain('Git')
    expect(out).toContain('✓')
  })

  it('shows git not available when .git missing', async () => {
    mockFs.existsSync.mockImplementation((p: any) => {
      const s = String(p)
      if (s.endsWith('.git')) return false
      if (s.endsWith('package.json')) return true
      return false
    })
    mockFs.readFileSync.mockImplementation((p: any) => {
      if (String(p).endsWith('package.json')) {
        return JSON.stringify({ name: 'test' })
      }
      return ''
    })

    await statusCommand()

    const out = getOutput()
    expect(out).toContain('Git')
    expect(out).toContain('✗')
  })

  it('shows not authenticated when logged out', async () => {
    setupBasicProject()
    await statusCommand()

    const out = getOutput()
    expect(out).toContain('Authentication')
    expect(out).toContain('Not authenticated')
  })

  it('shows GitHub auth when authenticated via GitHub', async () => {
    const loginMock = require('../login')
    loginMock.isAuthenticated.mockReturnValue(true)
    loginMock.getAuthMethod.mockReturnValue('github')
    loginMock.getUser.mockReturnValue({ name: 'testuser', tier: 'PRO' })

    setupBasicProject()
    await statusCommand()

    const out = getOutput()
    expect(out).toContain('GitHub')
    expect(out).toContain('PRO')
  })

  it('shows x402 auth when authenticated via wallet', async () => {
    const loginMock = require('../login')
    loginMock.isAuthenticated.mockReturnValue(true)
    loginMock.getAuthMethod.mockReturnValue('x402')
    loginMock.getX402Address.mockReturnValue('0x1234567890abcdef1234567890abcdef12345678')

    setupBasicProject()
    await statusCommand()

    const out = getOutput()
    expect(out).toContain('x402 Wallet')
    expect(out).toContain('$5/day')
  })

  it('shows knowledge layer status', async () => {
    setupBasicProject()
    await statusCommand()

    const out = getOutput()
    expect(out).toContain('Knowledge Layer')
    expect(out).toContain('VISION.md')
    expect(out).toContain('ROADMAP.md')
    expect(out).toContain('NARRATIVE.md')
  })

  it('shows context hub not running', async () => {
    setupBasicProject()
    await statusCommand()

    const out = getOutput()
    expect(out).toContain('Context Hub')
    expect(out).toContain('Not running')
  })

  it('shows context hub running when active', async () => {
    const contextHubMock = require('../context-hub')
    contextHubMock.isRunning.mockReturnValue({ running: true, pid: 12345 })

    setupBasicProject()
    await statusCommand()

    const out = getOutput()
    expect(out).toContain('Context Hub')
    expect(out).toContain('Running')
    expect(out).toContain('12345')
  })

  it('shows quick actions section', async () => {
    setupBasicProject()
    await statusCommand()

    const out = getOutput()
    expect(out).toContain('Quick Actions')
    expect(out).toContain('jfl hud')
    expect(out).toContain('jfl login')
  })

  it('shows platform features section', async () => {
    setupBasicProject()
    await statusCommand()

    const out = getOutput()
    expect(out).toContain('Platform Features')
    expect(out).toContain('Local toolkit')
    expect(out).toContain('Git collaboration')
  })

  it('returns early when not in project', async () => {
    const ensureProjectMock = require('../../utils/ensure-project')
    ensureProjectMock.ensureInProject.mockResolvedValue(false)

    await statusCommand()

    const out = getOutput()
    expect(out).not.toContain('Knowledge Layer')
  })

  it('falls back to directory name when no package.json', async () => {
    const ensureProjectMock = require('../../utils/ensure-project')
    ensureProjectMock.ensureInProject.mockResolvedValue(true)

    mockFs.existsSync.mockImplementation((p: any) => {
      const s = String(p)
      if (s.endsWith('package.json')) return false
      if (s.endsWith('.git')) return true
      if (s.includes('knowledge')) return false
      if (s.includes('skills')) return false
      return false
    })
    mockFs.readFileSync.mockImplementation(() => '')

    jest.spyOn(process, 'cwd').mockReturnValue('/test/my-project')

    await statusCommand()

    const out = getOutput()
    // The directory name is derived from the path
    expect(out).toContain('my-project')
  })
})
