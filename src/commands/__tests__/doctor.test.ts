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
  return { default: chalk, __esModule: true }
})

jest.mock('fs')
jest.mock('../hooks', () => ({
  initHooks: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../utils/context-hub-port', () => ({
  getProjectPort: jest.fn().mockReturnValue(3410),
}))

const mockFs = fs as jest.Mocked<typeof fs>

let logOutput: string[]

beforeEach(() => {
  jest.clearAllMocks()
  logOutput = []
  jest.spyOn(console, 'log').mockImplementation((...args: any[]) => {
    logOutput.push(args.join(' '))
  })
})

afterAll(() => {
  jest.restoreAllMocks()
})

function getOutput() {
  return logOutput.join('\n')
}

function setupHealthyProject() {
  mockFs.existsSync.mockImplementation((p: any) => {
    const s = String(p)
    if (s.endsWith('.jfl')) return true
    if (s.endsWith('config.json')) return true
    if (s.endsWith('settings.json')) return true
    if (s.endsWith('memory.db')) return true
    if (s.includes('journal')) return true
    if (s.includes('agents')) return false
    if (s.includes('flows.yaml') || s.includes('flows.json')) return false
    return false
  })
  mockFs.readFileSync.mockImplementation((p: any) => {
    const s = String(p)
    if (s.endsWith('config.json')) return JSON.stringify({ name: 'test', type: 'gtm' })
    if (s.endsWith('settings.json')) return JSON.stringify({
      hooks: {
        PostToolUse: [{ matcher: '', hooks: [{ type: 'http', url: 'http://localhost:3410/api/hooks' }] }],
      },
    })
    return ''
  })
  mockFs.statSync.mockReturnValue({ size: 1024 } as any)
  mockFs.readdirSync.mockReturnValue(['session-1.jsonl'] as any)
}

describe('doctorCommand', () => {
  let doctorCommand: any

  beforeAll(async () => {
    const mod = await import('../doctor')
    doctorCommand = mod.doctorCommand
  })

  it('reports all checks passing for healthy project', async () => {
    setupHealthyProject()
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any

    await doctorCommand()

    const out = getOutput()
    expect(out).toContain('[ok]')
    expect(out).toContain('.jfl directory')
    expect(out).toContain('config.json')
    expect(out).toContain('Hooks')
    expect(out).toContain('Journal')
  })

  it('reports missing .jfl directory', async () => {
    mockFs.existsSync.mockReturnValue(false)
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any

    await doctorCommand()

    const out = getOutput()
    expect(out).toContain('[!!]')
    expect(out).toContain('issue(s) found')
  })

  it('reports missing hooks as fixable', async () => {
    mockFs.existsSync.mockImplementation((p: any) => {
      const s = String(p)
      if (s.endsWith('.jfl')) return true
      if (s.endsWith('config.json')) return true
      if (s.endsWith('settings.json')) return false
      if (s.endsWith('memory.db')) return true
      if (s.includes('journal')) return true
      return false
    })
    mockFs.readFileSync.mockImplementation((p: any) => {
      if (String(p).endsWith('config.json')) return JSON.stringify({ name: 'test' })
      return ''
    })
    mockFs.statSync.mockReturnValue({ size: 512 } as any)
    mockFs.readdirSync.mockReturnValue([] as any)
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any

    await doctorCommand()

    const out = getOutput()
    expect(out).toContain('Hooks')
    expect(out).toContain('fixable')
  })

  it('fixes hooks when --fix is passed', async () => {
    const { initHooks } = require('../hooks')

    mockFs.existsSync.mockImplementation((p: any) => {
      const s = String(p)
      if (s.endsWith('.jfl')) return true
      if (s.endsWith('config.json')) return true
      if (s.endsWith('settings.json')) return false
      if (s.endsWith('memory.db')) return true
      if (s.includes('journal')) return true
      return false
    })
    mockFs.readFileSync.mockImplementation((p: any) => {
      if (String(p).endsWith('config.json')) return JSON.stringify({ name: 'test' })
      return ''
    })
    mockFs.statSync.mockReturnValue({ size: 512 } as any)
    mockFs.readdirSync.mockReturnValue([] as any)
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any

    await doctorCommand({ fix: true })

    expect(initHooks).toHaveBeenCalled()
    const out = getOutput()
    expect(out).toContain('[fix]')
  })

  it('reports context hub not running when fetch fails', async () => {
    setupHealthyProject()
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any

    await doctorCommand()

    const out = getOutput()
    expect(out).toContain('Context Hub')
    expect(out).toContain('[!!]')
  })

  it('shows all checks passed when everything is healthy', async () => {
    setupHealthyProject()
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any

    await doctorCommand()

    const out = getOutput()
    expect(out).toContain('All checks passed')
  })
})
