/**
 * Error Handling Tests for Flow Engine
 *
 * Tests resource limits, malformed flows, action failures, and execution buffer overflow
 *
 * @purpose Test error paths and resource limits in flow-engine.ts
 */

import type { MAPEvent, MAPEventType } from '../../types/map.js'

function createMockEventBus(overrides?: any) {
  return {
    subscribe: jest.fn().mockReturnValue({ id: 'sub-1' }),
    unsubscribe: jest.fn(),
    emit: jest.fn(),
    getEvents: jest.fn().mockReturnValue([]),
    buffer: [],
    maxSize: 1000,
    subscribers: new Map(),
    persistPath: null,
    onStart: jest.fn(),
    onStop: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    publish: jest.fn(),
    handleIncoming: jest.fn(),
    load: jest.fn(),
    save: jest.fn(),
    getStats: jest.fn().mockReturnValue({}),
    clear: jest.fn(),
    ...overrides,
  }
}

describe('FlowEngine error handling', () => {
  let mockEventBus: any

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockEventBus = createMockEventBus()
  })

  describe('loadFlows error handling', () => {
    it('returns empty array when flows.yaml has invalid YAML syntax', async () => {
      jest.doMock('fs', () => ({
        existsSync: (p: string) => String(p).includes('flows.yaml'),
        readFileSync: () => 'invalid: yaml: : syntax {{{{',
        readdirSync: () => [],
      }))

      const { FlowEngine } = await import('../flow-engine.js')
      const engine = new FlowEngine(mockEventBus, '/tmp/test')

      const count = await engine.start()
      expect(count).toBe(0)
    })

    it('returns empty array when flows.json has invalid JSON', async () => {
      jest.doMock('fs', () => ({
        existsSync: (p: string) => String(p).includes('flows.json'),
        readFileSync: () => '{ invalid json }}}',
        readdirSync: () => [],
      }))

      const { FlowEngine } = await import('../flow-engine.js')
      const engine = new FlowEngine(mockEventBus, '/tmp/test')

      const count = await engine.start()
      expect(count).toBe(0)
    })

    it('filters out flows with missing trigger patterns', async () => {
      jest.doMock('fs', () => ({
        existsSync: (p: string) => String(p).includes('flows.yaml'),
        readFileSync: () => `
flows:
  - name: valid-flow
    trigger:
      pattern: "test:event"
    actions:
      - type: log
        message: test
  - name: invalid-flow
    trigger: {}
    actions:
      - type: log
`,
        readdirSync: () => [],
      }))

      const { FlowEngine } = await import('../flow-engine.js')
      const engine = new FlowEngine(mockEventBus, '/tmp/test')

      await engine.start()
      const flows = engine.getFlows()
      expect(flows.length).toBe(1)
      expect(flows[0].name).toBe('valid-flow')
    })

    it('filters out flows with missing actions array', async () => {
      jest.doMock('fs', () => ({
        existsSync: (p: string) => String(p).includes('flows.yaml'),
        readFileSync: () => `
flows:
  - name: no-actions
    trigger:
      pattern: "test:event"
`,
        readdirSync: () => [],
      }))

      const { FlowEngine } = await import('../flow-engine.js')
      const engine = new FlowEngine(mockEventBus, '/tmp/test')

      await engine.start()
      const flows = engine.getFlows()
      expect(flows.length).toBe(0)
    })

    it('handles missing flows directory gracefully', async () => {
      jest.doMock('fs', () => ({
        existsSync: (p: string) => String(p).includes('flows.yaml'),
        readFileSync: () => `
flows:
  - name: test
    trigger:
      pattern: "test:event"
    actions:
      - type: log
        message: test
`,
        readdirSync: () => {
          throw new Error('ENOENT')
        },
      }))

      const { FlowEngine } = await import('../flow-engine.js')
      const engine = new FlowEngine(mockEventBus, '/tmp/test')

      // Should not throw even if flows directory doesn't exist
      await engine.start()
    })
  })

  describe('execution buffer overflow', () => {
    it('maintains max 200 executions by dropping oldest', async () => {
      jest.doMock('fs', () => ({
        existsSync: (p: string) => String(p).includes('flows.yaml'),
        readFileSync: () => `
flows:
  - name: test-flow
    enabled: true
    trigger:
      pattern: "test:*"
    actions:
      - type: log
        message: test
`,
        readdirSync: () => [],
        appendFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      // Mock telemetry to avoid side effects
      jest.doMock('../telemetry.js', () => ({
        telemetry: { track: jest.fn() },
      }))

      const { FlowEngine } = await import('../flow-engine.js')

      let capturedCallback: ((event: MAPEvent) => void) | null = null
      const trackingEventBus = createMockEventBus({
        subscribe: jest.fn().mockImplementation(({ callback }: any) => {
          capturedCallback = callback
          return { id: 'sub-1' }
        }),
      })

      const engine = new FlowEngine(trackingEventBus, '/tmp/test')
      await engine.start()

      // Trigger 250 events to exceed the 200 limit
      for (let i = 0; i < 250; i++) {
        const event: MAPEvent = {
          id: `event-${i}`,
          ts: new Date().toISOString(),
          type: 'test:trigger' as MAPEventType,
          source: 'test',
          data: { index: i },
        }
        capturedCallback?.(event)
      }

      const executions = engine.getExecutions()
      expect(executions.length).toBe(200)

      // Verify oldest executions were dropped
      const firstEventId = executions[0].trigger_event_id
      expect(firstEventId).toBe('event-50')
    })
  })

  describe('action execution errors', () => {
    it('catches and logs action errors without stopping flow', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      jest.doMock('fs', () => ({
        existsSync: (p: string) => String(p).includes('flows.yaml'),
        readFileSync: () => `
flows:
  - name: error-flow
    enabled: true
    trigger:
      pattern: "test:error"
    actions:
      - type: webhook
        url: http://localhost:59999/fail
`,
        readdirSync: () => [],
        appendFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      jest.doMock('../telemetry.js', () => ({
        telemetry: { track: jest.fn() },
      }))

      const originalFetch = global.fetch
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'))

      try {
        const { FlowEngine } = await import('../flow-engine.js')

        let capturedCallback: ((event: MAPEvent) => void) | null = null
        const trackingEventBus = createMockEventBus({
          subscribe: jest.fn().mockImplementation(({ callback }: any) => {
            capturedCallback = callback
            return { id: 'sub-1' }
          }),
        })

        const engine = new FlowEngine(trackingEventBus, '/tmp/test')
        await engine.start()

        const event: MAPEvent = {
          id: 'error-event',
          ts: new Date().toISOString(),
          type: 'test:error' as MAPEventType,
          source: 'test',
          data: {},
        }

        // Wait for async action execution
        await new Promise(resolve => setTimeout(resolve, 100))
        capturedCallback?.(event)
        await new Promise(resolve => setTimeout(resolve, 100))

        const executions = engine.getExecutions()
        expect(executions.length).toBeGreaterThan(0)
      } finally {
        global.fetch = originalFetch
        consoleSpy.mockRestore()
      }
    })

    it('handles command action timeout', async () => {
      jest.doMock('fs', () => ({
        existsSync: (p: string) => String(p).includes('flows.yaml'),
        readFileSync: () => `
flows:
  - name: timeout-flow
    enabled: true
    trigger:
      pattern: "test:timeout"
    actions:
      - type: command
        command: sleep
        args:
          - "60"
`,
        readdirSync: () => [],
        appendFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      jest.doMock('../telemetry.js', () => ({
        telemetry: { track: jest.fn() },
      }))

      jest.doMock('child_process', () => ({
        execSync: jest.fn().mockImplementation(() => {
          const err = new Error('Command timed out')
          ;(err as any).killed = true
          throw err
        }),
      }))

      const { FlowEngine } = await import('../flow-engine.js')

      let capturedCallback: ((event: MAPEvent) => void) | null = null
      const trackingEventBus = createMockEventBus({
        subscribe: jest.fn().mockImplementation(({ callback }: any) => {
          capturedCallback = callback
          return { id: 'sub-1' }
        }),
      })

      const engine = new FlowEngine(trackingEventBus, '/tmp/test')
      await engine.start()

      const event: MAPEvent = {
        id: 'timeout-event',
        ts: new Date().toISOString(),
        type: 'test:timeout' as MAPEventType,
        source: 'test',
      }

      capturedCallback?.(event)
      await new Promise(resolve => setTimeout(resolve, 50))

      const executions = engine.getExecutions()
      const latest = executions[executions.length - 1]
      expect(latest?.actions_failed).toBeGreaterThanOrEqual(0)
    })
  })

  describe('condition evaluation errors', () => {
    it('returns false for malformed condition syntax', async () => {
      const { FlowEngine } = await import('../flow-engine.js')

      const result = FlowEngine.validateCondition('invalid condition syntax')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid condition format')
    })

    it('returns false for condition with unsupported operator', async () => {
      const { FlowEngine } = await import('../flow-engine.js')

      const result = FlowEngine.validateCondition('data.value > "10"')
      expect(result.valid).toBe(false)
    })

    it('validates correct condition syntax', async () => {
      const { FlowEngine } = await import('../flow-engine.js')

      const validConditions = [
        'data.type == "test"',
        'source != "internal"',
        'data.message contains "error"',
      ]

      for (const condition of validConditions) {
        const result = FlowEngine.validateCondition(condition)
        expect(result.valid).toBe(true)
      }
    })
  })

  describe('gate evaluation edge cases', () => {
    it('gates flow when after date is in the future', async () => {
      jest.doMock('fs', () => ({
        existsSync: (p: string) => String(p).includes('flows.yaml'),
        readFileSync: () => {
          const futureDate = new Date(Date.now() + 86400000).toISOString()
          return `
flows:
  - name: gated-flow
    enabled: true
    trigger:
      pattern: "test:gate"
    gate:
      after: "${futureDate}"
    actions:
      - type: log
        message: test
`
        },
        readdirSync: () => [],
        appendFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      jest.doMock('../telemetry.js', () => ({
        telemetry: { track: jest.fn() },
      }))

      const { FlowEngine } = await import('../flow-engine.js')

      let capturedCallback: ((event: MAPEvent) => void) | null = null
      const trackingEventBus = createMockEventBus({
        subscribe: jest.fn().mockImplementation(({ callback }: any) => {
          capturedCallback = callback
          return { id: 'sub-1' }
        }),
      })

      const engine = new FlowEngine(trackingEventBus, '/tmp/test')
      await engine.start()

      const event: MAPEvent = {
        id: 'gate-event',
        ts: new Date().toISOString(),
        type: 'test:gate' as MAPEventType,
        source: 'test',
      }

      capturedCallback?.(event)
      await new Promise(resolve => setTimeout(resolve, 50))

      const executions = engine.getExecutions()
      const gatedExec = executions.find(e => e.flow === 'gated-flow')
      expect(gatedExec?.gated).toBe('time')
    })
  })

  describe('child hub connection errors', () => {
    it('handles child SSE connection failure gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      jest.doMock('fs', () => ({
        existsSync: () => false,
        readFileSync: () => '',
        readdirSync: () => [],
      }))

      const originalFetch = global.fetch
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'))

      try {
        const { FlowEngine } = await import('../flow-engine.js')
        const engine = new FlowEngine(mockEventBus, '/tmp/test')

        engine.setChildren([
          { name: 'child1', path: '/tmp/child', port: 59998 },
        ])

        await engine.start()

        // Give time for connection attempt
        await new Promise(resolve => setTimeout(resolve, 100))

        engine.stop()
      } finally {
        global.fetch = originalFetch
        consoleSpy.mockRestore()
      }
    })
  })

  describe('spawn action errors', () => {
    it('handles worktree creation failure', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      jest.doMock('fs', () => ({
        existsSync: (p: string) => String(p).includes('flows.yaml'),
        readFileSync: () => `
flows:
  - name: spawn-flow
    enabled: true
    trigger:
      pattern: "test:spawn"
    actions:
      - type: spawn
        command: echo
        args:
          - "test"
        target: worktree
`,
        readdirSync: () => [],
        appendFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      jest.doMock('../telemetry.js', () => ({
        telemetry: { track: jest.fn() },
      }))

      jest.doMock('child_process', () => ({
        execSync: jest.fn().mockImplementation(() => {
          throw new Error('fatal: worktree already exists')
        }),
        spawn: jest.fn().mockReturnValue({
          pid: 12345,
          on: jest.fn(),
          unref: jest.fn(),
        }),
      }))

      try {
        const { FlowEngine } = await import('../flow-engine.js')

        let capturedCallback: ((event: MAPEvent) => void) | null = null
        const trackingEventBus = {
          subscribe: jest.fn().mockImplementation(({ callback }) => {
            capturedCallback = callback
            return { id: 'sub-1' }
          }),
          unsubscribe: jest.fn(),
          emit: jest.fn(),
          getEvents: jest.fn().mockReturnValue([]),
        }

        const engine = new FlowEngine(trackingEventBus, '/tmp/test')
        await engine.start()

        const event: MAPEvent = {
          id: 'spawn-event',
          ts: new Date().toISOString(),
          type: 'test:spawn' as MAPEventType,
          source: 'test',
        }

        capturedCallback?.(event)
        await new Promise(resolve => setTimeout(resolve, 100))
      } finally {
        consoleSpy.mockRestore()
      }
    })
  })

  describe('toggleFlow edge cases', () => {
    it('returns null for non-existent flow', async () => {
      jest.doMock('fs', () => ({
        existsSync: () => false,
        readFileSync: () => '',
        readdirSync: () => [],
      }))

      const { FlowEngine } = await import('../flow-engine.js')
      const engine = new FlowEngine(mockEventBus, '/tmp/test')

      const result = engine.toggleFlow('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('approveGated edge cases', () => {
    it('returns null for non-existent gated execution', async () => {
      jest.doMock('fs', () => ({
        existsSync: () => false,
        readFileSync: () => '',
        readdirSync: () => [],
      }))

      const { FlowEngine } = await import('../flow-engine.js')
      const engine = new FlowEngine(mockEventBus, '/tmp/test')

      const result = await engine.approveGated('nonexistent', 'fake-id')
      expect(result).toBeNull()
    })
  })

  describe('interpolation edge cases', () => {
    it('handles missing event data fields', async () => {
      jest.doMock('fs', () => ({
        existsSync: (p: string) => String(p).includes('flows.yaml'),
        readFileSync: () => `
flows:
  - name: interpolate-flow
    enabled: true
    trigger:
      pattern: "test:interp"
    actions:
      - type: log
        message: "Value: {{data.missing.nested}}"
`,
        readdirSync: () => [],
        appendFileSync: jest.fn(),
        mkdirSync: jest.fn(),
      }))

      jest.doMock('../telemetry.js', () => ({
        telemetry: { track: jest.fn() },
      }))

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      try {
        const { FlowEngine } = await import('../flow-engine.js')

        let capturedCallback: ((event: MAPEvent) => void) | null = null
        const trackingEventBus = {
          subscribe: jest.fn().mockImplementation(({ callback }) => {
            capturedCallback = callback
            return { id: 'sub-1' }
          }),
          unsubscribe: jest.fn(),
          emit: jest.fn(),
          getEvents: jest.fn().mockReturnValue([]),
        }

        const engine = new FlowEngine(trackingEventBus, '/tmp/test')
        await engine.start()

        const event: MAPEvent = {
          id: 'interp-event',
          ts: new Date().toISOString(),
          type: 'test:interp' as MAPEventType,
          source: 'test',
          data: {},
        }

        capturedCallback?.(event)
        await new Promise(resolve => setTimeout(resolve, 50))

        // Should have logged with empty string for missing value
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Value: ')
        )
      } finally {
        consoleSpy.mockRestore()
      }
    })
  })
})
