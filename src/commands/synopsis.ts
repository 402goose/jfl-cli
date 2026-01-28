/**
 * jfl synopsis - Work summary aggregator
 *
 * Aggregates journal entries, git commits, and code headers to show
 * what happened in a given time period.
 *
 * @purpose CLI command for generating work summaries
 */

import chalk from "chalk"
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"

// ============================================================================
// Types
// ============================================================================

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

interface GitCommit {
  hash: string
  author: string
  date: string
  message: string
}

interface FileHeader {
  file: string
  purpose: string
  spec?: string
  decision?: string
}

interface Synopsis {
  hours: number
  author?: string
  journalEntries: JournalEntry[]
  commits: GitCommit[]
  fileHeaders: FileHeader[]
  summary: {
    features: number
    fixes: number
    decisions: number
    discoveries: number
    filesModified: number
    incompleteItems: string[]
  }
}

// ============================================================================
// Journal Reader
// ============================================================================

function readJournalEntries(
  projectRoot: string,
  since: Date,
  author?: string
): JournalEntry[] {
  const journalDir = path.join(projectRoot, ".jfl", "journal")
  const entries: JournalEntry[] = []

  if (!fs.existsSync(journalDir)) {
    return entries
  }

  const files = fs.readdirSync(journalDir).filter(f => f.endsWith(".jsonl"))

  for (const file of files) {
    const filePath = path.join(journalDir, file)
    const content = fs.readFileSync(filePath, "utf-8")
    const lines = content.trim().split("\n").filter(l => l.trim())

    for (const line of lines) {
      try {
        const entry: JournalEntry = JSON.parse(line)

        // Filter by timestamp
        if (entry.ts && new Date(entry.ts) < since) {
          continue
        }

        // Filter by author (check session name for author hint)
        if (author && entry.session && !entry.session.toLowerCase().includes(author.toLowerCase())) {
          continue
        }

        entries.push(entry)
      } catch {
        // Skip malformed lines
      }
    }
  }

  return entries.sort((a, b) => {
    const tsA = a.ts ? new Date(a.ts).getTime() : 0
    const tsB = b.ts ? new Date(b.ts).getTime() : 0
    return tsB - tsA // Most recent first
  })
}

// ============================================================================
// Git Commits
// ============================================================================

function getGitCommits(
  projectRoot: string,
  since: Date,
  author?: string
): GitCommit[] {
  try {
    const sinceStr = since.toISOString()
    let command = `git log --all --since="${sinceStr}" --pretty=format:"%H|%an|%aI|%s"`

    if (author) {
      command += ` --author="${author}"`
    }

    const output = execSync(command, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"]
    })

    if (!output.trim()) {
      return []
    }

    return output
      .trim()
      .split("\n")
      .map(line => {
        const [hash, authorName, date, message] = line.split("|")
        return { hash, author: authorName, date, message }
      })
  } catch {
    return []
  }
}

// ============================================================================
// File Headers
// ============================================================================

function extractHeaders(content: string): { purpose?: string; spec?: string; decision?: string } {
  const purposeMatch = content.match(/@purpose\s+(.+?)(?:\n|\*)/i)
  const specMatch = content.match(/@spec\s+(.+?)(?:\n|\*)/i)
  const decisionMatch = content.match(/@decision\s+(.+?)(?:\n|\*)/i)

  return {
    purpose: purposeMatch ? purposeMatch[1].trim() : undefined,
    spec: specMatch ? specMatch[1].trim() : undefined,
    decision: decisionMatch ? decisionMatch[1].trim() : undefined
  }
}

function getModifiedFiles(projectRoot: string, since: Date): string[] {
  try {
    const sinceStr = since.toISOString()
    const output = execSync(
      `git log --all --since="${sinceStr}" --name-only --pretty=format:`,
      {
        cwd: projectRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"]
      }
    )

    const files = new Set(
      output
        .split("\n")
        .map(f => f.trim())
        .filter(f => f && (f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".jsx")))
    )

    return Array.from(files)
  } catch {
    return []
  }
}

function readFileHeaders(projectRoot: string, since: Date): FileHeader[] {
  const modifiedFiles = getModifiedFiles(projectRoot, since)
  const headers: FileHeader[] = []

  for (const file of modifiedFiles) {
    const filePath = path.join(projectRoot, file)
    if (!fs.existsSync(filePath)) continue

    try {
      const content = fs.readFileSync(filePath, "utf-8")
      const extracted = extractHeaders(content)

      if (extracted.purpose) {
        const header: FileHeader = {
          file,
          purpose: extracted.purpose
        }
        if (extracted.spec) header.spec = extracted.spec
        if (extracted.decision) header.decision = extracted.decision
        headers.push(header)
      }
    } catch {
      // Skip unreadable files
    }
  }

  return headers
}

// ============================================================================
// Synopsis Generator
// ============================================================================

function generateSynopsis(
  projectRoot: string,
  hours: number,
  author?: string
): Synopsis {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000)

  const journalEntries = readJournalEntries(projectRoot, since, author)
  const commits = getGitCommits(projectRoot, since, author)
  const fileHeaders = readFileHeaders(projectRoot, since)

  // Aggregate summary
  const features = journalEntries.filter(e => e.type === "feature").length
  const fixes = journalEntries.filter(e => e.type === "fix").length
  const decisions = journalEntries.filter(e => e.type === "decision").length
  const discoveries = journalEntries.filter(e => e.type === "discovery").length

  const filesModified = new Set([
    ...commits.map(c => c.message),
    ...journalEntries.flatMap(e => e.files || [])
  ]).size

  const incompleteItems = journalEntries.flatMap(e => e.incomplete || [])

  return {
    hours,
    author,
    journalEntries,
    commits,
    fileHeaders,
    summary: {
      features,
      fixes,
      decisions,
      discoveries,
      filesModified,
      incompleteItems
    }
  }
}

// ============================================================================
// Display
// ============================================================================

function displaySynopsis(synopsis: Synopsis) {
  const { hours, author, journalEntries, commits, fileHeaders, summary } = synopsis

  console.log(chalk.bold(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`))
  console.log(chalk.bold(`  Synopsis: Last ${hours} hours`))
  if (author) {
    console.log(chalk.gray(`  Author: ${author}`))
  }
  console.log(chalk.bold(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`))

  // Summary
  console.log(chalk.cyan("Summary"))
  console.log(`  ${chalk.green(summary.features)} features`)
  console.log(`  ${chalk.blue(summary.fixes)} fixes`)
  console.log(`  ${chalk.yellow(summary.decisions)} decisions`)
  console.log(`  ${chalk.magenta(summary.discoveries)} discoveries`)
  console.log(`  ${chalk.gray(summary.filesModified)} files modified`)
  console.log()

  // Journal Entries
  if (journalEntries.length > 0) {
    console.log(chalk.cyan("Journal Entries"))
    for (const entry of journalEntries.slice(0, 10)) {
      const typeColor =
        entry.type === "feature"
          ? chalk.green
          : entry.type === "fix"
          ? chalk.blue
          : entry.type === "decision"
          ? chalk.yellow
          : chalk.white

      console.log(`  ${typeColor(`[${entry.type}]`)} ${entry.title}`)
      if (entry.summary) {
        console.log(chalk.gray(`    ${entry.summary}`))
      }
      if (entry.files && entry.files.length > 0) {
        console.log(chalk.gray(`    Files: ${entry.files.slice(0, 3).join(", ")}`))
      }
    }
    if (journalEntries.length > 10) {
      console.log(chalk.gray(`  ... and ${journalEntries.length - 10} more entries`))
    }
    console.log()
  }

  // Commits
  if (commits.length > 0) {
    console.log(chalk.cyan("Git Commits"))
    for (const commit of commits.slice(0, 10)) {
      console.log(`  ${chalk.gray(commit.hash.slice(0, 7))} ${commit.message}`)
      console.log(chalk.gray(`    by ${commit.author} on ${new Date(commit.date).toLocaleString()}`))
    }
    if (commits.length > 10) {
      console.log(chalk.gray(`  ... and ${commits.length - 10} more commits`))
    }
    console.log()
  }

  // File Headers
  if (fileHeaders.length > 0) {
    console.log(chalk.cyan("Modified Files (with @purpose)"))
    for (const header of fileHeaders.slice(0, 10)) {
      console.log(`  ${chalk.white(header.file)}`)
      console.log(chalk.gray(`    @purpose ${header.purpose}`))
      if (header.spec) {
        console.log(chalk.gray(`    @spec ${header.spec}`))
      }
      if (header.decision) {
        console.log(chalk.gray(`    @decision ${header.decision}`))
      }
    }
    if (fileHeaders.length > 10) {
      console.log(chalk.gray(`  ... and ${fileHeaders.length - 10} more files`))
    }
    console.log()
  }

  // Incomplete Items
  if (summary.incompleteItems.length > 0) {
    console.log(chalk.cyan("Incomplete / Next Steps"))
    for (const item of summary.incompleteItems.slice(0, 5)) {
      console.log(`  ${chalk.yellow("○")} ${item}`)
    }
    console.log()
  }

  // Next Steps (from most recent journal entry)
  const mostRecent = journalEntries[0]
  if (mostRecent && mostRecent.next) {
    console.log(chalk.cyan("Next Action"))
    console.log(`  ${mostRecent.next}`)
    console.log()
  }

  console.log(chalk.bold(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`))
}

// ============================================================================
// CLI Command
// ============================================================================

export async function synopsisCommand(hours: string = "24", author?: string) {
  const projectRoot = process.cwd()
  const hoursNum = parseInt(hours, 10)

  if (isNaN(hoursNum) || hoursNum <= 0) {
    console.log(chalk.red("\n  Invalid hours parameter. Must be a positive number.\n"))
    return
  }

  const synopsis = generateSynopsis(projectRoot, hoursNum, author)
  displaySynopsis(synopsis)
}
