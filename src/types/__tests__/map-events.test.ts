import type { MAPEventType, MAPEvent } from '../map'

describe('MAPEventType iteration events', () => {
  it('accepts agent iteration event types', () => {
    const types: MAPEventType[] = [
      'agent:iteration-start',
      'agent:iteration-complete',
      'agent:analysis',
    ]
    expect(types).toHaveLength(3)
  })

  it('accepts eval event types', () => {
    const types: MAPEventType[] = [
      'eval:submitted',
      'eval:scored',
      'eval:baseline',
    ]
    expect(types).toHaveLength(3)
  })

  it('creates valid MAPEvent with iteration types', () => {
    const event: MAPEvent = {
      id: 'test-1',
      ts: new Date().toISOString(),
      type: 'agent:iteration-complete',
      source: 'shadow',
      data: {
        iteration: 3,
        composite_score: 0.58,
        model_version: 'prg-0.7.0',
      },
    }
    expect(event.type).toBe('agent:iteration-complete')
    expect(event.data.iteration).toBe(3)
  })

  it('creates valid MAPEvent with eval types', () => {
    const event: MAPEvent = {
      id: 'eval-1',
      ts: new Date().toISOString(),
      type: 'eval:scored',
      source: 'arena',
      data: {
        team: 'lobsters',
        ndcg: 0.72,
        mrr: 0.65,
        composite: 0.58,
      },
    }
    expect(event.type).toBe('eval:scored')
  })
})
