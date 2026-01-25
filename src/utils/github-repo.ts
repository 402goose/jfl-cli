/**
 * GitHub Repository Operations
 *
 * Handles GitHub repo creation and GitHub App installation
 */

import { getGitHubToken, getGitHubUsername } from './github-auth.js'
import { getProjectConfig } from './project-config.js'
import chalk from 'chalk'
import ora from 'ora'
import { basename } from 'path'

const GITHUB_API_URL = 'https://api.github.com'

interface GitHubRepo {
  id: number
  name: string
  full_name: string
  clone_url: string
  ssh_url: string
  html_url: string
  private: boolean
}

/**
 * Create a new GitHub repository
 */
export async function createGitHubRepo(
  projectPath: string = process.cwd()
): Promise<{ url: string; sshUrl: string; htmlUrl: string }> {
  const token = getGitHubToken()
  if (!token) {
    throw new Error('Not authenticated with GitHub. Run: jfl login')
  }

  // Get project name from config or directory name
  const config = getProjectConfig()
  const projectName = config.name || basename(projectPath)

  const spinner = ora('Creating GitHub repository...').start()

  try {
    // Check if repo already exists
    const username = getGitHubUsername()
    if (username) {
      const existingRepo = await checkRepoExists(token, username, projectName)
      if (existingRepo) {
        spinner.succeed('Repository already exists')
        return {
          url: existingRepo.clone_url,
          sshUrl: existingRepo.ssh_url,
          htmlUrl: existingRepo.html_url,
        }
      }
    }

    // Create new repo
    const response = await fetch(`${GITHUB_API_URL}/user/repos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: projectName,
        description: config.description || `JFL GTM workspace for ${projectName}`,
        private: true,
        auto_init: false, // We'll push our own code
        has_issues: true,
        has_wiki: false,
        has_projects: false,
      }),
    })

    if (!response.ok) {
      const error = await response.json()

      // Check if repo already exists
      if (error.errors && error.errors.some((e: { message: string }) => e.message?.includes('already exists'))) {
        // Repo exists, get its URL
        const existingRepo = await getRepo(token, username!, projectName)
        if (existingRepo) {
          spinner.succeed('Repository already exists')
          return {
            url: existingRepo.clone_url,
            sshUrl: existingRepo.ssh_url,
            htmlUrl: existingRepo.html_url,
          }
        }
      }

      throw new Error(`Failed to create repository: ${error.message || response.statusText}`)
    }

    const repo: GitHubRepo = await response.json()

    spinner.succeed(`Created repository: ${chalk.cyan(repo.html_url)}`)

    return {
      url: repo.clone_url,
      sshUrl: repo.ssh_url,
      htmlUrl: repo.html_url,
    }
  } catch (error) {
    spinner.fail('Failed to create repository')
    throw error
  }
}

/**
 * Check if a repository exists
 */
async function checkRepoExists(
  token: string,
  owner: string,
  repo: string
): Promise<GitHubRepo | null> {
  try {
    return await getRepo(token, owner, repo)
  } catch {
    return null
  }
}

/**
 * Get repository info
 */
async function getRepo(token: string, owner: string, repo: string): Promise<GitHubRepo> {
  const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    throw new Error(`Repository not found: ${owner}/${repo}`)
  }

  return response.json()
}

/**
 * Check if JFL GitHub App is installed on a repository
 */
export async function checkGitHubAppInstalled(
  owner: string,
  repo: string
): Promise<{ installed: boolean; installationId?: number; installUrl?: string }> {
  const token = getGitHubToken()
  if (!token) {
    throw new Error('Not authenticated with GitHub')
  }

  try {
    // Get user's installations
    const response = await fetch(`${GITHUB_API_URL}/user/installations`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (!response.ok) {
      return {
        installed: false,
        installUrl: 'https://github.com/apps/jfl-platform/installations/new',
      }
    }

    const { installations } = await response.json()

    // Look for JFL app installation
    for (const installation of installations) {
      // Check if this installation has access to the repo
      const reposResponse = await fetch(
        `${GITHUB_API_URL}/user/installations/${installation.id}/repositories`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      )

      if (reposResponse.ok) {
        const { repositories } = await reposResponse.json()
        const hasRepo = repositories.some(
          (r: { name: string; owner: { login: string } }) =>
            r.name === repo && r.owner.login === owner
        )

        if (hasRepo) {
          return {
            installed: true,
            installationId: installation.id,
          }
        }
      }
    }

    return {
      installed: false,
      installUrl: `https://github.com/apps/jfl-platform/installations/new/permissions?target_id=${owner}`,
    }
  } catch (error) {
    console.error(chalk.red('Error checking GitHub App installation:'), error)
    return {
      installed: false,
      installUrl: 'https://github.com/apps/jfl-platform/installations/new',
    }
  }
}

/**
 * Poll for GitHub App installation (wait for user to install)
 */
export async function waitForGitHubAppInstallation(
  owner: string,
  repo: string,
  timeoutMs: number = 300000 // 5 minutes
): Promise<number | null> {
  const startTime = Date.now()
  const pollInterval = 3000 // 3 seconds

  console.log(chalk.gray('\n  Waiting for GitHub App installation...'))
  console.log(chalk.gray('  (Press Ctrl+C to cancel)\n'))

  const spinner = ora('Checking installation status...').start()

  while (Date.now() - startTime < timeoutMs) {
    const result = await checkGitHubAppInstalled(owner, repo)

    if (result.installed && result.installationId) {
      spinner.succeed('GitHub App installed!')
      return result.installationId
    }

    // Wait before next check
    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  spinner.fail('Installation timeout')
  return null
}

/**
 * Prompt user to install GitHub App
 */
export async function promptGitHubAppInstall(
  owner: string,
  repo: string
): Promise<number | null> {
  const result = await checkGitHubAppInstalled(owner, repo)

  if (result.installed && result.installationId) {
    console.log(chalk.gray('  ✓ GitHub App already installed'))
    return result.installationId
  }

  console.log(chalk.yellow('\n⚠️  JFL GitHub App not installed'))
  console.log(chalk.gray('\nTo enable deployments, install the JFL GitHub App:'))
  console.log(chalk.cyan(`\n  ${result.installUrl}\n`))
  console.log(chalk.gray('Then select the repository: ') + chalk.white(`${owner}/${repo}`))

  // Try to open browser
  try {
    const open = (await import('open')).default
    await open(result.installUrl || 'https://github.com/apps/jfl-platform/installations/new')
    console.log(chalk.dim('\n  Browser opened...\n'))
  } catch {
    console.log(chalk.dim('\n  (Could not open browser - copy the URL above)\n'))
  }

  // Wait for installation
  return await waitForGitHubAppInstallation(owner, repo)
}
