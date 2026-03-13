import chalk from "chalk"
import inquirer from "inquirer"
import { existsSync } from "fs"
import { join } from "path"
import { getConfigValue, setConfig } from "./jfl-config.js"

// Cache project detection result for the current process
let _isProjectCache: { cwd: string; isProject: boolean } | undefined

/**
 * Fast check if directory is a JFL project (cached per-cwd)
 */
function checkIsProject(cwd: string): boolean {
  if (_isProjectCache && _isProjectCache.cwd === cwd) {
    return _isProjectCache.isProject
  }
  const isProject =
    existsSync(join(cwd, ".jfl")) ||
    existsSync(join(cwd, "CLAUDE.md")) ||
    existsSync(join(cwd, "knowledge"))
  _isProjectCache = { cwd, isProject }
  return isProject
}

/**
 * Check if we're in a JFL project. If not, offer to navigate to known projects.
 * Returns true if we're in a project (or user navigated to one).
 * Returns false if user cancelled or no projects available.
 */
export async function ensureInProject(): Promise<boolean> {
  const cwd = process.cwd()

  // Check if already in a JFL project (uses cache)
  if (checkIsProject(cwd)) {
    return true
  }

  // Not in a project - check for known projects
  const knownProjects = (getConfigValue("projects") as string[]) || []
  const existingProjects = knownProjects.filter(
    (p) => existsSync(join(p, "CLAUDE.md")) || existsSync(join(p, "knowledge"))
  )

  if (existingProjects.length === 0) {
    // No known projects
    console.log(chalk.yellow("\nNot in a JFL project directory."))
    console.log(chalk.gray("Run 'jfl init' to create a new project.\n"))
    return false
  }

  // Show known projects and offer navigation
  console.log(chalk.yellow("\nNot in a JFL project directory."))
  console.log(chalk.cyan("\nYour projects:\n"))

  const { selected } = await inquirer.prompt([
    {
      type: "list",
      name: "selected",
      message: "Open a project?",
      choices: [
        ...existingProjects.map((p) => ({
          name: p.replace(process.env.HOME || "", "~"),
          value: p,
        })),
        new inquirer.Separator("─────────────────"),
        { name: "Create new project", value: "new" },
        { name: "Cancel", value: "cancel" },
      ],
    },
  ])

  if (selected === "cancel") {
    return false
  }

  if (selected === "new") {
    console.log(chalk.gray("\nRun 'jfl init' to create a new project.\n"))
    return false
  }

  // Navigate to selected project
  // Update config with cleaned list
  setConfig("projects", existingProjects)

  process.chdir(selected)
  console.log(chalk.gray(`\nOpened ${selected}\n`))

  return true
}

/**
 * Check if current directory is a JFL project (no prompts)
 * Uses cached result for current working directory
 */
export function isJflProject(): boolean {
  return checkIsProject(process.cwd())
}
