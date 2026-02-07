/**
 * Stratus X1 Reasoning API Client
 *
 * Provides reasoning-based analysis and synthesis capabilities
 * for Context Hub journal entries and project documentation.
 *
 * @purpose Client for calling Stratus X1 reasoning API to synthesize context
 */

// ============================================================================
// Types
// ============================================================================

interface StratusMessage {
  role: "user" | "assistant"
  content: string
}

interface StratusRequest {
  model: string
  messages: StratusMessage[]
  temperature?: number
  max_tokens?: number
}

interface StratusResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  stratus?: {
    model: string
    execution_llm: string
    confidence: number
    planning_time_ms: number
    execution_time_ms: number
  }
}

interface JournalEntry {
  v?: number
  ts?: string
  session?: string
  type?: string
  status?: string
  title?: string
  summary?: string
  detail?: string
  files?: string[]
  decision?: string
  incomplete?: string[]
  next?: string
  learned?: string[]
}

interface SynthesisResult {
  summary: string
  decisions: Array<{ decision: string; rationale: string }>
  problemsSolved: Array<{ problem: string; solution: string }>
  incompleteItems: string[]
  nextSteps: string[]
  rawResponse: string
  confidence?: number
  executionTime?: number
}

// ============================================================================
// Stratus Client
// ============================================================================

export class StratusClient {
  private baseUrl: string
  private apiKey: string
  private model: string
  private timeout: number

  constructor(options: {
    baseUrl?: string
    apiKey?: string
    model?: string
    timeout?: number
  } = {}) {
    this.baseUrl = options.baseUrl || process.env.STRATUS_API_URL || "http://212.115.124.137:8000"
    this.apiKey = options.apiKey || process.env.STRATUS_API_KEY || ""
    this.model = options.model || "stratus-x1ac-base-claude-sonnet-4"
    this.timeout = options.timeout || 30000 // 30 seconds default
  }

  /**
   * Call Stratus reasoning API with a prompt
   */
  async reason(prompt: string, options: {
    temperature?: number
    maxTokens?: number
  } = {}): Promise<StratusResponse> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const request: StratusRequest = {
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2000
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      }

      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`
      }

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: controller.signal
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Stratus API error (${response.status}): ${errorText}`)
      }

      return await response.json()
    } catch (error: any) {
      if (error.name === "AbortError") {
        throw new Error(`Stratus request timed out after ${this.timeout}ms`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Synthesize journal entries into structured summary
   */
  async synthesizeJournalEntries(
    entries: JournalEntry[],
    options: {
      focus?: "decisions" | "problems" | "progress" | "all"
    } = {}
  ): Promise<SynthesisResult> {
    const focus = options.focus || "all"

    // Build focused prompt based on what user wants
    const focusInstructions = {
      decisions: "Focus on key decisions made, including the options considered and rationale for each choice.",
      problems: "Focus on problems encountered and how they were solved, including root causes and learnings.",
      progress: "Focus on what was accomplished, current status, and momentum toward goals.",
      all: "Provide a comprehensive analysis covering decisions, problems solved, progress made, and next steps."
    }

    const prompt = `Analyze these journal entries from a software project.

Journal Entries:
${JSON.stringify(entries, null, 2)}

${focusInstructions[focus]}

Provide a structured summary in the following format:

## Summary
{2-3 sentence overview of what happened}

## Key Decisions Made
{List decisions with brief rationale - format: "Decision: Rationale"}

## Problems Solved
{List problems and their solutions - format: "Problem: Solution"}

## Incomplete Items
{List what's stubbed, planned, or not yet done}

## Next Steps
{What should happen next}

Be concise but specific. Cite entry timestamps when referencing specific work.`

    const startTime = Date.now()
    const response = await this.reason(prompt, {
      temperature: 0.7,
      maxTokens: 2000
    })
    const executionTime = Date.now() - startTime

    const content = response.choices[0]?.message?.content || ""

    // Parse structured response
    const synthesis = this.parseStructuredSummary(content)

    return {
      ...synthesis,
      rawResponse: content,
      confidence: response.stratus?.confidence,
      executionTime
    }
  }

  /**
   * Parse Stratus response into structured format
   */
  private parseStructuredSummary(content: string): Omit<SynthesisResult, "rawResponse" | "confidence" | "executionTime"> {
    const result: Omit<SynthesisResult, "rawResponse" | "confidence" | "executionTime"> = {
      summary: "",
      decisions: [],
      problemsSolved: [],
      incompleteItems: [],
      nextSteps: []
    }

    // Extract summary
    const summaryMatch = content.match(/## Summary\s*\n([\s\S]*?)(?=\n##|$)/i)
    if (summaryMatch) {
      result.summary = summaryMatch[1].trim()
    }

    // Extract decisions
    const decisionsMatch = content.match(/## Key Decisions Made\s*\n([\s\S]*?)(?=\n##|$)/i)
    if (decisionsMatch) {
      const decisionsText = decisionsMatch[1].trim()
      const lines = decisionsText.split('\n').filter(l => l.trim())
      for (const line of lines) {
        const match = line.match(/[-*]\s*(.+?):\s*(.+)/)
        if (match) {
          result.decisions.push({
            decision: match[1].trim(),
            rationale: match[2].trim()
          })
        } else if (line.startsWith('-') || line.startsWith('*')) {
          // Fallback for lines without clear separator
          const text = line.replace(/^[-*]\s*/, '').trim()
          result.decisions.push({
            decision: text,
            rationale: ""
          })
        }
      }
    }

    // Extract problems solved
    const problemsMatch = content.match(/## Problems Solved\s*\n([\s\S]*?)(?=\n##|$)/i)
    if (problemsMatch) {
      const problemsText = problemsMatch[1].trim()
      const lines = problemsText.split('\n').filter(l => l.trim())
      for (const line of lines) {
        const match = line.match(/[-*]\s*(.+?):\s*(.+)/)
        if (match) {
          result.problemsSolved.push({
            problem: match[1].trim(),
            solution: match[2].trim()
          })
        } else if (line.startsWith('-') || line.startsWith('*')) {
          const text = line.replace(/^[-*]\s*/, '').trim()
          result.problemsSolved.push({
            problem: text,
            solution: ""
          })
        }
      }
    }

    // Extract incomplete items
    const incompleteMatch = content.match(/## Incomplete Items\s*\n([\s\S]*?)(?=\n##|$)/i)
    if (incompleteMatch) {
      const incompleteText = incompleteMatch[1].trim()
      result.incompleteItems = incompleteText
        .split('\n')
        .filter(l => l.trim())
        .map(l => l.replace(/^[-*]\s*/, '').trim())
    }

    // Extract next steps
    const nextStepsMatch = content.match(/## Next Steps\s*\n([\s\S]*?)(?=\n##|$)/i)
    if (nextStepsMatch) {
      const nextStepsText = nextStepsMatch[1].trim()
      result.nextSteps = nextStepsText
        .split('\n')
        .filter(l => l.trim())
        .map(l => l.replace(/^[-*]\s*/, '').trim())
    }

    return result
  }

  /**
   * Format synthesis result as human-readable text
   */
  formatSynthesis(synthesis: SynthesisResult): string {
    const lines: string[] = []

    lines.push("# Context Synthesis\n")

    if (synthesis.summary) {
      lines.push(synthesis.summary)
      lines.push("")
    }

    if (synthesis.decisions.length > 0) {
      lines.push("## Key Decisions")
      for (const { decision, rationale } of synthesis.decisions) {
        if (rationale) {
          lines.push(`- **${decision}**: ${rationale}`)
        } else {
          lines.push(`- ${decision}`)
        }
      }
      lines.push("")
    }

    if (synthesis.problemsSolved.length > 0) {
      lines.push("## Problems Solved")
      for (const { problem, solution } of synthesis.problemsSolved) {
        if (solution) {
          lines.push(`- **${problem}**: ${solution}`)
        } else {
          lines.push(`- ${problem}`)
        }
      }
      lines.push("")
    }

    if (synthesis.incompleteItems.length > 0) {
      lines.push("## Incomplete Items")
      for (const item of synthesis.incompleteItems) {
        lines.push(`- ${item}`)
      }
      lines.push("")
    }

    if (synthesis.nextSteps.length > 0) {
      lines.push("## Next Steps")
      for (const step of synthesis.nextSteps) {
        lines.push(`- ${step}`)
      }
      lines.push("")
    }

    if (synthesis.confidence !== undefined) {
      lines.push(`_Confidence: ${(synthesis.confidence * 100).toFixed(0)}%_`)
    }
    if (synthesis.executionTime !== undefined) {
      lines.push(`_Analysis time: ${(synthesis.executionTime / 1000).toFixed(1)}s_`)
    }

    return lines.join("\n")
  }
}
