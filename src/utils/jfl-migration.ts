/**
 * JFL Migration from ~/.jfl/ to XDG directories
 *
 * @purpose One-time migration of legacy ~/.jfl/ to XDG-compliant paths
 */

import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import { JFL_PATHS, JFL_FILES, hasLegacyJflDir, ensureJflDirs } from './jfl-paths.js'

interface MigrationResult {
  success: boolean
  migrated: string[]
  errors: Array<{ file: string; error: string }>
}

/**
 * Migrate ~/.jfl/ to XDG directories
 * Called automatically on first run if legacy dir exists
 */
export async function migrateToXDG(options: { silent?: boolean } = {}): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    migrated: [],
    errors: [],
  }

  if (!hasLegacyJflDir()) {
    return result // Nothing to migrate
  }

  if (!options.silent) {
    console.log(chalk.cyan('\n📦 Migrating JFL to XDG directories...\n'))
  }

  try {
    // Ensure new directories exist
    ensureJflDirs()

    // Migration map: legacy path → new path
    const migrations: Array<{ from: string; to: string; type: string }> = [
      // Config files
      {
        from: path.join(JFL_PATHS.legacy, 'config.json'),
        to: JFL_FILES.config,
        type: 'config',
      },

      // Sessions (data)
      {
        from: path.join(JFL_PATHS.legacy, 'sessions.json'),
        to: JFL_FILES.sessions,
        type: 'data',
      },

      // Service manager (data)
      {
        from: path.join(JFL_PATHS.legacy, 'service-manager'),
        to: JFL_FILES.servicesDir,
        type: 'data',
      },

      // Update check cache
      {
        from: path.join(JFL_PATHS.legacy, '.jfl-last-update-check'),
        to: JFL_FILES.updateCheck,
        type: 'cache',
      },
    ]

    // Execute migrations
    for (const migration of migrations) {
      try {
        if (!fs.existsSync(migration.from)) {
          continue // Skip if source doesn't exist
        }

        const isDir = fs.statSync(migration.from).isDirectory()

        if (isDir) {
          // Copy directory recursively
          copyDirRecursive(migration.from, migration.to)
        } else {
          // Copy file
          const destDir = path.dirname(migration.to)
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true })
          }
          fs.copyFileSync(migration.from, migration.to)
        }

        result.migrated.push(migration.to)

        if (!options.silent) {
          console.log(chalk.gray(`  ✓ ${path.basename(migration.from)} → ${migration.type}`))
        }
      } catch (err: any) {
        result.errors.push({
          file: migration.from,
          error: err.message,
        })
        result.success = false
      }
    }

    // If migration successful, remove legacy directory
    if (result.success && result.errors.length === 0) {
      fs.rmSync(JFL_PATHS.legacy, { recursive: true, force: true })

      if (!options.silent) {
        console.log(chalk.green('\n✨ Migration complete!\n'))
        console.log(chalk.gray('  Config: ~/.config/jfl/'))
        console.log(chalk.gray('  Data:   ~/.local/share/jfl/'))
        console.log(chalk.gray('  Cache:  ~/.cache/jfl/\n'))
      }
    }

  } catch (err: any) {
    result.success = false
    result.errors.push({ file: 'migration', error: err.message })
  }

  return result
}

/**
 * Check if migration is needed and prompt user
 * Called at CLI startup
 */
export async function checkAndMigrate(options: { silent?: boolean } = {}): Promise<void> {
  if (!hasLegacyJflDir()) {
    return // No migration needed
  }

  // Auto-migrate (user chose Option A)
  const result = await migrateToXDG(options)

  if (!result.success) {
    console.error(chalk.red('\n⚠️  Migration had errors:'))
    for (const error of result.errors) {
      console.error(chalk.gray(`  ${error.file}: ${error.error}`))
    }
    console.log(chalk.yellow('\nYou may need to migrate manually.\n'))
  }
}

/**
 * Recursively copy directory
 */
function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }

  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}
