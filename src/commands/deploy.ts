import chalk from "chalk"
import ora from "ora"
import inquirer from "inquirer"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import { getAuthMethod, getToken, getX402Address, isAuthenticated } from "./login.js"
import { ensureDayPass } from "../utils/auth-guard.js"

const PLATFORM_URL = process.env.JFL_PLATFORM_URL || "https://jfl.run"

export async function deployCommand(options?: { force?: boolean }) {
  console.log(chalk.bold("\n🚀 JFL - Deploy\n"))

  const cwd = process.cwd()

  // Check if in a JFL project
  const hasJflConfig = existsSync(join(cwd, "CLAUDE.md")) || existsSync(join(cwd, "knowledge"))

  if (!hasJflConfig) {
    console.log(chalk.red("Not in a JFL project directory."))
    console.log(chalk.gray("\nTo create a new project:"))
    console.log("  jfl init")
    return
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

  // Check for uncommitted changes
  try {
    const status = execSync("git status --porcelain", { cwd, encoding: "utf-8" })
    if (status && !options?.force) {
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
        console.log(chalk.gray("Commit your changes first, then deploy."))
        return
      }
    }
  } catch {
    // Not a git repo or git not available
  }

  // Get current branch
  let branch = "main"
  try {
    branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf-8" }).trim()
  } catch {
    // Default to main
  }

  console.log(chalk.gray(`Branch: ${branch}`))

  // Check for remote
  let remoteUrl = ""
  try {
    remoteUrl = execSync("git remote get-url origin", { cwd, encoding: "utf-8" }).trim()
    console.log(chalk.gray(`Remote: ${remoteUrl}`))
  } catch {
    console.log(chalk.yellow("\n⚠️  No git remote configured"))
    console.log(chalk.gray("Add a remote to enable deployments:"))
    console.log(chalk.gray("  git remote add origin <your-repo-url>"))
    return
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

  spinner.text = "Connecting to platform..."

  // First, find or create the project on the platform
  const projectsRes = await fetch(`${PLATFORM_URL}/api/projects`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
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
        Authorization: `Bearer ${token}`,
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
      Authorization: `Bearer ${token}`,
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

  spinner.succeed("Deployment triggered!")

  console.log(chalk.bold.green("\n✅ Deployed!\n"))
  console.log(chalk.gray("Project:"), project.slug)
  console.log(chalk.gray("Deployment:"), deployment.id)
  console.log(chalk.gray("Status:"), deployment.status)
  console.log(chalk.cyan("\nView at:"), `${PLATFORM_URL}/dashboard/${project.slug}`)
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
