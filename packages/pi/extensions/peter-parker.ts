/**
 * Peter Parker Extension — Full Orchestrator
 *
 * Replaces the WebSocket bridge with a proper Pi extension orchestrator.
 * Subscribes to MAP events, queries Stratus predictor for optimal action,
 * spawns Pi RPC subprocesses, and runs the review loop (max 5 iterations).
 *
 * @purpose Full Peter Parker orchestrator — review loop with Stratus dispatch via Pi RPC
 */

import { spawn } from "child_process"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import type { PiContext, JflConfig } from "./types.js"
import { emitCustomEvent, hubUrl, authToken } from "./map-bridge.js"

interface ReviewTask {
  id: string
  prompt: string
  source: string
  priority?: number
}

interface PeterIteration {
  taskId: string
  iteration: number
  agentPid?: number
  startTime: Date
  prediction?: { delta: number; recommendation: string }
  result?: "success" | "failed" | "max_iterations"
}

const MAX_ITERATIONS = 5
let projectRoot = ""
let maxIterations = MAX_ITERATIONS
let activeIterations = new Map<string, PeterIteration>()

async function getPredictor(root: string) {
  try {
    // @ts-ignore — resolved from jfl package at runtime
    const { Predictor } = await import("../../src/lib/predictor.js")
    return new Predictor(root)
  } catch {
    return null
  }
}

async function spawnPiAgent(
  ctx: PiContext,
  task: ReviewTask,
  extensionPath: string
): Promise<{ exitCode: number | null }> {
  return new Promise((resolve) => {
    const args = [
      "--mode", "rpc",
      "--extension", extensionPath,
      "--task", task.prompt,
      "--yolo",
    ]

    ctx.log(`PP: spawning agent for task ${task.id}`, "debug")

    const proc = spawn("pi", args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        JFL_SESSION_ID: ctx.session.id,
        JFL_TASK_ID: task.id,
      },
    })

    proc.stdout?.on("data", (d: Buffer) => ctx.log(`PP agent: ${d.toString().trim()}`, "debug"))
    proc.stderr?.on("data", (d: Buffer) => ctx.log(`PP agent err: ${d.toString().trim()}`, "debug"))

    proc.on("close", (code) => resolve({ exitCode: code }))
    proc.on("error", () => resolve({ exitCode: -1 }))

    setTimeout(() => {
      proc.kill()
      resolve({ exitCode: -1 })
    }, 5 * 60 * 1000)
  })
}

async function runReviewLoop(ctx: PiContext, task: ReviewTask): Promise<void> {
  const current = activeIterations.get(task.id)
  const iteration = current ? current.iteration + 1 : 1

  if (iteration > maxIterations) {
    ctx.log(`PP: max iterations (${maxIterations}) reached for task ${task.id}`, "warn")
    await emitCustomEvent(ctx, "peter:max-iterations", { taskId: task.id, iterations: iteration - 1 })
    activeIterations.delete(task.id)
    return
  }

  const iterRecord: PeterIteration = {
    taskId: task.id,
    iteration,
    startTime: new Date(),
  }

  const predictor = await getPredictor(projectRoot)
  if (predictor) {
    try {
      const prediction = await predictor.predict({
        proposal: {
          description: task.prompt,
          change_type: "fix",
          scope: "small",
        },
        current_score: 0,
        goal: "resolve review findings",
        recent_trajectory: [],
      })
      iterRecord.prediction = { delta: prediction.predicted_delta, recommendation: prediction.recommendation }

      if (prediction.recommendation === "abandon") {
        ctx.log(`PP: predictor recommends abandon for task ${task.id}`, "info")
        activeIterations.delete(task.id)
        return
      }
    } catch {}
  }

  activeIterations.set(task.id, iterRecord)
  await emitCustomEvent(ctx, "peter:dispatched", { taskId: task.id, iteration, prediction: iterRecord.prediction })

  const extensionPath = join(projectRoot, "node_modules", "@jfl", "pi", "dist", "extensions", "index.js")
  const result = await spawnPiAgent(ctx, task, extensionPath)

  iterRecord.result = result.exitCode === 0 ? "success" : "failed"
  activeIterations.set(task.id, iterRecord)

  if (result.exitCode !== 0) {
    ctx.log(`PP: agent failed (iteration ${iteration}), will retry`, "info")
    await runReviewLoop(ctx, task)
  } else {
    await emitCustomEvent(ctx, "peter:completed", { taskId: task.id, iterations: iteration })
    activeIterations.delete(task.id)
  }
}

export async function setupPeterParker(ctx: PiContext, config: JflConfig): Promise<void> {
  projectRoot = ctx.session.projectRoot
  maxIterations = config.pi?.max_peter_iterations ?? MAX_ITERATIONS

  ctx.on("map:eval:scored", async (data) => {
    const event = data as { taskId?: string; score?: number; findings?: string[] }
    if (!event.taskId || !event.findings?.length) return

    const task: ReviewTask = {
      id: event.taskId,
      prompt: `Review findings to address:\n${event.findings.join("\n")}`,
      source: "eval:scored",
    }
    await runReviewLoop(ctx, task)
  })

  ctx.on("map:review:findings", async (data) => {
    const event = data as { id?: string; findings?: string; priority?: number }
    if (!event.findings) return

    const task: ReviewTask = {
      id: event.id ?? `review-${Date.now()}`,
      prompt: event.findings,
      source: "review:findings",
      priority: event.priority,
    }
    await runReviewLoop(ctx, task)
  })

  ctx.on("map:task:requested", async (data) => {
    const event = data as { id?: string; prompt?: string }
    if (!event.prompt) return

    const task: ReviewTask = {
      id: event.id ?? `task-${Date.now()}`,
      prompt: event.prompt,
      source: "task:requested",
    }
    await runReviewLoop(ctx, task)
  })

  ctx.registerCommand({
    name: "peter",
    description: "Peter Parker orchestrator — run a task through the review loop",
    async handler(args, ctx) {
      if (!args.trim()) {
        ctx.ui.notify("Usage: /peter <task description>", { level: "info" })
        return
      }
      const task: ReviewTask = {
        id: `peter-${Date.now()}`,
        prompt: args.trim(),
        source: "manual",
      }
      ctx.ui.notify(`Starting Peter Parker loop for: ${args.trim().slice(0, 60)}`, { level: "info" })
      await runReviewLoop(ctx, task)
    },
  })
}
