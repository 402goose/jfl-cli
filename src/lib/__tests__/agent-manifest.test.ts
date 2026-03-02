import { generateManifest, generatePolicy, generateLifecycle } from '../agent-manifest'
import { parse as parseYaml } from 'yaml'

describe('generateManifest', () => {
  it('produces valid YAML with required fields', () => {
    const yaml = generateManifest('telemetry-agent')
    const manifest = parseYaml(yaml)

    expect(manifest.name).toBe('telemetry-agent')
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.type).toBe('reactive')
    expect(manifest.triggers).toHaveLength(1)
    expect(manifest.triggers[0].pattern).toBe('session:ended')
    expect(manifest.capabilities).toContain('read_telemetry')
    expect(manifest.capabilities).toContain('write_journal')
    expect(manifest.runtime.command).toBe('claude')
    expect(manifest.runtime.cwd).toBe('{{project_root}}')
  })

  it('uses custom description when provided', () => {
    const yaml = generateManifest('seo-agent', 'Monitors SEO rankings')
    const manifest = parseYaml(yaml)

    expect(manifest.description).toBe('Monitors SEO rankings')
  })

  it('falls back to default description', () => {
    const yaml = generateManifest('my-agent')
    const manifest = parseYaml(yaml)

    expect(manifest.description).toBe('my-agent agent')
  })

  it('includes agent name in runtime args', () => {
    const yaml = generateManifest('shadow')
    const manifest = parseYaml(yaml)

    expect(manifest.runtime.args).toEqual(
      expect.arrayContaining([expect.stringContaining('shadow')])
    )
  })
})

describe('generatePolicy', () => {
  it('produces valid JSON with all required fields', () => {
    const json = generatePolicy()
    const policy = JSON.parse(json)

    expect(policy.cost_limit_usd).toBe(0.5)
    expect(policy.approval_gate).toBe('auto')
    expect(policy.allowed_actions).toEqual(['log', 'emit', 'journal', 'command'])
    expect(policy.blocked_actions).toEqual(['spawn'])
    expect(policy.max_concurrent).toBe(1)
    expect(policy.cooldown_seconds).toBe(300)
  })

  it('blocks spawn by default', () => {
    const policy = JSON.parse(generatePolicy())
    expect(policy.blocked_actions).toContain('spawn')
    expect(policy.allowed_actions).not.toContain('spawn')
  })
})

describe('generateLifecycle', () => {
  it('produces valid YAML with flow definition', () => {
    const yaml = generateLifecycle('telemetry-agent', 'telemetry:batch')
    const lifecycle = parseYaml(yaml)

    expect(lifecycle.flows).toHaveLength(1)
    expect(lifecycle.flows[0].name).toBe('telemetry-agent-trigger')
    expect(lifecycle.flows[0].trigger.pattern).toBe('telemetry:batch')
    expect(lifecycle.flows[0].enabled).toBe(true)
    expect(lifecycle.flows[0].actions).toHaveLength(2)
  })

  it('uses provided trigger pattern', () => {
    const yaml = generateLifecycle('seo', 'hook:tool-use')
    const lifecycle = parseYaml(yaml)

    expect(lifecycle.flows[0].trigger.pattern).toBe('hook:tool-use')
  })

  it('emits agent:started event', () => {
    const yaml = generateLifecycle('test-agent', 'session:ended')
    const lifecycle = parseYaml(yaml)

    const emitAction = lifecycle.flows[0].actions.find((a: any) => a.type === 'emit')
    expect(emitAction).toBeDefined()
    expect(emitAction.event_type).toBe('agent:started')
    expect(emitAction.data.agent).toBe('test-agent')
  })

  it('includes log action with agent name', () => {
    const yaml = generateLifecycle('my-bot', 'custom:event')
    const lifecycle = parseYaml(yaml)

    const logAction = lifecycle.flows[0].actions.find((a: any) => a.type === 'log')
    expect(logAction).toBeDefined()
    expect(logAction.message).toContain('my-bot')
  })
})
