import chalk from "chalk"
import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { isAuthenticated, getAuthMethod, getUser } from "./login.js"

interface RoadmapPhase {
  name: string
  start: Date
  end: Date
  status: "complete" | "active" | "upcoming"
}

export async function hudCommand(options?: { compact?: boolean }) {
  const cwd = process.cwd()

  // Check if in a JFL project
  const hasJflConfig = existsSync(join(cwd, "CLAUDE.md")) || existsSync(join(cwd, "knowledge"))

  if (!hasJflConfig) {
    console.log(chalk.yellow("\nNot in a JFL project directory."))
    console.log(chalk.gray("Run 'jfl init' to create a new project."))
    return
  }

  if (options?.compact) {
    await showCompactHud(cwd)
  } else {
    await showFullHud(cwd)
  }
}

async function showCompactHud(cwd: string) {
  const projectName = getProjectName(cwd)
  const countdown = getCountdown(cwd)
  const taskStats = getTaskStats(cwd)
  const authStatus = getAuthStatus()

  // One-line status
  const countdownStr = countdown
    ? chalk.cyan(`${countdown.days}d`)
    : chalk.gray("no date")

  const tasksStr = taskStats
    ? chalk.gray(`${taskStats.done}/${taskStats.total}`)
    : ""

  console.log(`${chalk.bold(projectName)} ${countdownStr} ${tasksStr} ${authStatus}`)
}

async function showFullHud(cwd: string) {
  const projectName = getProjectName(cwd)

  console.log()
  console.log(chalk.bold.cyan("═".repeat(50)))
  console.log(chalk.bold(`  📊 ${projectName.toUpperCase()}`))
  console.log(chalk.bold.cyan("═".repeat(50)))

  // Countdown
  const countdown = getCountdown(cwd)
  if (countdown) {
    const urgencyColor =
      countdown.days <= 3
        ? chalk.red.bold
        : countdown.days <= 7
          ? chalk.yellow.bold
          : chalk.green.bold

    console.log()
    console.log(chalk.gray("  LAUNCH"))
    console.log(urgencyColor(`  ${countdown.days} DAYS TO LAUNCH`))
    console.log(chalk.gray(`  ${countdown.date.toLocaleDateString()}`))
  }

  // Phase tracker
  const phases = getPhases(cwd)
  if (phases.length > 0) {
    console.log()
    console.log(chalk.gray("  PHASE"))
    for (const phase of phases) {
      const icon =
        phase.status === "complete"
          ? chalk.green("✓")
          : phase.status === "active"
            ? chalk.yellow("▶")
            : chalk.gray("○")
      const name =
        phase.status === "active"
          ? chalk.bold(phase.name)
          : phase.status === "complete"
            ? chalk.gray(phase.name)
            : chalk.white(phase.name)
      console.log(`  ${icon} ${name}`)
    }
  }

  // Task stats
  const taskStats = getTaskStats(cwd)
  if (taskStats) {
    console.log()
    console.log(chalk.gray("  TASKS"))
    const percent = Math.round((taskStats.done / taskStats.total) * 100)
    const bar = createProgressBar(percent, 20)
    console.log(`  ${bar} ${percent}%`)
    console.log(chalk.gray(`  ${taskStats.done} done • ${taskStats.inProgress} in progress • ${taskStats.todo} todo`))
  }

  // Auth status
  console.log()
  console.log(chalk.gray("  AUTH"))
  if (isAuthenticated()) {
    const method = getAuthMethod()
    if (method === "x402") {
      console.log(chalk.blue(`  💰 x402 ($5/day)`))
    } else {
      const user = getUser()
      console.log(chalk.blue(`  🐙 ${user?.tier || "GitHub"}`))
    }
  } else {
    console.log(chalk.gray("  ○ Not authenticated"))
    console.log(chalk.gray("    Run 'jfl login' to unlock platform features"))
  }

  // Knowledge layer status
  const knowledgeStatus = getKnowledgeStatus(cwd)
  console.log()
  console.log(chalk.gray("  KNOWLEDGE"))
  console.log(`  ${knowledgeStatus.ready}/${knowledgeStatus.total} docs configured`)
  if (knowledgeStatus.missing.length > 0 && knowledgeStatus.missing.length <= 3) {
    console.log(chalk.gray(`  Missing: ${knowledgeStatus.missing.join(", ")}`))
  }

  // Quick actions
  console.log()
  console.log(chalk.gray("  QUICK ACTIONS"))
  console.log("  /brand-architect     Create brand identity")
  console.log("  /content thread      Write a launch thread")
  console.log("  jfl deploy           Deploy to platform")

  console.log()
  console.log(chalk.bold.cyan("═".repeat(50)))
  console.log()
}

function getProjectName(cwd: string): string {
  // Try VISION.md for project name
  const visionPath = join(cwd, "knowledge", "VISION.md")
  if (existsSync(visionPath)) {
    const content = readFileSync(visionPath, "utf-8")
    const titleMatch = content.match(/^#\s+(.+)$/m)
    if (titleMatch) {
      return titleMatch[1].trim()
    }
  }

  // Try package.json
  const pkgPath = join(cwd, "package.json")
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
      if (pkg.name) return pkg.name
    } catch {
      // ignore
    }
  }

  // Fall back to directory name
  return cwd.split("/").pop() || "Project"
}

function getCountdown(cwd: string): { days: number; date: Date } | null {
  // Try to parse launch date from ROADMAP.md
  const roadmapPath = join(cwd, "knowledge", "ROADMAP.md")
  if (!existsSync(roadmapPath)) return null

  const content = readFileSync(roadmapPath, "utf-8")

  // Look for date patterns
  const datePatterns = [
    /launch[:\s]+(\d{4}-\d{2}-\d{2})/i,
    /launch date[:\s]+(\d{4}-\d{2}-\d{2})/i,
    /launches?[:\s]+(\w+\s+\d{1,2},?\s+\d{4})/i,
  ]

  for (const pattern of datePatterns) {
    const match = content.match(pattern)
    if (match) {
      const date = new Date(match[1])
      if (!isNaN(date.getTime())) {
        const now = new Date()
        const diff = date.getTime() - now.getTime()
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
        return { days: Math.max(0, days), date }
      }
    }
  }

  return null
}

function getPhases(cwd: string): RoadmapPhase[] {
  const roadmapPath = join(cwd, "knowledge", "ROADMAP.md")
  if (!existsSync(roadmapPath)) return []

  const content = readFileSync(roadmapPath, "utf-8")
  const phases: RoadmapPhase[] = []

  // Look for phase headers
  const phaseMatches = content.matchAll(/^##\s+(?:Phase\s+\d+:?\s+)?(.+)$/gm)

  for (const match of phaseMatches) {
    const name = match[1].trim()
    // Simple heuristic: phases with checkmarks are complete
    const isComplete = content.includes(`[x]`) && content.slice(0, match.index).includes(`[x]`)

    phases.push({
      name,
      start: new Date(),
      end: new Date(),
      status: isComplete ? "complete" : "upcoming",
    })
  }

  // Mark one as active
  if (phases.length > 0) {
    const activeIndex = phases.findIndex((p) => p.status !== "complete")
    if (activeIndex >= 0) {
      phases[activeIndex].status = "active"
    }
  }

  return phases.slice(0, 5) // Limit to 5 phases
}

function getTaskStats(cwd: string): { total: number; done: number; inProgress: number; todo: number } | null {
  const tasksPath = join(cwd, "knowledge", "TASKS.md")
  if (!existsSync(tasksPath)) return null

  const content = readFileSync(tasksPath, "utf-8")

  // Count checkboxes
  const doneMatches = content.match(/\[x\]/gi) || []
  const todoMatches = content.match(/\[\s\]/g) || []
  const inProgressMatches = content.match(/\[~\]/g) || []

  const done = doneMatches.length
  const inProgress = inProgressMatches.length
  const todo = todoMatches.length
  const total = done + inProgress + todo

  if (total === 0) return null

  return { total, done, inProgress, todo }
}

function getKnowledgeStatus(cwd: string): { total: number; ready: number; missing: string[] } {
  const knowledgePath = join(cwd, "knowledge")
  const requiredDocs = [
    "VISION.md",
    "NARRATIVE.md",
    "THESIS.md",
    "ROADMAP.md",
    "BRAND_BRIEF.md",
    "BRAND_DECISIONS.md",
  ]

  const missing: string[] = []
  let ready = 0

  for (const doc of requiredDocs) {
    const docPath = join(knowledgePath, doc)
    if (existsSync(docPath)) {
      const content = readFileSync(docPath, "utf-8").trim()
      // Check if it has actual content beyond template
      if (content.length > 100 && !content.includes("TODO") && !content.includes("[fill in]")) {
        ready++
      } else {
        missing.push(doc.replace(".md", ""))
      }
    } else {
      missing.push(doc.replace(".md", ""))
    }
  }

  return { total: requiredDocs.length, ready, missing }
}

function getAuthStatus(): string {
  if (!isAuthenticated()) {
    return chalk.gray("○")
  }

  const method = getAuthMethod()
  if (method === "x402") {
    return chalk.blue("💰")
  } else {
    return chalk.green("✓")
  }
}

function createProgressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width)
  const empty = width - filled

  const filledChar = chalk.green("█")
  const emptyChar = chalk.gray("░")

  return filledChar.repeat(filled) + emptyChar.repeat(empty)
}
