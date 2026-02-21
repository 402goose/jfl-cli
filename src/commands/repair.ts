/**
 * jfl repair - Repair a JFL project missing .jfl directory
 *
 * Detects JFL project structure and creates missing .jfl/config.json
 */

import chalk from "chalk"
import inquirer from "inquirer"
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs"
import { join, basename } from "path"
import { execSync } from "child_process"
import { isAuthenticated, getUser, getAuthMethod, getX402Address } from "./login.js"
import { validateSettings, fixSettings, getValidationReport } from "../utils/settings-validator.js"

// Markers that indicate this is a JFL project
const JFL_MARKERS = {
  required: [".claude/skills", "templates", "CLAUDE.md"],
  optional: ["knowledge", "content", "suggestions", "previews"]
}

export async function repairCommand() {
  const cwd = process.cwd()

  console.log(chalk.bold("\n🔧 JFL Repair\n"))

  // Check if .jfl already exists
  if (existsSync(join(cwd, ".jfl"))) {
    const configPath = join(cwd, ".jfl", "config.json")
    if (existsSync(configPath)) {
      console.log(chalk.green("✓ .jfl/config.json already exists"))

      // Show current config
      try {
        const config = JSON.parse(readFileSync(configPath, "utf-8"))
        console.log(chalk.gray("\nCurrent config:"))
        console.log(chalk.gray(JSON.stringify(config, null, 2)))
      } catch (err) {
        console.log(chalk.yellow("⚠️  Config exists but is malformed"))
        console.log(chalk.gray("Delete .jfl/config.json and run repair again"))
      }
      return
    }
    console.log(chalk.yellow("⚠️  .jfl/ exists but config.json is missing"))
  }

  // Check if this looks like a JFL project
  console.log(chalk.cyan("Checking for JFL project markers...\n"))

  const foundMarkers: string[] = []
  const missingMarkers: string[] = []

  for (const marker of JFL_MARKERS.required) {
    if (existsSync(join(cwd, marker))) {
      foundMarkers.push(marker)
      console.log(chalk.green(`  ✓ ${marker}`))
    } else {
      missingMarkers.push(marker)
      console.log(chalk.red(`  ✗ ${marker}`))
    }
  }

  for (const marker of JFL_MARKERS.optional) {
    if (existsSync(join(cwd, marker))) {
      foundMarkers.push(marker)
      console.log(chalk.gray(`  • ${marker}`))
    }
  }

  // If missing required markers, not a JFL project
  if (missingMarkers.length > 0) {
    console.log(chalk.red("\n✗ This doesn't look like a JFL project"))
    console.log(chalk.gray(`  Missing required: ${missingMarkers.join(", ")}`))
    console.log(chalk.gray("\n  To create a new JFL project, run:"))
    console.log(chalk.cyan("  jfl init"))
    return
  }

  console.log(chalk.green("\n✓ This looks like a JFL project!"))

  // Detect project name and description from various sources
  const projectName = detectProjectName(cwd)
  const projectDescription = detectDescription(cwd)

  console.log(chalk.gray(`\nDetected project name: ${projectName}`))
  console.log(chalk.gray(`Detected description: ${projectDescription}`))

  // Check authentication
  let ownerName = ""
  let ownerGithub = ""
  let ownerX402 = ""

  if (isAuthenticated()) {
    const authMethod = getAuthMethod()
    if (authMethod === "github") {
      const user = getUser()
      ownerName = user?.name || ""
      try {
        const gitUser = execSync("git config user.name", { encoding: "utf-8" }).trim()
        ownerGithub = gitUser
        if (!ownerName) ownerName = gitUser
      } catch {
        ownerGithub = user?.name || ""
      }
    } else if (authMethod === "x402") {
      ownerX402 = getX402Address() || ""
      ownerName = `x402:${ownerX402.slice(0, 8)}...`
    }
    console.log(chalk.green(`✓ Authenticated as ${ownerName}`))
  } else {
    console.log(chalk.yellow("⚠️  Not authenticated. Run 'jfl login' to claim ownership."))
  }

  // Detect product repo if it exists
  let productRepo = ""
  let productPath = ""
  let setup = "building-product" // Default

  // Check config for registered product repo
  const existingConfigPath = join(cwd, ".jfl", "config.json")
  if (existsSync(existingConfigPath)) {
    try {
      const config = JSON.parse(readFileSync(existingConfigPath, "utf-8"))
      if (config.product_repo) {
        productRepo = config.product_repo
        setup = "building-product"
        console.log(chalk.green(`\n✓ Product repo registered: ${productRepo}`))
      }
    } catch (err) {
      // Ignore errors
    }
  }

  if (!productRepo && existsSync(join(cwd, "knowledge")) && existsSync(join(cwd, "content"))) {
    // Has knowledge and content but no product → GTM only
    setup = "gtm-only"
  }

  // Only prompt for project name if we need to confirm
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Project name:",
      default: projectName,
      validate: (input: string) => {
        if (!input.trim()) {
          return "Project name is required"
        }
        return true
      },
    },
  ])

  // Create .jfl directory
  const jflDir = join(cwd, ".jfl")
  if (!existsSync(jflDir)) {
    mkdirSync(jflDir, { recursive: true })
  }

  // Build config
  const config: Record<string, any> = {
    name: answers.name,
    type: "gtm",
    setup: setup,
    description: projectDescription,
  }

  // Add owner info if authenticated
  if (ownerGithub) {
    config.owner = {
      name: ownerName,
      github: ownerGithub,
    }
  } else if (ownerX402) {
    config.owner = {
      name: ownerName,
      x402: ownerX402,
    }
  }

  // Add product repo if found
  if (productRepo) {
    config.product_repo = productRepo
    config.registered_services = config.registered_services || []
    if (!config.registered_services.some((s: any) => s.repo === productRepo)) {
      config.registered_services.push({ name: "product", repo: productRepo })
    }
  }

  // Write config
  const configPath = join(jflDir, "config.json")
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")

  console.log(chalk.green("\n✓ Created .jfl/config.json"))
  console.log(chalk.gray("\nConfig:"))
  console.log(chalk.gray(JSON.stringify(config, null, 2)))

  // Verify repair
  console.log(chalk.cyan("\nVerifying repair..."))

  if (existsSync(join(cwd, ".jfl", "config.json"))) {
    console.log(chalk.green("✓ .jfl/config.json exists"))
  } else {
    console.log(chalk.red("✗ Failed to create config"))
    return
  }

  // Test if config is valid JSON
  try {
    JSON.parse(readFileSync(join(cwd, ".jfl", "config.json"), "utf-8"))
    console.log(chalk.green("✓ Config is valid JSON"))
  } catch (err) {
    console.log(chalk.red("✗ Config is malformed"))
    return
  }

  // Validate and optionally fix .claude/settings.json
  const settingsPath = join(cwd, ".claude", "settings.json")
  if (existsSync(settingsPath)) {
    console.log(chalk.cyan("\nChecking .claude/settings.json..."))
    try {
      const settingsContent = readFileSync(settingsPath, "utf-8")
      const settings = JSON.parse(settingsContent)
      const errors = validateSettings(settings)

      if (errors.length > 0) {
        console.log(chalk.yellow("\n⚠️  Settings.json has schema issues:"))
        console.log(chalk.gray(getValidationReport(settings)))

        const { fixNow } = await inquirer.prompt([
          {
            type: "confirm",
            name: "fixNow",
            message: "Auto-fix settings.json?",
            default: true,
          },
        ])

        if (fixNow) {
          const fixed = fixSettings(settings)
          writeFileSync(settingsPath, JSON.stringify(fixed, null, 2) + "\n")
          console.log(chalk.green("✓ Settings.json auto-fixed"))
        } else {
          console.log(chalk.yellow("⚠️  Settings.json issues remain"))
        }
      } else {
        console.log(chalk.green("✓ Settings.json is valid"))
      }
    } catch (err) {
      console.log(chalk.yellow("⚠️  Could not validate settings.json"))
    }
  }

  console.log(chalk.bold.green("\n✅ Repair complete!\n"))
  console.log(chalk.gray("You can now run:"))
  console.log(chalk.cyan("  jfl update    # Pull latest JFL updates"))
  console.log(chalk.cyan("  jfl status    # Check project status"))
  console.log(chalk.cyan("  jfl hud       # View dashboard"))
  console.log()
}

/**
 * Detect project name from various sources
 */
function detectProjectName(cwd: string): string {
  // Try .jfl/config.json first (if it exists)
  const configPath = join(cwd, ".jfl", "config.json")
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"))
      if (config.name) return config.name
    } catch {
      // Ignore
    }
  }

  // Try knowledge/VISION.md
  const visionPath = join(cwd, "knowledge", "VISION.md")
  if (existsSync(visionPath)) {
    try {
      const vision = readFileSync(visionPath, "utf-8")
      const match = vision.match(/^#\s+(.+)/m)
      if (match) {
        const heading = match[1].trim()

        // Skip template headings
        const templateHeadings = ["Vision", "Brand", "Narrative", "Thesis", "Roadmap"]
        if (!templateHeadings.includes(heading)) {
          return heading.toLowerCase().replace(/\s+/g, "-")
        }
      }
    } catch {
      // Ignore
    }
  }

  // Fall back to directory name
  return basename(cwd)
}

/**
 * Detect project description from various sources
 */
function detectDescription(cwd: string): string {
  // Try .jfl/config.json first (if it exists)
  const configPath = join(cwd, ".jfl", "config.json")
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"))
      if (config.description) return config.description
    } catch {
      // Ignore
    }
  }

  // Try knowledge/VISION.md - look for "The One-Liner" section
  const visionPath = join(cwd, "knowledge", "VISION.md")
  if (existsSync(visionPath)) {
    try {
      const vision = readFileSync(visionPath, "utf-8")

      // Match pattern: ## The One-Liner followed by content
      const oneLinerMatch = vision.match(/##\s+The One-Liner[\s\S]*?\*\*[^:]+:\*\*\s*(.+?)(?=\n\n|---)/m)
      if (oneLinerMatch && oneLinerMatch[1]) {
        const description = oneLinerMatch[1].trim()
        // Make sure it's not a placeholder
        if (description && !description.includes("{") && description.length > 10) {
          return description
        }
      }
    } catch {
      // Ignore
    }
  }

  // Fall back to generic description
  return `GTM workspace for ${basename(cwd)}`
}
