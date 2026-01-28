/**
 * jfl update - Update npm package and GTM template
 *
 * 1. Checks npm for jfl package updates (minor/patch auto-update, major prompts)
 * 2. Syncs CLAUDE.md, skills/, templates/ from the template/ folder
 * while preserving project-specific files (knowledge/, product/, etc.)
 */

import chalk from "chalk"
import ora from "ora"
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as readline from "readline"
import { homedir } from "os"

const TEMPLATE_REPO = "https://github.com/402goose/jfl-template.git"
const TEMP_DIR = ".jfl-update-temp"
const UPDATE_CHECK_CACHE = ".jfl-last-update-check"
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours

// Files/folders to sync from template/ folder (not repo root)
const SYNC_PATHS = [
  "CLAUDE.md",
  ".claude/",
  ".mcp.json",
  "context-hub",
  "templates/",
  "scripts/"
]

// Files/folders to NEVER overwrite (project-specific)
const PRESERVE_PATHS = [
  "knowledge/",
  "product/",
  "suggestions/",
  "content/",
  "previews/",
  ".jfl/config.json",
  "app/",
  "site/"
]

// ============================================================================
// npm Package Update Check
// ============================================================================

function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const parts = version.replace(/^v/, "").split(".").map(n => parseInt(n, 10))
  return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 }
}

function shouldCheckForUpdates(): boolean {
  const cacheDir = homedir()
  const cachePath = path.join(cacheDir, ".jfl", UPDATE_CHECK_CACHE)

  if (!fs.existsSync(cachePath)) {
    return true
  }

  try {
    const lastCheck = parseInt(fs.readFileSync(cachePath, "utf-8"), 10)
    return Date.now() - lastCheck > UPDATE_CHECK_INTERVAL
  } catch {
    return true
  }
}

function markUpdateChecked() {
  const homeDir = homedir()
  const jflDir = path.join(homeDir, ".jfl")
  const cachePath = path.join(jflDir, UPDATE_CHECK_CACHE)

  if (!fs.existsSync(jflDir)) {
    fs.mkdirSync(jflDir, { recursive: true })
  }

  fs.writeFileSync(cachePath, Date.now().toString())
}

function getCurrentVersion(): string {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../package.json"), "utf-8")
    )
    return packageJson.version
  } catch {
    return "0.0.0"
  }
}

function getLatestVersion(): string | null {
  try {
    const output = execSync("npm view jfl version", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
    return output.trim()
  } catch {
    return null
  }
}

async function promptForMajorUpdate(currentVersion: string, latestVersion: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    console.log(chalk.yellow(`\n⚠️  Major version update available: ${currentVersion} → ${latestVersion}`))
    console.log(chalk.gray("This may include breaking changes."))

    rl.question(chalk.cyan("Update now? (y/n): "), (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes")
    })
  })
}

async function checkNpmPackageUpdate(autoUpdate: boolean): Promise<void> {
  // Skip if we checked recently (unless manual update)
  if (autoUpdate && !shouldCheckForUpdates()) {
    return
  }

  if (!autoUpdate) {
    console.log(chalk.cyan("\n🔍 Checking for npm package updates...\n"))
  }

  const spinner = autoUpdate ? ora({ isSilent: true }) : ora("Checking npm registry...")

  if (!autoUpdate) spinner.start()

  try {
    const currentVersion = getCurrentVersion()
    const latestVersion = getLatestVersion()

    if (!latestVersion) {
      if (!autoUpdate) spinner.stop()
      return
    }

    if (currentVersion === latestVersion) {
      if (!autoUpdate) {
        spinner.succeed(`jfl is up to date (v${currentVersion})`)
        console.log()
      }
      markUpdateChecked()
      return
    }

    const current = parseVersion(currentVersion)
    const latest = parseVersion(latestVersion)

    // Major version change - prompt user
    if (latest.major > current.major) {
      if (!autoUpdate) spinner.stop()
      const shouldUpdate = await promptForMajorUpdate(currentVersion, latestVersion)

      if (!shouldUpdate) {
        console.log(chalk.gray("Skipping major update. Run 'jfl update' to update later.\n"))
        markUpdateChecked()
        return
      }

      if (!autoUpdate) spinner = ora(`Updating to v${latestVersion}...`).start()
    } else {
      // Minor/patch - auto-update silently
      if (!autoUpdate) {
        spinner.text = `Updating to v${latestVersion}...`
      } else {
        // For auto-update, show brief message
        console.log(chalk.gray(`⚡ Updating jfl to v${latestVersion}...`))
      }
    }

    // Run npm update
    execSync("npm install -g jfl@latest", { stdio: "pipe" })

    if (!autoUpdate) {
      spinner.succeed(`Updated to v${latestVersion}`)
      console.log()
    } else {
      console.log(chalk.green(`✓ Updated to v${latestVersion}\n`))
    }

    markUpdateChecked()

  } catch (err: any) {
    if (!autoUpdate) {
      spinner.fail("Update check failed")
      console.error(chalk.red(err.message))
      console.log()
    }
  }
}

// ============================================================================
// GTM Template Sync
// ============================================================================

export async function updateCommand(options: { dry?: boolean; autoUpdate?: boolean } = {}) {
  const isAutoUpdate = options.autoUpdate || false

  // Check npm package updates first
  await checkNpmPackageUpdate(isAutoUpdate)
  const cwd = process.cwd()

  // Check if we're in a JFL project
  if (!fs.existsSync(path.join(cwd, ".jfl"))) {
    // Check if this LOOKS like a JFL project (has markers)
    const hasJflMarkers =
      fs.existsSync(path.join(cwd, ".claude", "skills")) &&
      fs.existsSync(path.join(cwd, "templates")) &&
      fs.existsSync(path.join(cwd, "CLAUDE.md"))

    if (hasJflMarkers) {
      console.log(chalk.yellow("This looks like a JFL project, but .jfl/ is missing."))
      console.log(chalk.cyan("\nTo fix this, run:"))
      console.log(chalk.gray("  jfl repair"))
      console.log(chalk.gray("\nThis will create .jfl/config.json with your project details."))
    } else {
      console.log(chalk.red("Not in a JFL project. Run this from your project root."))
    }
    return
  }

  // Check if this IS the product repo (don't update product with itself)
  const configPath = path.join(cwd, ".jfl", "config.json")
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
      if (config.type === "product") {
        console.log(chalk.yellow("This is the product repo. Nothing to update from."))
        return
      }
    } catch (err) {
      console.log(chalk.yellow("Warning: .jfl/config.json is malformed. Proceeding with update."))
    }
  }

  const isDryRun = options.dry || false

  if (!isAutoUpdate) {
    console.log(chalk.cyan("📦 Syncing GTM template...\n"))
  }

  if (isDryRun) {
    console.log(chalk.gray("  DRY RUN - Showing what would be updated\n"))

    console.log(chalk.white("  Would sync from jfl-template:"))
    for (const p of SYNC_PATHS) {
      const destPath = path.join(cwd, p)
      const exists = fs.existsSync(destPath)
      const status = exists ? chalk.gray("(exists, would overwrite)") : chalk.gray("(new)")
      console.log(chalk.gray(`    ✓ ${p} ${status}`))
    }

    console.log(chalk.gray("\n  Would preserve (project-specific):"))
    for (const p of PRESERVE_PATHS) {
      if (fs.existsSync(path.join(cwd, p))) {
        console.log(chalk.gray(`    • ${p}`))
      }
    }

    console.log(chalk.cyan("\n  No changes made. Run without --dry to actually update.\n"))
    return
  }

  console.log(chalk.cyan("\n  Updating JFL product files...\n"))

  const spinner = ora("Fetching latest product...").start()

  try {
    // Clone product repo to temp directory
    const tempPath = path.join(cwd, TEMP_DIR)
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { recursive: true })
    }

    execSync(`git clone --depth 1 ${TEMPLATE_REPO} ${TEMP_DIR}`, {
      cwd,
      stdio: "pipe"
    })

    spinner.text = "Syncing files..."

    let updated: string[] = []
    let skipped: string[] = []

    // Source from root of template repo (jfl-template has files at root)
    const templatePath = tempPath

    for (const syncPath of SYNC_PATHS) {
      const sourcePath = path.join(templatePath, syncPath)
      const destPath = path.join(cwd, syncPath)

      if (!fs.existsSync(sourcePath)) {
        continue
      }

      // Check if it's a directory
      const isDir = fs.statSync(sourcePath).isDirectory()

      if (isDir) {
        // For directories, sync contents but don't delete project-specific files
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true })
        }
        copyDirRecursive(sourcePath, destPath)
        updated.push(syncPath)
      } else {
        // For files, just copy
        const destDir = path.dirname(destPath)
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true })
        }
        fs.copyFileSync(sourcePath, destPath)
        updated.push(syncPath)
      }
    }

    // Cleanup temp directory
    fs.rmSync(tempPath, { recursive: true })

    spinner.succeed("Updated!")

    console.log(chalk.green("\n  Synced from product repo:"))
    for (const p of updated) {
      console.log(chalk.gray(`    ✓ ${p}`))
    }

    console.log(chalk.gray("\n  Preserved (project-specific):"))
    for (const p of PRESERVE_PATHS) {
      if (fs.existsSync(path.join(cwd, p))) {
        console.log(chalk.gray(`    • ${p}`))
      }
    }

    console.log(chalk.cyan("\n  Done! Restart Claude Code to pick up changes.\n"))

  } catch (err: any) {
    spinner.fail("Update failed")
    console.error(chalk.red(err.message))
  }
}

function copyDirRecursive(src: string, dest: string) {
  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true })
      }
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}
