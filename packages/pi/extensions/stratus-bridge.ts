/**
 * Stratus Bridge Extension
 *
 * Wires the RL prediction loop: predict before agent starts, resolve after,
 * emit training tuples, and buffer for nightly policy head training.
 *
 * @purpose RL flywheel — predict/resolve per agent turn, emit training tuples to Stratus
 */

import { existsSync, appendFileSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { PiContext, AgentStartEvent, AgentEndEvent } from "./types.js"
import { emitCustomEvent } from "./map-bridge.js"

const TRAINING_BUFFER = join(homedir(), ".jfl", "training-buffer.jsonl")

let projectRoot = ""
const sessionPredictions = new Map<string, string>()

function getTrainingBufferPath(): string {
  const dir = join(homedir(), ".jfl")
  mkdirSync(dir, { recursive: true })
  return TRAINING_BUFFER
}

async function getPredictor(root: string) {
  try {
    // @ts-ignore — resolved from jfl package at runtime
    const { Predictor } = await import("../../src/lib/predictor.js")
    return new Predictor(root)
  } catch {
    return null
  }
}

function buildProposal(event: AgentStartEvent) {
  return {
    description: event.prompt?.slice(0, 200) ?? "agent task",
    change_type: "feature" as const,
    scope: "medium" as const,
  }
}

export async function onAgentStart(ctx: PiContext, event: AgentStartEvent): Promise<void> {
  if (!projectRoot) return

  const predictor = await getPredictor(projectRoot)
  if (!predictor) return

  try {
    const prediction = await predictor.predict({
      proposal: buildProposal(event),
      current_score: 0,
      goal: "improve project quality",
      recent_trajectory: [],
    })

    const key = `${ctx.session.id}:${Date.now()}`
    sessionPredictions.set(key, prediction.prediction_id)

    ctx.session.custom["last_prediction_id"] = prediction.prediction_id
    ctx.session.custom["last_prediction_key"] = key

    ctx.log(`Stratus prediction: ${prediction.recommendation} (Δ${prediction.predicted_delta.toFixed(3)})`, "debug")
  } catch (err) {
    ctx.log(`Stratus predict failed: ${err}`, "debug")
  }
}

export async function onAgentEnd(ctx: PiContext, event: AgentEndEvent): Promise<void> {
  if (!projectRoot) return

  const predictionId = ctx.session.custom["last_prediction_id"] as string | undefined
  if (!predictionId) return

  const predictor = await getPredictor(projectRoot)
  if (!predictor) return

  try {
    const actualDelta = event.exitReason === "success" ? 0.05 : 0.0
    await predictor.resolve(predictionId, actualDelta, {
      eval_run_id: ctx.session.id,
      resolved_at: new Date().toISOString(),
    })

    const tuple = {
      ts: new Date().toISOString(),
      session_id: ctx.session.id,
      prediction_id: predictionId,
      actual_delta: actualDelta,
      turn_count: event.turnCount ?? 0,
      model: event.model,
      exit_reason: event.exitReason,
    }

    appendFileSync(getTrainingBufferPath(), JSON.stringify(tuple) + "\n")
    await emitCustomEvent(ctx, "training:tuple:added", tuple)

    delete ctx.session.custom["last_prediction_id"]
    delete ctx.session.custom["last_prediction_key"]
  } catch (err) {
    ctx.log(`Stratus resolve failed: ${err}`, "debug")
  }
}

export function setProjectRoot(root: string): void {
  projectRoot = root
}

export function initStratusBridge(root: string): void {
  projectRoot = root
}
