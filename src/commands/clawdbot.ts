/**
 * OpenClaw Gateway Plugin Management
 *
 * Installs and manages the JFL plugin for OpenClaw gateway.
 * Copies plugin files to ~/.openclaw/plugins/jfl/ (or ~/.clawdbot/plugins/jfl/ for legacy installs)
 * and configures the gateway config file.
 *
 * @purpose CLI commands for installing/checking JFL OpenClaw gateway plugin
 */

import chalk from "chalk"
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { execSync } from "child_process"
import { fileURLToPath } from "url"
import * as path from "path"

const OPENCLAW_DIR = join(homedir(), ".openclaw")
const CLAWDBOT_DIR = join(homedir(), ".clawdbot") // legacy fallback

function resolveGatewayDir(): string | null {
  if (existsSync(OPENCLAW_DIR)) return OPENCLAW_DIR
  if (existsSync(CLAWDBOT_DIR)) return CLAWDBOT_DIR
  return null
}

function getPluginTarget(): string {
  const dir = resolveGatewayDir() ?? OPENCLAW_DIR
  return join(dir, "plugins", "jfl")
}

function getConfigPath(): string {
  const dir = resolveGatewayDir()
  if (!dir) throw new Error("No gateway installation found")
  const openclawConfig = join(dir, "openclaw.json")
  const clawdbotConfig = join(dir, "clawdbot.json")
  return existsSync(openclawConfig) ? openclawConfig : clawdbotConfig
}

function isGatewayInstalled(): boolean {
  if (resolveGatewayDir() !== null) return true
  try {
    execSync("which openclaw", { stdio: "pipe" })
    return true
  } catch {}
  try {
    execSync("which clawdbot", { stdio: "pipe" })
    return true
  } catch {}
  return false
}

function getPluginSourceDir(): string {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  // From dist/commands/clawdbot.js -> clawdbot-plugin/
  return join(__dirname, "..", "..", "clawdbot-plugin")
}

function isPluginInstalled(): boolean {
  const pluginTarget = getPluginTarget()
  return existsSync(pluginTarget) && existsSync(join(pluginTarget, "index.js"))
}

function isPluginEnabledInConfig(): { loaded: boolean; enabled: boolean } {
  let configPath: string
  try {
    configPath = getConfigPath()
  } catch {
    return { loaded: false, enabled: false }
  }

  if (!existsSync(configPath)) {
    return { loaded: false, enabled: false }
  }

  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    const paths: string[] = config?.plugins?.load?.paths ?? []
    const loaded = paths.some((p: string) => p.includes("plugins/jfl") || p.includes("plugins\\jfl"))
    const enabled = config?.plugins?.entries?.jfl?.enabled === true
    return { loaded, enabled }
  } catch {
    return { loaded: false, enabled: false }
  }
}

function copyPluginFiles(srcDir: string): void {
  const pluginTarget = getPluginTarget()
  mkdirSync(pluginTarget, { recursive: true })

  const filesToCopy = ["index.js", "openclaw.plugin.json"]

  for (const file of filesToCopy) {
    const src = join(srcDir, file)
    if (existsSync(src)) {
      copyFileSync(src, join(pluginTarget, file))
    }
  }

  const tsSource = join(srcDir, "index.ts")
  if (existsSync(tsSource)) {
    copyFileSync(tsSource, join(pluginTarget, "index.ts"))
  }

  const packageJson = {
    name: "jfl-clawdbot-plugin",
    version: "0.1.0",
    description: "JFL plugin for OpenClaw gateway",
    main: "index.js",
    type: "module",
  }
  writeFileSync(join(pluginTarget, "package.json"), JSON.stringify(packageJson, null, 2) + "\n")
}

function updateGatewayConfig(): void {
  let configPath: string
  try {
    configPath = getConfigPath()
  } catch {
    // No gateway dir found — write to openclaw.json
    const gatewayDir = OPENCLAW_DIR
    mkdirSync(gatewayDir, { recursive: true })
    configPath = join(gatewayDir, "openclaw.json")
  }

  let config: Record<string, any> = {}

  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"))
    } catch {
      config = {}
    }
  }

  if (!config.plugins) config.plugins = {}
  if (!config.plugins.load) config.plugins.load = {}
  if (!Array.isArray(config.plugins.load.paths)) config.plugins.load.paths = []
  if (!config.plugins.entries) config.plugins.entries = {}

  const pluginTarget = getPluginTarget()
  const alreadyLoaded = config.plugins.load.paths.some(
    (p: string) => p.includes("plugins/jfl") || p.includes("plugins\\jfl")
  )
  if (!alreadyLoaded) {
    config.plugins.load.paths.push(pluginTarget)
  }

  if (!config.plugins.entries.jfl) {
    config.plugins.entries.jfl = { enabled: true }
  } else {
    config.plugins.entries.jfl.enabled = true
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
}

export async function clawdbotSetupCommand(): Promise<void> {
  console.log(chalk.bold("\n  JFL OpenClaw Plugin Setup\n"))

  if (!isGatewayInstalled()) {
    console.log(chalk.red("  OpenClaw is not installed."))
    console.log()
    console.log(chalk.gray("  Install it from: ") + chalk.white("https://openclaw.dev"))
    console.log()
    console.log(chalk.gray("  (Also supports legacy ~/.clawdbot installations)"))
    console.log()
    process.exit(1)
  }
  const gatewayDir = resolveGatewayDir()!
  console.log(chalk.green("  [1/4] OpenClaw detected") + chalk.gray(` (${gatewayDir})`))

  const pluginSrc = getPluginSourceDir()
  if (!existsSync(pluginSrc) || !existsSync(join(pluginSrc, "index.js"))) {
    console.log(chalk.red("  Plugin source files not found."))
    console.log(chalk.gray(`  Expected at: ${pluginSrc}`))
    console.log(chalk.gray("  This may indicate a broken jfl installation. Try: npm install -g jfl\n"))
    process.exit(1)
  }
  console.log(chalk.green("  [2/4] Plugin source located"))

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

  try {
    updateGatewayConfig()
    console.log(chalk.green("  [4/4] Gateway config updated"))
  } catch (err: any) {
    console.log(chalk.red(`  Failed to update config: ${err.message}`))
    console.log(chalk.gray("  You may need to manually add the plugin to your gateway config\n"))
    process.exit(1)
  }

  const pluginTarget = getPluginTarget()
  let configPath: string
  try {
    configPath = getConfigPath()
  } catch {
    configPath = join(gatewayDir, "openclaw.json")
  }

  console.log(chalk.green("\n  JFL plugin installed successfully.\n"))
  console.log(chalk.gray("  Plugin path:  ") + chalk.white(pluginTarget))
  console.log(chalk.gray("  Config:       ") + chalk.white(configPath))
  console.log()
  console.log(chalk.cyan("  Restart your gateway to load the plugin:"))
  console.log(chalk.white("    openclaw gateway"))
  console.log()
}

export async function clawdbotStatusCommand(): Promise<void> {
  console.log(chalk.bold("\n  JFL OpenClaw Plugin Status\n"))

  const installed = isGatewayInstalled()
  const gatewayDir = resolveGatewayDir()
  console.log(
    installed
      ? chalk.green("  OpenClaw:     ") + "installed" + (gatewayDir ? chalk.gray(` (${gatewayDir})`) : "")
      : chalk.red("  OpenClaw:     ") + "not found"
  )

  if (!installed) {
    console.log(chalk.gray("\n  Install OpenClaw from: ") + chalk.white("https://openclaw.dev"))
    console.log(chalk.gray("  (Also supports legacy ~/.clawdbot installations)\n"))
    return
  }

  const pluginTarget = getPluginTarget()
  const pluginInstalled = isPluginInstalled()
  console.log(
    pluginInstalled
      ? chalk.green("  JFL plugin:   ") + "installed"
      : chalk.yellow("  JFL plugin:   ") + "not installed"
  )

  if (pluginInstalled) {
    console.log(chalk.gray("  Plugin path:  ") + pluginTarget)

    try {
      const files = readdirSync(pluginTarget)
      console.log(chalk.gray("  Files:        ") + files.join(", "))
    } catch { /* skip */ }
  }

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

  if (!pluginInstalled) {
    console.log(chalk.cyan("\n  Run 'jfl openclaw plugin setup' to install the plugin.\n"))
  } else if (!loaded || !enabled) {
    console.log(chalk.cyan("\n  Run 'jfl openclaw plugin setup' to fix the configuration.\n"))
  } else {
    console.log(chalk.green("\n  Everything looks good. Use /jfl in your OpenClaw gateway.\n"))
  }
}
