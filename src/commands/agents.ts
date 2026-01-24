import chalk from "chalk"
import ora from "ora"
import inquirer from "inquirer"
import { getAuthMethod, getToken, getX402Address, getUser, isAuthenticated } from "./login.js"
import { ensureDayPass } from "../utils/auth-guard.js"
import { getPlatformAuthHeaders } from "../utils/platform-auth.js"

const PLATFORM_URL = process.env.JFL_PLATFORM_URL || "https://jfl.run"
const X402_URL = process.env.X402_URL || "https://agent-main.402.cat"

interface Agent {
  id: string
  name: string
  observedState: string
  cpu: number
  memory: number
  createdAt: string
}

export async function agentsCommand(action?: string, options?: { name?: string; task?: string }) {
  // Check authentication
  if (!isAuthenticated()) {
    console.log(chalk.yellow("\nAuthentication required for parallel agents."))
    console.log(chalk.gray("Run 'jfl login' to authenticate."))
    return
  }

  const authMethod = getAuthMethod()

  // Check day pass for x402 users
  if (authMethod === "x402") {
    const dayPass = await ensureDayPass()
    if (!dayPass) {
      return
    }
  }

  // Check tier for platform auth
  if (authMethod === "github") {
    const user = getUser()
    if (user?.tier !== "PRO" && user?.tier !== "ENTERPRISE") {
      console.log(chalk.yellow("\n⚡ Parallel Agents - Pro Feature"))
      console.log(chalk.gray("\nParallel agents let you run multiple AI agents simultaneously."))
      console.log(chalk.gray("Each agent works on its own branch and can be assigned different tasks."))
      console.log(chalk.cyan(`\nUpgrade at: ${PLATFORM_URL}/dashboard/settings`))
      return
    }
  }

  // Route to action
  switch (action) {
    case "list":
    case undefined:
      await listAgents()
      break
    case "create":
      await createAgent(options?.name, options?.task)
      break
    case "start":
      await startAgent(options?.name)
      break
    case "stop":
      await stopAgent(options?.name)
      break
    case "destroy":
      await destroyAgent(options?.name)
      break
    default:
      console.log(chalk.bold("\n🤖 JFL - Parallel Agents\n"))
      console.log(chalk.gray("Usage:"))
      console.log("  jfl agents                 List all agents")
      console.log("  jfl agents create          Create a new agent")
      console.log("  jfl agents start -n <name> Start an agent")
      console.log("  jfl agents stop -n <name>  Stop an agent")
      console.log("  jfl agents destroy -n <name> Destroy an agent")
  }
}

async function listAgents() {
  console.log(chalk.bold("\n🤖 JFL - Parallel Agents\n"))

  const spinner = ora("Fetching agents...").start()

  try {
    const agents = await fetchAgents()

    if (agents.length === 0) {
      spinner.info("No agents found")
      console.log(chalk.gray("\nCreate your first agent:"))
      console.log("  jfl agents create")
      return
    }

    spinner.succeed(`Found ${agents.length} agent(s)`)
    console.log()

    const stateColors: Record<string, (s: string) => string> = {
      provisioning: chalk.yellow,
      running: chalk.green,
      stopped: chalk.gray,
      suspended: chalk.hex("#FFA500"),
      error: chalk.red,
      destroyed: chalk.gray,
    }

    for (const agent of agents) {
      const colorFn = stateColors[agent.observedState] || chalk.white
      const state = colorFn(agent.observedState.padEnd(12))
      console.log(`  ${state} ${chalk.white(agent.name)} (${agent.cpu} CPU, ${agent.memory}MB)`)
    }

    console.log()
  } catch (error) {
    spinner.fail("Failed to fetch agents")
    console.error(chalk.red(error))
  }
}

async function createAgent(name?: string, task?: string) {
  console.log(chalk.bold("\n🤖 JFL - Create Agent\n"))

  // Get agent name
  if (!name) {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Agent name:",
        validate: (input: string) => {
          if (!/^[a-z0-9-]+$/.test(input)) {
            return "Use lowercase letters, numbers, and hyphens only"
          }
          return true
        },
      },
    ])
    name = answer.name
  }

  // Get task
  if (!task) {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "task",
        message: "Task for agent:",
        validate: (input: string) => {
          if (!input.trim()) {
            return "Please provide a task"
          }
          return true
        },
      },
    ])
    task = answer.task
  }

  // Get resources
  const { cpu, memory } = await inquirer.prompt([
    {
      type: "list",
      name: "cpu",
      message: "CPU cores:",
      choices: [
        { name: "1 core (light tasks)", value: 1 },
        { name: "2 cores (standard)", value: 2 },
        { name: "4 cores (heavy tasks)", value: 4 },
      ],
      default: 1,
    },
    {
      type: "list",
      name: "memory",
      message: "Memory:",
      choices: [
        { name: "256 MB", value: 256 },
        { name: "512 MB", value: 512 },
        { name: "1024 MB", value: 1024 },
      ],
      default: 256,
    },
  ])

  const spinner = ora("Creating agent...").start()

  try {
    const authMethod = getAuthMethod()

    if (authMethod === "x402") {
      const x402Address = getX402Address()

      const res = await fetch(`${X402_URL}/v1/agents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-402-Account": x402Address!,
        },
        body: JSON.stringify({
          name,
          task,
          cpu,
          memory,
        }),
      })

      if (!res.ok) {
        const error = await res.text()
        throw new Error(error)
      }

      const agent = await res.json()
      spinner.succeed(`Agent created: ${agent.name}`)
    } else {
      const token = getToken()
      const platformAuthHeaders = getPlatformAuthHeaders()

      // Use platform auth if available, otherwise use legacy GitHub token
      const authHeaders = Object.keys(platformAuthHeaders).length > 0
        ? platformAuthHeaders
        : { Authorization: `Bearer ${token}` }

      const res = await fetch(`${PLATFORM_URL}/api/agents`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          task,
          cpu,
          memory,
        }),
      })

      if (!res.ok) {
        const error = await res.text()
        throw new Error(error)
      }

      const agent = await res.json()
      spinner.succeed(`Agent created: ${agent.name}`)
    }

    console.log(chalk.gray(`\nTask: ${task}`))
    console.log(chalk.gray(`Resources: ${cpu} CPU, ${memory}MB RAM`))
    console.log(chalk.cyan("\nStart with:"), `jfl agents start -n ${name}`)
    console.log()
  } catch (error) {
    spinner.fail("Failed to create agent")
    console.error(chalk.red(error))
  }
}

async function startAgent(name?: string) {
  if (!name) {
    const agents = await fetchAgents()
    const stoppedAgents = agents.filter((a) => a.observedState === "stopped")

    if (stoppedAgents.length === 0) {
      console.log(chalk.yellow("\nNo stopped agents to start."))
      return
    }

    const { selected } = await inquirer.prompt([
      {
        type: "list",
        name: "selected",
        message: "Select agent to start:",
        choices: stoppedAgents.map((a) => ({ name: a.name, value: a.id })),
      },
    ])
    name = selected
  }

  const spinner = ora("Starting agent...").start()

  try {
    await agentAction(name!, "start")
    spinner.succeed("Agent started!")
  } catch (error) {
    spinner.fail("Failed to start agent")
    console.error(chalk.red(error))
  }
}

async function stopAgent(name?: string) {
  if (!name) {
    const agents = await fetchAgents()
    const runningAgents = agents.filter((a) => a.observedState === "running")

    if (runningAgents.length === 0) {
      console.log(chalk.yellow("\nNo running agents to stop."))
      return
    }

    const { selected } = await inquirer.prompt([
      {
        type: "list",
        name: "selected",
        message: "Select agent to stop:",
        choices: runningAgents.map((a) => ({ name: a.name, value: a.id })),
      },
    ])
    name = selected
  }

  const spinner = ora("Stopping agent...").start()

  try {
    await agentAction(name!, "stop")
    spinner.succeed("Agent stopped!")
  } catch (error) {
    spinner.fail("Failed to stop agent")
    console.error(chalk.red(error))
  }
}

async function destroyAgent(name?: string) {
  if (!name) {
    const agents = await fetchAgents()

    if (agents.length === 0) {
      console.log(chalk.yellow("\nNo agents to destroy."))
      return
    }

    const { selected } = await inquirer.prompt([
      {
        type: "list",
        name: "selected",
        message: "Select agent to destroy:",
        choices: agents.map((a) => ({
          name: `${a.name} (${a.observedState})`,
          value: a.id,
        })),
      },
    ])

    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: "Are you sure? This cannot be undone.",
        default: false,
      },
    ])

    if (!confirm) {
      console.log(chalk.gray("Cancelled."))
      return
    }

    name = selected
  }

  const spinner = ora("Destroying agent...").start()

  try {
    await agentAction(name!, "destroy")
    spinner.succeed("Agent destroyed!")
  } catch (error) {
    spinner.fail("Failed to destroy agent")
    console.error(chalk.red(error))
  }
}

async function fetchAgents(): Promise<Agent[]> {
  const authMethod = getAuthMethod()

  if (authMethod === "x402") {
    const x402Address = getX402Address()
    const res = await fetch(`${X402_URL}/v1/agents?account_id=${x402Address}`)

    if (!res.ok) {
      throw new Error("Failed to fetch agents")
    }

    const data = await res.json()
    return data.agents || []
  } else {
    const token = getToken()
    const platformAuthHeaders = getPlatformAuthHeaders()

    // Use platform auth if available, otherwise use legacy GitHub token
    const authHeaders = Object.keys(platformAuthHeaders).length > 0
      ? platformAuthHeaders
      : { Authorization: `Bearer ${token}` }

    const res = await fetch(`${PLATFORM_URL}/api/agents`, {
      headers: authHeaders,
    })

    if (!res.ok) {
      throw new Error("Failed to fetch agents")
    }

    const data = await res.json()
    return data.agents || []
  }
}

async function agentAction(agentId: string, action: "start" | "stop" | "destroy") {
  const authMethod = getAuthMethod()

  if (authMethod === "x402") {
    const x402Address = getX402Address()

    if (action === "destroy") {
      const res = await fetch(`${X402_URL}/v1/agents/${agentId}`, {
        method: "DELETE",
        headers: {
          "X-402-Account": x402Address!,
        },
      })

      if (!res.ok) {
        throw new Error("Failed to destroy agent")
      }
    } else {
      const res = await fetch(`${X402_URL}/v1/agents/${agentId}/${action}`, {
        method: "POST",
        headers: {
          "X-402-Account": x402Address!,
        },
      })

      if (!res.ok) {
        throw new Error(`Failed to ${action} agent`)
      }
    }
  } else {
    const token = getToken()
    const platformAuthHeaders = getPlatformAuthHeaders()

    // Use platform auth if available, otherwise use legacy GitHub token
    const authHeaders = Object.keys(platformAuthHeaders).length > 0
      ? platformAuthHeaders
      : { Authorization: `Bearer ${token}` }

    if (action === "destroy") {
      const res = await fetch(`${PLATFORM_URL}/api/agents/${agentId}`, {
        method: "DELETE",
        headers: authHeaders,
      })

      if (!res.ok) {
        throw new Error("Failed to destroy agent")
      }
    } else {
      const res = await fetch(`${PLATFORM_URL}/api/agents/${agentId}/${action}`, {
        method: "POST",
        headers: authHeaders,
      })

      if (!res.ok) {
        throw new Error(`Failed to ${action} agent`)
      }
    }
  }
}
