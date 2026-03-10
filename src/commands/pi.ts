/**
 * Pi Command
 *
 * Launches JFL in Pi AI agent runtime with full extension support.
 * Also handles 'jfl pi agents run' for spawning agent teams.
 *
 * @purpose CLI commands for Pi integration — launch, agent spawn, team management
 */

import chalk from "chalk"
import { spawn, execSync } from "child_process"
import { existsSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { parse as parseYaml } from "yaml"

interface PiOptions {
  yolo?: boolean
  mode?: string
  task?: string
}

interface AgentsRunOptions {
  team: string
  dryRun?: boolean
}

function findPiExtension(cwd: string): string {
  const candidates = [
    join(cwd, "node_modules", "@jfl", "pi", "dist", "index.js"),
    join(cwd, "packages", "pi", "dist", "index.js"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "pi", "dist", "index.js"),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "pi", "extensions", "index.ts")
}

function findPiSkills(cwd: string): string | null {
  const candidates = [
    join(cwd, "node_modules", "@jfl", "pi", "skills"),
    join(cwd, "packages", "pi", "skills"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "pi", "skills"),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

function hasPi(): boolean {
  try {
    execSync("which pi", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export async function piCommand(options: PiOptions, extraArgs: string[] = []): Promise<void> {
  if (!hasPi()) {
    console.log(chalk.red("\n  Pi is not installed"))
    console.log(chalk.gray("  Install: npm install -g @anthropic-ai/pi"))
    console.log(chalk.gray("  Or: brew install pi\n"))
    process.exit(1)
  }

  const cwd = process.cwd()
  const extensionPath = findPiExtension(cwd)
  const skillsPath = findPiSkills(cwd)

  const args: string[] = [
    "--extension", extensionPath,
  ]

  if (skillsPath) {
    args.push("--skill", skillsPath)
  }

  args.push("--theme", "jfl")

  if (options.yolo) args.push("--yolo")
  if (options.mode) args.push("--mode", options.mode)
  if (options.task) args.push("--task", options.task)

  args.push(...extraArgs)

  console.log(chalk.cyan("\n  Launching JFL in Pi...\n"))
  console.log(chalk.gray(`  Extension: ${extensionPath}`))
  if (skillsPath) console.log(chalk.gray(`  Skills: ${skillsPath}`))
  console.log()

  const proc = spawn("pi", args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, JFL_PI_MODE: "1" },
  })

  proc.on("exit", (code) => {
    process.exit(code ?? 0)
  })
}

interface TeamAgent {
  name: string
  role: string
  description?: string
  model?: string
  skills?: string[]
}

interface TeamConfig {
  name: string
  description?: string
  agents: TeamAgent[]
  orchestration?: {
    mode?: string
    extension?: string
  }
}

export async function piAgentsRunCommand(options: AgentsRunOptions): Promise<void> {
  if (!hasPi()) {
    console.log(chalk.red("\n  Pi is not installed. Install: npm install -g @anthropic-ai/pi\n"))
    process.exit(1)
  }

  const cwd = process.cwd()
  const teamPath = join(cwd, options.team)

  if (!existsSync(teamPath)) {
    const fallback = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "pi", "teams", options.team.split("/").pop() ?? "gtm-team.yaml")
    if (!existsSync(fallback)) {
      console.log(chalk.red(`\n  Team config not found: ${options.team}`))
      console.log(chalk.gray(`  Tried: ${teamPath}`))
      console.log(chalk.gray(`  Also tried: ${fallback}\n`))
      process.exit(1)
    }
  }

  const teamContent = readFileSync(existsSync(teamPath) ? teamPath : join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "pi", "teams", options.team.split("/").pop() ?? "gtm-team.yaml"), "utf-8")
  const team = parseYaml(teamContent) as TeamConfig

  const extensionPath = findPiExtension(cwd)
  const skillsPath = findPiSkills(cwd)

  console.log(chalk.cyan(`\n  Spawning ${team.name} (${team.agents.length} agents)...`))
  if (team.description) console.log(chalk.gray(`  ${team.description}`))
  console.log()

  if (options.dryRun) {
    for (const agent of team.agents) {
      console.log(chalk.white(`  [${agent.name}] ${agent.role}`))
      console.log(chalk.gray(`    Model: ${agent.model ?? "claude-sonnet-4-6"}`))
      const skills = agent.skills?.join(", ") ?? "none"
      console.log(chalk.gray(`    Skills: ${skills}`))
      const cmd = `pi --mode rpc --extension ${extensionPath} --yolo`
      console.log(chalk.gray(`    Command: ${cmd}`))
      console.log()
    }
    return
  }

  const procs: ReturnType<typeof spawn>[] = []

  for (const agent of team.agents) {
    const args = [
      "--mode", "rpc",
      "--extension", extensionPath,
      "--yolo",
    ]

    if (skillsPath) {
      args.push("--skill", skillsPath)
    }

    const env = {
      ...process.env,
      JFL_AGENT_NAME: agent.name,
      JFL_AGENT_ROLE: agent.role,
      JFL_AGENT_MODEL: agent.model ?? "claude-sonnet-4-6",
      JFL_PI_MODE: "1",
    }

    console.log(chalk.green(`  ● Starting ${agent.name} (${agent.role})`))

    const proc = spawn("pi", args, {
      cwd,
      stdio: "ignore",
      detached: true,
      env,
    })

    proc.unref()
    procs.push(proc)
  }

  console.log()
  console.log(chalk.green(`  ✓ ${procs.length} agents spawned`))
  console.log(chalk.gray("  Use /grid in a Pi session to monitor agent status"))
  console.log(chalk.gray("  Context Hub at :4242 — agents emit agent:health every 5s\n"))
}
