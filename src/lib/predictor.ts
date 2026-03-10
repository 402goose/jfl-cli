/**
 * Stratus Prediction Engine (Phase 2 RL)
 *
 * Combines Stratus rollout (fast, structural JEPA world model) with
 * chat (slow, semantic reasoning) into an ensemble prediction that
 * estimates eval score delta before executing changes.
 *
 * @purpose Predict eval score delta before executing changes — Stratus as world model / value function
 */

import { readFileSync, existsSync, appendFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'

export interface Proposal {
  description: string
  files_affected?: string[]
  change_type: 'fix' | 'refactor' | 'feature' | 'config'
  scope: 'small' | 'medium' | 'large'
}

export interface PredictionInput {
  proposal: Proposal
  current_score: number
  failing_evals?: string[]
  goal: string
  recent_trajectory: Array<{ action: string; delta: number; reward: number }>
}

export interface PredictionOutput {
  prediction_id: string
  predicted_delta: number
  predicted_score: number
  confidence: number
  reasoning: string
  risks: Array<{ description: string; severity: 'low' | 'medium' | 'high' }>
  recommendation: 'proceed' | 'revise' | 'abandon'
  brain_goal_proximity: number
  method: 'rollout' | 'chat' | 'ensemble'
  ts: string
}

export interface PredictionRecord {
  prediction_id: string
  ts: string
  proposal: Proposal
  input_score: number
  prediction: {
    delta: number
    score: number
    confidence: number
    recommendation: string
    method: string
    brain_goal_proximity: number
  }
  actual: {
    delta: number
    score: number
    eval_run_id: string
    resolved_at: string
  } | null
  accuracy: {
    delta_error: number
    direction_correct: boolean
    calibration: number
  } | null
}

interface RolloutResponse {
  id: string
  object: string
  created: number
  goal: string
  initial_state: string
  action_sequence: Array<{
    step: number
    action_id: number
    action_name: string
    action_category: string
  }>
  predictions: Array<{
    step: number
    action: { step: number; action_id: number; action_name: string; action_category: string }
    current_state: { step: number; magnitude: number; confidence: string }
    predicted_state: { step: number; magnitude: number; confidence: string }
    state_change: number
    interpretation: string
    brain_confidence: number
    brain_goal_proximity: number
    brain_alternatives: unknown
  }>
}

interface ChatResponse {
  id: string
  choices: Array<{
    message: { role: string; content: string }
    finish_reason: string
  }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  stratus?: { confidence: number }
}

interface ParsedChatPrediction {
  predicted_delta: number
  confidence: number
  reasoning: string
  risks: Array<{ description: string; severity: 'low' | 'medium' | 'high' }>
  recommendation: 'proceed' | 'revise' | 'abandon'
}

function findProjectRoot(): string {
  let dir = process.cwd()
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.jfl', 'config.json'))) return dir
    if (existsSync(join(dir, '.jfl'))) return dir
    dir = dirname(dir)
  }
  return process.cwd()
}

export class Predictor {
  private baseUrl: string
  private apiKey: string
  private model: string
  private predictionsPath: string

  constructor(options: {
    baseUrl?: string
    apiKey?: string
    model?: string
    projectRoot?: string
  } = {}) {
    this.baseUrl = options.baseUrl || process.env.STRATUS_API_URL || 'https://api.stratus.run'
    this.apiKey = options.apiKey || process.env.STRATUS_API_KEY || ''
    this.model = options.model || 'stratus-x1ac-base-claude-sonnet-4-6'
    const root = options.projectRoot || findProjectRoot()
    this.predictionsPath = join(root, '.jfl', 'predictions', 'predictions.jsonl')
  }

  async predict(input: PredictionInput): Promise<PredictionOutput> {
    const predictionId = `pred_${randomUUID().slice(0, 8)}`
    const ts = new Date().toISOString()

    const [rolloutResult, chatResult] = await Promise.allSettled([
      this.callRollout(input),
      this.callChat(input),
    ])

    const rollout = rolloutResult.status === 'fulfilled' ? rolloutResult.value : null
    const chat = chatResult.status === 'fulfilled' ? chatResult.value : null

    let output: PredictionOutput

    if (chat && rollout) {
      output = this.ensemble(predictionId, ts, input, rollout, chat)
    } else if (chat) {
      output = this.fromChat(predictionId, ts, input, chat)
    } else if (rollout) {
      output = this.fromRollout(predictionId, ts, input, rollout)
    } else {
      const rolloutErr = rolloutResult.status === 'rejected' ? rolloutResult.reason?.message : 'unknown'
      const chatErr = chatResult.status === 'rejected' ? chatResult.reason?.message : 'unknown'
      throw new Error(`Both Stratus endpoints failed. Rollout: ${rolloutErr}. Chat: ${chatErr}`)
    }

    this.logPrediction(output, input)

    try {
      const { telemetry } = await import('./telemetry.js')
      telemetry.track({
        category: 'performance',
        event: 'predictor:predict',
        success: true,
        stratus_confidence: output.confidence,
        feature_context: JSON.stringify({
          method: output.method,
          predicted_delta: output.predicted_delta,
          recommendation: output.recommendation,
          brain_goal_proximity: output.brain_goal_proximity,
          change_type: input.proposal.change_type,
          scope: input.proposal.scope,
        }),
      })
    } catch {
      // telemetry is fire-and-forget
    }

    return output
  }

  async resolve(
    predictionId: string,
    actualDelta: number,
    actualScore: number,
    evalRunId: string
  ): Promise<void> {
    const records = this.readRecords()
    const idx = records.findIndex(r => r.prediction_id === predictionId)

    if (idx === -1) {
      throw new Error(`Prediction ${predictionId} not found`)
    }

    const record = records[idx]
    record.actual = {
      delta: actualDelta,
      score: actualScore,
      eval_run_id: evalRunId,
      resolved_at: new Date().toISOString(),
    }

    const deltaError = Math.abs(record.prediction.delta - actualDelta)
    const directionCorrect =
      (record.prediction.delta >= 0 && actualDelta >= 0) ||
      (record.prediction.delta < 0 && actualDelta < 0)
    const calibration = record.prediction.confidence > 0
      ? 1 - Math.abs(deltaError / Math.max(Math.abs(actualDelta), 0.001))
      : 0

    record.accuracy = {
      delta_error: deltaError,
      direction_correct: directionCorrect,
      calibration: Math.max(0, Math.min(1, calibration)),
    }

    records[idx] = record
    this.writeRecords(records)

    try {
      const { telemetry } = await import('./telemetry.js')
      telemetry.track({
        category: 'performance',
        event: 'predictor:resolve',
        success: directionCorrect,
        feature_context: JSON.stringify({
          prediction_id: predictionId,
          delta_error: deltaError,
          direction_correct: directionCorrect,
          calibration: record.accuracy.calibration,
        }),
      })
    } catch {
      // fire-and-forget
    }
  }

  getAccuracy(limit?: number): {
    total: number
    resolved: number
    direction_accuracy: number
    mean_delta_error: number
    calibration: number
  } {
    const records = this.readRecords()
    const resolved = records.filter(r => r.accuracy !== null)
    const subset = limit ? resolved.slice(-limit) : resolved

    if (subset.length === 0) {
      return { total: records.length, resolved: 0, direction_accuracy: 0, mean_delta_error: 0, calibration: 0 }
    }

    const directionCorrect = subset.filter(r => r.accuracy!.direction_correct).length
    const meanDeltaError = subset.reduce((s, r) => s + r.accuracy!.delta_error, 0) / subset.length
    const meanCalibration = subset.reduce((s, r) => s + r.accuracy!.calibration, 0) / subset.length

    return {
      total: records.length,
      resolved: subset.length,
      direction_accuracy: directionCorrect / subset.length,
      mean_delta_error: meanDeltaError,
      calibration: meanCalibration,
    }
  }

  getHistory(limit: number = 20): PredictionRecord[] {
    const records = this.readRecords()
    return records.slice(-limit)
  }

  private async callRollout(input: PredictionInput): Promise<RolloutResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)

    try {
      const state = {
        current_score: input.current_score,
        proposal: input.proposal,
        failing_evals: input.failing_evals || [],
        recent_trajectory: input.recent_trajectory,
      }

      const response = await fetch(`${this.baseUrl}/v1/rollout`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.model,
          state,
          goal: input.goal,
          horizon: 5,
          return_confidence: true,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Rollout API error (${response.status}): ${errText.slice(0, 200)}`)
      }

      return await response.json() as RolloutResponse
    } finally {
      clearTimeout(timer)
    }
  }

  private async callChat(input: PredictionInput): Promise<ParsedChatPrediction> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)

    try {
      const trajectoryStr = input.recent_trajectory.length > 0
        ? input.recent_trajectory
            .map(t => `  - ${t.action}: delta=${t.delta >= 0 ? '+' : ''}${t.delta.toFixed(4)}, reward=${t.reward.toFixed(2)}`)
            .join('\n')
        : '  (no prior trajectory)'

      const failingStr = input.failing_evals && input.failing_evals.length > 0
        ? input.failing_evals.map(e => `  - ${e}`).join('\n')
        : '  (none specified)'

      const prompt = `You are a prediction engine for an RL-based eval optimization loop. Given a proposed code change and current eval trajectory, predict whether the change will improve the eval composite score.

Current composite score: ${input.current_score}
Goal: ${input.goal}

Proposed change:
  Description: ${input.proposal.description}
  Type: ${input.proposal.change_type}
  Scope: ${input.proposal.scope}
  Files: ${(input.proposal.files_affected || []).join(', ') || 'unspecified'}

Failing evals:
${failingStr}

Recent trajectory (action, delta, reward):
${trajectoryStr}

Respond in this exact JSON format (no markdown fences):
{
  "predicted_delta": <number between -1 and 1>,
  "confidence": <number between 0 and 1>,
  "reasoning": "<2-3 sentence explanation>",
  "risks": [{"description": "<risk>", "severity": "low|medium|high"}],
  "recommendation": "proceed|revise|abandon"
}

Base your prediction on:
1. How similar changes performed in the trajectory
2. Whether the change directly addresses failing evals
3. The scope and risk profile of the change type
4. Diminishing returns patterns in the trajectory`

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 1000,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Chat API error (${response.status}): ${errText.slice(0, 200)}`)
      }

      const result = await response.json() as ChatResponse
      const content = result.choices?.[0]?.message?.content || ''

      return this.parseChatResponse(content)
    } finally {
      clearTimeout(timer)
    }
  }

  private parseChatResponse(content: string): ParsedChatPrediction {
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Chat response did not contain valid JSON')
    }

    try {
      const parsed = JSON.parse(jsonMatch[0])

      const delta = typeof parsed.predicted_delta === 'number'
        ? Math.max(-1, Math.min(1, parsed.predicted_delta))
        : 0

      const confidence = typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5

      const recommendation = ['proceed', 'revise', 'abandon'].includes(parsed.recommendation)
        ? parsed.recommendation as 'proceed' | 'revise' | 'abandon'
        : 'revise'

      const risks = Array.isArray(parsed.risks)
        ? parsed.risks.map((r: any) => ({
            description: String(r.description || ''),
            severity: ['low', 'medium', 'high'].includes(r.severity) ? r.severity : 'medium',
          }))
        : []

      return {
        predicted_delta: delta,
        confidence,
        reasoning: String(parsed.reasoning || ''),
        risks,
        recommendation,
      }
    } catch {
      throw new Error(`Failed to parse chat prediction JSON: ${content.slice(0, 200)}`)
    }
  }

  private ensemble(
    predictionId: string,
    ts: string,
    input: PredictionInput,
    rollout: RolloutResponse,
    chat: ParsedChatPrediction,
  ): PredictionOutput {
    const avgGoalProximity = rollout.predictions.length > 0
      ? rollout.predictions.reduce((s, p) => s + p.brain_goal_proximity, 0) / rollout.predictions.length
      : 0.5

    const rolloutDelta = (avgGoalProximity - 0.5) * 0.2
    const ensembleDelta = chat.predicted_delta * 0.6 + rolloutDelta * 0.4

    const avgBrainConf = rollout.predictions.length > 0
      ? rollout.predictions.reduce((s, p) => s + p.brain_confidence, 0) / rollout.predictions.length
      : 0.5
    const ensembleConfidence = chat.confidence * 0.6 + avgBrainConf * 0.4

    return {
      prediction_id: predictionId,
      predicted_delta: Math.round(ensembleDelta * 10000) / 10000,
      predicted_score: Math.round((input.current_score + ensembleDelta) * 10000) / 10000,
      confidence: Math.round(ensembleConfidence * 100) / 100,
      reasoning: chat.reasoning,
      risks: chat.risks,
      recommendation: chat.recommendation,
      brain_goal_proximity: Math.round(avgGoalProximity * 10000) / 10000,
      method: 'ensemble',
      ts,
    }
  }

  private fromChat(
    predictionId: string,
    ts: string,
    input: PredictionInput,
    chat: ParsedChatPrediction,
  ): PredictionOutput {
    return {
      prediction_id: predictionId,
      predicted_delta: chat.predicted_delta,
      predicted_score: Math.round((input.current_score + chat.predicted_delta) * 10000) / 10000,
      confidence: chat.confidence,
      reasoning: chat.reasoning,
      risks: chat.risks,
      recommendation: chat.recommendation,
      brain_goal_proximity: 0,
      method: 'chat',
      ts,
    }
  }

  private fromRollout(
    predictionId: string,
    ts: string,
    input: PredictionInput,
    rollout: RolloutResponse,
  ): PredictionOutput {
    const avgGoalProximity = rollout.predictions.length > 0
      ? rollout.predictions.reduce((s, p) => s + p.brain_goal_proximity, 0) / rollout.predictions.length
      : 0.5
    const avgBrainConf = rollout.predictions.length > 0
      ? rollout.predictions.reduce((s, p) => s + p.brain_confidence, 0) / rollout.predictions.length
      : 0.5

    const rolloutDelta = (avgGoalProximity - 0.5) * 0.2

    const recommendation: 'proceed' | 'revise' | 'abandon' =
      avgGoalProximity > 0.6 ? 'proceed' :
      avgGoalProximity > 0.4 ? 'revise' : 'abandon'

    return {
      prediction_id: predictionId,
      predicted_delta: Math.round(rolloutDelta * 10000) / 10000,
      predicted_score: Math.round((input.current_score + rolloutDelta) * 10000) / 10000,
      confidence: Math.round(avgBrainConf * 100) / 100,
      reasoning: `Rollout-only prediction. Brain goal proximity: ${avgGoalProximity.toFixed(4)}. ` +
        `${rollout.predictions.length} steps evaluated with avg confidence ${avgBrainConf.toFixed(4)}.`,
      risks: [],
      recommendation,
      brain_goal_proximity: Math.round(avgGoalProximity * 10000) / 10000,
      method: 'rollout',
      ts,
    }
  }

  private logPrediction(output: PredictionOutput, input: PredictionInput): void {
    const record: PredictionRecord = {
      prediction_id: output.prediction_id,
      ts: output.ts,
      proposal: input.proposal,
      input_score: input.current_score,
      prediction: {
        delta: output.predicted_delta,
        score: output.predicted_score,
        confidence: output.confidence,
        recommendation: output.recommendation,
        method: output.method,
        brain_goal_proximity: output.brain_goal_proximity,
      },
      actual: null,
      accuracy: null,
    }

    const dir = dirname(this.predictionsPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(this.predictionsPath, JSON.stringify(record) + '\n')
  }

  private readRecords(): PredictionRecord[] {
    if (!existsSync(this.predictionsPath)) return []
    const content = readFileSync(this.predictionsPath, 'utf-8')
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line) as PredictionRecord
        } catch {
          return null
        }
      })
      .filter((r): r is PredictionRecord => r !== null)
  }

  private writeRecords(records: PredictionRecord[]): void {
    const dir = dirname(this.predictionsPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.predictionsPath, records.map(r => JSON.stringify(r)).join('\n') + '\n')
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`
    return h
  }
}
