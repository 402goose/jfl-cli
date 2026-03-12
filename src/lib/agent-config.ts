/**
 * Agent Configuration
 *
 * TOML-based configuration for scoped RL agents following Karpathy's autoresearch principles.
 * Each agent has ONE metric, fixed time budget, immutable eval snapshot, and constrained file scope.
 *
 * @purpose Parse and validate agent TOML configs for scoped RL experiments
 */

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "fs"
import { join, dirname } from "path"

// ============================================================================
// Types
// ============================================================================

export interface EvalConfig {
  script: string        // Path to eval script (relative to project root)
  data: string          // Path to eval data file (relative to project root)
}

export interface ConstraintConfig {
  files_in_scope: string[]     // Glob patterns for files agent CAN modify
  files_readonly: string[]     // Glob patterns for files that are READ-ONLY
  max_file_changes: number     // Max files that can be changed per round
}

export interface PolicyConfig {
  embedding_model: string      // Model for embeddings (e.g., "stratus-x1ac-base-claude-sonnet-4-6")
  exploration_rate: number     // Initial exploration rate (0.0 - 1.0)
  decay_per_round: number      // Decay per round
  min_exploration: number      // Floor for exploration rate
}

export interface ScopeConfig {
  produces: string[]           // Event patterns this agent produces (e.g., ["search:quality-improved"])
  consumes: string[]           // Event patterns this agent reacts to (e.g., ["data:index-updated"])
}

export interface AgentConfig {
  name: string                 // Agent identifier (e.g., "search-quality")
  scope: string                // Scope name (e.g., "search", "tests", "quality")
  metric: string               // ONE metric, scalar, higher is better (e.g., "ndcg@10")
  direction: "maximize" | "minimize"  // Optimization direction
  time_budget_seconds: number  // Fixed time budget per round
  eval: EvalConfig
  constraints: ConstraintConfig
  policy: PolicyConfig
  context_scope: ScopeConfig   // Bidirectional context sharing (produces/consumes)
}

// ============================================================================
// TOML Parser (lightweight, no dependencies)
// ============================================================================

interface TomlSection {
  [key: string]: string | number | boolean | string[] | TomlSection
}

function parseTomlValue(value: string): string | number | boolean | string[] {
  value = value.trim()

  // Boolean
  if (value === "true") return true
  if (value === "false") return false

  // Number (integer or float)
  if (/^-?\d+$/.test(value)) return parseInt(value, 10)
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value)

  // Array
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return []
    // Handle array of strings
    const items: string[] = []
    let current = ""
    let inQuote = false
    let quoteChar = ""
    for (let i = 0; i < inner.length; i++) {
      const char = inner[i]
      if ((char === '"' || char === "'") && !inQuote) {
        inQuote = true
        quoteChar = char
      } else if (char === quoteChar && inQuote) {
        inQuote = false
        items.push(current)
        current = ""
      } else if (char === "," && !inQuote) {
        if (current.trim()) items.push(current.trim())
        current = ""
      } else if (inQuote) {
        current += char
      }
    }
    if (current.trim()) items.push(current.trim().replace(/^["']|["']$/g, ""))
    return items
  }

  // String (quoted or unquoted)
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }

  return value
}

function parseToml(content: string): Record<string, TomlSection> {
  const result: Record<string, TomlSection> = {}
  let currentSection = "__root__"
  result[currentSection] = {}

  const lines = content.split("\n")
  for (const rawLine of lines) {
    const line = rawLine.trim()

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) continue

    // Section header
    if (line.startsWith("[") && line.endsWith("]")) {
      currentSection = line.slice(1, -1)
      if (!result[currentSection]) {
        result[currentSection] = {}
      }
      continue
    }

    // Key = value
    const eqIndex = line.indexOf("=")
    if (eqIndex > 0) {
      const key = line.slice(0, eqIndex).trim()
      const value = line.slice(eqIndex + 1).trim()
      result[currentSection][key] = parseTomlValue(value)
    }
  }

  return result
}

// ============================================================================
// Config Loading
// ============================================================================

export function parseAgentConfig(tomlContent: string): AgentConfig {
  const parsed = parseToml(tomlContent)

  const agent = parsed["agent"] || {}
  const evalSection = parsed["eval"] || {}
  const constraints = parsed["constraints"] || {}
  const policy = parsed["policy"] || {}

  // Validate required fields
  if (!agent.name) throw new Error("agent.name is required")
  if (!agent.metric) throw new Error("agent.metric is required")
  if (!evalSection.script) throw new Error("eval.script is required")
  if (!evalSection.data) throw new Error("eval.data is required")

  return {
    name: agent.name as string,
    scope: (agent.scope as string) || "general",
    metric: agent.metric as string,
    direction: (agent.direction as "maximize" | "minimize") || "maximize",
    time_budget_seconds: (agent.time_budget_seconds as number) || 300,
    eval: {
      script: evalSection.script as string,
      data: evalSection.data as string,
    },
    constraints: {
      files_in_scope: (constraints.files_in_scope as string[]) || ["**/*"],
      files_readonly: (constraints.files_readonly as string[]) || ["eval/**"],
      max_file_changes: (constraints.max_file_changes as number) || 10,
    },
    policy: {
      embedding_model: (policy.embedding_model as string) || "stratus-x1ac-base-claude-sonnet-4-6",
      exploration_rate: (policy.exploration_rate as number) || 0.2,
      decay_per_round: (policy.decay_per_round as number) || 0.01,
      min_exploration: (policy.min_exploration as number) || 0.05,
    },
    context_scope: {
      produces: (parsed["context_scope"]?.produces as string[]) || [`${agent.scope || "general"}:improved`],
      consumes: (parsed["context_scope"]?.consumes as string[]) || [],
    },
  }
}

export function loadAgentConfig(projectRoot: string, agentName: string): AgentConfig {
  const configPath = join(projectRoot, ".jfl", "agents", `${agentName}.toml`)
  if (!existsSync(configPath)) {
    throw new Error(`Agent config not found: ${configPath}`)
  }
  const content = readFileSync(configPath, "utf-8")
  return parseAgentConfig(content)
}

export function listAgentConfigs(projectRoot: string): string[] {
  const agentsDir = join(projectRoot, ".jfl", "agents")
  if (!existsSync(agentsDir)) return []

  return readdirSync(agentsDir)
    .filter(f => f.endsWith(".toml"))
    .map(f => f.replace(".toml", ""))
}

export function loadAllAgentConfigs(projectRoot: string): AgentConfig[] {
  const names = listAgentConfigs(projectRoot)
  return names.map(name => loadAgentConfig(projectRoot, name))
}

// ============================================================================
// Config Generation
// ============================================================================

export function generateAgentToml(config: Partial<AgentConfig>): string {
  const lines: string[] = [
    "# Agent Configuration",
    "# Scoped RL agent following Karpathy's autoresearch principles",
    "",
    "[agent]",
    `name = "${config.name || "unnamed"}"`,
    `scope = "${config.scope || "general"}"`,
    `metric = "${config.metric || "composite_score"}"`,
    `direction = "${config.direction || "maximize"}"`,
    `time_budget_seconds = ${config.time_budget_seconds || 300}`,
    "",
    "[eval]",
    `# Eval script is READ-ONLY during a session`,
    `script = "${config.eval?.script || "eval/eval.ts"}"`,
    `data = "${config.eval?.data || "eval/fixtures/data.jsonl"}"`,
    "",
    "[constraints]",
    `files_in_scope = [${(config.constraints?.files_in_scope || ["src/**"]).map(s => `"${s}"`).join(", ")}]`,
    `files_readonly = [${(config.constraints?.files_readonly || ["eval/**"]).map(s => `"${s}"`).join(", ")}]`,
    `max_file_changes = ${config.constraints?.max_file_changes || 10}`,
    "",
    "[policy]",
    `embedding_model = "${config.policy?.embedding_model || "stratus-x1ac-base-claude-sonnet-4-6"}"`,
    `exploration_rate = ${config.policy?.exploration_rate || 0.2}`,
    `decay_per_round = ${config.policy?.decay_per_round || 0.01}`,
    `min_exploration = ${config.policy?.min_exploration || 0.05}`,
  ]

  return lines.join("\n")
}

export function writeAgentConfig(projectRoot: string, config: Partial<AgentConfig>): string {
  const agentsDir = join(projectRoot, ".jfl", "agents")
  if (!existsSync(agentsDir)) {
    mkdirSync(agentsDir, { recursive: true })
  }

  const configPath = join(agentsDir, `${config.name || "unnamed"}.toml`)
  const content = generateAgentToml(config)
  writeFileSync(configPath, content)

  return configPath
}

// ============================================================================
// Validation
// ============================================================================

export function validateAgentConfig(config: AgentConfig, projectRoot: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check eval script exists
  const evalScriptPath = join(projectRoot, config.eval.script)
  if (!existsSync(evalScriptPath)) {
    errors.push(`Eval script not found: ${config.eval.script}`)
  }

  // Check eval data exists
  const evalDataPath = join(projectRoot, config.eval.data)
  if (!existsSync(evalDataPath)) {
    errors.push(`Eval data not found: ${config.eval.data}`)
  }

  // Validate numeric ranges
  if (config.policy.exploration_rate < 0 || config.policy.exploration_rate > 1) {
    errors.push(`exploration_rate must be between 0 and 1, got: ${config.policy.exploration_rate}`)
  }

  if (config.time_budget_seconds < 30) {
    errors.push(`time_budget_seconds must be at least 30, got: ${config.time_budget_seconds}`)
  }

  if (config.constraints.max_file_changes < 1) {
    errors.push(`max_file_changes must be at least 1, got: ${config.constraints.max_file_changes}`)
  }

  return { valid: errors.length === 0, errors }
}
