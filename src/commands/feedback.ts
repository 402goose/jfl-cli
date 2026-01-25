import chalk from "chalk"
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "fs"
import { join } from "path"
import inquirer from "inquirer"
import { isAuthenticated, getToken, getAuthMethod } from "./login.js"
import { getPlatformAuthHeaders } from "../utils/platform-auth.js"

const PLATFORM_URL = process.env.JFL_PLATFORM_URL || "https://jfl.run"

interface FeedbackEntry {
  date: string
  rating: number
  issue?: string
  session_context?: string
  synced?: boolean
}

export async function feedbackCommand(action?: string) {
  const cwd = process.cwd()
  const feedbackDir = join(cwd, ".jfl")
  const feedbackFile = join(feedbackDir, "feedback.jsonl")

  switch (action) {
    case "sync":
      await syncFeedback(feedbackFile)
      break
    case "view":
      await viewFeedback(feedbackFile)
      break
    default:
      await collectFeedback(feedbackDir, feedbackFile)
  }
}

async function collectFeedback(feedbackDir: string, feedbackFile: string) {
  console.log(chalk.bold("\n📊 JFL Feedback\n"))

  const { rating } = await inquirer.prompt([
    {
      type: "list",
      name: "rating",
      message: "How's JFL doing this session?",
      choices: [
        { name: "5 - Amazing", value: 5 },
        { name: "4 - Great", value: 4 },
        { name: "3 - Fine", value: 3 },
        { name: "2 - Not great", value: 2 },
        { name: "1 - Frustrating", value: 1 },
        { name: "0 - Broken", value: 0 },
      ],
    },
  ])

  const entry: FeedbackEntry = {
    date: new Date().toISOString().split("T")[0],
    rating,
  }

  if (rating <= 2) {
    const { issue } = await inquirer.prompt([
      {
        type: "input",
        name: "issue",
        message: "What went wrong?",
      },
    ])
    entry.issue = issue

    const { context } = await inquirer.prompt([
      {
        type: "input",
        name: "context",
        message: "What were you trying to do? (optional)",
        default: "",
      },
    ])
    if (context) entry.session_context = context

    console.log(chalk.yellow("\nSorry about that. Logged for improvement."))
  } else {
    console.log(chalk.green("\nThanks! Keep shipping."))
  }

  // Save locally
  if (!existsSync(feedbackDir)) {
    mkdirSync(feedbackDir, { recursive: true })
  }
  appendFileSync(feedbackFile, JSON.stringify(entry) + "\n")

  // Offer to sync if authenticated
  if (isAuthenticated() && rating <= 2) {
    const { share } = await inquirer.prompt([
      {
        type: "confirm",
        name: "share",
        message: "Share this with the JFL team to help improve?",
        default: true,
      },
    ])

    if (share) {
      await syncSingleEntry(entry)
    }
  }

  console.log()
}

async function viewFeedback(feedbackFile: string) {
  if (!existsSync(feedbackFile)) {
    console.log(chalk.gray("\nNo feedback logged yet.\n"))
    return
  }

  const lines = readFileSync(feedbackFile, "utf-8").trim().split("\n")
  const entries: FeedbackEntry[] = lines.map((l) => JSON.parse(l))

  console.log(chalk.bold("\n📊 Feedback History\n"))

  const avg = entries.reduce((sum, e) => sum + e.rating, 0) / entries.length
  console.log(chalk.gray(`Average rating: ${avg.toFixed(1)}/5`))
  console.log(chalk.gray(`Total sessions: ${entries.length}\n`))

  // Show last 10
  const recent = entries.slice(-10).reverse()
  for (const entry of recent) {
    const ratingColor = entry.rating >= 4 ? chalk.green : entry.rating >= 3 ? chalk.yellow : chalk.red
    console.log(`${chalk.gray(entry.date)} ${ratingColor(entry.rating + "/5")}${entry.issue ? ` - ${entry.issue}` : ""}`)
  }

  console.log()
}

async function syncFeedback(feedbackFile: string) {
  if (!isAuthenticated()) {
    console.log(chalk.yellow("\nLogin required to sync feedback."))
    console.log(chalk.gray("Run: jfl login\n"))
    return
  }

  if (!existsSync(feedbackFile)) {
    console.log(chalk.gray("\nNo feedback to sync.\n"))
    return
  }

  const lines = readFileSync(feedbackFile, "utf-8").trim().split("\n")
  const entries: FeedbackEntry[] = lines.map((l) => JSON.parse(l))
  const unsynced = entries.filter((e) => !e.synced)

  if (unsynced.length === 0) {
    console.log(chalk.gray("\nAll feedback already synced.\n"))
    return
  }

  console.log(chalk.cyan(`\nSyncing ${unsynced.length} feedback entries...`))

  try {
    const token = getToken()
    const platformAuthHeaders = getPlatformAuthHeaders()

    // Use platform auth if available, otherwise use legacy GitHub token
    const authHeaders = Object.keys(platformAuthHeaders).length > 0
      ? platformAuthHeaders
      : { Authorization: `Bearer ${token}` }

    const res = await fetch(`${PLATFORM_URL}/api/feedback`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ entries: unsynced }),
    })

    if (res.ok) {
      // Mark as synced
      const updated = entries.map((e) => ({ ...e, synced: true }))
      const content = updated.map((e) => JSON.stringify(e)).join("\n") + "\n"
      require("fs").writeFileSync(feedbackFile, content)

      console.log(chalk.green("✓ Feedback synced. Thanks for helping improve JFL!\n"))
    } else {
      console.log(chalk.red("Failed to sync. Will retry next time.\n"))
    }
  } catch (error) {
    console.log(chalk.red("Failed to sync. Will retry next time.\n"))
  }
}

async function syncSingleEntry(entry: FeedbackEntry) {
  try {
    const token = getToken()
    const platformAuthHeaders = getPlatformAuthHeaders()

    // Use platform auth if available, otherwise use legacy GitHub token
    const authHeaders = Object.keys(platformAuthHeaders).length > 0
      ? platformAuthHeaders
      : { Authorization: `Bearer ${token}` }

    await fetch(`${PLATFORM_URL}/api/feedback`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ entries: [entry] }),
    })
    console.log(chalk.green("✓ Shared with JFL team."))
  } catch {
    console.log(chalk.gray("(Will sync later)"))
  }
}
