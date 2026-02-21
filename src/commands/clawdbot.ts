/**
 * Clawdbot Plugin Management
 *
 * Installs and manages the JFL plugin for Clawdbot gateway.
 * Copies plugin files to ~/.clawdbot/plugins/jfl/ and configures clawdbot.json.
 *
 * @purpose CLI commands for installing/checking JFL Clawdbot plugin
 */

import chalk from "chalk"
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { execSync } from "child_process"
import { fileURLToPath } from "url"
import * as path from "path"

const CLAWDBOT_DIR = join(homedir(), ".clawdbot")
const PLUGINS_DIR = join(CLAWDBOT_DIR, "plugins")
const PLUGIN_TARGET = join(PLUGINS_DIR, "jfl")
const CLAWDBOT_CONFIG = join(CLAWDBOT_DIR, "clawdbot.json")

function isClawdbotInstalled(): boolean {
  // Check for ~/.clawdbot/ directory
  if (existsSync(CLAWDBOT_DIR)) return true

  // Check for clawdbot binary
  try {
    execSync("which clawdbot", { stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

function getPluginSourceDir(): string {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  // From dist/commands/clawdbot.js -> clawdbot-plugin/
  return join(__dirname, "..", "..", "clawdbot-plugin")
}

function isPluginInstalled(): boolean {
  return existsSync(PLUGIN_TARGET) && existsSync(join(PLUGIN_TARGET, "index.js"))
}

function isPluginEnabledInConfig(): { loaded: boolean; enabled: boolean } {
  if (!existsSync(CLAWDBOT_CONFIG)) {
    return { loaded: false, enabled: false }
  }

  try {
    const config = JSON.parse(readFileSync(CLAWDBOT_CONFIG, "utf-8"))
    const paths: string[] = config?.plugins?.load?.paths ?? []
    const loaded = paths.some((p: string) => p.includes("plugins/jfl") || p.includes("plugins\\jfl"))
    const enabled = config?.plugins?.entries?.jfl?.enabled === true
    return { loaded, enabled }
  } catch {
    return { loaded: false, enabled: false }
  }
}

function copyPluginFiles(srcDir: string): void {
  // Create target directory
  mkdirSync(PLUGIN_TARGET, { recursive: true })

  // Copy all files from plugin source
  const filesToCopy = ["index.js", "clawdbot.plugin.json"]

  for (const file of filesToCopy) {
    const src = join(srcDir, file)
    if (existsSync(src)) {
      copyFileSync(src, join(PLUGIN_TARGET, file))
    }
  }

  // Also copy index.ts if present (for reference)
  const tsSource = join(srcDir, "index.ts")
  if (existsSync(tsSource)) {
    copyFileSync(tsSource, join(PLUGIN_TARGET, "index.ts"))
  }

  // Create a minimal package.json so Clawdbot can load it as a module
  const packageJson = {
    name: "jfl-clawdbot-plugin",
    version: "0.1.0",
    description: "JFL plugin for Clawdbot",
    main: "index.js",
    type: "module",
  }
  writeFileSync(join(PLUGIN_TARGET, "package.json"), JSON.stringify(packageJson, null, 2) + "\n")
}

function updateClawdbotConfig(): void {
  let config: Record<string, any> = {}

  if (existsSync(CLAWDBOT_CONFIG)) {
    try {
      config = JSON.parse(readFileSync(CLAWDBOT_CONFIG, "utf-8"))
    } catch {
      // If config is malformed, start fresh
      config = {}
    }
  }

  // Ensure plugins structure exists
  if (!config.plugins) config.plugins = {}
  if (!config.plugins.load) config.plugins.load = {}
  if (!Array.isArray(config.plugins.load.paths)) config.plugins.load.paths = []
  if (!config.plugins.entries) config.plugins.entries = {}

  // Add plugin path if not already present
  const pluginPath = PLUGIN_TARGET
  const alreadyLoaded = config.plugins.load.paths.some(
    (p: string) => p.includes("plugins/jfl") || p.includes("plugins\\jfl")
  )
  if (!alreadyLoaded) {
    config.plugins.load.paths.push(pluginPath)
  }

  // Add plugin entry if not already present
  if (!config.plugins.entries.jfl) {
    config.plugins.entries.jfl = { enabled: true }
  } else {
    config.plugins.entries.jfl.enabled = true
  }

  writeFileSync(CLAWDBOT_CONFIG, JSON.stringify(config, null, 2) + "\n")
}

export async function clawdbotSetupCommand(): Promise<void> {
  console.log(chalk.bold("\n  JFL Clawdbot Plugin Setup\n"))

  // Step 1: Check if Clawdbot is installed
  if (!isClawdbotInstalled()) {
    console.log(chalk.red("  Clawdbot not found."))
    console.log(chalk.gray("  Looking for ~/.clawdbot/ directory or clawdbot binary.\n"))
    console.log(chalk.gray("  Install Clawdbot first: https://clawd.bot\n"))
    process.exit(1)
  }
  console.log(chalk.green("  [1/4] Clawdbot detected"))

  // Step 2: Find plugin source files
  const pluginSrc = getPluginSourceDir()
  if (!existsSync(pluginSrc) || !existsSync(join(pluginSrc, "index.js"))) {
    console.log(chalk.red("  Plugin source files not found."))
    console.log(chalk.gray(`  Expected at: ${pluginSrc}`))
    console.log(chalk.gray("  This may indicate a broken jfl installation. Try: npm install -g jfl\n"))
    process.exit(1)
  }
  console.log(chalk.green("  [2/4] Plugin source located"))

  // Step 3: Copy plugin files
  const updating = isPluginInstalled()
  try {
    copyPluginFiles(pluginSrc)
    if (updating) {
      console.log(chalk.green("  [3/4] Plugin files updated"))
    } else {
      console.log(chalk.green("  [3/4] Plugin files installed"))
    }
  } catch (err: any) {
    console.log(chalk.red(`  Failed to copy plugin files: ${err.message}`))
    process.exit(1)
  }

  // Step 4: Update clawdbot.json config
  try {
    updateClawdbotConfig()
    console.log(chalk.green("  [4/4] Clawdbot config updated"))
  } catch (err: any) {
    console.log(chalk.red(`  Failed to update config: ${err.message}`))
    console.log(chalk.gray("  You may need to manually add the plugin to ~/.clawdbot/clawdbot.json\n"))
    process.exit(1)
  }

  // Success
  console.log(chalk.green("\n  JFL plugin installed successfully.\n"))
  console.log(chalk.gray("  Plugin path:  ") + chalk.white(PLUGIN_TARGET))
  console.log(chalk.gray("  Config:       ") + chalk.white(CLAWDBOT_CONFIG))
  console.log()
  console.log(chalk.cyan("  Restart your gateway to load the plugin:"))
  console.log(chalk.white("    clawdbot gateway"))
  console.log()
}

export async function clawdbotStatusCommand(): Promise<void> {
  console.log(chalk.bold("\n  JFL Clawdbot Plugin Status\n"))

  // Clawdbot installed?
  const installed = isClawdbotInstalled()
  console.log(
    installed
      ? chalk.green("  Clawdbot:     ") + "installed"
      : chalk.red("  Clawdbot:     ") + "not found"
  )

  if (!installed) {
    console.log(chalk.gray("\n  Install Clawdbot first: https://clawd.bot\n"))
    return
  }

  // Plugin installed?
  const pluginInstalled = isPluginInstalled()
  console.log(
    pluginInstalled
      ? chalk.green("  JFL plugin:   ") + "installed"
      : chalk.yellow("  JFL plugin:   ") + "not installed"
  )

  if (pluginInstalled) {
    console.log(chalk.gray("  Plugin path:  ") + PLUGIN_TARGET)

    // Show plugin files
    try {
      const files = readdirSync(PLUGIN_TARGET)
      console.log(chalk.gray("  Files:        ") + files.join(", "))
    } catch { /* skip */ }
  }

  // Config status?
  const { loaded, enabled } = isPluginEnabledInConfig()
  console.log(
    loaded
      ? chalk.green("  Config path:  ") + "registered"
      : chalk.yellow("  Config path:  ") + "not registered"
  )
  console.log(
    enabled
      ? chalk.green("  Enabled:      ") + "yes"
      : chalk.yellow("  Enabled:      ") + "no"
  )

  // Suggestions
  if (!pluginInstalled) {
    console.log(chalk.cyan("\n  Run 'jfl clawdbot setup' to install the plugin.\n"))
  } else if (!loaded || !enabled) {
    console.log(chalk.cyan("\n  Run 'jfl clawdbot setup' to fix the configuration.\n"))
  } else {
    console.log(chalk.green("\n  Everything looks good. Use /jfl in your Clawdbot gateway.\n"))
  }
}
