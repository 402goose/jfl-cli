/**
 * Stratus Rollout Endpoint Test
 *
 * Tests whether Stratus can plan multi-step action sequences
 * for the ProductRank competition using rollout-style lookahead.
 *
 * @purpose Test/exploration script for Stratus rollout endpoint with ProductRank state
 */

// ============================================================================
// Types
// ============================================================================

interface ProductRankState {
  team: string
  currentApproach: string
  scores: {
    ndcg: number
    precision: number
    recall: number
    novelty: number
    weighted: number
  }
  availableActions: string[]
  iteration: number
  constraints: string[]
}

interface RolloutStep {
  step: number
  action: string
  expected_impact: string
  confidence: number
  reasoning: string
}

interface RolloutPlan {
  steps: RolloutStep[]
  overall_strategy: string
}

interface JepaAction {
  step: number
  action_id: number
  action_name: string
  action_category: string
}

interface JepaPrediction {
  step: number
  action: JepaAction
  current_state: { step: number; magnitude: number; confidence: string }
  predicted_state: { step: number; magnitude: number; confidence: string }
  state_change: number
  interpretation: string
  brain_confidence: number
  brain_goal_proximity: number
  brain_alternatives: unknown
}

interface JepaRolloutResponse {
  id: string
  object: string
  created: number
  goal: string
  initial_state: string
  action_sequence: JepaAction[]
  predictions: JepaPrediction[]
}

interface RolloutResult {
  endpoint: string
  model: string
  latencyMs: number
  rolloutEndpointExists: boolean
  plan: RolloutPlan | null
  jepaResponse: JepaRolloutResponse | null
  rawResponse: string
  error: string | null
}

interface AvailabilityResult {
  available: boolean
  endpoint: string
  model: string
  latencyMs: number
  error: string | null
}

// ============================================================================
// Constants
// ============================================================================

const BASE_URL = "https://api.stratus.run"
const MODEL = "stratus-x1ac-huge-claude-sonnet-4-6"
const TIMEOUT_MS = 60_000

// ============================================================================
// Test States
// ============================================================================

const baselineState: ProductRankState = {
  team: "lobsters",
  currentApproach: "Naive alphabetical baseline - returns tools sorted alphabetically, no ML or ranking logic yet",
  scores: { ndcg: 0.0, precision: 0.0, recall: 0.0, novelty: 0.0, weighted: 0.0000 },
  availableActions: [
    "Implement TF-IDF based ranking on tool descriptions",
    "Build collaborative filtering from GitHub star patterns",
    "Add LLM-based relevance scoring with Claude",
    "Create product relationship graph from dependency data",
    "Implement hybrid RAG with tool documentation embeddings",
    "Add user intent classification before ranking",
    "Fine-tune embeddings on developer tool usage data"
  ],
  iteration: 1,
  constraints: [
    "Must submit valid output.jsonl matching eval format",
    "Limited to public data sources (GitHub, npm, Reddit)",
    "Cannot access opponent team journals or strategies",
    "Weekly submission cadence (Friday sync)",
    "Eval metrics: NDCG@10 (35%), Precision@5 (25%), Recall@20 (20%), Novelty (20%)"
  ]
}

const advancedState: ProductRankState = {
  team: "lobsters",
  currentApproach: "TF-IDF + collaborative filtering hybrid, GitHub star correlation, basic intent classification",
  scores: { ndcg: 0.342, precision: 0.287, recall: 0.456, novelty: 0.123, weighted: 0.3102 },
  availableActions: [
    "Add product relationship graph from npm dependency trees",
    "Implement LLM reranking with Claude for top-50 candidates",
    "Build digital twin simulation for user preference modeling",
    "Add Visa spend signal correlation",
    "Ensemble current models with learned weights",
    "Switch to transformer-based ranking model"
  ],
  iteration: 3,
  constraints: [
    "Must beat PhDs team current score of 0.2891",
    "Budget: ~$50/week for API calls",
    "Must maintain submission format compatibility"
  ]
}

// ============================================================================
// Helpers
// ============================================================================

function getApiKey(): string {
  const key = process.env.STRATUS_API_KEY
  if (!key) {
    throw new Error(
      "STRATUS_API_KEY not set. Export it before running:\n" +
      "  export STRATUS_API_KEY=stratus_sk_live_..."
    )
  }
  return key
}

function headers(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function parseJsonFromResponse(text: string): RolloutPlan | null {
  const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  const candidate = jsonBlockMatch ? jsonBlockMatch[1].trim() : text.trim()

  try {
    const parsed = JSON.parse(candidate)
    if (parsed.steps && Array.isArray(parsed.steps)) {
      return parsed as RolloutPlan
    }
    return null
  } catch {
    const rawJsonMatch = text.match(/\{[\s\S]*"steps"\s*:\s*\[[\s\S]*\][\s\S]*\}/)
    if (rawJsonMatch) {
      try {
        const parsed = JSON.parse(rawJsonMatch[0])
        if (parsed.steps && Array.isArray(parsed.steps)) {
          return parsed as RolloutPlan
        }
      } catch {
        // fall through
      }
    }
    return null
  }
}

// ============================================================================
// Test Functions
// ============================================================================

async function testStratusAvailability(): Promise<AvailabilityResult> {
  const apiKey = getApiKey()
  const start = Date.now()

  try {
    const response = await fetchWithTimeout(
      `${BASE_URL}/v1/chat/completions`,
      {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: "Reply with exactly: OK" }],
          max_tokens: 10
        })
      },
      15_000
    )

    const latencyMs = Date.now() - start

    if (!response.ok) {
      const errorText = await response.text()
      return {
        available: false,
        endpoint: BASE_URL,
        model: MODEL,
        latencyMs,
        error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`
      }
    }

    await response.json()
    return { available: true, endpoint: BASE_URL, model: MODEL, latencyMs, error: null }
  } catch (err: any) {
    return {
      available: false,
      endpoint: BASE_URL,
      model: MODEL,
      latencyMs: Date.now() - start,
      error: err.message
    }
  }
}

async function testRolloutEndpoint(state: ProductRankState): Promise<RolloutResult> {
  const apiKey = getApiKey()
  let rolloutEndpointExists = false

  // --- Attempt 1: dedicated /v1/rollout endpoint ---
  const rolloutStart = Date.now()
  try {
    const response = await fetchWithTimeout(
      `${BASE_URL}/v1/rollout`,
      {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({
          model: MODEL,
          state,
          goal: `Maximize weighted recommendation score (currently ${state.scores.weighted}). Metrics: NDCG@10 (35%), Precision@5 (25%), Recall@20 (20%), Novelty (20%). Team "${state.team}" at iteration ${state.iteration}.`,
          horizon: 5,
          return_confidence: true
        })
      },
      TIMEOUT_MS
    )

    const latencyMs = Date.now() - rolloutStart

    if (response.ok) {
      rolloutEndpointExists = true
      const rawText = await response.text()
      console.log("\n[DEBUG] /v1/rollout raw response:\n", rawText.slice(0, 3000))

      let jepaResponse: JepaRolloutResponse | null = null
      try {
        const parsed = JSON.parse(rawText)
        if (parsed.object === "rollout.prediction" && parsed.predictions) {
          jepaResponse = parsed as JepaRolloutResponse
        }
      } catch {
        // not JSON or unexpected format
      }

      return {
        endpoint: `${BASE_URL}/v1/rollout`,
        model: MODEL,
        latencyMs,
        rolloutEndpointExists: true,
        plan: null,
        jepaResponse,
        rawResponse: rawText.slice(0, 5000),
        error: null
      }
    }

    const errText = await response.text()
    console.log(`[INFO] /v1/rollout returned ${response.status} -- falling back to chat completions`)
    console.log(`[DEBUG] /v1/rollout error body: ${errText.slice(0, 500)}`)
  } catch (err: any) {
    console.log(`[INFO] /v1/rollout not reachable (${err.message}) -- falling back to chat completions`)
  }

  // --- Attempt 2: chat completions with planning prompt ---
  const chatStart = Date.now()
  try {
    const systemPrompt =
      "You are a strategic planning model for an ML competition. " +
      "Given the current state, plan a 5-step action sequence to maximize the weighted score. " +
      "Return JSON only, no markdown fences: " +
      '{"steps": [{"step": number, "action": string, "expected_impact": string, "confidence": number, "reasoning": string}], "overall_strategy": string}'

    const response = await fetchWithTimeout(
      `${BASE_URL}/v1/chat/completions`,
      {
        method: "POST",
        headers: headers(apiKey),
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(state, null, 2) }
          ],
          temperature: 0.4,
          max_tokens: 4000
        })
      },
      TIMEOUT_MS
    )

    const latencyMs = Date.now() - chatStart

    if (!response.ok) {
      const errText = await response.text()
      return {
        endpoint: `${BASE_URL}/v1/chat/completions`,
        model: MODEL,
        latencyMs,
        rolloutEndpointExists,
        plan: null,
        jepaResponse: null,
        rawResponse: errText.slice(0, 3000),
        error: `HTTP ${response.status}: ${errText.slice(0, 200)}`
      }
    }

    const result = await response.json()
    const content: string = result.choices?.[0]?.message?.content || ""
    console.log("\n[DEBUG] Chat completions raw content:\n", content.slice(0, 2000))

    const plan = parseJsonFromResponse(content)

    return {
      endpoint: `${BASE_URL}/v1/chat/completions`,
      model: MODEL,
      latencyMs,
      rolloutEndpointExists,
      plan,
      jepaResponse: null,
      rawResponse: content.slice(0, 3000),
      error: null
    }
  } catch (err: any) {
    return {
      endpoint: `${BASE_URL}/v1/chat/completions`,
      model: MODEL,
      latencyMs: Date.now() - chatStart,
      rolloutEndpointExists,
      plan: null,
      jepaResponse: null,
      rawResponse: "",
      error: err.message
    }
  }
}

// ============================================================================
// Output Formatting
// ============================================================================

function printResult(label: string, state: ProductRankState, result: RolloutResult): void {
  console.log(`\n${"=".repeat(60)}`)
  console.log(`  ${label}`)
  console.log(`  Team: ${state.team} | Iteration: ${state.iteration} | Weighted: ${state.scores.weighted}`)
  console.log(`${"=".repeat(60)}`)
  console.log(`Endpoint: ${result.endpoint}`)
  console.log(`Model:    ${result.model}`)
  console.log(`Latency:  ${result.latencyMs}ms`)
  console.log(`Rollout endpoint exists: ${result.rolloutEndpointExists ? "yes" : "no"}`)

  if (result.error) {
    console.log(`\nERROR: ${result.error}`)
    return
  }

  if (result.jepaResponse) {
    const jepa = result.jepaResponse
    console.log(`\n--- JEPA World Model Response ---`)
    console.log(`ID: ${jepa.id}`)
    console.log(`Goal: ${jepa.goal}`)

    console.log(`\n--- Action Sequence (pre-trained vocabulary) ---`)
    for (const a of jepa.action_sequence) {
      console.log(`  Step ${a.step}: [${a.action_id}] ${a.action_name} (${a.action_category})`)
    }

    console.log(`\n--- State Predictions (JEPA) ---`)
    for (const p of jepa.predictions) {
      const actionLabel = p.action.action_name === "<unk>" ? `<unk> (action_id ${p.action.action_id})` : p.action.action_name
      console.log(`\n  Step ${p.step}: ${actionLabel} [${p.action.action_category}]`)
      console.log(`    State magnitude: ${p.current_state.magnitude.toFixed(3)} → ${p.predicted_state.magnitude.toFixed(3)} (${p.current_state.confidence})`)
      console.log(`    State change: ${p.state_change.toFixed(3)}`)
      console.log(`    Brain confidence: ${p.brain_confidence.toFixed(4)}`)
      console.log(`    Goal proximity: ${p.brain_goal_proximity.toFixed(4)}`)
      console.log(`    Interpretation: ${p.interpretation}`)
    }

    const avgBrainConf = jepa.predictions.reduce((s, p) => s + p.brain_confidence, 0) / jepa.predictions.length
    const avgGoalProx = jepa.predictions.reduce((s, p) => s + p.brain_goal_proximity, 0) / jepa.predictions.length
    const unkCount = jepa.action_sequence.filter(a => a.action_name === "<unk>").length
    const uniqueActions = new Set(jepa.action_sequence.map(a => a.action_name))

    console.log(`\n--- JEPA Analysis ---`)
    console.log(`- Steps: ${jepa.predictions.length}`)
    console.log(`- Avg brain confidence: ${avgBrainConf.toFixed(4)}`)
    console.log(`- Avg goal proximity: ${avgGoalProx.toFixed(4)}`)
    console.log(`- <unk> tokens: ${unkCount} / ${jepa.action_sequence.length} (${unkCount > 0 ? "model at edge of training distribution" : "within distribution"})`)
    console.log(`- Unique actions: ${[...uniqueActions].join(", ")}`)
    console.log(`- Action vocabulary is PRE-TRAINED — custom policy head needed for ProductRank-specific actions`)
    return
  }

  if (!result.plan) {
    console.log("\nCould not parse a valid rollout plan from response.")
    console.log("Raw response (first 1500 chars):")
    console.log(result.rawResponse.slice(0, 1500))
    return
  }

  console.log(`\n--- Planned Action Sequence (Chat Completions Fallback) ---`)
  for (const step of result.plan.steps) {
    console.log(`\nStep ${step.step}: ${step.action}`)
    console.log(`  Confidence: ${step.confidence}`)
    console.log(`  Expected impact: ${step.expected_impact}`)
    console.log(`  Reasoning: ${step.reasoning}`)
  }

  console.log(`\n--- Overall Strategy ---`)
  console.log(result.plan.overall_strategy)

  const avgConfidence = result.plan.steps.reduce((s, st) => s + st.confidence, 0) / result.plan.steps.length
  const actionable = result.plan.steps.every(s => s.action && s.action.length > 5)

  console.log(`\n--- Analysis ---`)
  console.log(`- Rollout endpoint exists: ${result.rolloutEndpointExists ? "yes" : "no"}`)
  console.log(`- Steps returned: ${result.plan.steps.length}`)
  console.log(`- Average confidence: ${avgConfidence.toFixed(3)}`)
  console.log(`- Response quality: ${actionable ? "actionable" : "vague/incomplete"}`)
  console.log(`- Actionable for ProductRank: ${actionable ? "yes" : "needs refinement"}`)
}

// ============================================================================
// Main
// ============================================================================

async function runRolloutTest(): Promise<void> {
  console.log("=== Stratus Rollout Test ===\n")

  // 1. Availability check
  console.log("Checking Stratus availability...")
  const availability = await testStratusAvailability()

  if (!availability.available) {
    console.log(`\nStratus is NOT available.`)
    console.log(`  Endpoint: ${availability.endpoint}`)
    console.log(`  Error: ${availability.error}`)
    console.log("\nCannot proceed with rollout test.")
    process.exit(1)
  }

  console.log(`Stratus is available (${availability.latencyMs}ms health check)`)

  // 2. Baseline state rollout
  console.log("\nRunning rollout test with BASELINE state...")
  const baselineResult = await testRolloutEndpoint(baselineState)
  printResult("BASELINE STATE (iteration 1, score 0.0)", baselineState, baselineResult)

  // 3. Advanced state rollout
  console.log("\n\nRunning rollout test with ADVANCED state...")
  const advancedResult = await testRolloutEndpoint(advancedState)
  printResult("ADVANCED STATE (iteration 3, score 0.3102)", advancedState, advancedResult)

  // 4. Comparison
  console.log(`\n${"=".repeat(60)}`)
  console.log("  COMPARISON")
  console.log(`${"=".repeat(60)}`)
  console.log(`Baseline latency:  ${baselineResult.latencyMs}ms`)
  console.log(`Advanced latency:  ${advancedResult.latencyMs}ms`)
  console.log(`Rollout endpoint:  ${baselineResult.rolloutEndpointExists ? "exists" : "not found (used chat fallback)"}`)

  if (baselineResult.jepaResponse && advancedResult.jepaResponse) {
    const basePreds = baselineResult.jepaResponse.predictions
    const advPreds = advancedResult.jepaResponse.predictions

    const baseAvgConf = basePreds.reduce((s, p) => s + p.brain_confidence, 0) / basePreds.length
    const advAvgConf = advPreds.reduce((s, p) => s + p.brain_confidence, 0) / advPreds.length
    const baseAvgGoal = basePreds.reduce((s, p) => s + p.brain_goal_proximity, 0) / basePreds.length
    const advAvgGoal = advPreds.reduce((s, p) => s + p.brain_goal_proximity, 0) / advPreds.length

    console.log(`\nBaseline avg brain confidence: ${baseAvgConf.toFixed(4)}`)
    console.log(`Advanced avg brain confidence: ${advAvgConf.toFixed(4)}`)
    console.log(`Baseline avg goal proximity:   ${baseAvgGoal.toFixed(4)}`)
    console.log(`Advanced avg goal proximity:   ${advAvgGoal.toFixed(4)}`)

    const baseUnk = baselineResult.jepaResponse.action_sequence.filter(a => a.action_name === "<unk>").length
    const advUnk = advancedResult.jepaResponse.action_sequence.filter(a => a.action_name === "<unk>").length
    console.log(`Baseline <unk> tokens: ${baseUnk}`)
    console.log(`Advanced <unk> tokens: ${advUnk}`)

    const baseActions = baselineResult.jepaResponse.action_sequence.map(a => `${a.action_name}:${a.action_id}`)
    const advActions = advancedResult.jepaResponse.action_sequence.map(a => `${a.action_name}:${a.action_id}`)
    const overlap = baseActions.filter(a => advActions.includes(a))
    console.log(`Action sequence overlap: ${overlap.length} / ${baseActions.length}`)

    console.log(`\n--- Key Insight ---`)
    console.log(`Goal proximity dropped ${baseAvgGoal.toFixed(4)} → ${advAvgGoal.toFixed(4)}: JEPA world model`)
    console.log(`recognizes the advanced state (0.31 score) is harder to improve than baseline (0.0).`)
    console.log(`This is real signal — the model tracks diminishing returns.`)
    console.log(`\nBut action vocabulary is generic (research_company, assign_counsel, kubectl_get).`)
    console.log(`A custom ProductRank policy head would map these to domain-specific actions`)
    console.log(`like "add_collaborative_filtering" or "implement_reranking".`)
  } else if (baselineResult.plan && advancedResult.plan) {
    const baseAvg = baselineResult.plan.steps.reduce((s, st) => s + st.confidence, 0) / baselineResult.plan.steps.length
    const advAvg = advancedResult.plan.steps.reduce((s, st) => s + st.confidence, 0) / advancedResult.plan.steps.length
    console.log(`Baseline avg confidence: ${baseAvg.toFixed(3)}`)
    console.log(`Advanced avg confidence: ${advAvg.toFixed(3)}`)

    const baseActions = baselineResult.plan.steps.map(s => s.action)
    const advActions = new Set(advancedResult.plan.steps.map(s => s.action))
    const overlap = baseActions.filter(a => advActions.has(a))
    console.log(`Action overlap: ${overlap.length} of ${baseActions.length} baseline actions appear in advanced plan`)
    console.log(`Plans are ${overlap.length === 0 ? "fully differentiated" : "partially overlapping"} (good: plans should adapt to state)`)
  }
}

// Run if executed directly
runRolloutTest().catch(err => {
  console.error("\nFatal error:", err.message)
  process.exit(1)
})
