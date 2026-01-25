import chalk from "chalk"
import ora from "ora"
import inquirer from "inquirer"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import { getAuthMethod, getToken, getX402Address, isAuthenticated } from "./login.js"
import { ensureDayPass } from "../utils/auth-guard.js"
import { getPlatformAuthHeaders } from "../utils/platform-auth.js"
import {
  getGitStatus,
  initializeGit,
  createInitialCommit,
  addGitRemote,
  pushToRemote,
  parseGitHubUrl,
} from "../utils/git.js"
import { createGitHubRepo, promptGitHubAppInstall } from "../utils/github-repo.js"
import { isGitHubAuthenticated } from "../utils/github-auth.js"

const PLATFORM_URL = process.env.JFL_PLATFORM_URL || "https://jfl.run"

export async function deployCommand(options?: { force?: boolean; dryRun?: boolean }) {
  console.log(chalk.bold(options?.dryRun ? "\n🔍 JFL - Deploy (Dry Run)\n" : "\n🚀 JFL - Deploy\n"))

  const cwd = process.cwd()

  // Check if in a JFL project
  const hasJflConfig = existsSync(join(cwd, "CLAUDE.md")) || existsSync(join(cwd, "knowledge"))

  if (!hasJflConfig) {
    console.log(chalk.red("Not in a JFL project directory."))
    console.log(chalk.gray("\nTo create a new project:"))
    console.log("  jfl init")
    return
  }

  // Dry run mode - show what would happen
  if (options?.dryRun) {
    return await showDeployPlan(cwd)
  }

  // Check authentication
  if (!isAuthenticated()) {
    console.log(chalk.yellow("Authentication required to deploy."))
    console.log(chalk.gray("\nRun 'jfl login' to authenticate."))
    return
  }

  // Check day pass for x402 users
  const authMethod = getAuthMethod()
  if (authMethod === "x402") {
    const dayPass = await ensureDayPass()
    if (!dayPass) {
      return
    }
  }

  // Get project info
  const projectName = getProjectName(cwd)
  console.log(chalk.gray(`Project: ${projectName}`))

  // Auto-setup git repository
  console.log(chalk.bold("\n📦 Setting up deployment...\n"))

  const gitStatus = getGitStatus(cwd)

  // 1. Initialize git if needed
  if (!gitStatus.isRepo) {
    console.log(chalk.gray("Initializing git repository..."))
    initializeGit(cwd)
  }

  // 2. Create initial commit if needed
  if (!gitStatus.hasCommits) {
    console.log(chalk.gray("Creating initial commit..."))
    createInitialCommit(cwd)
  }

  // Get current branch
  const branch = gitStatus.branch || "main"
  console.log(chalk.gray(`Branch: ${branch}`))

  // Check for uncommitted changes (after initial commit)
  const updatedGitStatus = getGitStatus(cwd)
  if (updatedGitStatus.uncommittedChanges && !options?.force) {
    console.log(chalk.yellow("\n⚠️  Uncommitted changes detected"))
    const { proceed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "proceed",
        message: "Deploy anyway?",
        default: false,
      },
    ])
    if (!proceed) {
      console.log(chalk.gray("\nCommit your changes first, then deploy."))
      console.log(chalk.dim("  git add ."))
      console.log(chalk.dim(`  git commit -m "your message"`))
      console.log(chalk.dim("  jfl deploy"))
      return
    }
  }

  // 3. Create GitHub repo and add remote if needed
  let remoteUrl = updatedGitStatus.remoteUrl

  if (!updatedGitStatus.hasRemote) {
    // Check GitHub auth
    if (!isGitHubAuthenticated()) {
      console.log(chalk.yellow("\n⚠️  GitHub authentication required to create repository"))
      console.log(chalk.gray("\nRun 'jfl login' to authenticate with GitHub."))
      return
    }

    console.log(chalk.gray("\nNo git remote found. Creating GitHub repository..."))

    try {
      const { url } = await createGitHubRepo(cwd)
      remoteUrl = url

      // Add remote
      addGitRemote(cwd, url)

      // Push to remote
      await pushToRemote(cwd)

      console.log(chalk.green(`\n✓ Repository created and code pushed!`))
    } catch (error) {
      console.error(chalk.red("\nFailed to create GitHub repository:"))
      console.error(chalk.red(String(error)))
      return
    }
  } else {
    console.log(chalk.gray(`Remote: ${remoteUrl}`))
  }

  // Verify we have a remote URL
  if (!remoteUrl) {
    console.error(chalk.red("\n⚠️  No git remote configured"))
    console.log(chalk.gray("Please configure a git remote and try again."))
    return
  }

  // 4. Check GitHub App installation
  const repoInfo = parseGitHubUrl(remoteUrl)
  if (repoInfo && authMethod === "platform") {
    console.log(chalk.gray("\nChecking GitHub App installation..."))

    try {
      const installationId = await promptGitHubAppInstall(repoInfo.owner, repoInfo.repo)

      if (!installationId) {
        console.log(chalk.yellow("\n⚠️  GitHub App installation required for deployment"))
        console.log(chalk.gray("\nPlease install the GitHub App and try again."))
        return
      }
    } catch (error) {
      console.error(chalk.red("\nFailed to check GitHub App installation:"))
      console.error(chalk.red(String(error)))
      // Continue anyway - the platform might handle this differently
    }
  }

  // Deploy based on auth method
  const spinner = ora("Preparing deployment...").start()

  try {
    if (authMethod === "x402") {
      await deployWithX402(projectName, remoteUrl, branch, spinner)
    } else {
      await deployWithPlatform(projectName, remoteUrl, branch, spinner)
    }
  } catch (error) {
    spinner.fail("Deployment failed")
    console.error(chalk.red(error))
  }
}

async function deployWithX402(
  projectName: string,
  repoUrl: string,
  branch: string,
  spinner: ReturnType<typeof ora>
) {
  const x402Address = getX402Address()

  spinner.text = "Checking x402 balance..."

  const X402_URL = process.env.X402_URL || "https://agent-main.402.cat"

  // Check balance
  const balanceRes = await fetch(`${X402_URL}/v1/billing/balance?account_id=${x402Address}`)

  if (!balanceRes.ok) {
    spinner.fail("x402 wallet not found")
    console.log(chalk.yellow("\nSet up your wallet at https://402.cat"))
    return
  }

  const { balanceUsdc } = await balanceRes.json()
  const balance = parseFloat(balanceUsdc)

  if (balance < 5) {
    spinner.fail("Insufficient balance")
    console.log(chalk.yellow(`\nBalance: $${balanceUsdc} USDC`))
    console.log(chalk.gray("Minimum $5 required for deployment"))
    console.log(chalk.gray("Top up at: https://402.cat"))
    return
  }

  spinner.text = "Creating deployment..."

  // Deploy via x402 agent
  const deployRes = await fetch(`${X402_URL}/v1/agents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-402-Account": x402Address!,
    },
    body: JSON.stringify({
      name: `${projectName}-deploy`,
      repo_url: repoUrl,
      branch,
      cpu: 1,
      memory: 256,
      env: {},
    }),
  })

  if (!deployRes.ok) {
    const error = await deployRes.text()
    throw new Error(`Deployment failed: ${error}`)
  }

  const agent = await deployRes.json()

  spinner.succeed("Deployment created!")

  console.log(chalk.bold.green("\n✅ Deployed!\n"))
  console.log(chalk.gray("Agent ID:"), agent.id)
  console.log(chalk.gray("Status:"), agent.observedState)
  console.log(chalk.cyan("\nView at:"), `https://402.cat/agents/${agent.id}`)
  console.log()
}

async function deployWithPlatform(
  projectName: string,
  repoUrl: string,
  branch: string,
  spinner: ReturnType<typeof ora>
) {
  const token = getToken()
  const platformAuthHeaders = getPlatformAuthHeaders()

  // Use platform auth if available, otherwise use legacy GitHub token
  const authHeaders = Object.keys(platformAuthHeaders).length > 0
    ? platformAuthHeaders
    : { Authorization: `Bearer ${token}` }

  spinner.text = "Connecting to platform..."

  // First, find or create the project on the platform
  const projectsRes = await fetch(`${PLATFORM_URL}/api/projects`, {
    headers: authHeaders,
  })

  if (!projectsRes.ok) {
    throw new Error("Failed to connect to platform")
  }

  const { projects } = await projectsRes.json()
  let project = projects.find((p: { name: string }) => p.name === projectName)

  if (!project) {
    spinner.text = "Creating project on platform..."

    const createRes = await fetch(`${PLATFORM_URL}/api/projects`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName,
        slug: projectName.toLowerCase().replace(/[^a-z0-9]/g, "-"),
        repoUrl,
      }),
    })

    if (!createRes.ok) {
      throw new Error("Failed to create project")
    }

    project = await createRes.json()
  }

  spinner.text = "Triggering deployment..."

  // Trigger deploy
  const deployRes = await fetch(`${PLATFORM_URL}/api/projects/${project.id}/deploy`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      branch,
      commitSha: getCommitSha(),
    }),
  })

  if (!deployRes.ok) {
    const error = await deployRes.text()
    throw new Error(`Deployment failed: ${error}`)
  }

  const deployment = await deployRes.json()

  spinner.succeed("Deployment complete!")

  console.log(chalk.bold.green("\n✅ Your GTM is now deployed!\n"))
  console.log(chalk.gray("Project ID:"), project.id)
  console.log(chalk.gray("Project:"), project.slug)
  console.log(chalk.gray("Status:"), deployment.status)

  console.log(chalk.bold("\n📦 Access your GTM container:\n"))
  console.log(chalk.cyan("  Web UI:"), `${PLATFORM_URL}/demos/jfl-runner?project=${project.id}`)
  console.log(chalk.cyan("  Dashboard:"), `${PLATFORM_URL}/dashboard/${project.slug}`)

  console.log(chalk.bold("\n🚀 Start a session:\n"))
  console.log(chalk.gray("  jfl session --project"), project.id)
  console.log()
}

function getProjectName(cwd: string): string {
  // Try to get from package.json
  const pkgPath = join(cwd, "package.json")
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
      if (pkg.name) return pkg.name
    } catch {
      // ignore
    }
  }

  // Fall back to directory name
  return cwd.split("/").pop() || "unknown"
}

function getCommitSha(): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim()
  } catch {
    return undefined
  }
}

/**
 * Show deployment plan (dry run)
 */
async function showDeployPlan(cwd: string): Promise<void> {
  const projectName = getProjectName(cwd)
  const gitStatus = getGitStatus(cwd)

  console.log(chalk.bold("Deployment Plan:\n"))

  // Project info
  console.log(chalk.cyan("Project:"), projectName)

  // Git status
  console.log(chalk.bold("\n📦 Git Status:\n"))

  if (!gitStatus.isRepo) {
    console.log(chalk.yellow("  ⚠  Not a git repository"))
    console.log(chalk.gray("     → Will initialize git"))
  } else {
    console.log(chalk.green("  ✓ Git repository exists"))
  }

  if (!gitStatus.hasCommits) {
    console.log(chalk.yellow("  ⚠  No commits"))
    console.log(chalk.gray("     → Will create initial commit"))
  } else {
    console.log(chalk.green(`  ✓ Has commits (branch: ${gitStatus.branch})`))
  }

  if (gitStatus.uncommittedChanges) {
    console.log(chalk.yellow("  ⚠  Uncommitted changes detected"))
    console.log(chalk.gray("     → Will ask for confirmation"))
  } else {
    console.log(chalk.green("  ✓ Working directory clean"))
  }

  // GitHub status
  console.log(chalk.bold("\n🔗 GitHub Status:\n"))

  if (!gitStatus.hasRemote) {
    if (!isGitHubAuthenticated()) {
      console.log(chalk.red("  ✗ No GitHub authentication"))
      console.log(chalk.gray("     → Run 'jfl login' first"))
      return
    }

    console.log(chalk.yellow("  ⚠  No git remote"))
    console.log(chalk.gray(`     → Will create GitHub repo: ${projectName}`))
    console.log(chalk.gray("     → Will push code to GitHub"))

    const authMethod = getAuthMethod()
    if (authMethod === "platform") {
      console.log(chalk.gray("     → Will check GitHub App installation"))
    }
  } else {
    console.log(chalk.green(`  ✓ Remote configured`))
    console.log(chalk.gray(`     ${gitStatus.remoteUrl}`))

    const repoInfo = parseGitHubUrl(gitStatus.remoteUrl!)
    if (repoInfo) {
      const authMethod = getAuthMethod()
      if (authMethod === "platform") {
        console.log(chalk.gray("     → Will verify GitHub App installation"))
      }
    }
  }

  // Deployment
  console.log(chalk.bold("\n🚀 Deployment:\n"))

  const authMethod = getAuthMethod()
  if (authMethod === "x402") {
    console.log(chalk.gray("  → Will deploy via x402 agent"))
    console.log(chalk.gray("  → Cost: ~$5/month for hosting"))
  } else {
    console.log(chalk.gray("  → Will deploy to JFL platform"))
    console.log(chalk.gray("  → Will create/update project"))
    console.log(chalk.gray("  → Will trigger deployment"))
  }

  // Next steps
  console.log(chalk.bold("\n✨ What happens next:\n"))
  console.log(chalk.gray("  1. Git repo setup (if needed)"))
  console.log(chalk.gray("  2. GitHub repo creation (if needed)"))
  console.log(chalk.gray("  3. GitHub App installation check (if using platform)"))
  console.log(chalk.gray("  4. Platform deployment"))
  console.log(chalk.gray("  5. Access via web UI or Telegram"))

  console.log(chalk.bold("\n▶ To proceed with deployment:\n"))
  console.log(chalk.cyan("  jfl deploy"))
  console.log()
}
