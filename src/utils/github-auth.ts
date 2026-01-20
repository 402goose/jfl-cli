/**
 * GitHub Authentication for JFL CLI
 *
 * Uses GitHub Device Flow for CLI-friendly OAuth:
 * 1. Request device code
 * 2. User enters code at github.com/login/device
 * 3. Poll for access token
 * 4. Use token for API calls
 */

import Conf from 'conf'
import chalk from 'chalk'
import ora from 'ora'
import open from 'open'

const config = new Conf({ projectName: 'jfl' })

// Register your GitHub OAuth App at:
// https://github.com/settings/applications/new
// - Application name: JFL CLI
// - Homepage URL: https://github.com/402goose/just-fucking-launch
// - Authorization callback URL: http://localhost (not used for device flow)
// Then paste the Client ID here:
const GITHUB_CLIENT_ID = process.env.JFL_GITHUB_CLIENT_ID || 'Ov23lizuLuSNqONApTVc'

const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_API_URL = 'https://api.github.com'

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

interface TokenResponse {
  access_token?: string
  token_type?: string
  scope?: string
  error?: string
  error_description?: string
}

interface GitHubUser {
  login: string
  id: number
  name: string | null
  email: string | null
  avatar_url: string
}

interface GitHubRepo {
  name: string
  full_name: string
  owner: {
    login: string
  }
  description: string | null
  html_url: string
  clone_url: string
  ssh_url: string
  pushed_at: string
  permissions?: {
    admin: boolean
    push: boolean
    pull: boolean
  }
}

export interface JflProject {
  name: string
  fullName: string
  owner: string
  description: string | null
  cloneUrl: string
  sshUrl: string
  lastUpdated: string
  hasUserSuggestions: boolean
  projectConfig?: {
    name?: string
    wallet?: string
    walletOwner?: string
  }
}

/**
 * Check if user is authenticated with GitHub
 */
export function isGitHubAuthenticated(): boolean {
  const token = config.get('githubToken') as string | undefined
  return !!token
}

/**
 * Get stored GitHub token
 */
export function getGitHubToken(): string | null {
  return config.get('githubToken') as string | null
}

/**
 * Get stored GitHub username
 */
export function getGitHubUsername(): string | null {
  return config.get('githubUsername') as string | null
}

/**
 * Clear GitHub auth
 */
export function clearGitHubAuth(): void {
  config.delete('githubToken')
  config.delete('githubUsername')
}

/**
 * Request a device code from GitHub
 */
async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      scope: 'repo read:user',
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to request device code: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Poll GitHub for access token
 */
async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<string> {
  const startTime = Date.now()
  const expiresAt = startTime + expiresIn * 1000

  while (Date.now() < expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000))

    const response = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })

    const data: TokenResponse = await response.json()

    if (data.access_token) {
      return data.access_token
    }

    if (data.error === 'authorization_pending') {
      // User hasn't authorized yet, keep polling
      continue
    }

    if (data.error === 'slow_down') {
      // We're polling too fast, increase interval
      interval += 5
      continue
    }

    if (data.error === 'expired_token') {
      throw new Error('Authorization expired. Please try again.')
    }

    if (data.error === 'access_denied') {
      throw new Error('Authorization denied by user.')
    }

    if (data.error) {
      throw new Error(data.error_description || data.error)
    }
  }

  throw new Error('Authorization timed out. Please try again.')
}

/**
 * Get authenticated user info
 */
async function getUser(token: string): Promise<GitHubUser> {
  const response = await fetch(`${GITHUB_API_URL}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Get user's repositories
 */
async function getUserRepos(token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = []
  let page = 1
  const perPage = 100

  while (true) {
    const response = await fetch(
      `${GITHUB_API_URL}/user/repos?per_page=${perPage}&page=${page}&sort=pushed&direction=desc`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to get repos: ${response.statusText}`)
    }

    const pageRepos: GitHubRepo[] = await response.json()
    repos.push(...pageRepos)

    if (pageRepos.length < perPage) {
      break
    }

    page++

    // Safety limit
    if (page > 10) {
      break
    }
  }

  return repos
}

/**
 * Check if a repo is a JFL GTM project (not just any repo with CLAUDE.md)
 *
 * A JFL GTM project has:
 * - .jfl/config.json (definitive), OR
 * - knowledge/ directory (GTM structure)
 *
 * Just having CLAUDE.md is not enough (the CLI itself has that)
 */
async function checkRepoForJfl(
  token: string,
  owner: string,
  repo: string
): Promise<{ isJfl: boolean; config?: Record<string, unknown> }> {
  // Skip the JFL CLI repo itself
  if (repo === 'just-fucking-launch' || repo === 'jfl') {
    return { isJfl: false }
  }

  // Try .jfl/config.json first (definitive signal)
  try {
    const response = await fetch(
      `${GITHUB_API_URL}/repos/${owner}/${repo}/contents/.jfl/config.json`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    )

    if (response.ok) {
      const data = await response.json()
      if (data.content) {
        const content = Buffer.from(data.content, 'base64').toString('utf-8')
        return { isJfl: true, config: JSON.parse(content) }
      }
    }
  } catch {
    // Not found or error, continue
  }

  // Try knowledge/ directory (GTM structure signal)
  try {
    const response = await fetch(
      `${GITHUB_API_URL}/repos/${owner}/${repo}/contents/knowledge`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    )

    if (response.ok) {
      return { isJfl: true }
    }
  } catch {
    // Not found
  }

  return { isJfl: false }
}

/**
 * Check if user has a suggestions file in the repo
 */
async function checkUserSuggestions(
  token: string,
  owner: string,
  repo: string,
  username: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${GITHUB_API_URL}/repos/${owner}/${repo}/contents/suggestions/${username}.md`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    )

    return response.ok
  } catch {
    return false
  }
}

/**
 * Authenticate with GitHub using Device Flow
 * Returns the username on success
 */
export async function authenticateWithGitHub(): Promise<string> {
  // Check if already authenticated
  const existingToken = getGitHubToken()
  if (existingToken) {
    try {
      const user = await getUser(existingToken)
      config.set('githubUsername', user.login)
      return user.login
    } catch {
      // Token invalid, clear and re-auth
      clearGitHubAuth()
    }
  }

  console.log(chalk.cyan('\nConnecting to GitHub...\n'))

  // Request device code
  const deviceCode = await requestDeviceCode()

  // Show instructions
  console.log(chalk.bold('To authorize JFL:'))
  console.log()
  console.log(chalk.gray('  1. Go to: ') + chalk.cyan.underline(deviceCode.verification_uri))
  console.log(chalk.gray('  2. Enter code: ') + chalk.yellow.bold(deviceCode.user_code))
  console.log()

  // Pause so they can see the code
  await new Promise((resolve) => setTimeout(resolve, 1500))

  // Try to open browser
  console.log(chalk.dim('  Opening browser...'))
  try {
    await open(deviceCode.verification_uri)
  } catch {
    console.log(chalk.dim('  (Could not open browser - go to the URL manually)'))
  }

  console.log()

  // Poll for token
  const spinner = ora('Waiting for authorization...').start()

  try {
    const token = await pollForToken(
      deviceCode.device_code,
      deviceCode.interval,
      deviceCode.expires_in
    )

    // Get user info
    const user = await getUser(token)

    // Store token and username
    config.set('githubToken', token)
    config.set('githubUsername', user.login)

    spinner.succeed(`Connected as ${chalk.green(user.login)}`)

    return user.login
  } catch (error) {
    spinner.fail('Authorization failed')
    throw error
  }
}

/**
 * Discover JFL projects the user has access to
 */
export async function discoverJflProjects(): Promise<JflProject[]> {
  const token = getGitHubToken()
  const username = getGitHubUsername()

  if (!token || !username) {
    throw new Error('Not authenticated with GitHub')
  }

  const spinner = ora('Looking for JFL projects...').start()

  try {
    const repos = await getUserRepos(token)
    const jflProjects: JflProject[] = []

    // Check each repo for JFL config (limit to recent 50 for speed)
    const reposToCheck = repos.slice(0, 50)

    for (const repo of reposToCheck) {
      spinner.text = `Checking ${repo.full_name}...`

      const { isJfl, config: projectConfig } = await checkRepoForJfl(
        token,
        repo.owner.login,
        repo.name
      )

      if (isJfl) {
        const hasUserSuggestions = await checkUserSuggestions(
          token,
          repo.owner.login,
          repo.name,
          username
        )

        jflProjects.push({
          name: repo.name,
          fullName: repo.full_name,
          owner: repo.owner.login,
          description: repo.description,
          cloneUrl: repo.clone_url,
          sshUrl: repo.ssh_url,
          lastUpdated: repo.pushed_at,
          hasUserSuggestions,
          projectConfig: projectConfig as JflProject['projectConfig'],
        })
      }
    }

    spinner.succeed(`Found ${jflProjects.length} JFL project${jflProjects.length === 1 ? '' : 's'}`)

    return jflProjects
  } catch (error) {
    spinner.fail('Failed to discover projects')
    throw error
  }
}

/**
 * Clone a repository
 */
export async function cloneRepository(
  project: JflProject,
  targetDir?: string
): Promise<string> {
  const { execSync } = await import('child_process')
  const { homedir } = await import('os')
  const { join, basename } = await import('path')
  const { existsSync } = await import('fs')

  // Determine target directory
  const projectsDir = join(homedir(), 'Projects')
  const defaultTarget = join(projectsDir, project.name)
  const target = targetDir || defaultTarget

  // Check if already exists
  if (existsSync(target)) {
    console.log(chalk.yellow(`\nDirectory already exists: ${target}`))
    return target
  }

  // Ensure Projects directory exists
  if (!existsSync(projectsDir)) {
    execSync(`mkdir -p "${projectsDir}"`)
  }

  const spinner = ora(`Cloning ${project.fullName}...`).start()

  try {
    // Prefer SSH if available, fall back to HTTPS
    const cloneUrl = project.sshUrl

    execSync(`git clone "${cloneUrl}" "${target}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    spinner.succeed(`Cloned to ${chalk.cyan(target)}`)

    return target
  } catch (error) {
    // Try HTTPS if SSH failed
    try {
      execSync(`git clone "${project.cloneUrl}" "${target}"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      spinner.succeed(`Cloned to ${chalk.cyan(target)}`)

      return target
    } catch (httpsError) {
      spinner.fail('Failed to clone repository')
      throw httpsError
    }
  }
}
