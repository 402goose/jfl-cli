import chalk from "chalk"
import inquirer from "inquirer"
import { existsSync } from "fs"
import { join } from "path"
import { getConfigValue, setConfig } from "./jfl-config.js"

/**
 * Check if we're in a JFL project. If not, offer to navigate to known projects.
 * Returns true if we're in a project (or user navigated to one).
 * Returns false if user cancelled or no projects available.
 */
export async function ensureInProject(): Promise<boolean> {
  const cwd = process.cwd()

  // Check if already in a JFL project
  const hasJflConfig =
    existsSync(join(cwd, "CLAUDE.md")) || existsSync(join(cwd, "knowledge"))

  if (hasJflConfig) {
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
 */
export function isJflProject(): boolean {
  const cwd = process.cwd()
  return (
    existsSync(join(cwd, ".jfl")) ||
    existsSync(join(cwd, "CLAUDE.md")) ||
    existsSync(join(cwd, "knowledge"))
  )
}
