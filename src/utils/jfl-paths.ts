/**
 * Centralized JFL directory path management
 *
 * @purpose Single source of truth for all JFL paths (global and project-local)
 * @spec Implements XDG Base Directory Specification
 * @perf Paths computed once at module load, existence checks cached for 5s
 */

import { homedir, platform } from 'os'
import { join } from 'path'
import * as fs from 'fs'

// Cache for existsSync calls to avoid repeated filesystem access
const existsCache = new Map<string, { exists: boolean; ts: number }>()
const CACHE_TTL_MS = 5000 // 5 second cache

function cachedExists(path: string): boolean {
  const cached = existsCache.get(path)
  const now = Date.now()
  if (cached && (now - cached.ts) < CACHE_TTL_MS) {
    return cached.exists
  }
  const exists = fs.existsSync(path)
  existsCache.set(path, { exists, ts: now })
  return exists
}

export function clearPathCache(): void {
  existsCache.clear()
}

/**
 * Get XDG config home directory (cross-platform)
 */
function getConfigHome(): string {
  if (platform() === 'win32') {
    return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  }
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
}

/**
 * Get XDG data home directory (cross-platform)
 */
function getDataHome(): string {
  if (platform() === 'win32') {
    return process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  }
  return process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
}

/**
 * Get XDG cache home directory (cross-platform)
 */
function getCacheHome(): string {
  if (platform() === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'cache')
  }
  return process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
}

/**
 * XDG Base Directory paths for JFL
 * Respects XDG environment variables, falls back to defaults
 */
export const JFL_PATHS = {
  // XDG Config Home: ~/.config/jfl/ (or %APPDATA%/jfl/ on Windows)
  config: join(getConfigHome(), 'jfl'),

  // XDG Data Home: ~/.local/share/jfl/ (or %LOCALAPPDATA%/jfl/ on Windows)
  data: join(getDataHome(), 'jfl'),

  // XDG Cache Home: ~/.cache/jfl/ (or %LOCALAPPDATA%/cache/jfl/ on Windows)
  cache: join(getCacheHome(), 'jfl'),

  // Legacy path (for migration detection)
  legacy: join(homedir(), '.jfl'),
} as const

/**
 * Specific file paths within JFL directories
 */
export const JFL_FILES = {
  // Config files
  config: join(JFL_PATHS.config, 'config.json'),
  auth: join(JFL_PATHS.config, 'auth.json'),

  // Data files
  sessions: join(JFL_PATHS.data, 'sessions.json'),
  servicesDir: join(JFL_PATHS.data, 'services'),
  servicesRegistry: join(JFL_PATHS.data, 'services', 'registry.json'),
  servicesLogs: join(JFL_PATHS.data, 'services', 'logs'),
  servicesPids: join(JFL_PATHS.data, 'services', 'pids'),

  // Cache files
  updateCheck: join(JFL_PATHS.cache, 'last-update-check'),
  telemetryQueue: join(JFL_PATHS.cache, 'telemetry-queue.jsonl'),
  telemetryArchive: join(JFL_PATHS.data, 'telemetry-archive.jsonl'),
} as const

/**
 * Check if legacy ~/.jfl/ exists (needs migration)
 * Uses cached existsSync to avoid repeated filesystem access
 */
export function hasLegacyJflDir(): boolean {
  return cachedExists(JFL_PATHS.legacy)
}

/**
 * Get migration status
 * Returns: 'none' | 'needed' | 'complete'
 * Uses cached existsSync to avoid repeated filesystem access
 */
export function getMigrationStatus(): 'none' | 'needed' | 'complete' {
  const hasLegacy = hasLegacyJflDir()
  const hasNew = cachedExists(JFL_PATHS.config)

  if (!hasLegacy && !hasNew) return 'none'
  if (hasLegacy && !hasNew) return 'needed'
  return 'complete'
}

/**
 * Ensure JFL directories exist
 * Creates XDG-compliant directory structure
 * Uses cached existsSync and invalidates cache after creation
 */
export function ensureJflDirs(): void {
  const dirs = [
    JFL_PATHS.config,
    JFL_PATHS.data,
    JFL_PATHS.cache,
    JFL_FILES.servicesDir,
    JFL_FILES.servicesLogs,
    JFL_FILES.servicesPids,
  ]

  for (const dir of dirs) {
    if (!cachedExists(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      // Invalidate cache after creation
      existsCache.set(dir, { exists: true, ts: Date.now() })
    }
  }
}

/**
 * Get project-local .jfl directory
 * @param projectRoot - Absolute path to project root
 */
export function getProjectJflDir(projectRoot: string): string {
  return join(projectRoot, '.jfl')
}

/**
 * Get project-local .jfl file
 * @param projectRoot - Absolute path to project root
 * @param filename - File within .jfl/ directory
 */
export function getProjectJflFile(projectRoot: string, filename: string): string {
  return join(projectRoot, '.jfl', filename)
}
