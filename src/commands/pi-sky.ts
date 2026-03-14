import chalk from "chalk"
import { existsSync, readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"
import { parse as parseYaml } from "yaml"

function findPiExtension(cwd: string): string {
  const candidates = [
    join(cwd, "node_modules", "@jfl", "pi", "dist", "index.js"),
    join(cwd, "packages", "pi", "dist", "index.js"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "pi", "dist", "index.js"),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "pi", "extensions", "index.ts")
}

function findPiSkills(cwd: string): string | undefined {
  const candidates = [
    join(cwd, "node_modules", "@jfl", "pi", "skills"),
    join(cwd, "packages", "pi", "skills"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "pi", "skills"),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return undefined
}

function findPiTheme(cwd: string): string | undefined {
  const candidates = [
    join(cwd, "node_modules", "@jfl", "pi", "themes", "jfl.theme.json"),
    join(cwd, "packages", "pi", "themes", "jfl.theme.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "pi", "themes", "jfl.theme.json"),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return undefined
}

function hasPi(): boolean {
  try {
    execSync("which pi", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function readHubUrl(cwd: string): string {
  try {
    const configPath = join(cwd, ".jfl", "config.json")
    if (!existsSync(configPath)) return "http://localhost:4242"
    const config = JSON.parse(readFileSync(configPath, "utf-8"))
    const port = config.contextHub?.port ?? 4242
    return `http://localhost:${port}`
  } catch {
    return "http://localhost:4242"
  }
}

interface RunOptions {
  task: string
  budget?: string
  model?: string
  yolo?: boolean
}

export async function piSkyRun(options: RunOptions): Promise<void> {
  if (!hasPi()) {
    console.log(chalk.red("\n  Pi is not installed. Install: npm install -g @mariozechner/pi-coding-agent\n"))
    process.exit(1)
  }

  const cwd = process.cwd()
  const { PiRpcBridge } = await import("../lib/pi-sky/bridge.js")
  const { CostMonitor } = await import("../lib/pi-sky/cost-monitor.js")
  const { EventRouter } = await import("../lib/pi-sky/event-router.js")

  const extensionPath = findPiExtension(cwd)
  const skillsPath = findPiSkills(cwd)
  const themePath = findPiTheme(cwd)
  const hubUrl = readHubUrl(cwd)

  console.log(chalk.cyan("\n  ⚡ Pi in the Sky — Single Agent\n"))
  console.log(chalk.gray(`  Extension: ${extensionPath}`))
  console.log(chalk.gray(`  Hub: ${hubUrl}`))
  if (options.budget) console.log(chalk.gray(`  Budget: $${options.budget}`))
  console.log()

  const bridge = new PiRpcBridge({
    extensionPath,
    skillsPath,
    themePath,
    yolo: options.yolo ?? true,
    model: options.model,
    cwd,
    env: { JFL_PI_MODE: "1" },
  })

  const router = new EventRouter({ hubUrl })
  router.on("error", () => {})
  router.registerBridge("agent", bridge)

  let costMonitor: InstanceType<typeof CostMonitor> | null = null
  if (options.budget) {
    costMonitor = new CostMonitor({ maxCost: parseFloat(options.budget) })
    costMonitor.registerBridge("agent", bridge)
    costMonitor.on("downgrade", (data: any) => {
      console.log(chalk.yellow(`\n  ⚠ Budget exceeded — downgraded to ${data.model} (thinking: ${data.thinking})`))
    })
    costMonitor.on("upgrade", (data: any) => {
      console.log(chalk.green(`\n  ↑ Critical path — upgraded to ${data.model}`))
    })
  }


  bridge.on("exit", () => {
    router.stop()
    process.exit(0)
  })

  try {
    await bridge.start()

    try {
      await router.startSse()
    } catch {
      await router.startPolling().catch(() => {})
    }

    const waitForIdle = () => new Promise<void>((resolve) => {
      let idleTimer: ReturnType<typeof setTimeout> | null = null

      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          resolve()
        }, 5000)
      }

      bridge.on("message_update", resetIdle)
      bridge.on("tool_execution_start", resetIdle)
      bridge.on("tool_execution_end", resetIdle)
      bridge.on("turn_start", resetIdle)
      bridge.on("turn_end", resetIdle)
      bridge.on("agent_end", () => {
        if (idleTimer) clearTimeout(idleTimer)
        resolve()
      })

      resetIdle()
    })

    process.stdout.write(chalk.gray("  Warming up JFL context..."))
    await waitForIdle()
    process.stdout.write(chalk.green(" ready\n\n"))

    bridge.removeAllListeners("message_update")
    bridge.removeAllListeners("tool_execution_start")
    bridge.removeAllListeners("tool_execution_end")
    bridge.removeAllListeners("turn_start")
    bridge.removeAllListeners("turn_end")
    bridge.removeAllListeners("agent_end")

    bridge.on("message_update", (event: any) => {
      const delta = event.assistantMessageEvent
      if (delta?.type === "text_delta" && delta.delta) {
        process.stdout.write(delta.delta)
      }
    })

    bridge.on("tool_execution_start", (event: any) => {
      console.log(chalk.gray(`\n  ▸ ${event.toolName}: ${JSON.stringify(event.args ?? {}).slice(0, 80)}`))
    })

    const taskDone = new Promise<void>((resolve) => {
      let idleTimer: ReturnType<typeof setTimeout> | null = null
      const finish = () => {
        if (idleTimer) clearTimeout(idleTimer)
        resolve()
      }

      bridge.on("agent_end", finish)

      bridge.on("turn_end", () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(finish, 3000)
      })
    })

    await bridge.prompt(options.task)
    await taskDone

    console.log(chalk.green("\n\n  ✓ Done"))
    if (costMonitor) {
      await costMonitor.checkAll()
      console.log(chalk.gray(`  Cost: $${costMonitor.totalCost.toFixed(4)} / $${costMonitor.budget.toFixed(2)}`))
    }
    console.log()

    router.stop()
    await bridge.shutdown().catch(() => {})
  } catch (err: any) {
    console.error(chalk.red(`\n  Error: ${err.message}\n`))
    await bridge.shutdown().catch(() => {})
    process.exit(1)
  }
}

interface SwarmCommandOptions {
  team: string
  budget?: string
  dryRun?: boolean
}

export async function piSkySwarm(options: SwarmCommandOptions): Promise<void> {
  if (!hasPi()) {
    console.log(chalk.red("\n  Pi is not installed. Install: npm install -g @mariozechner/pi-coding-agent\n"))
    process.exit(1)
  }

  const cwd = process.cwd()
  const { PiSwarm } = await import("../lib/pi-sky/swarm.js")

  const extensionPath = findPiExtension(cwd)
  const skillsPath = findPiSkills(cwd)
  const themePath = findPiTheme(cwd)
  const hubUrl = readHubUrl(cwd)

  let teamPath = join(cwd, options.team)
  if (!existsSync(teamPath)) {
    teamPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "pi", "teams", options.team.split("/").pop() ?? "")
    if (!existsSync(teamPath)) {
      console.log(chalk.red(`\n  Team config not found: ${options.team}\n`))
      process.exit(1)
    }
  }

  const teamContent = readFileSync(teamPath, "utf-8")
  const team = parseYaml(teamContent) as { name: string; description?: string; agents: Array<{ name: string; role: string; model?: string; skills?: string[] }> }

  console.log(chalk.cyan(`\n  ⚡ Pi in the Sky — Swarm: ${team.name}\n`))
  if (team.description) console.log(chalk.gray(`  ${team.description}`))
  console.log(chalk.gray(`  Agents: ${team.agents.length}`))
  console.log(chalk.gray(`  Hub: ${hubUrl}`))
  if (options.budget) console.log(chalk.gray(`  Budget: $${options.budget}`))
  console.log()

  if (options.dryRun) {
    for (const agent of team.agents) {
      console.log(chalk.white(`  [${agent.name}] ${agent.role}`))
      console.log(chalk.gray(`    Model: ${agent.model ?? "default"}`))
      console.log(chalk.gray(`    Skills: ${agent.skills?.join(", ") ?? "none"}`))
      console.log()
    }
    console.log(chalk.gray("  (dry run — no agents spawned)\n"))
    return
  }

  const swarm = new PiSwarm({
    agents: team.agents.map(a => ({
      name: a.name,
      role: a.role,
      model: a.model,
      skills: a.skills,
    })),
    extensionPath,
    skillsPath,
    themePath,
    costBudget: options.budget ? parseFloat(options.budget) : undefined,
    hubUrl,
    yolo: true,
  })

  swarm.on("agent_spawned", (data: any) => {
    console.log(chalk.green(`  ● ${data.name} (${data.role}) — pid ${data.pid}`))
  })

  swarm.on("agent_message", (data: any) => {
    const delta = data.event?.assistantMessageEvent
    if (delta?.type === "text_delta" && delta.delta) {
      process.stdout.write(chalk.gray(`[${data.name}] `) + delta.delta)
    }
  })

  swarm.on("agent_tool", (data: any) => {
    if (data.phase === "start") {
      console.log(chalk.gray(`  [${data.name}] ▸ ${data.event.toolName}`))
    }
  })

  swarm.on("agent_exit", (data: any) => {
    console.log(chalk.yellow(`  ○ ${data.name} exited (code ${data.code})`))
  })

  swarm.on("cost_downgrade", (data: any) => {
    console.log(chalk.yellow(`  ⚠ ${data.agent} downgraded to ${data.model}`))
  })

  swarm.on("event_routed", (data: any) => {
    console.log(chalk.magenta(`  ⚡ Event routed: ${data.event.type} → ${data.route.action}`))
  })

  process.on("SIGINT", async () => {
    console.log(chalk.yellow("\n\n  Shutting down swarm..."))
    await swarm.shutdown()
    process.exit(0)
  })

  try {
    await swarm.start()

    console.log(chalk.green(`\n  ✓ ${swarm.agentCount} agents running\n`))
    console.log(chalk.gray("  Ctrl+C to shutdown. Agents are connected to MAP event bus.\n"))

    await new Promise(() => {})
  } catch (err: any) {
    console.error(chalk.red(`\n  Error: ${err.message}\n`))
    await swarm.shutdown().catch(() => {})
    process.exit(1)
  }
}

interface DashboardOptions {
  // future: refresh interval, filter patterns, etc.
}

export async function piSkyDashboard(_options: DashboardOptions): Promise<void> {
  console.log(chalk.cyan("\n  ⚡ Pi in the Sky — Dashboard\n"))
  console.log(chalk.gray("  Dashboard not yet implemented. Use:"))
  console.log(chalk.gray("    jfl context-hub dashboard    (web)"))
  console.log(chalk.gray("    jfl viz dash                 (terminal)"))
  console.log(chalk.gray("    jfl events                   (live events)\n"))
}

interface VoiceOptions {
  device?: string
  mode?: string
}

export async function piSkyVoice(options: VoiceOptions): Promise<void> {
  if (!hasPi()) {
    console.log(chalk.red("\n  Pi is not installed.\n"))
    process.exit(1)
  }

  const cwd = process.cwd()
  const { PiRpcBridge } = await import("../lib/pi-sky/bridge.js")
  const { VoiceBridge } = await import("../lib/pi-sky/voice-bridge.js")

  const extensionPath = findPiExtension(cwd)
  const skillsPath = findPiSkills(cwd)

  console.log(chalk.cyan("\n  ⚡ Pi in the Sky — Voice Copilot\n"))

  const bridge = new PiRpcBridge({
    extensionPath,
    skillsPath,
    yolo: true,
    cwd,
    env: { JFL_PI_MODE: "1" },
  })

  await bridge.start()

  bridge.on("message_update", (event: any) => {
    const delta = event.assistantMessageEvent
    if (delta?.type === "text_delta" && delta.delta) {
      process.stdout.write(delta.delta)
    }
  })

  const voice = new VoiceBridge(bridge, {
    device: options.device,
    mode: (options.mode as "steer" | "follow_up" | "prompt") ?? "steer",
  })

  voice.on("transcription", (text: string) => {
    console.log(chalk.cyan(`\n  🎙 "${text}"`))
  })

  voice.on("sent", (data: any) => {
    console.log(chalk.gray(`  → ${data.mode}: sent to agent`))
  })

  voice.on("error", (err: any) => {
    console.log(chalk.red(`  Voice error: ${err.message}`))
  })

  process.on("SIGINT", async () => {
    voice.stop()
    await bridge.shutdown()
    process.exit(0)
  })

  await voice.start()
  console.log(chalk.green("  ✓ Listening... Speak to steer the agent. Ctrl+C to stop.\n"))
}

interface EvalSweepOptions {
  concurrency?: string
}

export async function piSkyEvalSweep(options: EvalSweepOptions): Promise<void> {
  if (!hasPi()) {
    console.log(chalk.red("\n  Pi is not installed.\n"))
    process.exit(1)
  }

  const cwd = process.cwd()
  const { EvalSweep } = await import("../lib/pi-sky/eval-sweep.js")

  const hubUrl = readHubUrl(cwd)
  const concurrency = options.concurrency ? parseInt(options.concurrency) : 4

  console.log(chalk.cyan("\n  ⚡ Pi in the Sky — Eval Sweep\n"))
  console.log(chalk.gray(`  Concurrency: ${concurrency}`))
  console.log(chalk.gray(`  Hub: ${hubUrl}`))
  console.log()

  const sweep = new EvalSweep({
    concurrency,
    hubUrl,
    bridgeOptions: { yolo: true },
  })

  sweep.on("start", (data: any) => {
    console.log(chalk.white(`  Sweeping ${data.services.length} services...\n`))
  })

  sweep.on("service_start", (data: any) => {
    console.log(chalk.gray(`  ▸ ${data.service} (${data.path})`))
  })

  sweep.on("service_end", (data: any) => {
    const icon = data.success ? chalk.green("✓") : chalk.red("✗")
    const time = `${(data.durationMs / 1000).toFixed(1)}s`
    console.log(`  ${icon} ${data.service} — ${time}`)
  })

  sweep.on("complete", (data: any) => {
    const passed = data.results.filter((r: any) => r.success).length
    const total = data.results.length
    console.log(chalk.green(`\n  ✓ Sweep complete: ${passed}/${total} passed\n`))
  })

  const results = await sweep.sweep(cwd)

  if (results.length === 0) {
    console.log(chalk.yellow("  No services found. Register services with: jfl onboard <path>\n"))
  }
}

interface ExperimentOptions {
  prompt: string
  variants: string
  eval?: string
  model?: string
}

export async function piSkyExperiment(options: ExperimentOptions): Promise<void> {
  if (!hasPi()) {
    console.log(chalk.red("\n  Pi is not installed.\n"))
    process.exit(1)
  }

  const cwd = process.cwd()
  const { ExperimentRunner } = await import("../lib/pi-sky/experiment.js")

  const extensionPath = findPiExtension(cwd)
  const variants = options.variants.split(",").map(v => v.trim())

  console.log(chalk.cyan("\n  ⚡ Pi in the Sky — A/B Experiment\n"))
  console.log(chalk.gray(`  Prompt: ${options.prompt.slice(0, 60)}...`))
  console.log(chalk.gray(`  Variants: ${variants.join(", ")}`))
  if (options.eval) console.log(chalk.gray(`  Eval: ${options.eval.slice(0, 60)}...`))
  console.log()

  const runner = new ExperimentRunner({
    extensionPath,
    yolo: true,
    noSession: true,
    model: options.model,
    cwd,
  })

  runner.on("variant_start", (data: any) => {
    console.log(chalk.white(`  [${data.current}/${data.total}] Testing: ${data.variant}`))
  })

  runner.on("variant_end", (data: any) => {
    const score = data.result.score != null ? ` — score: ${data.result.score}` : ""
    const cost = data.result.stats?.cost ? ` ($${data.result.stats.cost.toFixed(4)})` : ""
    console.log(chalk.gray(`    ✓ Complete${score}${cost}`))
  })

  runner.on("complete", (data: any) => {
    console.log(chalk.green(`\n  ✓ Winner: ${data.winner.variant}`))
    if (data.winner.score != null) {
      console.log(chalk.gray(`    Score: ${data.winner.score}`))
    }
    console.log()
  })

  await runner.run({
    basePrompt: options.prompt,
    variants,
    evalPrompt: options.eval,
  })
}
