/**
 * Project-level configuration
 *
 * Stored in .jfl/config.json at project root
 * Separate from user-level config (global, in ~/Library/Preferences/jfl-nodejs)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface ProjectConfig {
  name?: string
  type?: string
  setup?: string
  wallet?: string        // Project wallet address (owner's)
  walletOwner?: string   // Git username of wallet owner
  description?: string
}

/**
 * Get the .jfl directory path for current project
 */
function getJflDir(): string {
  return join(process.cwd(), '.jfl')
}

/**
 * Get the config file path
 */
function getConfigPath(): string {
  return join(getJflDir(), 'config.json')
}

/**
 * Check if we're in a JFL project
 */
export function isJflProject(): boolean {
  const cwd = process.cwd()
  return existsSync(join(cwd, '.jfl')) ||
         existsSync(join(cwd, 'CLAUDE.md')) ||
         existsSync(join(cwd, 'knowledge'))
}

/**
 * Read project config
 */
export function getProjectConfig(): ProjectConfig {
  const configPath = getConfigPath()

  if (!existsSync(configPath)) {
    return {}
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

/**
 * Write project config
 */
export function setProjectConfig(config: ProjectConfig): void {
  const jflDir = getJflDir()
  const configPath = getConfigPath()

  // Ensure .jfl directory exists
  if (!existsSync(jflDir)) {
    mkdirSync(jflDir, { recursive: true })
  }

  // Merge with existing config
  const existing = getProjectConfig()
  const merged = { ...existing, ...config }

  writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n')
}

/**
 * Get project wallet address
 */
export function getProjectWallet(): string | undefined {
  const config = getProjectConfig()
  return config.wallet
}

/**
 * Set project wallet (called when owner sets up x402)
 */
export function setProjectWallet(address: string, ownerUsername: string): void {
  setProjectConfig({
    wallet: address,
    walletOwner: ownerUsername,
  })
}

/**
 * Check if current user is the wallet owner
 */
export function isWalletOwner(username: string): boolean {
  const config = getProjectConfig()
  if (!config.walletOwner) return false
  return config.walletOwner.toLowerCase() === username.toLowerCase()
}

/**
 * Get project name
 */
export function getProjectName(): string {
  const config = getProjectConfig()
  if (config.name) return config.name

  // Fallback to directory name
  const cwd = process.cwd()
  return cwd.split('/').pop() || 'project'
}
