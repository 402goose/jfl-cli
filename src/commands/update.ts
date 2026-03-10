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
import { validateSettings, fixSettings } from "../utils/settings-validator.js"
import { JFL_FILES } from "../utils/jfl-paths.js"
import {
  detectServiceChanges,
  writeCliVersion,
  getCurrentCliVersion,
  restartCoreServices,
  validateCoreServices
} from "../lib/service-utils.js"
import { persistProjectPort, getProjectPort } from "../utils/context-hub-port.js"

const TEMPLATE_REPO = "https://github.com/402goose/jfl-template.git"
const TEMP_DIR = ".jfl-update-temp"
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours

// Files/folders to sync from template/ folder (not repo root)
const SYNC_PATHS = [
  "CLAUDE.md",
  ".claude/",
  ".mcp.json",
  "context-hub",
  "templates/",
  "scripts/",
  ".jfl/flows/"
]

// Files that should NOT be overwritten if they already exist and have been customized.
// These contain project-specific content that jfl update would destroy.
const SKIP_IF_CUSTOMIZED = [
  "CLAUDE.md",
  ".mcp.json"
]

// Directories where only NEW files are copied (existing files are never overwritten).
// This is for user-customizable config that ships with defaults.
const MERGE_ONLY_PATHS = [
  ".jfl/flows/"
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
  const cachePath = JFL_FILES.updateCheck

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
  const cachePath = JFL_FILES.updateCheck
  const cacheDir = path.dirname(cachePath)

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true })
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

  try {
    const currentVersion = getCurrentVersion()
    const latestVersion = getLatestVersion()

    if (!latestVersion) {
      return
    }

    if (currentVersion === latestVersion) {
      if (!autoUpdate) {
        console.log(chalk.green("✓ jfl is up to date") + chalk.gray(` (v${currentVersion})`))
        console.log()
      }
      markUpdateChecked()
      return
    }

    const current = parseVersion(currentVersion)
    const latest = parseVersion(latestVersion)

    // Major version change - prompt user
    if (latest.major > current.major) {
      const shouldUpdate = await promptForMajorUpdate(currentVersion, latestVersion)

      if (!shouldUpdate) {
        console.log(chalk.gray("Skipping major update. Run 'jfl update' to update later.\n"))
        markUpdateChecked()
        return
      }
    } else {
      // Minor/patch - show update message
      if (autoUpdate) {
        console.log(chalk.gray(`⚡ Updating jfl to v${latestVersion}...`))
      } else {
        console.log(chalk.cyan(`Updating to v${latestVersion}...`))
      }
    }

    // Run npm update
    execSync("npm install -g jfl@latest", { stdio: "pipe" })

    console.log(chalk.green(`✓ Updated to v${latestVersion}`))
    console.log()

    markUpdateChecked()

  } catch (err: any) {
    if (!autoUpdate) {
      console.log(chalk.red("✗ Update check failed"))
      console.error(chalk.gray(err.message))
      console.log()
    }
  }
}

// ============================================================================
// GTM Template Sync
// ============================================================================

export async function updateCommand(options: { dry?: boolean; autoUpdate?: boolean } = {}) {
  const isAutoUpdate = options.autoUpdate || false

  // In auto mode, skip everything if checked recently (24h cache)
  if (isAutoUpdate && !shouldCheckForUpdates()) {
    return
  }

  // Check npm package updates first
  await checkNpmPackageUpdate(isAutoUpdate)
  const cwd = process.cwd()

  // CRITICAL: Never sync to home directory (namespace violation)
  if (cwd === homedir()) {
    if (!isAutoUpdate) {
      console.log(chalk.red("❌ Cannot update from home directory"))
      console.log(chalk.yellow("This would overwrite ~/CLAUDE.md (your global config)"))
      console.log(chalk.gray("\nRun 'jfl update' from a JFL project directory instead."))
    }
    return
  }

  // Check if we're in a JFL project (must have config.json, not just .jfl/)
  const configPath = path.join(cwd, ".jfl", "config.json")
  if (!fs.existsSync(configPath)) {
    // Check if this LOOKS like a JFL project (has markers)
    const hasJflMarkers =
      fs.existsSync(path.join(cwd, ".claude", "skills")) &&
      fs.existsSync(path.join(cwd, "templates")) &&
      fs.existsSync(path.join(cwd, "CLAUDE.md"))

    if (hasJflMarkers) {
      console.log(chalk.yellow("This looks like a JFL project, but .jfl/config.json is missing."))
      console.log(chalk.cyan("\nTo fix this, run:"))
      console.log(chalk.gray("  jfl repair"))
      console.log(chalk.gray("\nThis will create .jfl/config.json with your project details."))
    } else if (!isAutoUpdate) {
      // Don't spam on auto-update, only show when manually running
      console.log(chalk.red("Not in a JFL project. Run this from your project root."))
    }
    return
  }

  // Check if this IS the product repo (don't update product with itself)
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    if (config.type === "product") {
      if (!isAutoUpdate) {
        console.log(chalk.yellow("This is the product repo. Nothing to update from."))
      }
      return
    }
  } catch (err) {
    console.log(chalk.yellow("Warning: .jfl/config.json is malformed. Proceeding with update."))
  }

  const isDryRun = options.dry || false

  if (isDryRun) {
    if (!isAutoUpdate) {
      console.log(chalk.cyan("📦 Checking GTM template...\n"))
    }
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

  if (!isAutoUpdate) {
    console.log(chalk.cyan("📦 Syncing GTM template...\n"))
  }

  const spinner = ora("Fetching latest from jfl-template...").start()

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
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true })
        }

        if (MERGE_ONLY_PATHS.includes(syncPath)) {
          const mergeResult = copyDirMergeOnly(sourcePath, destPath)
          if (mergeResult.copied.length > 0) {
            updated.push(`${syncPath} (${mergeResult.copied.length} new)`)
          }
          for (const s of mergeResult.skipped) {
            skipped.push(`${syncPath}${s}`)
          }
        } else {
          copyDirRecursive(sourcePath, destPath)
          updated.push(syncPath)
        }
      } else {
        // For files, check if this is a project-customized file
        if (SKIP_IF_CUSTOMIZED.includes(syncPath) && fs.existsSync(destPath)) {
          // File exists and is project-owned — don't overwrite
          // Save template version as .template for reference
          const templateCopy = destPath + ".template"
          const destDir = path.dirname(destPath)
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true })
          }
          fs.copyFileSync(sourcePath, templateCopy)
          updated.push(`${syncPath} (template saved, existing preserved)`)
        } else {
          const destDir = path.dirname(destPath)
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true })
          }
          fs.copyFileSync(sourcePath, destPath)
          updated.push(syncPath)
        }
      }
    }

    // Cleanup temp directory
    fs.rmSync(tempPath, { recursive: true })

    spinner.succeed("GTM template synced")

    // Validate and fix .claude/settings.json after sync
    const settingsPath = path.join(cwd, ".claude", "settings.json")
    if (fs.existsSync(settingsPath)) {
      const validationSpinner = ora("Validating .claude/settings.json...").start()
      try {
        const settingsContent = fs.readFileSync(settingsPath, "utf-8")
        const settings = JSON.parse(settingsContent)
        const errors = validateSettings(settings)

        if (errors.length > 0) {
          const fixed = fixSettings(settings)
          fs.writeFileSync(settingsPath, JSON.stringify(fixed, null, 2) + "\n")
          validationSpinner.succeed("Settings.json auto-fixed")
        } else {
          validationSpinner.succeed("Settings.json valid")
        }
      } catch (err) {
        validationSpinner.warn("Could not validate settings.json")
      }
    }

    // Ensure HTTP hooks are configured (added in v0.3.x)
    ensureHttpHooks(cwd)

    console.log(chalk.white("\n  Synced from jfl-template:"))
    for (const p of updated) {
      console.log(chalk.gray(`    ✓ ${p}`))
    }

    if (skipped.length > 0) {
      console.log(chalk.white("\n  Skipped (already exist):"))
      for (const s of skipped) {
        console.log(chalk.gray(`    • ${s}`))
      }
    }

    console.log(chalk.gray("\n  Preserved (project-specific):"))
    for (const p of PRESERVE_PATHS) {
      if (fs.existsSync(path.join(cwd, p))) {
        console.log(chalk.gray(`    • ${p}`))
      }
    }

    // Migrate existing projects to per-project Context Hub ports
    const configPath2 = path.join(cwd, ".jfl", "config.json")
    if (fs.existsSync(configPath2)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(configPath2, "utf-8"))
        if (!cfg.contextHub?.port) {
          const port = persistProjectPort(cwd)
          console.log(chalk.green(`\n  ✓ Assigned Context Hub port: ${port}`))
        }
      } catch {
        // Non-fatal
      }
    }

    // Check if services need to be restarted (CLI version changed)
    const serviceChanges = await detectServiceChanges()

    if (serviceChanges.changed && serviceChanges.oldVersion) {
      console.log(chalk.cyan(`\n📦 CLI updated: ${serviceChanges.oldVersion} → ${serviceChanges.newVersion}`))
      console.log(chalk.gray("Services will be restarted to use new version...\n"))

      // Restart services
      const restartResults = await restartCoreServices()

      // Update stored version
      writeCliVersion(serviceChanges.newVersion)

      // Validate services are healthy
      const validation = await validateCoreServices()

      if (!validation.healthy) {
        console.log(chalk.yellow("\n⚠️  Some services need attention:\n"))
        for (const issue of validation.issues) {
          console.log(chalk.yellow(`  • ${issue.service}: ${issue.message}`))
          console.log(chalk.gray(`    Fix: ${issue.remedy}\n`))
        }
      }
    } else {
      // First time or no version change - just record version
      writeCliVersion(serviceChanges.newVersion)
    }

    console.log(chalk.cyan("\n✨ Update complete! Restart Claude Code to pick up changes.\n"))

    // Mark update as checked so auto mode skips for next 24h
    markUpdateChecked()

  } catch (err: any) {
    spinner.fail("Update failed")
    console.error(chalk.red(err.message))
  }
}

const HTTP_HOOK_EVENTS = ["PostToolUse", "Stop", "PreCompact", "SubagentStart", "SubagentStop"]

function ensureHttpHooks(cwd: string): void {
  const settingsPath = path.join(cwd, ".claude", "settings.json")
  if (!fs.existsSync(settingsPath)) return

  try {
    const port = getProjectPort(cwd)
    if (!port) return

    const hookUrl = `http://localhost:${port}/api/hooks`
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"))
    if (!settings.hooks) settings.hooks = {}

    let added = 0
    let fixed = 0
    for (const event of HTTP_HOOK_EVENTS) {
      if (!settings.hooks[event]) settings.hooks[event] = []

      const existingIdx = settings.hooks[event].findIndex(
        (entry: any) => entry.hooks?.some((h: any) => h.type === "http" && h.url?.includes("/api/hooks"))
      )

      if (existingIdx >= 0) {
        // HTTP hook exists — check if port is correct
        const entry = settings.hooks[event][existingIdx]
        const httpHook = entry.hooks.find((h: any) => h.type === "http" && h.url?.includes("/api/hooks"))
        if (httpHook && httpHook.url !== hookUrl) {
          httpHook.url = hookUrl
          fixed++
        }
      } else {
        settings.hooks[event].push({
          matcher: "",
          hooks: [{ type: "http", url: hookUrl }],
        })
        added++
      }
    }

    if (added > 0 || fixed > 0) {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n")
      if (added > 0) console.log(chalk.green(`\n  ✓ HTTP hooks added for ${added} events → ${hookUrl}`))
      if (fixed > 0) console.log(chalk.green(`\n  ✓ HTTP hooks updated for ${fixed} events → ${hookUrl}`))
    }
  } catch {}
}

function copyDirMergeOnly(
  src: string,
  dest: string,
  prefix = ""
): { copied: string[]; skipped: string[] } {
  const copied: string[] = []
  const skipped: string[] = []
  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true })
      }
      const sub = copyDirMergeOnly(srcPath, destPath, rel)
      copied.push(...sub.copied)
      skipped.push(...sub.skipped)
    } else {
      if (fs.existsSync(destPath)) {
        skipped.push(rel)
      } else {
        const destDir = path.dirname(destPath)
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true })
        }
        fs.copyFileSync(srcPath, destPath)
        copied.push(rel)
      }
    }
  }

  return { copied, skipped }
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
