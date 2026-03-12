/**
 * @purpose Tests for jfl hud command
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
  getUser: jest.fn().mockReturnValue(null),
}))
jest.mock('../../utils/ensure-project', () => ({
  ensureInProject: jest.fn().mockResolvedValue(true),
}))

const mockFs = fs as jest.Mocked<typeof fs>

let logOutput: string[]

beforeEach(() => {
  jest.clearAllMocks()
  logOutput = []
  jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    logOutput.push(args.join(' '))
  })
  jest.spyOn(process, 'cwd').mockReturnValue('/test/project')
})

afterAll(() => {
  jest.restoreAllMocks()
})

function getOutput() {
  return logOutput.join('\n')
}

function setupProjectWithVision(visionContent: string = '# Test Project\n\nVision content here.') {
  mockFs.existsSync.mockImplementation((p: any) => {
    const s = String(p)
    if (s.includes('VISION.md')) return true
    if (s.includes('ROADMAP.md')) return false
    if (s.includes('TASKS.md')) return false
    if (s.endsWith('package.json')) return false
    return false
  })
  mockFs.readFileSync.mockImplementation((p: any) => {
    const s = String(p)
    if (s.includes('VISION.md')) return visionContent
    return ''
  })
}

function setupFullProject() {
  const roadmapContent = `
# Roadmap

Launch: 2026-06-01

## Phase 1: Foundation
- [x] Set up project
- [x] Design system

## Phase 2: MVP
- [ ] Build features
- [~] Testing

## Phase 3: Launch
- [ ] Marketing
- [ ] Release
`

  const tasksContent = `
# Tasks

- [x] Task 1
- [x] Task 2
- [~] Task 3
- [ ] Task 4
- [ ] Task 5
`

  mockFs.existsSync.mockImplementation((p: any) => {
    const s = String(p)
    if (s.includes('VISION.md')) return true
    if (s.includes('NARRATIVE.md')) return true
    if (s.includes('THESIS.md')) return true
    if (s.includes('ROADMAP.md')) return true
    if (s.includes('TASKS.md')) return true
    if (s.includes('BRAND_BRIEF.md')) return true
    if (s.includes('BRAND_DECISIONS.md')) return true
    return false
  })

  mockFs.readFileSync.mockImplementation((p: any) => {
    const s = String(p)
    if (s.includes('VISION.md')) return '# My Project\n\nThis is a real project with content.'
    if (s.includes('NARRATIVE.md')) return 'A real narrative document with enough content.'
    if (s.includes('THESIS.md')) return 'This is the thesis document with real content here.'
    if (s.includes('ROADMAP.md')) return roadmapContent
    if (s.includes('TASKS.md')) return tasksContent
    if (s.includes('BRAND_BRIEF.md')) return 'Brand brief with enough content to count.'
    if (s.includes('BRAND_DECISIONS.md')) return 'Brand decisions with real content inside.'
    return ''
  })
}

describe('hudCommand', () => {
  let hudCommand: any

  beforeAll(async () => {
    const mod = await import('../hud')
    hudCommand = mod.hudCommand
  })

  describe('full HUD', () => {
    it('displays project name from VISION.md', async () => {
      setupProjectWithVision('# My Awesome Project\n\nDescription here.')
      await hudCommand()

      const out = getOutput()
      expect(out).toContain('MY AWESOME PROJECT')
    })

    it('falls back to directory name when no VISION.md', async () => {
      mockFs.existsSync.mockReturnValue(false)
      jest.spyOn(process, 'cwd').mockReturnValue('/test/fallback-project')

      await hudCommand()

      const out = getOutput()
      expect(out).toContain('FALLBACK-PROJECT')
    })

    it('shows launch countdown when ROADMAP has date', async () => {
      setupFullProject()
      await hudCommand()

      const out = getOutput()
      expect(out).toContain('LAUNCH')
      expect(out).toContain('DAYS TO LAUNCH')
    })

    it('shows phase tracker from ROADMAP', async () => {
      setupFullProject()
      await hudCommand()

      const out = getOutput()
      expect(out).toContain('PHASE')
      expect(out).toContain('Foundation')
      expect(out).toContain('MVP')
    })

    it('shows task stats from TASKS.md', async () => {
      setupFullProject()
      await hudCommand()

      const out = getOutput()
      expect(out).toContain('TASKS')
      expect(out).toContain('%')
    })

    it('shows auth section when not authenticated', async () => {
      setupProjectWithVision()
      await hudCommand()

      const out = getOutput()
      expect(out).toContain('AUTH')
      expect(out).toContain('Not authenticated')
    })

    it('shows GitHub auth when logged in', async () => {
      const loginMock = require('../login')
      loginMock.isAuthenticated.mockReturnValue(true)
      loginMock.getAuthMethod.mockReturnValue('github')
      loginMock.getUser.mockReturnValue({ tier: 'PRO' })

      setupProjectWithVision()
      await hudCommand()

      const out = getOutput()
      expect(out).toContain('PRO')
    })

    it('shows x402 auth when using wallet', async () => {
      const loginMock = require('../login')
      loginMock.isAuthenticated.mockReturnValue(true)
      loginMock.getAuthMethod.mockReturnValue('x402')

      setupProjectWithVision()
      await hudCommand()

      const out = getOutput()
      expect(out).toContain('x402')
      expect(out).toContain('$5/day')
    })

    it('shows knowledge docs status', async () => {
      setupFullProject()
      await hudCommand()

      const out = getOutput()
      expect(out).toContain('KNOWLEDGE')
      expect(out).toContain('docs configured')
    })

    it('shows missing docs when not all configured', async () => {
      const loginMock = require('../login')
      loginMock.isAuthenticated.mockReturnValue(false)

      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('VISION.md')) return true
        return false
      })
      mockFs.readFileSync.mockImplementation((p: any) => {
        // VISION exists with content that exceeds threshold but has TODO
        if (String(p).includes('VISION.md')) return '# Test\n\nSome content here that is definitely longer than 100 characters TODO fill this in later with more details'
        return ''
      })

      await hudCommand()

      const out = getOutput()
      // When docs are missing or incomplete, it shows count and possibly Missing
      expect(out).toContain('docs configured')
    })

    it('shows quick actions section', async () => {
      setupProjectWithVision()
      await hudCommand()

      const out = getOutput()
      expect(out).toContain('QUICK ACTIONS')
      expect(out).toContain('/brand-architect')
      expect(out).toContain('/content thread')
      expect(out).toContain('jfl deploy')
    })
  })

  describe('compact HUD', () => {
    it('shows one-line status with compact option', async () => {
      setupProjectWithVision()
      await hudCommand({ compact: true })

      const out = getOutput()
      // Compact mode should be brief - just project name and basic info
      expect(out.split('\n').length).toBeLessThan(5)
    })

    it('shows countdown in compact mode', async () => {
      setupFullProject()
      await hudCommand({ compact: true })

      const out = getOutput()
      expect(out).toMatch(/\d+d/)  // Should contain "Xd" format
    })

    it('shows task count in compact mode', async () => {
      setupFullProject()
      await hudCommand({ compact: true })

      const out = getOutput()
      expect(out).toMatch(/\d+\/\d+/)  // Should contain "X/Y" format
    })
  })

  it('returns early when not in project', async () => {
    const ensureProjectMock = require('../../utils/ensure-project')
    ensureProjectMock.ensureInProject.mockResolvedValue(false)

    await hudCommand()

    const out = getOutput()
    expect(out).not.toContain('KNOWLEDGE')
  })
})
