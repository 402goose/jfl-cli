/**
 * JFL Configuration Management
 *
 * Centralized config storage in XDG-compliant directories
 * Replaces Conf library to keep all state in JFL's namespace.
 *
 * @purpose Global JFL configuration management in XDG directories
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import path from "path"
import chalk from "chalk"
import * as p from "@clack/prompts"
import { JFL_PATHS, JFL_FILES, ensureJflDirs } from "./jfl-paths.js"

// Use XDG-compliant config path
const CONFIG_FILE = JFL_FILES.config

// ============================================================================
// Config Operations
// ============================================================================

export function ensureJFLDir(): void {
  ensureJflDirs()
}

export function getConfig(): Record<string, any> {
  ensureJFLDir()

  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, JSON.stringify({}, null, 2))
    return {}
  }

  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"))
  } catch (error) {
    console.warn(chalk.yellow(`Failed to parse ${CONFIG_FILE}, starting fresh`))
    return {}
  }
}

export function setConfig(key: string, value: any): void {
  const config = getConfig()
  config[key] = value
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n")
}

export function getConfigValue(key: string, defaultValue?: any): any {
  const config = getConfig()
  return config[key] !== undefined ? config[key] : defaultValue
}

export function deleteConfigKey(key: string): void {
  const config = getConfig()
  delete config[key]
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n")
}

export function clearConfig(): void {
  writeFileSync(CONFIG_FILE, JSON.stringify({}, null, 2) + "\n")
}

// ============================================================================
// Code Directory Management
// ============================================================================

export async function getCodeDirectory(): Promise<string> {
  const config = getConfig()

  if (config.codeDirectory) {
    return config.codeDirectory
  }

  // First time - ask user
  const defaultDir = path.join(homedir(), "CascadeProjects")
  const codeDir = await p.text({
    message: "Where do you keep your code repos?",
    placeholder: defaultDir,
    defaultValue: defaultDir,
    validate: (input: string) => {
      if (!input.trim()) return "Directory required"
    },
  })

  if (p.isCancel(codeDir)) {
    return defaultDir
  }

  const resolved = (codeDir as string) || defaultDir
  setConfig("codeDirectory", resolved)
  p.log.success(`Saved code directory: ${resolved}`)

  return resolved
}

// ============================================================================
// Project Detection
// ============================================================================

export function isInJFLProject(cwd: string = process.cwd()): boolean {
  return existsSync(join(cwd, ".jfl", "config.json"))
}

export function findProjectRoot(startPath: string = process.cwd()): string | null {
  let currentPath = startPath
  const root = path.parse(currentPath).root

  while (currentPath !== root) {
    if (isInJFLProject(currentPath)) {
      return currentPath
    }
    currentPath = path.dirname(currentPath)
  }

  return null
}

// ============================================================================
// MCP Config Path Detection
// ============================================================================

export function getMCPConfigFile(): string {
  // Check if we're in a JFL project
  const projectRoot = findProjectRoot()

  if (projectRoot) {
    // Project-local MCP config (recommended)
    return path.join(projectRoot, ".mcp.json")
  }

  // Global mode - store in JFL's config dir (XDG compliant)
  return path.join(JFL_PATHS.config, "mcp-config.json")
}
