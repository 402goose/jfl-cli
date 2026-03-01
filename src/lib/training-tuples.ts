/**
 * @purpose Extract (state, action, reward) training tuples from ProductRank team journal files
 */

import { readFileSync, readdirSync, existsSync } from "fs"
import { join, basename } from "path"
import { createHash } from "crypto"

export interface TrainingTuple {
  id: string
  timestamp: string
  team: string
  state: {
    approach: string
    scores: Record<string, number> | null
    iteration: number
    filesChanged: string[]
  }
  action: {
    type: string
    description: string
    detail: string
  }
  reward: {
    scoreDelta: number | null
    qualitative: "improvement" | "regression" | "neutral" | "unknown"
    learned: string[]
  }
  source: {
    file: string
    session: string
    entryIndex: number
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
  learned?: string[]
  incomplete?: string[]
  next?: string
  decision?: string
  [key: string]: unknown
}

const SCORE_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "ndcg", regex: /ndcg(?:@\d+)?[:\s=]+(\d+\.?\d*)/gi },
  { label: "precision", regex: /precision[:\s=]+(\d+\.?\d*)/gi },
  { label: "recall", regex: /recall[:\s=]+(\d+\.?\d*)/gi },
  { label: "mrr", regex: /mrr[:\s=]+(\d+\.?\d*)/gi },
  { label: "map", regex: /\bmap[:\s=]+(\d+\.?\d*)/gi },
  { label: "weighted", regex: /weighted[:\s=]+(\d+\.?\d*)/gi },
  { label: "score", regex: /\bscore[:\s=]+(\d+\.?\d*)/gi },
  { label: "f1", regex: /f1[:\s=]+(\d+\.?\d*)/gi },
]

const BARE_METRIC_PATTERN = /(?:scores?\s+)?0\.\d{3,}/gi

export function extractScores(text: string): Record<string, number> | null {
  if (!text) return null

  const scores: Record<string, number> = {}

  for (const { label, regex } of SCORE_PATTERNS) {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    let idx = 0
    while ((match = regex.exec(text)) !== null) {
      const val = parseFloat(match[1])
      if (!isNaN(val) && val >= 0 && val <= 1000) {
        const key = idx === 0 ? label : `${label}_${idx}`
        scores[key] = val
        idx++
      }
    }
  }

  if (Object.keys(scores).length === 0) {
    const bareMatches = text.match(BARE_METRIC_PATTERN)
    if (bareMatches) {
      for (let i = 0; i < bareMatches.length && i < 5; i++) {
        const cleaned = bareMatches[i].replace(/^scores?\s+/i, "")
        const val = parseFloat(cleaned)
        if (!isNaN(val) && val > 0 && val < 10) {
          scores[`metric_${i}`] = val
        }
      }
    }
  }

  return Object.keys(scores).length > 0 ? scores : null
}

function extractTeam(filePath: string, session: string): string {
  const pathLower = filePath.toLowerCase()
  if (pathLower.includes("lobsters")) return "lobsters"
  if (pathLower.includes("phds")) return "phds"
  if (pathLower.includes("shadow")) return "shadow"

  const sessionLower = (session || "").toLowerCase()
  if (sessionLower.includes("lobster")) return "lobsters"
  if (sessionLower.includes("phd")) return "phds"
  if (sessionLower.includes("shadow")) return "shadow"

  return "unknown"
}

function computeScoreDelta(
  currentScores: Record<string, number> | null,
  nextScores: Record<string, number> | null
): number | null {
  if (!currentScores || !nextScores) return null

  const commonKeys = Object.keys(currentScores).filter((k) => k in nextScores)
  if (commonKeys.length === 0) return null

  let totalDelta = 0
  for (const key of commonKeys) {
    totalDelta += nextScores[key] - currentScores[key]
  }
  return totalDelta / commonKeys.length
}

function determineQualitative(
  delta: number | null,
  currentScores: Record<string, number> | null,
  nextScores: Record<string, number> | null,
  entry: JournalEntry
): "improvement" | "regression" | "neutral" | "unknown" {
  if (delta !== null) {
    if (delta > 0.001) return "improvement"
    if (delta < -0.001) return "regression"
    return "neutral"
  }

  const textToScan = [entry.summary, entry.detail, ...(entry.learned || [])].filter(Boolean).join(" ").toLowerCase()

  if (/improv|better|gain|increas|boost|uplift|higher/.test(textToScan)) return "improvement"
  if (/regress|worse|decreas|drop|lower|degrad/.test(textToScan)) return "regression"
  if (/same|unchanged|flat|no.?change|stable/.test(textToScan)) return "neutral"

  return "unknown"
}

function hashTuple(state: string, action: string): string {
  return createHash("sha256").update(state + action).digest("hex").slice(0, 16)
}

function parseJournalFile(filePath: string): Array<{ entry: JournalEntry; lineIndex: number }> {
  const results: Array<{ entry: JournalEntry; lineIndex: number }> = []

  if (!existsSync(filePath)) return results

  let content: string
  try {
    content = readFileSync(filePath, "utf-8")
  } catch {
    return results
  }

  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    try {
      const parsed = JSON.parse(line)
      if (typeof parsed === "object" && parsed !== null) {
        results.push({ entry: parsed as JournalEntry, lineIndex: i })
      }
    } catch {
      process.stderr.write(`[training-tuples] Skipping malformed line ${i + 1} in ${basename(filePath)}\n`)
    }
  }

  return results
}

export function extractTuples(journalDir: string, team?: string): TrainingTuple[] {
  if (!existsSync(journalDir)) {
    process.stderr.write(`[training-tuples] Journal directory not found: ${journalDir}\n`)
    return []
  }

  const files = readdirSync(journalDir).filter((f) => f.endsWith(".jsonl"))
  if (files.length === 0) {
    process.stderr.write(`[training-tuples] No .jsonl files in ${journalDir}\n`)
    return []
  }

  const allEntries: Array<{
    entry: JournalEntry
    file: string
    lineIndex: number
    team: string
  }> = []

  for (const file of files) {
    const filePath = join(journalDir, file)
    const parsed = parseJournalFile(filePath)
    for (const { entry, lineIndex } of parsed) {
      const entryTeam = extractTeam(filePath, entry.session || "")
      allEntries.push({ entry, file: filePath, lineIndex, team: entryTeam })
    }
  }

  allEntries.sort((a, b) => (a.entry.ts || "").localeCompare(b.entry.ts || ""))

  if (team) {
    const filtered = allEntries.filter((e) => e.team === team)
    return buildTuplesForGroup(filtered)
  }

  const byTeam = new Map<string, typeof allEntries>()
  for (const entry of allEntries) {
    const group = byTeam.get(entry.team) || []
    group.push(entry)
    byTeam.set(entry.team, group)
  }

  const tuples: TrainingTuple[] = []
  for (const [, entries] of byTeam) {
    tuples.push(...buildTuplesForGroup(entries))
  }

  tuples.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return tuples
}

function buildTuplesForGroup(
  entries: Array<{
    entry: JournalEntry
    file: string
    lineIndex: number
    team: string
  }>
): TrainingTuple[] {
  const tuples: TrainingTuple[] = []

  for (let i = 0; i < entries.length; i++) {
    const { entry, file, lineIndex, team } = entries[i]
    const nextEntry = i + 1 < entries.length ? entries[i + 1].entry : null

    const combinedText = [entry.summary, entry.detail].filter(Boolean).join(" ")
    const currentScores = extractScores(combinedText)
    const nextScores = nextEntry ? extractScores([nextEntry.summary, nextEntry.detail].filter(Boolean).join(" ")) : null

    const scoreDelta = computeScoreDelta(currentScores, nextScores)

    const approach = entry.summary || entry.title || ""
    const actionDesc = entry.summary || entry.title || ""
    const actionDetail = entry.detail || ""

    const stateStr = JSON.stringify({ approach, scores: currentScores, team })
    const actionStr = JSON.stringify({ type: entry.type, desc: actionDesc })

    tuples.push({
      id: hashTuple(stateStr, actionStr),
      timestamp: entry.ts || "",
      team,
      state: {
        approach,
        scores: currentScores,
        iteration: i + 1,
        filesChanged: entry.files || [],
      },
      action: {
        type: entry.type || "unknown",
        description: actionDesc,
        detail: actionDetail,
      },
      reward: {
        scoreDelta,
        qualitative: determineQualitative(scoreDelta, currentScores, nextScores, entry),
        learned: entry.learned || [],
      },
      source: {
        file,
        session: entry.session || "",
        entryIndex: lineIndex,
      },
    })
  }

  return tuples
}

export function formatTuplesReport(tuples: TrainingTuple[]): string {
  const lines: string[] = []

  lines.push("# Training Tuple Extraction Report")
  lines.push("")
  lines.push(`**Total tuples:** ${tuples.length}`)
  lines.push(`**Extraction time:** ${new Date().toISOString()}`)
  lines.push("")

  const teamCounts = new Map<string, number>()
  let withScoreDelta = 0
  let withScores = 0
  let withLearned = 0

  for (const t of tuples) {
    teamCounts.set(t.team, (teamCounts.get(t.team) || 0) + 1)
    if (t.reward.scoreDelta !== null) withScoreDelta++
    if (t.state.scores !== null) withScores++
    if (t.reward.learned.length > 0) withLearned++
  }

  lines.push("## Per-Team Breakdown")
  lines.push("")
  lines.push("| Team | Tuples | With Scores | With Score Delta |")
  lines.push("|------|--------|-------------|------------------|")

  for (const [team, count] of teamCounts) {
    const teamTuples = tuples.filter((t) => t.team === team)
    const teamScores = teamTuples.filter((t) => t.state.scores !== null).length
    const teamDeltas = teamTuples.filter((t) => t.reward.scoreDelta !== null).length
    lines.push(`| ${team} | ${count} | ${teamScores} | ${teamDeltas} |`)
  }

  lines.push("")
  lines.push("## Signal Coverage")
  lines.push("")
  lines.push(`- Tuples with embedded scores: ${withScores} / ${tuples.length} (${tuples.length > 0 ? ((withScores / tuples.length) * 100).toFixed(0) : 0}%)`)
  lines.push(`- Tuples with score deltas: ${withScoreDelta} / ${tuples.length} (${tuples.length > 0 ? ((withScoreDelta / tuples.length) * 100).toFixed(0) : 0}%)`)
  lines.push(`- Tuples with learnings: ${withLearned} / ${tuples.length} (${tuples.length > 0 ? ((withLearned / tuples.length) * 100).toFixed(0) : 0}%)`)
  lines.push("")

  const qualCounts: Record<string, number> = {}
  for (const t of tuples) {
    qualCounts[t.reward.qualitative] = (qualCounts[t.reward.qualitative] || 0) + 1
  }

  lines.push("## Qualitative Reward Distribution")
  lines.push("")
  for (const [qual, count] of Object.entries(qualCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${qual}**: ${count}`)
  }
  lines.push("")

  if (tuples.length > 0) {
    lines.push("## Sample Tuple (first entry)")
    lines.push("")
    lines.push("```json")
    lines.push(JSON.stringify(tuples[0], null, 2))
    lines.push("```")
    lines.push("")
  }

  const actionTypes: Record<string, number> = {}
  for (const t of tuples) {
    actionTypes[t.action.type] = (actionTypes[t.action.type] || 0) + 1
  }
  lines.push("## Action Type Distribution")
  lines.push("")
  for (const [type, count] of Object.entries(actionTypes).sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${type}**: ${count}`)
  }
  lines.push("")

  return lines.join("\n")
}
