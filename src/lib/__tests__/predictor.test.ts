/**
 * Predictor Unit Tests
 *
 * @purpose Test Predictor class constructor defaults, predict, resolve, and getAccuracy
 */

const mockExistsSync = jest.fn()
const mockReadFileSync = jest.fn()
const mockWriteFileSync = jest.fn()
const mockAppendFileSync = jest.fn()
const mockMkdirSync = jest.fn()

jest.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  appendFileSync: mockAppendFileSync,
  mkdirSync: mockMkdirSync,
}))

jest.mock('../telemetry.js', () => ({
  telemetry: { track: jest.fn() },
}))

const mockFetch = jest.fn()
;(globalThis as any).fetch = mockFetch

import { Predictor, PredictionInput } from '../predictor'

function makePredictionInput(overrides: Partial<PredictionInput> = {}): PredictionInput {
  return {
    proposal: {
      description: 'fix flaky test',
      change_type: 'fix',
      scope: 'small',
    },
    current_score: 0.72,
    goal: 'improve eval composite score',
    recent_trajectory: [],
    ...overrides,
  }
}

function makePredictionRecord(id: string, opts: { resolved?: boolean } = {}) {
  const record: any = {
    prediction_id: id,
    ts: '2026-03-01T00:00:00.000Z',
    proposal: { description: 'test', change_type: 'fix', scope: 'small' },
    input_score: 0.70,
    prediction: {
      delta: 0.05,
      score: 0.75,
      confidence: 0.8,
      recommendation: 'proceed',
      method: 'chat',
      brain_goal_proximity: 0,
    },
    actual: null,
    accuracy: null,
  }
  if (opts.resolved) {
    record.actual = { delta: 0.04, score: 0.74, eval_run_id: 'run-1', resolved_at: '2026-03-01T01:00:00.000Z' }
    record.accuracy = { delta_error: 0.01, direction_correct: true, calibration: 0.75 }
  }
  return record
}

describe('Predictor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
  })

  describe('constructor defaults', () => {
    it('uses default baseUrl and model when no options provided', () => {
      const predictor = new Predictor({ projectRoot: '/tmp/test-project' })
      expect(predictor).toBeInstanceOf(Predictor)
      expect(typeof predictor.predict).toBe('function')
      expect(typeof predictor.resolve).toBe('function')
      expect(typeof predictor.getAccuracy).toBe('function')
    })

    it('accepts custom baseUrl and model', () => {
      const predictor = new Predictor({
        baseUrl: 'https://custom.api',
        model: 'custom-model',
        projectRoot: '/tmp/test-project',
      })
      expect(predictor).toBeInstanceOf(Predictor)
    })
  })

  describe('predict', () => {
    it('throws when both fetch calls fail (network error)', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Connection refused'))

      const predictor = new Predictor({
        baseUrl: 'https://test.api',
        apiKey: 'test-key',
        projectRoot: '/tmp/test-project',
      })

      await expect(predictor.predict(makePredictionInput())).rejects.toThrow(
        'Both Stratus endpoints failed'
      )
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('throws when both endpoints return non-200', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          text: async () => 'Bad Gateway',
        })

      const predictor = new Predictor({
        baseUrl: 'https://test.api',
        apiKey: 'test-key',
        projectRoot: '/tmp/test-project',
      })

      await expect(predictor.predict(makePredictionInput())).rejects.toThrow(
        'Both Stratus endpoints failed'
      )
    })

    it('falls back to chat-only when rollout fails', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Rollout timeout'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'chat-1',
            choices: [{
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  predicted_delta: 0.03,
                  confidence: 0.7,
                  reasoning: 'Chat-only fallback.',
                  risks: [],
                  recommendation: 'proceed',
                }),
              },
              finish_reason: 'stop',
            }],
          }),
        })

      mockMkdirSync.mockReturnValue(undefined)

      const predictor = new Predictor({
        baseUrl: 'https://test.api',
        apiKey: 'test-key',
        projectRoot: '/tmp/test-project',
      })

      const result = await predictor.predict(makePredictionInput())
      expect(result.method).toBe('chat')
      expect(result.predicted_delta).toBe(0.03)
    })

    it('falls back to rollout-only when chat fails', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'rollout-1',
            object: 'rollout',
            created: Date.now(),
            goal: 'test',
            initial_state: '{}',
            action_sequence: [],
            predictions: [
              {
                step: 1,
                action: { step: 1, action_id: 1, action_name: 'fix', action_category: 'code' },
                current_state: { step: 0, magnitude: 0.5, confidence: 'high' },
                predicted_state: { step: 1, magnitude: 0.6, confidence: 'high' },
                state_change: 0.1,
                interpretation: 'positive',
                brain_confidence: 0.85,
                brain_goal_proximity: 0.7,
                brain_alternatives: null,
              },
            ],
          }),
        })
        .mockRejectedValueOnce(new Error('Chat timeout'))

      mockMkdirSync.mockReturnValue(undefined)

      const predictor = new Predictor({
        baseUrl: 'https://test.api',
        apiKey: 'test-key',
        projectRoot: '/tmp/test-project',
      })

      const result = await predictor.predict(makePredictionInput())
      expect(result.method).toBe('rollout')
      expect(result.brain_goal_proximity).toBe(0.7)
    })

    it('calls both rollout and chat endpoints and returns ensemble result', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'rollout-1',
            object: 'rollout',
            created: Date.now(),
            goal: 'test',
            initial_state: '{}',
            action_sequence: [],
            predictions: [
              {
                step: 1,
                action: { step: 1, action_id: 1, action_name: 'fix', action_category: 'code' },
                current_state: { step: 0, magnitude: 0.5, confidence: 'high' },
                predicted_state: { step: 1, magnitude: 0.6, confidence: 'high' },
                state_change: 0.1,
                interpretation: 'positive',
                brain_confidence: 0.85,
                brain_goal_proximity: 0.7,
                brain_alternatives: null,
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'chat-1',
            choices: [{
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  predicted_delta: 0.05,
                  confidence: 0.8,
                  reasoning: 'Fix addresses failing test directly.',
                  risks: [{ description: 'minor scope creep', severity: 'low' }],
                  recommendation: 'proceed',
                }),
              },
              finish_reason: 'stop',
            }],
          }),
        })

      mockExistsSync.mockReturnValue(false)
      mockMkdirSync.mockReturnValue(undefined)

      const predictor = new Predictor({
        baseUrl: 'https://test.api',
        apiKey: 'test-key',
        projectRoot: '/tmp/test-project',
      })

      const result = await predictor.predict(makePredictionInput())

      expect(result).toHaveProperty('prediction_id')
      expect(result).toHaveProperty('predicted_delta')
      expect(result).toHaveProperty('predicted_score')
      expect(result).toHaveProperty('confidence')
      expect(result).toHaveProperty('recommendation')
      expect(result.method).toBe('ensemble')
      expect(typeof result.predicted_delta).toBe('number')
      expect(typeof result.confidence).toBe('number')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('resolve', () => {
    it('handles malformed JSON in predictions file gracefully', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(
        '{"prediction_id":"pred_good"}\nnot valid json\n{"prediction_id":"pred_also_good"}\n'
      )

      const predictor = new Predictor({ projectRoot: '/tmp/test-project' })

      await expect(
        predictor.resolve('pred_not_here', 0.02, 0.74, 'run-1')
      ).rejects.toThrow('Prediction pred_not_here not found')
    })

    it('throws on unknown prediction ID', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('')

      const predictor = new Predictor({ projectRoot: '/tmp/test-project' })

      await expect(
        predictor.resolve('pred_nonexistent', 0.03, 0.75, 'run-1')
      ).rejects.toThrow('Prediction pred_nonexistent not found')
    })

    it('resolves an existing prediction and computes accuracy', async () => {
      const record = makePredictionRecord('pred_abc12345')
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(JSON.stringify(record) + '\n')

      const predictor = new Predictor({ projectRoot: '/tmp/test-project' })

      await predictor.resolve('pred_abc12345', 0.04, 0.74, 'run-2')

      expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
      const written = mockWriteFileSync.mock.calls[0][1] as string
      const updated = JSON.parse(written.trim())
      expect(updated.actual).not.toBeNull()
      expect(updated.actual.delta).toBe(0.04)
      expect(updated.accuracy).not.toBeNull()
      expect(updated.accuracy.direction_correct).toBe(true)
    })
  })

  describe('getAccuracy', () => {
    it('returns zero stats when all records are unresolved', () => {
      const r1 = makePredictionRecord('pred_1')
      const r2 = makePredictionRecord('pred_2')
      const r3 = makePredictionRecord('pred_3')

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(
        [r1, r2, r3].map(r => JSON.stringify(r)).join('\n') + '\n'
      )

      const predictor = new Predictor({ projectRoot: '/tmp/test-project' })
      const accuracy = predictor.getAccuracy()

      expect(accuracy.total).toBe(3)
      expect(accuracy.resolved).toBe(0)
      expect(accuracy.direction_accuracy).toBe(0)
      expect(accuracy.mean_delta_error).toBe(0)
      expect(accuracy.calibration).toBe(0)
    })

    it('returns correct shape with no records', () => {
      mockExistsSync.mockReturnValue(false)

      const predictor = new Predictor({ projectRoot: '/tmp/test-project' })
      const accuracy = predictor.getAccuracy()

      expect(accuracy).toEqual({
        total: 0,
        resolved: 0,
        direction_accuracy: 0,
        mean_delta_error: 0,
        calibration: 0,
      })
    })

    it('computes stats from resolved records', () => {
      const r1 = makePredictionRecord('pred_1', { resolved: true })
      const r2 = makePredictionRecord('pred_2', { resolved: true })
      const r3 = makePredictionRecord('pred_3')

      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(
        [r1, r2, r3].map(r => JSON.stringify(r)).join('\n') + '\n'
      )

      const predictor = new Predictor({ projectRoot: '/tmp/test-project' })
      const accuracy = predictor.getAccuracy()

      expect(accuracy.total).toBe(3)
      expect(accuracy.resolved).toBe(2)
      expect(accuracy.direction_accuracy).toBe(1)
      expect(typeof accuracy.mean_delta_error).toBe('number')
      expect(typeof accuracy.calibration).toBe('number')
    })
  })
})
