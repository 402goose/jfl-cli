/**
 * Tool Renderers
 *
 * Custom renderCall/renderResult for all JFL tools.
 * Transforms plain text output into themed, collapsible TUI components
 * with icons, borders, color-coded sections, and smart truncation.
 *
 * @purpose Beautiful TUI rendering for jfl_hud, jfl_context, jfl_crm, jfl_memory_search, jfl_synopsis, jfl_eval_status, jfl_eval_compare, jfl_policy_score, jfl_policy_rank, jfl_training_buffer, jfl_mine_tuples
 */

import type { PiTheme } from "./types.js"

// ─── Shared helpers ──────────────────────────────────────────────────────────

function truncLine(text: string, maxW: number): string {
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "")
  if (stripped.length <= maxW) return text
  return text.slice(0, maxW - 1) + "…"
}

function wrapText(text: string, width: number): string[] {
  const lines: string[] = []
  for (const raw of text.split("\n")) {
    if (raw.length <= width) { lines.push(raw); continue }
    let pos = 0
    while (pos < raw.length) {
      lines.push(raw.slice(pos, pos + width))
      pos += width
    }
  }
  return lines
}

function sectionBorder(theme: PiTheme, label: string, width: number): string {
  const labelStr = ` ${label} `
  const rest = Math.max(0, width - labelStr.length - 4)
  return theme.fg("border", "──") + theme.fg("accent", labelStr) + theme.fg("border", "─".repeat(rest))
}

// ─── HUD Tool ───────────────────────────────────────────────────────────────

export function hudRenderCall(args: Record<string, any>, theme: PiTheme): any {
  const label = theme.fg("accent", "◆") + " " + theme.fg("toolTitle", theme.bold("HUD"))
  return { render: () => [label], invalidate() {} }
}

export function hudRenderResult(result: any, opts: { expanded: boolean }, theme: PiTheme): any {
  const raw = extractText(result)
  const lines = raw.split("\n").filter(Boolean)

  if (!opts.expanded && lines.length > 5) {
    const display = lines.slice(0, 5).map(l => theme.fg("toolOutput", l))
    display.push(theme.fg("dim", `... ${lines.length - 5} more lines (Ctrl+O)`))
    return { render: () => display, invalidate() {} }
  }

  const themed = lines.map(line => {
    if (line.startsWith("◆")) return theme.fg("accent", line)
    if (line.includes("Phase:")) return theme.fg("warning", line)
    if (/^\s*(Pipeline|Deal|Stage)/i.test(line)) return theme.fg("accent", line)
    return theme.fg("toolOutput", line)
  })

  return { render: () => themed, invalidate() {} }
}

// ─── Context Tool ───────────────────────────────────────────────────────────

export function contextRenderCall(args: Record<string, any>, theme: PiTheme): any {
  const query = args.query ?? ""
  const label = theme.fg("toolTitle", theme.bold("context ")) + theme.fg("accent", `"${query}"`)
  return { render: () => [label], invalidate() {} }
}

export function contextRenderResult(result: any, opts: { expanded: boolean }, theme: PiTheme): any {
  const raw = extractText(result)
  if (raw === "No relevant context found.") {
    return { render: () => [theme.fg("dim", "No relevant context found")], invalidate() {} }
  }

  const sections = raw.split(/---\n/).filter(Boolean)
  const lines: string[] = []

  const max = opts.expanded ? sections.length : Math.min(sections.length, 3)
  for (let i = 0; i < max; i++) {
    const section = sections[i].trim()
    const firstLine = section.split("\n")[0] ?? ""

    if (firstLine.startsWith("[")) {
      const typeMatch = firstLine.match(/^\[(\w+)\]\s*(.*)/)
      if (typeMatch) {
        const typeColor = typeMatch[1] === "decision" ? "warning" : typeMatch[1] === "feature" ? "success" : "muted"
        lines.push(`${theme.fg(typeColor, `[${typeMatch[1]}]`)} ${theme.fg("text", typeMatch[2])}`)
      } else {
        lines.push(theme.fg("text", firstLine))
      }
    } else {
      lines.push(theme.fg("text", firstLine))
    }

    if (opts.expanded) {
      const rest = section.split("\n").slice(1)
      for (const l of rest) lines.push(theme.fg("muted", l))
      lines.push("")
    }
  }

  if (!opts.expanded && sections.length > 3) {
    lines.push(theme.fg("dim", `... ${sections.length - 3} more results (Ctrl+O)`))
  }

  return { render: () => lines, invalidate() {} }
}

// ─── CRM Tool ───────────────────────────────────────────────────────────────

export function crmRenderCall(args: Record<string, any>, theme: PiTheme): any {
  const cmd = args.command ?? "list"
  const extra = args.args ? ` ${args.args}` : ""
  const label = theme.fg("toolTitle", theme.bold("crm ")) + theme.fg("accent", cmd) + theme.fg("dim", extra)
  return { render: () => [label], invalidate() {} }
}

export function crmRenderResult(result: any, opts: { expanded: boolean }, theme: PiTheme): any {
  const raw = extractText(result)
  if (raw.startsWith("Error")) {
    return { render: () => [theme.fg("error", raw)], invalidate() {} }
  }

  const lines = raw.split("\n").filter(Boolean)
  const themed = lines.map(line => {
    if (/active|open|hot/i.test(line)) return theme.fg("success", line)
    if (/stale|cold|lost/i.test(line)) return theme.fg("error", line)
    if (/pipeline|deal|stage/i.test(line)) return theme.fg("accent", line)
    if (line.startsWith("─") || line.startsWith("│") || line.startsWith("┌")) return theme.fg("border", line)
    return theme.fg("toolOutput", line)
  })

  if (!opts.expanded && themed.length > 8) {
    const display = themed.slice(0, 8)
    display.push(theme.fg("dim", `... ${themed.length - 8} more (Ctrl+O)`))
    return { render: () => display, invalidate() {} }
  }

  return { render: () => themed, invalidate() {} }
}

// ─── Memory Search Tool ─────────────────────────────────────────────────────

export function memoryRenderCall(args: Record<string, any>, theme: PiTheme): any {
  const query = args.query ?? ""
  const type = args.type && args.type !== "all" ? ` [${args.type}]` : ""
  const label = theme.fg("toolTitle", theme.bold("memory ")) + theme.fg("accent", `"${query}"`) + theme.fg("muted", type)
  return { render: () => [label], invalidate() {} }
}

export function memoryRenderResult(result: any, opts: { expanded: boolean }, theme: PiTheme): any {
  const raw = extractText(result)
  if (raw.includes("unavailable") || raw.includes("No memories")) {
    return { render: () => [theme.fg("dim", raw)], invalidate() {} }
  }

  const entries = raw.split(/\n\n---\n\n/).filter(Boolean)
  const lines: string[] = []

  const max = opts.expanded ? entries.length : Math.min(entries.length, 4)
  for (let i = 0; i < max; i++) {
    const entry = entries[i].trim()
    const [header, ...body] = entry.split("\n")
    if (header) lines.push(theme.fg("accent", header))
    if (opts.expanded) {
      for (const l of body) lines.push(theme.fg("muted", l))
      lines.push("")
    } else if (body.length > 0) {
      lines.push(theme.fg("dim", body[0].slice(0, 80) + (body[0].length > 80 ? "…" : "")))
    }
  }

  if (!opts.expanded && entries.length > 4) {
    lines.push(theme.fg("dim", `... ${entries.length - 4} more (Ctrl+O)`))
  }

  return { render: () => lines, invalidate() {} }
}

// ─── Synopsis Tool ──────────────────────────────────────────────────────────

export function synopsisRenderCall(args: Record<string, any>, theme: PiTheme): any {
  const hours = args.hours ?? 24
  const author = args.author ? ` by ${args.author}` : ""
  const label = theme.fg("toolTitle", theme.bold("synopsis ")) + theme.fg("accent", `${hours}h`) + theme.fg("muted", author)
  return { render: () => [label], invalidate() {} }
}

export function synopsisRenderResult(result: any, opts: { expanded: boolean }, theme: PiTheme): any {
  const raw = extractText(result)
  const lines = raw.split("\n")
  const themed: string[] = []

  for (const line of lines) {
    if (/^#+\s/.test(line)) themed.push(theme.fg("accent", theme.bold(line)))
    else if (/^-\s/.test(line)) themed.push(theme.fg("muted", "  ") + theme.fg("text", line.slice(2)))
    else if (/feature|feat/i.test(line)) themed.push(theme.fg("success", line))
    else if (/fix|bug/i.test(line)) themed.push(theme.fg("error", line))
    else if (/decision/i.test(line)) themed.push(theme.fg("warning", line))
    else if (/time|hours|minutes/i.test(line)) themed.push(theme.fg("dim", line))
    else themed.push(theme.fg("toolOutput", line))
  }

  if (!opts.expanded && themed.length > 15) {
    const display = themed.slice(0, 15)
    display.push(theme.fg("dim", `... ${themed.length - 15} more lines (Ctrl+O)`))
    return { render: () => display, invalidate() {} }
  }

  return { render: () => themed, invalidate() {} }
}

// ─── Eval Status Tool ───────────────────────────────────────────────────────

export function evalStatusRenderCall(args: Record<string, any>, theme: PiTheme): any {
  const label = theme.fg("toolTitle", theme.bold("eval")) + " " + theme.fg("accent", "status")
  return { render: () => [label], invalidate() {} }
}

export function evalStatusRenderResult(result: any, opts: { expanded: boolean }, theme: PiTheme): any {
  const raw = extractText(result)
  const lines = raw.split("\n").filter(Boolean)
  const themed = lines.map(line => {
    const scoreMatch = line.match(/([\d.]+)/)
    if (scoreMatch) {
      const score = parseFloat(scoreMatch[1])
      if (score >= 0.8) return theme.fg("success", line)
      if (score >= 0.5) return theme.fg("warning", line)
      return theme.fg("error", line)
    }
    if (/trend|delta|improved/i.test(line)) return theme.fg("accent", line)
    return theme.fg("toolOutput", line)
  })

  return { render: () => themed, invalidate() {} }
}

// ─── Eval Compare Tool ──────────────────────────────────────────────────────

export function evalCompareRenderCall(args: Record<string, any>, theme: PiTheme): any {
  const a = args.a ?? "-2"
  const b = args.b ?? "-1"
  const label = theme.fg("toolTitle", theme.bold("eval")) + " " + theme.fg("accent", `compare ${a} ↔ ${b}`)
  return { render: () => [label], invalidate() {} }
}

export function evalCompareRenderResult(result: any, _opts: { expanded: boolean }, theme: PiTheme): any {
  const raw = extractText(result)
  const lines = raw.split("\n").filter(Boolean).map(line => {
    if (/improved|↑|better/i.test(line)) return theme.fg("success", line)
    if (/regressed|↓|worse/i.test(line)) return theme.fg("error", line)
    if (/unchanged|same/i.test(line)) return theme.fg("dim", line)
    return theme.fg("toolOutput", line)
  })
  return { render: () => lines, invalidate() {} }
}

// ─── Policy Score Tool ──────────────────────────────────────────────────────

export function policyScoreRenderCall(args: Record<string, any>, theme: PiTheme): any {
  const action = args.action_type ?? "?"
  const scope = args.scope ? `[${args.scope}]` : ""
  const label = theme.fg("toolTitle", theme.bold("policy ")) + theme.fg("accent", action) + " " + theme.fg("dim", scope)
  return { render: () => [label], invalidate() {} }
}

export function policyScoreRenderResult(result: any, _opts: { expanded: boolean }, theme: PiTheme): any {
  const raw = extractText(result)
  const lines = raw.split("\n").filter(Boolean).map(line => {
    if (/positive|recommend|high/i.test(line)) return theme.fg("success", line)
    if (/negative|avoid|low/i.test(line)) return theme.fg("error", line)
    if (/delta|score|predict/i.test(line)) return theme.fg("accent", line)
    return theme.fg("toolOutput", line)
  })
  return { render: () => lines, invalidate() {} }
}

// ─── Policy Rank Tool ───────────────────────────────────────────────────────

export function policyRankRenderCall(args: Record<string, any>, theme: PiTheme): any {
  let count = 0
  try { count = JSON.parse(args.actions ?? "[]").length } catch {}
  const label = theme.fg("toolTitle", theme.bold("policy ")) + theme.fg("accent", `rank ${count} actions`)
  return { render: () => [label], invalidate() {} }
}

export function policyRankRenderResult(result: any, _opts: { expanded: boolean }, theme: PiTheme): any {
  const raw = extractText(result)
  const lines = raw.split("\n").filter(Boolean)
  const themed = lines.map((line, i) => {
    const medal = i === 0 ? theme.fg("warning", "🥇") : i === 1 ? theme.fg("muted", "🥈") : i === 2 ? theme.fg("muted", "🥉") : theme.fg("dim", `  ${i + 1}.`)
    if (/delta|score/i.test(line)) return `${medal} ${theme.fg("accent", line)}`
    return `${medal} ${theme.fg("toolOutput", line)}`
  })
  return { render: () => themed, invalidate() {} }
}

// ─── Training Buffer Tool ───────────────────────────────────────────────────

export function trainingBufferRenderCall(args: Record<string, any>, theme: PiTheme): any {
  const action = args.action_type ?? "?"
  const outcome = args.outcome ?? ""
  const icon = outcome === "improved" ? theme.fg("success", "↑") : outcome === "regressed" ? theme.fg("error", "↓") : theme.fg("dim", "→")
  const label = theme.fg("toolTitle", theme.bold("train ")) + `${icon} ${theme.fg("accent", action)}`
  return { render: () => [label], invalidate() {} }
}

export function trainingBufferRenderResult(result: any, _opts: { expanded: boolean }, theme: PiTheme): any {
  const raw = extractText(result)
  const line = raw.includes("recorded") || raw.includes("saved")
    ? theme.fg("success", "✓ ") + theme.fg("muted", raw)
    : theme.fg("toolOutput", raw)
  return { render: () => [line], invalidate() {} }
}

// ─── Mine Tuples Tool ───────────────────────────────────────────────────────

export function mineTuplesRenderCall(args: Record<string, any>, theme: PiTheme): any {
  const source = args.source ?? "all"
  const write = args.write === "yes" ? theme.fg("warning", " (write)") : ""
  const label = theme.fg("toolTitle", theme.bold("mine ")) + theme.fg("accent", source) + write
  return { render: () => [label], invalidate() {} }
}

export function mineTuplesRenderResult(result: any, _opts: { expanded: boolean }, theme: PiTheme): any {
  const raw = extractText(result)
  const lines = raw.split("\n").filter(Boolean).map(line => {
    if (/mined|extracted|found/i.test(line)) return theme.fg("success", line)
    if (/error|failed/i.test(line)) return theme.fg("error", line)
    return theme.fg("toolOutput", line)
  })
  return { render: () => lines, invalidate() {} }
}

// ─── Extract text helper ────────────────────────────────────────────────────

function extractText(result: any): string {
  if (typeof result === "string") return result
  if (result?.details?.raw) return String(result.details.raw)
  if (result?.content) {
    for (const c of result.content) {
      if (c?.type === "text") return c.text
    }
  }
  return String(result ?? "")
}
