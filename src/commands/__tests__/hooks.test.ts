/**
 * @purpose Tests for jfl hooks command handlers
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
  return { default: chalk, __esModule: true }
})

jest.mock('fs')
jest.mock('yaml', () => ({
  stringify: jest.fn((obj: any) => JSON.stringify(obj)),
  parse: jest.fn((str: string) => JSON.parse(str)),
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
  jest.spyOn(process, 'cwd').mockReturnValue('/test/project')

  // Default: project exists
  mockFs.existsSync.mockImplementation((p: any) => {
    const s = String(p)
    if (s.includes('.jfl/config.json')) return true
    return false
  })
  mockFs.readFileSync.mockImplementation((p: any) => {
    const s = String(p)
    if (s.includes('config.json')) {
      return JSON.stringify({ name: 'test-project', type: 'gtm' })
    }
    return '{}'
  })
  mockFs.writeFileSync.mockReturnValue(undefined)
  mockFs.mkdirSync.mockReturnValue(undefined as any)
})

afterAll(() => {
  jest.restoreAllMocks()
})

function getOutput() {
  return logOutput.join('\n')
}

describe('hooksCommand', () => {
  let hooksCommand: any

  beforeAll(async () => {
    const mod = await import('../hooks')
    hooksCommand = mod.hooksCommand
  })

  describe('default (no action)', () => {
    it('shows help when no action provided', async () => {
      await hooksCommand()

      const out = getOutput()
      expect(out).toContain('jfl hooks')
      expect(out).toContain('init')
      expect(out).toContain('status')
      expect(out).toContain('remove')
      expect(out).toContain('deploy')
    })
  })

  describe('init action', () => {
    it('creates HTTP hooks for all events', async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('.jfl/config.json')) return true
        if (s.includes('settings.json')) return false
        if (s.includes('flows.yaml')) return false
        return false
      })

      await hooksCommand('init')

      expect(mockFs.writeFileSync).toHaveBeenCalled()
      const out = getOutput()
      expect(out).toContain('HTTP hooks configured')
      expect(out).toContain('localhost:3410')
    })

    it('reports hooks already configured when present', async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('.jfl/config.json')) return true
        if (s.includes('settings.json')) return true
        if (s.includes('flows.yaml')) return true
        return false
      })
      mockFs.readFileSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('settings.json')) {
          return JSON.stringify({
            hooks: {
              PostToolUse: [{ matcher: '', hooks: [{ type: 'http', url: 'http://localhost:3410/api/hooks' }] }],
              Stop: [{ matcher: '', hooks: [{ type: 'http', url: 'http://localhost:3410/api/hooks' }] }],
              PreCompact: [{ matcher: '', hooks: [{ type: 'http', url: 'http://localhost:3410/api/hooks' }] }],
              SubagentStart: [{ matcher: '', hooks: [{ type: 'http', url: 'http://localhost:3410/api/hooks' }] }],
              SubagentStop: [{ matcher: '', hooks: [{ type: 'http', url: 'http://localhost:3410/api/hooks' }] }],
            },
          })
        }
        if (s.includes('config.json')) {
          return JSON.stringify({ name: 'test' })
        }
        return '{}'
      })

      await hooksCommand('init')

      const out = getOutput()
      expect(out).toContain('already configured')
    })

    it('creates default flows.yaml if missing', async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('.jfl/config.json')) return true
        if (s.includes('settings.json')) return false
        if (s.includes('flows.yaml')) return false
        if (s.includes('.jfl')) return true
        if (s.includes('.claude')) return false
        return false
      })

      await hooksCommand('init')

      const writeCallPaths = mockFs.writeFileSync.mock.calls.map(c => String(c[0]))
      expect(writeCallPaths.some(p => p.includes('flows.yaml'))).toBe(true)
    })

    it('lists all hook events', async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('.jfl/config.json')) return true
        if (s.includes('settings.json')) return false
        if (s.includes('flows.yaml')) return false
        return false
      })

      await hooksCommand('init')

      const out = getOutput()
      expect(out).toContain('PostToolUse')
      expect(out).toContain('Stop')
      expect(out).toContain('PreCompact')
    })
  })

  describe('status action', () => {
    it('shows no hooks when none configured', async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('.jfl/config.json')) return true
        if (s.includes('settings.json')) return false
        return false
      })

      await hooksCommand('status')

      const out = getOutput()
      expect(out).toContain('No hooks configured')
    })

    it('shows configured HTTP hooks', async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('.jfl/config.json')) return true
        if (s.includes('settings.json')) return true
        return false
      })
      mockFs.readFileSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('settings.json')) {
          return JSON.stringify({
            hooks: {
              PostToolUse: [{ matcher: '', hooks: [{ type: 'http', url: 'http://localhost:3410/api/hooks' }] }],
            },
          })
        }
        if (s.includes('config.json')) {
          return JSON.stringify({ name: 'test' })
        }
        return '{}'
      })

      // Mock fetch for context hub health check
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any

      await hooksCommand('status')

      const out = getOutput()
      expect(out).toContain('PostToolUse')
      expect(out).toContain('http://localhost:3410/api/hooks')
    })

    it('shows context hub running status', async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('.jfl/config.json')) return true
        if (s.includes('settings.json')) return true
        return false
      })
      mockFs.readFileSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('settings.json')) {
          return JSON.stringify({
            hooks: {
              PostToolUse: [{ matcher: '', hooks: [{ type: 'http', url: 'http://localhost:3410/api/hooks' }] }],
            },
          })
        }
        if (s.includes('config.json')) {
          return JSON.stringify({ name: 'test' })
        }
        return '{}'
      })

      global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any

      await hooksCommand('status')

      const out = getOutput()
      expect(out).toContain('Context Hub')
      expect(out).toContain('running')
    })

    it('shows context hub not running', async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('.jfl/config.json')) return true
        if (s.includes('settings.json')) return true
        return false
      })
      mockFs.readFileSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('settings.json')) {
          return JSON.stringify({
            hooks: {
              PostToolUse: [{ matcher: '', hooks: [{ type: 'http', url: 'http://localhost:3410/api/hooks' }] }],
            },
          })
        }
        if (s.includes('config.json')) {
          return JSON.stringify({ name: 'test' })
        }
        return '{}'
      })

      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any

      await hooksCommand('status')

      const out = getOutput()
      expect(out).toContain('Context Hub')
      expect(out).toContain('not running')
    })
  })

  describe('remove action', () => {
    it('removes HTTP hooks', async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('.jfl/config.json')) return true
        if (s.includes('settings.json')) return true
        if (s.includes('.claude')) return true
        return false
      })
      mockFs.readFileSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('settings.json')) {
          return JSON.stringify({
            hooks: {
              PostToolUse: [{ matcher: '', hooks: [{ type: 'http', url: 'http://localhost:3410/api/hooks' }] }],
              Stop: [{ matcher: '', hooks: [{ type: 'http', url: 'http://localhost:3410/api/hooks' }] }],
            },
          })
        }
        if (s.includes('config.json')) {
          return JSON.stringify({ name: 'test' })
        }
        return '{}'
      })

      await hooksCommand('remove')

      const out = getOutput()
      expect(out).toContain('Removed')
      expect(out).toContain('HTTP hook')
      expect(mockFs.writeFileSync).toHaveBeenCalled()
    })

    it('reports no HTTP hooks to remove', async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('.jfl/config.json')) return true
        if (s.includes('settings.json')) return true
        return false
      })
      mockFs.readFileSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('settings.json')) {
          return JSON.stringify({
            hooks: {
              PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'echo test' }] }],
            },
          })
        }
        if (s.includes('config.json')) {
          return JSON.stringify({ name: 'test' })
        }
        return '{}'
      })

      await hooksCommand('remove')

      const out = getOutput()
      expect(out).toContain('No HTTP hooks found to remove')
    })

    it('preserves shell hooks when removing HTTP hooks', async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('.jfl/config.json')) return true
        if (s.includes('settings.json')) return true
        if (s.includes('.claude')) return true
        return false
      })
      mockFs.readFileSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('settings.json')) {
          return JSON.stringify({
            hooks: {
              PostToolUse: [{
                matcher: '',
                hooks: [
                  { type: 'http', url: 'http://localhost:3410/api/hooks' },
                  { type: 'command', command: 'echo preserved' },
                ],
              }],
            },
          })
        }
        if (s.includes('config.json')) {
          return JSON.stringify({ name: 'test' })
        }
        return '{}'
      })

      await hooksCommand('remove')

      const out = getOutput()
      expect(out).toContain('Shell hooks preserved')
    })

    it('shows no hooks message when hooks object empty', async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('.jfl/config.json')) return true
        if (s.includes('settings.json')) return true
        return false
      })
      mockFs.readFileSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('settings.json')) {
          return JSON.stringify({})
        }
        if (s.includes('config.json')) {
          return JSON.stringify({ name: 'test' })
        }
        return '{}'
      })

      await hooksCommand('remove')

      const out = getOutput()
      expect(out).toContain('No hooks configured')
    })
  })

  describe('deploy action', () => {
    it('deploys hooks to registered services', async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('.jfl/config.json')) return true
        if (s.includes('/service1')) return true
        if (s.includes('settings.json')) return false
        return false
      })
      mockFs.readFileSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.endsWith('.jfl/config.json')) {
          return JSON.stringify({
            name: 'test',
            registered_services: [
              { name: 'service1', path: '/test/service1' },
            ],
          })
        }
        return '{}'
      })

      await hooksCommand('deploy')

      const out = getOutput()
      expect(out).toContain('Deploying hooks to')
      expect(out).toContain('service1')
    })

    it('shows error when not in JFL project', async () => {
      mockFs.existsSync.mockReturnValue(false)

      await hooksCommand('deploy')

      const out = getOutput()
      expect(out).toContain('Not in a JFL project')
    })

    it('shows message when no services registered', async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('.jfl/config.json')) return true
        return false
      })
      mockFs.readFileSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('config.json')) {
          return JSON.stringify({ name: 'test', registered_services: [] })
        }
        return '{}'
      })

      await hooksCommand('deploy')

      const out = getOutput()
      expect(out).toContain('No registered services')
    })

    it('shows error when service directory not found', async () => {
      mockFs.existsSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.includes('.jfl/config.json')) return true
        if (s.includes('/missing-service')) return false
        return false
      })
      mockFs.readFileSync.mockImplementation((p: any) => {
        const s = String(p)
        if (s.endsWith('.jfl/config.json')) {
          return JSON.stringify({
            name: 'test',
            registered_services: [
              { name: 'missing-service', path: '/test/missing-service' },
            ],
          })
        }
        return '{}'
      })

      await hooksCommand('deploy')

      const out = getOutput()
      expect(out).toContain('directory not found')
    })
  })
})

describe('initHooks export', () => {
  let initHooks: any

  beforeAll(async () => {
    const mod = await import('../hooks')
    initHooks = mod.initHooks
  })

  it('is exported for external use', () => {
    expect(initHooks).toBeDefined()
    expect(typeof initHooks).toBe('function')
  })
})
