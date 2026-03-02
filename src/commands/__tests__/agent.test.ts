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
jest.mock('yaml', () => ({
  stringify: jest.fn((obj: any) => JSON.stringify(obj)),
  parse: jest.fn((str: string) => JSON.parse(str)),
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

describe('agent init', () => {
  let agentCommand: any

  beforeAll(async () => {
    const mod = await import('../agent')
    agentCommand = mod.agentCommand
  })

  it('rejects invalid agent names', async () => {
    await agentCommand('init', 'Invalid Name!')

    expect(getOutput()).toContain('Invalid agent name')
  })

  it('rejects if agent already exists', async () => {
    mockFs.existsSync.mockReturnValue(true)

    await agentCommand('init', 'my-agent')

    expect(getOutput()).toContain('already exists')
  })

  it('scaffolds manifest, policy, and lifecycle', async () => {
    mockFs.existsSync.mockReturnValue(false)
    mockFs.mkdirSync.mockReturnValue(undefined as any)
    mockFs.writeFileSync.mockReturnValue(undefined)

    await agentCommand('init', 'test-bot')

    expect(mockFs.mkdirSync).toHaveBeenCalledTimes(2)
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(3)

    const paths = mockFs.writeFileSync.mock.calls.map(c => String(c[0]))
    expect(paths.some(p => p.includes('manifest.yaml'))).toBe(true)
    expect(paths.some(p => p.includes('policy.json'))).toBe(true)
    expect(paths.some(p => p.includes('test-bot.yaml'))).toBe(true)
  })

  it('requires a name argument', async () => {
    await agentCommand('init')

    expect(getOutput()).toContain('Agent name required')
  })
})

describe('agent list', () => {
  let agentCommand: any

  beforeAll(async () => {
    const mod = await import('../agent')
    agentCommand = mod.agentCommand
  })

  it('shows message when no agents directory exists', async () => {
    mockFs.existsSync.mockReturnValue(false)

    await agentCommand('list')

    expect(getOutput()).toContain('No agents registered')
  })

  it('lists agents with manifest info', async () => {
    mockFs.existsSync.mockImplementation((p: any) => {
      const s = String(p)
      if (s.includes('agents') && !s.includes('manifest') && !s.includes('policy')) return true
      if (s.includes('manifest.yaml')) return true
      if (s.includes('policy.json')) return true
      return false
    })
    mockFs.readdirSync.mockReturnValue(['seo-agent'] as any)
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      description: 'SEO monitor',
      type: 'reactive',
    }))

    await agentCommand('list')

    const out = getOutput()
    expect(out).toContain('seo-agent')
    expect(out).toContain('SEO monitor')
  })
})

describe('agent status', () => {
  let agentCommand: any

  beforeAll(async () => {
    const mod = await import('../agent')
    agentCommand = mod.agentCommand
  })

  it('requires a name argument', async () => {
    await agentCommand('status')

    expect(getOutput()).toContain('Agent name required')
  })

  it('reports missing agent', async () => {
    mockFs.existsSync.mockReturnValue(false)

    await agentCommand('status', 'nonexistent')

    expect(getOutput()).toContain('not found')
  })

  it('shows file check status for existing agent', async () => {
    mockFs.existsSync.mockImplementation((p: any) => {
      const s = String(p)
      if (s.includes('agents/my-bot')) return true
      if (s.includes('manifest.yaml')) return true
      if (s.includes('policy.json')) return true
      if (s.includes('flows/my-bot.yaml')) return false
      return true
    })
    mockFs.readFileSync.mockImplementation((p: any) => {
      const s = String(p)
      if (s.includes('manifest.yaml')) return JSON.stringify({
        type: 'reactive',
        version: '0.1.0',
        triggers: [{ pattern: 'session:ended' }],
        capabilities: ['read_telemetry'],
        runtime: { command: 'claude', args: ['-p', 'test'] },
      })
      if (s.includes('policy.json')) return JSON.stringify({
        cost_limit_usd: 0.5,
        approval_gate: 'auto',
        max_concurrent: 1,
      })
      return '{}'
    })

    await agentCommand('status', 'my-bot')

    const out = getOutput()
    expect(out).toContain('[ok]')
    expect(out).toContain('manifest.yaml')
    expect(out).toContain('[!!]')
    expect(out).toContain('missing')
    expect(out).toContain('reactive')
    expect(out).toContain('$0.5')
  })
})

describe('agent default', () => {
  let agentCommand: any

  beforeAll(async () => {
    const mod = await import('../agent')
    agentCommand = mod.agentCommand
  })

  it('shows help when no action provided', async () => {
    await agentCommand()

    const out = getOutput()
    expect(out).toContain('jfl agent')
    expect(out).toContain('init')
    expect(out).toContain('list')
    expect(out).toContain('status')
  })
})
