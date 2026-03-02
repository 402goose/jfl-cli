import * as fs from 'fs'
import * as path from 'path'
import { FlowEngine } from '../flow-engine'
import { stringify as stringifyYaml } from 'yaml'

jest.mock('fs')
jest.mock('../telemetry', () => ({
  telemetry: { track: jest.fn() },
}))

const mockFs = fs as jest.Mocked<typeof fs>

const mockEventBus = {
  subscribe: jest.fn().mockReturnValue({ id: 'sub-1' }),
  unsubscribe: jest.fn(),
  emit: jest.fn(),
} as any

beforeEach(() => {
  jest.clearAllMocks()
})

function makeFlowYaml(flows: any[]) {
  return stringifyYaml({ flows })
}

describe('FlowEngine loadFlows directory scanning', () => {
  it('loads flows from .jfl/flows/*.yaml in addition to flows.yaml', async () => {
    const mainFlow = {
      name: 'main-flow',
      trigger: { pattern: 'session:ended' },
      actions: [{ type: 'log', message: 'main' }],
    }
    const agentFlow = {
      name: 'agent-flow',
      trigger: { pattern: 'agent:started' },
      actions: [{ type: 'log', message: 'agent' }],
    }

    const mainYaml = path.join('/test', '.jfl', 'flows.yaml')
    const flowsDir = path.join('/test', '.jfl', 'flows')

    mockFs.existsSync.mockImplementation((p: any) => {
      const s = String(p)
      if (s === mainYaml) return true
      if (s === flowsDir) return true
      return false
    })
    mockFs.readFileSync.mockImplementation((p: any) => {
      const s = String(p)
      if (s === mainYaml) return makeFlowYaml([mainFlow])
      if (s === path.join(flowsDir, 'my-agent.yaml')) return makeFlowYaml([agentFlow])
      return ''
    })
    mockFs.readdirSync.mockReturnValue(['my-agent.yaml'] as any)

    const engine = new FlowEngine(mockEventBus, '/test')
    await engine.start()
    const flows = engine.getFlows()

    expect(flows).toHaveLength(2)
    expect(flows.map(f => f.name)).toContain('main-flow')
    expect(flows.map(f => f.name)).toContain('agent-flow')
  })

  it('loads only directory flows when no main flows.yaml', async () => {
    const agentFlow = {
      name: 'solo-agent',
      trigger: { pattern: 'hook:tool-use' },
      actions: [{ type: 'log', message: 'solo' }],
    }

    const mainYaml = path.join('/test', '.jfl', 'flows.yaml')
    const mainJson = path.join('/test', '.jfl', 'flows.json')
    const flowsDir = path.join('/test', '.jfl', 'flows')

    mockFs.existsSync.mockImplementation((p: any) => {
      const s = String(p)
      if (s === mainYaml) return false
      if (s === mainJson) return false
      if (s === flowsDir) return true
      return false
    })
    mockFs.readFileSync.mockImplementation((p: any) => {
      if (String(p) === path.join(flowsDir, 'solo.yaml')) {
        return makeFlowYaml([agentFlow])
      }
      return ''
    })
    mockFs.readdirSync.mockReturnValue(['solo.yaml'] as any)

    const engine = new FlowEngine(mockEventBus, '/test')
    await engine.start()
    const flows = engine.getFlows()

    expect(flows).toHaveLength(1)
    expect(flows[0].name).toBe('solo-agent')
  })

  it('skips invalid yaml files in flows directory', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation()

    const mainYaml = path.join('/test', '.jfl', 'flows.yaml')
    const mainJson = path.join('/test', '.jfl', 'flows.json')
    const flowsDir = path.join('/test', '.jfl', 'flows')

    mockFs.existsSync.mockImplementation((p: any) => {
      const s = String(p)
      if (s === mainYaml) return false
      if (s === mainJson) return false
      if (s === flowsDir) return true
      return false
    })
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('Invalid YAML')
    })
    mockFs.readdirSync.mockReturnValue(['broken.yaml'] as any)

    const engine = new FlowEngine(mockEventBus, '/test')
    await engine.start()
    const flows = engine.getFlows()

    expect(flows).toHaveLength(0)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse broken.yaml')
    )

    consoleError.mockRestore()
  })

  it('ignores non-yaml files in flows directory', async () => {
    const mainYaml = path.join('/test', '.jfl', 'flows.yaml')
    const mainJson = path.join('/test', '.jfl', 'flows.json')
    const flowsDir = path.join('/test', '.jfl', 'flows')

    mockFs.existsSync.mockImplementation((p: any) => {
      const s = String(p)
      if (s === mainYaml) return false
      if (s === mainJson) return false
      if (s === flowsDir) return true
      return false
    })
    mockFs.readdirSync.mockReturnValue(['readme.md', 'notes.txt', 'agent.yaml'] as any)
    mockFs.readFileSync.mockReturnValue(makeFlowYaml([{
      name: 'test',
      trigger: { pattern: 'custom' },
      actions: [{ type: 'log', message: 'test' }],
    }]))

    const engine = new FlowEngine(mockEventBus, '/test')
    await engine.start()
    const flows = engine.getFlows()

    // Only agent.yaml should be loaded, not readme.md or notes.txt
    expect(flows).toHaveLength(1)
  })

  it('filters flows missing required fields from directory', async () => {
    const mainYaml = path.join('/test', '.jfl', 'flows.yaml')
    const mainJson = path.join('/test', '.jfl', 'flows.json')
    const flowsDir = path.join('/test', '.jfl', 'flows')

    mockFs.existsSync.mockImplementation((p: any) => {
      const s = String(p)
      if (s === mainYaml) return false
      if (s === mainJson) return false
      if (s === flowsDir) return true
      return false
    })
    mockFs.readdirSync.mockReturnValue(['mixed.yaml'] as any)
    mockFs.readFileSync.mockReturnValue(makeFlowYaml([
      { name: 'valid', trigger: { pattern: 'hook:stop' }, actions: [{ type: 'log', message: 'ok' }] },
      { name: 'no-trigger', actions: [{ type: 'log', message: 'bad' }] },
      { trigger: { pattern: 'hook:stop' }, actions: [{ type: 'log', message: 'bad' }] },
    ]))

    const engine = new FlowEngine(mockEventBus, '/test')
    await engine.start()
    const flows = engine.getFlows()

    expect(flows).toHaveLength(1)
    expect(flows[0].name).toBe('valid')
  })
})
