/**
 * JFL Skills Management Commands
 */

import chalk from "chalk"
import ora from "ora"
import inquirer from "inquirer"
import {
  fetchRegistry,
  listInstalledSkills,
  isSkillInstalled,
  installSkill,
  removeSkill,
  getAvailableUpdates,
  isJflWorkspace,
} from "../utils/skill-registry.js"
import type { SkillRegistry } from "../types/skills.js"

// Core skills that can't be removed
const CORE_SKILLS = ["hud", "brand-architect", "content-creator"]

/**
 * List skills
 */
export async function listSkillsCommand(options?: { available?: boolean; category?: string; tag?: string }) {
  if (!isJflWorkspace()) {
    console.log(chalk.red("\nNot a JFL workspace. Run this command from a JFL project directory.\n"))
    return
  }

  const spinner = ora("Fetching skill registry...").start()

  try {
    const registry = await fetchRegistry()
    spinner.stop()

    if (options?.available) {
      // Show all available skills
      showAvailableSkills(registry, options)
    } else {
      // Show installed skills
      showInstalledSkills(registry)
    }
  } catch (err: any) {
    spinner.fail("Failed to fetch skill registry")
    console.error(chalk.red(err.message))
  }
}

/**
 * Show installed skills
 */
function showInstalledSkills(registry: SkillRegistry) {
  const installed = listInstalledSkills()
  const count = Object.keys(installed).length

  console.log(chalk.bold(`\nInstalled Skills (${count})\n`))

  if (count === 0) {
    console.log(chalk.gray("  No skills installed yet.\n"))
    console.log(chalk.gray("  Run: jfl skills install <name>\n"))
    return
  }

  for (const [skillId, installedSkill] of Object.entries(installed)) {
    const registrySkill = registry.skills[skillId]
    const isCoreSkill = CORE_SKILLS.includes(skillId)
    const coreLabel = isCoreSkill ? chalk.gray(" [core]") : ""

    if (registrySkill) {
      const updateAvailable = registrySkill.version !== installedSkill.version
      const versionLabel = updateAvailable
        ? chalk.yellow(`${installedSkill.version} → ${registrySkill.version}`)
        : chalk.gray(installedSkill.version)

      console.log(`  ${chalk.green("✓")} ${chalk.cyan(skillId)} ${versionLabel}${coreLabel}`)
      console.log(`     ${chalk.gray(registrySkill.description)}`)
    } else {
      console.log(`  ${chalk.green("✓")} ${chalk.cyan(skillId)} ${chalk.gray(installedSkill.version)}${coreLabel}`)
      console.log(`     ${chalk.gray("(not in registry)")}`)
    }
  }

  console.log()
}

/**
 * Show available skills
 */
function showAvailableSkills(registry: SkillRegistry, options?: { category?: string; tag?: string }) {
  const installed = listInstalledSkills()
  let skills = Object.entries(registry.skills)

  // Filter by category
  if (options?.category) {
    skills = skills.filter(([_, skill]) => skill.category === options.category)
  }

  // Filter by tag
  if (options?.tag) {
    skills = skills.filter(([_, skill]) => skill.tags.includes(options.tag!))
  }

  const availableSkills = skills.filter(([skillId]) => !installed[skillId])
  const installedSkills = skills.filter(([skillId]) => installed[skillId])

  console.log(chalk.bold(`\nAvailable Skills (${availableSkills.length})\n`))

  if (availableSkills.length === 0) {
    console.log(chalk.gray("  All skills are installed.\n"))
  } else {
    for (const [skillId, skill] of availableSkills) {
      const size = formatSize(skill.size)
      const categoryLabel = skill.category === "core" ? chalk.blue("[core]") : chalk.gray("[catalog]")
      console.log(`  ${chalk.gray("○")} ${chalk.cyan(skillId)} ${chalk.gray(`(${size})`)} ${categoryLabel}`)
      console.log(`     ${chalk.gray(skill.description)}`)
      if (skill.tags.length > 0) {
        console.log(`     ${chalk.gray(skill.tags.map(t => `#${t}`).join(" "))}`)
      }
    }
    console.log()
  }

  if (installedSkills.length > 0) {
    console.log(chalk.bold(`Installed (${installedSkills.length})\n`))
    for (const [skillId, skill] of installedSkills) {
      const version = installed[skillId]?.version || "unknown"
      console.log(`  ${chalk.green("✓")} ${chalk.cyan(skillId)} ${chalk.gray(version)}`)
      console.log(`     ${chalk.gray(skill.description)}`)
    }
    console.log()
  }
}

/**
 * Install skill(s)
 */
export async function installSkillCommand(skillNames: string[]) {
  if (!isJflWorkspace()) {
    console.log(chalk.red("\nNot a JFL workspace. Run this command from a JFL project directory.\n"))
    return
  }

  if (skillNames.length === 0) {
    console.log(chalk.yellow("\nUsage: jfl skills install <skill-name> [skill-name...]\n"))
    return
  }

  const spinner = ora("Fetching skill registry...").start()

  try {
    const registry = await fetchRegistry()
    spinner.stop()

    for (const skillName of skillNames) {
      await installSingleSkill(skillName, registry)
    }

    console.log(chalk.green("\n✓ All skills installed!\n"))
  } catch (err: any) {
    spinner.fail("Failed to fetch skill registry")
    console.error(chalk.red(err.message))
  }
}

/**
 * Install a single skill
 */
async function installSingleSkill(skillName: string, registry: SkillRegistry) {
  // Parse version if specified (e.g., startup@0.9.0)
  const [skillId, version] = skillName.split("@")
  const skill = registry.skills[skillId]

  if (!skill) {
    console.log(chalk.red(`\n✗ Skill '${skillId}' not found in registry\n`))
    return
  }

  if (isSkillInstalled(skillId)) {
    console.log(chalk.yellow(`\n⚠ Skill '${skillId}' is already installed\n`))
    return
  }

  const size = formatSize(skill.size)
  const spinner = ora(`Installing ${skillId} (${size})...`).start()

  try {
    await installSkill(skillId, skill, version)
    spinner.succeed(`Installed ${skillId} (${version || skill.version})`)
  } catch (err: any) {
    spinner.fail(`Failed to install ${skillId}`)
    console.error(chalk.red(err.message))
  }
}

/**
 * Remove skill(s)
 */
export async function removeSkillCommand(skillNames: string[]) {
  if (!isJflWorkspace()) {
    console.log(chalk.red("\nNot a JFL workspace. Run this command from a JFL project directory.\n"))
    return
  }

  if (skillNames.length === 0) {
    console.log(chalk.yellow("\nUsage: jfl skills remove <skill-name> [skill-name...]\n"))
    return
  }

  for (const skillId of skillNames) {
    // Check if it's a core skill
    if (CORE_SKILLS.includes(skillId)) {
      console.log(chalk.red(`\n✗ Cannot remove core skill '${skillId}'\n`))
      continue
    }

    if (!isSkillInstalled(skillId)) {
      console.log(chalk.yellow(`\n⚠ Skill '${skillId}' is not installed\n`))
      continue
    }

    const spinner = ora(`Removing ${skillId}...`).start()

    try {
      removeSkill(skillId)
      spinner.succeed(`Removed ${skillId}`)
    } catch (err: any) {
      spinner.fail(`Failed to remove ${skillId}`)
      console.error(chalk.red(err.message))
    }
  }

  console.log()
}

/**
 * Update skills
 */
export async function updateSkillsCommand(options?: { dry?: boolean; skillName?: string }) {
  if (!isJflWorkspace()) {
    console.log(chalk.red("\nNot a JFL workspace. Run this command from a JFL project directory.\n"))
    return
  }

  const spinner = ora("Checking for updates...").start()

  try {
    const registry = await fetchRegistry()
    const updates = await getAvailableUpdates(registry)

    spinner.stop()

    if (updates.length === 0) {
      console.log(chalk.green("\n✓ All skills are up to date\n"))
      return
    }

    // Filter by skill name if specified
    const filteredUpdates = options?.skillName
      ? updates.filter(u => u.skillId === options?.skillName)
      : updates

    if (filteredUpdates.length === 0) {
      console.log(chalk.green(`\n✓ ${options?.skillName || "All skills"} up to date\n`))
      return
    }

    console.log(chalk.bold(`\nAvailable Updates (${filteredUpdates.length})\n`))

    for (const update of filteredUpdates) {
      console.log(`  ${chalk.cyan(update.skillId)}: ${chalk.gray(update.current)} → ${chalk.green(update.latest)}`)
    }

    console.log()

    if (options?.dry) {
      return
    }

    // Confirm update
    const answer = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: "Update these skills?",
        default: true,
      },
    ])

    if (!answer.confirm) {
      console.log(chalk.gray("\nCancelled.\n"))
      return
    }

    // Update each skill
    for (const update of filteredUpdates) {
      const skill = registry.skills[update.skillId]
      const updateSpinner = ora(`Updating ${update.skillId}...`).start()

      try {
        // Remove old version
        removeSkill(update.skillId)

        // Install new version
        await installSkill(update.skillId, skill)

        updateSpinner.succeed(`Updated ${update.skillId} (${update.current} → ${update.latest})`)
      } catch (err: any) {
        updateSpinner.fail(`Failed to update ${update.skillId}`)
        console.error(chalk.red(err.message))
      }
    }

    console.log(chalk.green("\n✓ Updates complete!\n"))
  } catch (err: any) {
    spinner.fail("Failed to check for updates")
    console.error(chalk.red(err.message))
  }
}

/**
 * Search skills
 */
export async function searchSkillsCommand(query: string) {
  if (!isJflWorkspace()) {
    console.log(chalk.red("\nNot a JFL workspace. Run this command from a JFL project directory.\n"))
    return
  }

  const spinner = ora("Searching skill registry...").start()

  try {
    const registry = await fetchRegistry()
    spinner.stop()

    const queryLower = query.toLowerCase()
    const results = Object.entries(registry.skills).filter(([skillId, skill]) => {
      return (
        skillId.toLowerCase().includes(queryLower) ||
        skill.name.toLowerCase().includes(queryLower) ||
        skill.description.toLowerCase().includes(queryLower) ||
        skill.tags.some(tag => tag.toLowerCase().includes(queryLower))
      )
    })

    if (results.length === 0) {
      console.log(chalk.gray(`\nNo skills found matching "${query}"\n`))
      return
    }

    console.log(chalk.bold(`\nSearch Results (${results.length})\n`))

    const installed = listInstalledSkills()

    for (const [skillId, skill] of results) {
      const isInstalled = installed[skillId]
      const status = isInstalled ? chalk.green("✓") : chalk.gray("○")
      const version = isInstalled ? chalk.gray(isInstalled.version) : chalk.gray(skill.version)

      console.log(`  ${status} ${chalk.cyan(skillId)} ${version}`)
      console.log(`     ${chalk.gray(skill.description)}`)
      console.log(`     ${chalk.gray(skill.tags.map(t => `#${t}`).join(" "))}`)
    }

    console.log()
  } catch (err: any) {
    spinner.fail("Failed to search skills")
    console.error(chalk.red(err.message))
  }
}

/**
 * Format byte size to human readable
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
