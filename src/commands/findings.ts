/**
 * @purpose CLI commands for findings — list, dismiss, fix
 */

import chalk from "chalk"
import type { Command } from "commander"
import { spawn } from "child_process"
import { FindingsEngine, type Finding, type FindingSeverity } from "../lib/findings-engine.js"

function formatTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] || "").length))
  )

  const lines: string[] = []
  lines.push("  " + headers.map((h, i) => h.padEnd(colWidths[i])).join("  "))
  lines.push("  " + colWidths.map(w => "─".repeat(w)).join("  "))
  for (const row of rows) {
    lines.push("  " + row.map((c, i) => (c || "").padEnd(colWidths[i])).join("  "))
  }
  return lines.join("\n")
}

function severityColor(severity: FindingSeverity): (text: string) => string {
  switch (severity) {
    case "critical": return chalk.red
    case "warning": return chalk.yellow
    case "info": return chalk.blue
  }
}

function severityIcon(severity: FindingSeverity): string {
  switch (severity) {
    case "critical": return "🔴"
    case "warning": return "⚠️"
    case "info": return "ℹ️"
  }
}

async function listCommand(options: { refresh?: boolean; all?: boolean }): Promise<void> {
  const engine = new FindingsEngine(process.cwd())

  let findings: Finding[]
  if (options.refresh) {
    console.log(chalk.gray("\n  Analyzing project..."))
    findings = await engine.analyze()
  } else {
    findings = engine.getFindings()
    if (findings.length === 0) {
      console.log(chalk.gray("\n  Analyzing project..."))
      findings = await engine.analyze()
    }
  }

  // Filter dismissed unless --all
  if (!options.all) {
    findings = findings.filter(f => !f.dismissed)
  }

  if (findings.length === 0) {
    console.log(chalk.green("\n  ✓ No findings. Everything looks good!\n"))
    return
  }

  console.log(chalk.bold(`\n  Findings (${findings.length})\n`))

  // Sort by severity
  const severityOrder: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2 }
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i]
    const icon = severityIcon(f.severity)
    const color = severityColor(f.severity)
    const dismissed = f.dismissed ? chalk.gray(" [dismissed]") : ""

    console.log(`  ${chalk.gray(`${i + 1}.`)} ${icon} ${color(f.title)}${dismissed}`)
    console.log(chalk.gray(`     ${f.description}`))

    if (f.scope_files.length > 0) {
      const files = f.scope_files.slice(0, 3).join(", ")
      const more = f.scope_files.length > 3 ? ` +${f.scope_files.length - 3} more` : ""
      console.log(chalk.gray(`     Scope: ${files}${more}`))
    }

    if (f.agent_config) {
      console.log(chalk.cyan(`     Action: jfl findings fix ${i + 1}`))
    } else {
      console.log(chalk.gray(`     Action: investigate manually`))
    }

    console.log()
  }

  // Summary
  const critical = findings.filter(f => f.severity === "critical").length
  const warning = findings.filter(f => f.severity === "warning").length
  const info = findings.filter(f => f.severity === "info").length

  const parts: string[] = []
  if (critical > 0) parts.push(chalk.red(`${critical} critical`))
  if (warning > 0) parts.push(chalk.yellow(`${warning} warning`))
  if (info > 0) parts.push(chalk.blue(`${info} info`))

  console.log(chalk.gray(`  Summary: ${parts.join(", ")}`))
  console.log(chalk.gray(`  Run 'jfl findings fix <n>' to spawn an agent for a fixable finding\n`))
}

async function fixCommand(index: string): Promise<void> {
  const idx = parseInt(index, 10) - 1

  if (isNaN(idx) || idx < 0) {
    console.log(chalk.red("\n  Invalid finding number. Run 'jfl findings' to see the list.\n"))
    return
  }

  const engine = new FindingsEngine(process.cwd())
  const findings = engine.getFindings().filter(f => !f.dismissed)

  // Sort by severity (same as list)
  const severityOrder: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2 }
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  if (idx >= findings.length) {
    console.log(chalk.red(`\n  Finding #${idx + 1} not found. Run 'jfl findings' to see the list.\n`))
    return
  }

  const finding = findings[idx]

  if (!finding.agent_config) {
    console.log(chalk.yellow(`\n  Finding "${finding.title}" doesn't have an automated fix.`))
    console.log(chalk.gray("  This requires manual investigation.\n"))
    return
  }

  console.log(chalk.bold(`\n  Spawning agent to fix: ${finding.title}\n`))
  console.log(chalk.gray(`  Type: ${finding.type}`))
  console.log(chalk.gray(`  Target: ${finding.agent_config.metric} >= ${finding.agent_config.target}`))

  if (finding.agent_config.scope_files.length > 0) {
    console.log(chalk.gray(`  Scope: ${finding.agent_config.scope_files.slice(0, 5).join(", ")}`))
  }

  console.log()

  // Build prompt
  const prompt = `Fix this issue: ${finding.title}

${finding.description}

Target metric: ${finding.agent_config.metric} >= ${finding.agent_config.target}
Scope files: ${finding.agent_config.scope_files.join(", ") || "all"}
Eval script: ${finding.agent_config.eval_script}

Approach:
1. Understand the current state
2. Make targeted changes to improve the metric
3. Run the eval script to verify improvement
4. Only commit changes that show measurable improvement`

  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.CLAUDE_CODE_ENTRYPOINT

  const child = spawn("jfl", ["peter", "run", "--prompt", prompt], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env,
  })
  child.unref()

  console.log(chalk.green(`  Agent spawned (PID: ${child.pid})`))
  console.log(chalk.gray(`  Run 'jfl peter status' to check progress\n`))
}

async function dismissCommand(index: string): Promise<void> {
  const idx = parseInt(index, 10) - 1

  if (isNaN(idx) || idx < 0) {
    console.log(chalk.red("\n  Invalid finding number. Run 'jfl findings' to see the list.\n"))
    return
  }

  const engine = new FindingsEngine(process.cwd())
  const findings = engine.getFindings().filter(f => !f.dismissed)

  // Sort by severity
  const severityOrder: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2 }
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  if (idx >= findings.length) {
    console.log(chalk.red(`\n  Finding #${idx + 1} not found. Run 'jfl findings' to see the list.\n`))
    return
  }

  const finding = findings[idx]
  engine.dismissFinding(finding.id)

  console.log(chalk.green(`\n  Dismissed: ${finding.title}\n`))
}

async function analyzeCommand(): Promise<void> {
  console.log(chalk.gray("\n  Analyzing project..."))

  const engine = new FindingsEngine(process.cwd())
  const findings = await engine.analyze()

  const active = findings.filter(f => !f.dismissed)

  if (active.length === 0) {
    console.log(chalk.green("  ✓ No findings. Everything looks good!\n"))
    return
  }

  console.log(chalk.green(`  ✓ Analysis complete. Found ${active.length} issue(s).`))
  console.log(chalk.gray("  Run 'jfl findings' to see details.\n"))
}

export function registerFindingsCommand(program: Command): void {
  const findingsCmd = program
    .command("findings")
    .description("Surface and fix problems automatically")

  findingsCmd
    .command("list", { isDefault: true })
    .description("List current findings")
    .option("--refresh", "Re-analyze before listing")
    .option("--all", "Include dismissed findings")
    .action(listCommand)

  findingsCmd
    .command("fix <n>")
    .description("Spawn an agent to fix finding #n")
    .action(fixCommand)

  findingsCmd
    .command("dismiss <n>")
    .description("Dismiss finding #n")
    .action(dismissCommand)

  findingsCmd
    .command("analyze")
    .description("Force re-analyze the project")
    .action(analyzeCommand)

  findingsCmd.action(async () => {
    await listCommand({})
  })
}
