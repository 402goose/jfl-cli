/**
 * Git Operations Utilities
 *
 * Handles all git operations needed for deployment:
 * - Initialize git repo
 * - Check for commits
 * - Check for remotes
 * - Create commits
 * - Push to remote
 */

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import ora from 'ora'

/**
 * Check if directory is a git repository
 */
export function isGitRepo(cwd: string = process.cwd()): boolean {
  return existsSync(join(cwd, '.git'))
}

/**
 * Initialize a new git repository
 */
export function initializeGit(cwd: string = process.cwd()): void {
  if (isGitRepo(cwd)) {
    return // Already initialized
  }

  execSync('git init', { cwd, stdio: 'pipe' })
  console.log(chalk.gray('  ✓ Initialized git repository'))
}

/**
 * Check if there are any commits
 */
export function hasCommits(cwd: string = process.cwd()): boolean {
  if (!isGitRepo(cwd)) {
    return false
  }

  try {
    execSync('git rev-parse HEAD', { cwd, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Create initial commit with all files
 */
export function createInitialCommit(cwd: string = process.cwd()): void {
  if (hasCommits(cwd)) {
    return // Already have commits
  }

  try {
    // Add all files
    execSync('git add .', { cwd, stdio: 'pipe' })

    // Create initial commit
    execSync(
      'git commit -m "Initial commit\\n\\nCo-Authored-By: JFL CLI <noreply@jfl.run>"',
      { cwd, stdio: 'pipe' }
    )

    console.log(chalk.gray('  ✓ Created initial commit'))
  } catch (error) {
    // Ignore errors (e.g., nothing to commit)
  }
}

/**
 * Get current branch name
 */
export function getCurrentBranch(cwd: string = process.cwd()): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim()
  } catch {
    return 'main'
  }
}

/**
 * Get latest commit SHA
 */
export function getLatestCommit(cwd: string = process.cwd()): string | null {
  try {
    return execSync('git rev-parse HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim()
  } catch {
    return null
  }
}

/**
 * Check if git remote exists
 */
export function hasGitRemote(cwd: string = process.cwd(), remote: string = 'origin'): boolean {
  if (!isGitRepo(cwd)) {
    return false
  }

  try {
    execSync(`git remote get-url ${remote}`, { cwd, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Get git remote URL
 */
export function getGitRemote(cwd: string = process.cwd(), remote: string = 'origin'): string | null {
  try {
    return execSync(`git remote get-url ${remote}`, {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim()
  } catch {
    return null
  }
}

/**
 * Add git remote
 */
export function addGitRemote(cwd: string, remoteUrl: string, remote: string = 'origin'): void {
  try {
    // Remove existing remote if it exists
    try {
      execSync(`git remote remove ${remote}`, { cwd, stdio: 'pipe' })
    } catch {
      // Ignore if remote doesn't exist
    }

    // Add new remote
    execSync(`git remote add ${remote} ${remoteUrl}`, { cwd, stdio: 'pipe' })
    console.log(chalk.gray(`  ✓ Added remote: ${remote}`))
  } catch (error) {
    throw new Error(`Failed to add git remote: ${error}`)
  }
}

/**
 * Push to remote
 */
export async function pushToRemote(
  cwd: string,
  remote: string = 'origin',
  branch?: string
): Promise<void> {
  const currentBranch = branch || getCurrentBranch(cwd)

  const spinner = ora('Pushing to GitHub...').start()

  try {
    // Set upstream and push
    execSync(`git push -u ${remote} ${currentBranch}`, {
      cwd,
      stdio: 'pipe',
    })

    spinner.succeed('Pushed to GitHub')
  } catch (error) {
    spinner.fail('Failed to push')
    throw new Error(`Failed to push to remote: ${error}`)
  }
}

/**
 * Check for uncommitted changes
 */
export function hasUncommittedChanges(cwd: string = process.cwd()): boolean {
  if (!isGitRepo(cwd)) {
    return false
  }

  try {
    const status = execSync('git status --porcelain', {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    return status.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Get git status summary
 */
export function getGitStatus(cwd: string = process.cwd()): {
  isRepo: boolean
  hasCommits: boolean
  hasRemote: boolean
  branch: string
  remoteUrl: string | null
  uncommittedChanges: boolean
} {
  const isRepo = isGitRepo(cwd)
  const commits = hasCommits(cwd)
  const remote = hasGitRemote(cwd)

  return {
    isRepo,
    hasCommits: commits,
    hasRemote: remote,
    branch: getCurrentBranch(cwd),
    remoteUrl: getGitRemote(cwd),
    uncommittedChanges: hasUncommittedChanges(cwd),
  }
}

/**
 * Extract owner/repo from GitHub URL
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // Support both HTTPS and SSH formats
  const patterns = [
    /github\.com[/:]([\w-]+)\/([\w-]+?)(\.git)?$/,
    /github\.com\/([\w-]+)\/([\w-]+)/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) {
      return {
        owner: match[1],
        repo: match[2],
      }
    }
  }

  return null
}
