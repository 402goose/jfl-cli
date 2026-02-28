/**
 * @purpose Static model pricing lookup and cost estimation for Stratus API calls
 */

interface ModelPricing {
  inputPer1kTokens: number
  outputPer1kTokens: number
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': { inputPer1kTokens: 0.015, outputPer1kTokens: 0.075 },
  'claude-opus-4-5': { inputPer1kTokens: 0.015, outputPer1kTokens: 0.075 },
  'claude-sonnet-4-6': { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015 },
  'claude-sonnet-4-5': { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015 },
  'claude-haiku-3-5': { inputPer1kTokens: 0.0008, outputPer1kTokens: 0.004 },
  'gpt-4o': { inputPer1kTokens: 0.0025, outputPer1kTokens: 0.01 },
  'gpt-4o-mini': { inputPer1kTokens: 0.00015, outputPer1kTokens: 0.0006 },
}

export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const normalized = model.toLowerCase()

  let pricing: ModelPricing | undefined
  for (const [key, value] of Object.entries(MODEL_PRICING)) {
    if (normalized.includes(key)) {
      pricing = value
      break
    }
  }

  if (!pricing) return 0

  return (promptTokens / 1000) * pricing.inputPer1kTokens +
    (completionTokens / 1000) * pricing.outputPer1kTokens
}
