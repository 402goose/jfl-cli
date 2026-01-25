/**
 * jfl update - Pull latest GTM template updates
 *
 * Syncs CLAUDE.md, skills/, templates/ from the template/ folder
 * while preserving project-specific files (knowledge/, product/, etc.)
 */

import chalk from "chalk"
import ora from "ora"
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

const TEMPLATE_REPO = "https://github.com/402goose/jfl-template.git"
const TEMP_DIR = ".jfl-update-temp"

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

export async function updateCommand(options: { dry?: boolean } = {}) {
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

  if (isDryRun) {
    console.log(chalk.cyan("\n  DRY RUN - Showing what would be updated\n"))

    console.log(chalk.green("  Would sync from product repo:"))
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

    execSync(`git clone --depth 1 ${PRODUCT_REPO} ${TEMP_DIR}`, {
      cwd,
      stdio: "pipe"
    })

    spinner.text = "Syncing files..."

    let updated: string[] = []
    let skipped: string[] = []

    // Source from template/ subfolder
    const templatePath = path.join(tempPath, "template")

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
