/**
 * Kuva Terminal Plotting
 *
 * Pipes structured data to the kuva CLI for terminal-rendered plots.
 * Kuva is a Rust scientific plotting tool (github.com/Psy-Fer/kuva).
 *
 * @purpose Bridge between JFL data (telemetry, arena, RL, events) and terminal visualization via kuva
 */

import { execSync, spawnSync } from 'child_process'

export interface BarEntry {
  label: string
  value: number
}

export interface ScatterPoint {
  x: number
  y: number
  label?: string
}

export interface TimeSeriesPoint {
  ts: string
  value: number
  series?: string
}

export function isKuvaInstalled(): boolean {
  try {
    execSync('which kuva', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function toTsv(headers: string[], rows: string[][]): string {
  const lines = [headers.join('\t')]
  for (const row of rows) {
    lines.push(row.join('\t'))
  }
  return lines.join('\n')
}

function runKuva(plotType: string, tsv: string, args: string[]): string | null {
  const result = spawnSync('kuva', [plotType, ...args, '--terminal'], {
    input: tsv,
    encoding: 'utf-8',
    timeout: 10000,
  })
  if (result.status !== 0) {
    return null
  }
  return result.stdout || null
}

export function barChart(entries: BarEntry[], title?: string): string | null {
  if (entries.length === 0) return null
  const tsv = toTsv(
    ['label', 'value'],
    entries.map(e => [e.label, String(e.value)])
  )
  const args: string[] = ['--label-col', 'label', '--value-col', 'value']
  if (title) args.push('--title', title)
  const output = runKuva('bar', tsv, args)
  if (!output) return null
  return output
}

export function scatterPlot(points: ScatterPoint[], title?: string): string | null {
  if (points.length === 0) return null
  const hasGroups = points.some(p => p.label)
  const headers = hasGroups ? ['x', 'y', 'group'] : ['x', 'y']
  const rows = points.map(p => hasGroups ? [String(p.x), String(p.y), p.label || ''] : [String(p.x), String(p.y)])
  const tsv = toTsv(headers, rows)
  const args: string[] = ['--x', 'x', '--y', 'y']
  if (hasGroups) args.push('--color-by', 'group')
  if (title) args.push('--title', title)
  const output = runKuva('scatter', tsv, args)
  if (!output) return null
  return output
}

export function linePlot(points: TimeSeriesPoint[], title?: string): string | null {
  if (points.length === 0) return null
  const hasSeries = points.some(p => p.series)
  const headers = hasSeries ? ['step', 'value', 'series'] : ['step', 'value']
  const rows = points.map((p, i) => hasSeries
    ? [String(i), String(p.value), p.series || '']
    : [String(i), String(p.value)]
  )
  const tsv = toTsv(headers, rows)
  const args: string[] = ['--x', 'step', '--y', 'value']
  if (hasSeries) args.push('--color-by', 'series')
  if (title) args.push('--title', title)
  const output = runKuva('line', tsv, args)
  if (!output) return null
  return output
}

/**
 * Render a simple ASCII bar chart without kuva dependency.
 * Fallback for when kuva isn't installed, and useful for agents
 * that want zero-dependency terminal visualization.
 */
export function asciiBars(entries: BarEntry[], opts?: { width?: number; title?: string }): string {
  if (entries.length === 0) return ''
  const width = opts?.width ?? 40
  const maxVal = Math.max(...entries.map(e => e.value))
  const maxLabelLen = Math.max(...entries.map(e => e.label.length), 5)

  const lines: string[] = []
  if (opts?.title) lines.push(`  ${opts.title}`)

  for (const entry of entries) {
    const barLen = maxVal > 0 ? Math.round((entry.value / maxVal) * width) : 0
    const bar = '\u2588'.repeat(barLen)
    const label = entry.label.padEnd(maxLabelLen)
    lines.push(`  ${label} ${bar} ${entry.value}`)
  }

  return lines.join('\n')
}

/**
 * Render a sparkline for time-series data.
 * Single line of Unicode block characters showing trend.
 */
export function sparkline(values: number[]): string {
  if (values.length === 0) return ''
  const blocks = ['\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588']
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values.map(v => blocks[Math.min(Math.floor(((v - min) / range) * 7), 7)]).join('')
}

/**
 * Render data using kuva if available, fall back to ASCII.
 */
export function renderBars(entries: BarEntry[], title?: string): string {
  if (isKuvaInstalled()) {
    const kuvaOutput = barChart(entries, title)
    if (kuvaOutput) return kuvaOutput
  }
  return asciiBars(entries, { title })
}
