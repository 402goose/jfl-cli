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
  chalk.dim = passthrough
  chalk.green = passthrough
  chalk.red = passthrough
  chalk.yellow = passthrough
  chalk.cyan = passthrough
  chalk.blue = passthrough
  return { default: chalk, __esModule: true }
})

jest.mock('fs')

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

function mockConfig(config: any) {
  mockFs.existsSync.mockImplementation((p: any) => {
    const s = String(p)
    if (s.endsWith('.jfl/config.json')) return true
    return false
  })
  mockFs.readFileSync.mockReturnValue(JSON.stringify(config))
}

describe('scope viz', () => {
  let scopeCommand: any

  beforeAll(async () => {
    const mod = await import('../scope')
    scopeCommand = mod.scopeCommand
  })

  it('shows "no services" when workspace has no registered services', async () => {
    mockConfig({
      name: 'test-gtm',
      type: 'gtm',
    })

    await scopeCommand('viz')

    expect(getOutput()).toContain('No registered services')
  })

  it('renders flow edges between producer and consumer', async () => {
    mockConfig({
      name: 'arena',
      type: 'gtm',
      context_scope: { produces: ['eval:*'] },
      registered_services: [
        {
          name: 'team-lobsters',
          path: '/fake/lobsters',
          type: 'service',
          status: 'active',
          context_scope: {
            produces: ['model:output'],
            consumes: ['eval:*'],
            denied: [],
          },
        },
        {
          name: 'team-phds',
          path: '/fake/phds',
          type: 'service',
          status: 'active',
          context_scope: {
            produces: ['model:output'],
            consumes: ['eval:*'],
            denied: ['model:output'],
          },
        },
      ],
    })

    await scopeCommand('viz')

    const out = getOutput()
    expect(out).toContain('Scope Graph')
    expect(out).toContain('arena')
    expect(out).toContain('team-lobsters')
    expect(out).toContain('team-phds')
    expect(out).toContain('Flows')
  })

  it('warns when a consumer denies what it also consumes', async () => {
    mockConfig({
      name: 'test-gtm',
      type: 'gtm',
      registered_services: [
        {
          name: 'confused-svc',
          path: '/fake/confused',
          type: 'service',
          status: 'active',
          context_scope: {
            produces: [],
            consumes: ['journal:*'],
            denied: ['journal:*'],
          },
        },
      ],
    })

    await scopeCommand('viz')

    const out = getOutput()
    expect(out).toContain('Warnings')
    expect(out).toContain('confused-svc')
    expect(out).toContain('consumes')
    expect(out).toContain('denies')
  })

  it('warns when service has no scope declared', async () => {
    mockConfig({
      name: 'test-gtm',
      type: 'gtm',
      registered_services: [
        {
          name: 'open-svc',
          path: '/fake/open',
          type: 'service',
          status: 'active',
        },
      ],
    })

    await scopeCommand('viz')

    const out = getOutput()
    expect(out).toContain('Warnings')
    expect(out).toContain('open-svc')
    expect(out).toContain('unrestricted')
  })

  it('shows blocked edges for denied patterns that match producers', async () => {
    mockConfig({
      name: 'arena',
      type: 'gtm',
      context_scope: { produces: ['eval:*'] },
      registered_services: [
        {
          name: 'shadow',
          path: '/fake/shadow',
          type: 'service',
          status: 'active',
          context_scope: {
            produces: ['shadow:analysis'],
            consumes: ['*'],
          },
        },
        {
          name: 'team-a',
          path: '/fake/team-a',
          type: 'service',
          status: 'active',
          context_scope: {
            produces: ['model:output'],
            consumes: ['eval:*'],
            denied: ['shadow:*'],
          },
        },
      ],
    })

    await scopeCommand('viz')

    const out = getOutput()
    expect(out).toContain('Blocked')
    expect(out).toContain('shadow')
    expect(out).toContain('team-a')
  })

  it('renders access matrix with pattern columns', async () => {
    mockConfig({
      name: 'arena',
      type: 'gtm',
      context_scope: { produces: ['eval:scored'] },
      registered_services: [
        {
          name: 'svc-a',
          path: '/fake/a',
          type: 'service',
          status: 'active',
          context_scope: {
            produces: ['model:output'],
            consumes: ['eval:scored'],
          },
        },
      ],
    })

    await scopeCommand('viz')

    const out = getOutput()
    expect(out).toContain('Access Matrix')
    expect(out).toContain('PROD')
    expect(out).toContain('READ')
  })
})

describe('matchScopePattern', () => {
  let matchScopePattern: any

  beforeAll(async () => {
    const mod = await import('../scope')
    matchScopePattern = mod.matchScopePattern
  })

  it('matches exact strings', () => {
    expect(matchScopePattern('eval:scored', 'eval:scored')).toBe(true)
    expect(matchScopePattern('eval:scored', 'eval:submitted')).toBe(false)
  })

  it('matches wildcard patterns', () => {
    expect(matchScopePattern('eval:*', 'eval:scored')).toBe(true)
    expect(matchScopePattern('eval:*', 'journal:entry')).toBe(false)
    expect(matchScopePattern('*', 'anything')).toBe(true)
  })

  it('matches glob-style prefix patterns', () => {
    expect(matchScopePattern('shadow:*', 'shadow:analysis')).toBe(true)
    expect(matchScopePattern('shadow:*', 'shadow:iteration')).toBe(true)
    expect(matchScopePattern('shadow:*', 'team:output')).toBe(false)
  })
})
