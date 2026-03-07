/**
 * @purpose Type definitions for the eval framework — agent-agnostic eval tracking
 */

export interface EvalEntry {
  v: 1
  ts: string
  agent: string
  run_id: string
  dataset?: string
  model_version?: string
  metrics: Record<string, number>
  composite?: number
  predictions?: Record<string, number>
  delta?: Record<string, number>
  session?: string
  notes?: string
}
