/**
 * @purpose Fleet commands for jfl pi — setup, spawn, collect, destroy, status, logs
 */

import chalk from "chalk"
import { execSync } from "child_process"
import { existsSync, readFileSync, mkdirSync, appendFileSync } from "fs"
import { join } from "path"
import {
  getBackend,
  loadFleetState,
  saveFleetState,
  type FleetState,
  type WaveState,
  type AgentState,
  type VMBackend,
} from "../lib/vm-backend.js"

export async function fleetSetup(options: { backend?: string; cpus?: number; memory?: number; skipBootArg?: boolean }): Promise<void> {
  const backendName = options.backend || "lume"
  const backend = getBackend(backendName)
  const projectRoot = process.cwd()

  console.log(chalk.cyan("\n  JFL Fleet Setup"))
  console.log(chalk.gray("  ─".repeat(28)))

  // Step 1: Install backend
  if (!backend.isInstalled()) {
    console.log(chalk.yellow(`\n  ${backend.name} not found. Installing...`))
    try {
      await backend.install()
      if (!backend.isInstalled()) throw new Error("Install completed but binary not found in PATH")
      console.log(chalk.green(`  ✓ ${backend.name} installed`))
    } catch (err: any) {
      console.log(chalk.red(`\n  Auto-install failed: ${err.message}`))
      console.log(chalk.white("\n  Install manually:"))
      console.log(chalk.cyan('    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/lume/scripts/install.sh)"'))
      console.log(chalk.gray("  Then re-run: jfl pi fleet setup\n"))
      process.exit(1)
    }
  } else {
    console.log(chalk.green(`  ✓ ${backend.name} installed`))
  }

  // Step 2: Boot arg for >2 macOS VMs
  if (!options.skipBootArg) {
    try {
      const quota = execSync("nvram hv_apple_isa_vm_quota 2>/dev/null || echo 'not set'", { stdio: "pipe" }).toString().trim()
      if (quota.includes("not set") || quota.includes("hv_apple_isa_vm_quota\t0")) {
        console.log(chalk.yellow("\n  VM quota boot arg not set"))
        console.log(chalk.gray("  Apple limits macOS VMs to 2 concurrent by default."))
        console.log(chalk.gray("  For agent fleets (3+ VMs), this needs to be raised.\n"))
        console.log(chalk.white("  What it does:"))
        console.log(chalk.gray("    Sets hv_apple_isa_vm_quota=255 in NVRAM"))
        console.log(chalk.gray("    Tells the Hypervisor.framework to allow up to 255 VMs"))
        console.log(chalk.gray("    Persists across reboots. Reversible with:"))
        console.log(chalk.gray("      sudo nvram -d hv_apple_isa_vm_quota\n"))
        console.log(chalk.white("  To set it:"))
        console.log(chalk.cyan("    sudo nvram hv_apple_isa_vm_quota=255"))
        console.log(chalk.gray("    Then reboot.\n"))
        console.log(chalk.gray("  Skip this check: --skip-boot-arg (limits fleet to 2 agents)"))
      } else {
        const val = quota.split("\t").pop() || "?"
        console.log(chalk.green(`  ✓ VM quota: ${val} (up to ${parseInt(val) || "?"} concurrent VMs)`))
      }
    } catch {
      console.log(chalk.gray("  ⚠ Could not check VM quota (nvram access may require full disk access)"))
    }
  }

  // Step 3: Check for base VM
  const state = loadFleetState(projectRoot)
  state.backend = backendName
  const baseName = state.base_vm || "jfl-base"

  const vms = await backend.list()
  const baseExists = vms.some(v => v.name === baseName)

  if (baseExists) {
    console.log(chalk.green(`  ✓ Base VM "${baseName}" exists`))
  } else {
    console.log(chalk.yellow(`\n  Base VM "${baseName}" not found. Creating...`))
    console.log(chalk.gray("  This downloads macOS and creates the base image (~15-30min first time)"))
    console.log()

    await backend.createBase(baseName, {
      cpus: options.cpus ?? 4,
      memory: options.memory ?? 4096,
    })

    console.log(chalk.yellow("\n  Base VM created. Next steps:"))
    console.log(chalk.white("  1. Start it:  lume run jfl-base"))
    console.log(chalk.white("  2. Run setup:  lume setup jfl-base"))
    console.log(chalk.white("  3. SSH in and install dependencies:"))
    console.log(chalk.cyan("     ssh admin@$(lume get jfl-base ip)"))
    console.log(chalk.gray("     # Inside VM:"))
    console.log(chalk.gray("     /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""))
    console.log(chalk.gray("     brew install node git"))
    console.log(chalk.gray("     npm install -g jfl-cli"))
    console.log(chalk.white("  4. Stop it:    lume stop jfl-base"))
    console.log(chalk.white("  5. Spawn:      jfl pi fleet spawn 4"))
  }

  state.base_vm = baseName
  saveFleetState(projectRoot, state)

  console.log(chalk.green("\n  ✓ Fleet setup complete\n"))
}

export async function fleetSpawn(count: number, options: { rounds?: number; repo?: string }): Promise<void> {
  const projectRoot = process.cwd()
  const state = loadFleetState(projectRoot)
  const backend = getBackend(state.backend || "lume")
  const baseName = state.base_vm || "jfl-base"
  const rounds = options.rounds ?? 5

  if (!backend.isInstalled()) {
    console.log(chalk.red("\n  Backend not installed. Run: jfl pi fleet setup\n"))
    process.exit(1)
  }

  const vms = await backend.list()
  if (!vms.some(v => v.name === baseName)) {
    console.log(chalk.red(`\n  Base VM "${baseName}" not found. Run: jfl pi fleet setup\n`))
    process.exit(1)
  }

  let targetRepo = options.repo || ""
  if (!targetRepo) {
    try {
      targetRepo = execSync("git remote get-url origin", { stdio: "pipe" }).toString().trim()
    } catch {
      console.log(chalk.red("\n  No git remote found. Specify with --repo\n"))
      process.exit(1)
    }
  }

  const waveId = Date.now().toString()
  const weightsPath = join(projectRoot, ".jfl", "policy-weights.json")

  console.log(chalk.cyan("\n  JFL Agent Fleet — Spawning Wave"))
  console.log(chalk.gray("  ─".repeat(28)))
  console.log(chalk.white(`  Wave:    ${waveId}`))
  console.log(chalk.white(`  Agents:  ${count}`))
  console.log(chalk.white(`  Rounds:  ${rounds}`))
  console.log(chalk.white(`  Repo:    ${targetRepo}`))

  if (existsSync(weightsPath)) {
    try {
      const w = JSON.parse(readFileSync(weightsPath, "utf-8"))
      console.log(chalk.white(`  Weights: trained on ${w.trained_on} tuples`))
    } catch {}
  } else {
    console.log(chalk.gray("  Weights: none (heuristic selection)"))
  }
  console.log()

  const wave: WaveState = {
    id: waveId,
    agents: [],
    started_at: new Date().toISOString(),
    status: "running",
    target_repo: targetRepo,
    rounds,
  }

  let started = 0
  for (let i = 1; i <= count; i++) {
    const agentName = `agent-${waveId}-${i}`
    const agent: AgentState = {
      name: agentName,
      vm_name: agentName,
      wave_id: waveId,
      index: i,
      status: "booting",
    }

    process.stdout.write(chalk.gray(`  [${i}/${count}] ${agentName}... `))

    try {
      await backend.clone(baseName, agentName)
      await backend.start(agentName, true)
      const ip = await backend.getIP(agentName)
      agent.ip = ip
      agent.status = "running"

      // Inject identity
      await backend.exec(agentName, `mkdir -p /tmp/agent-config && cat > /tmp/agent-config/identity.json << 'IDEOF'
{"agent_id":"${agentName}","wave_id":"${waveId}","fleet_index":${i},"fleet_size":${count},"target_repo":"${targetRepo}"}
IDEOF`)

      // Copy policy weights if available
      if (existsSync(weightsPath)) {
        await backend.copyTo(agentName, weightsPath, "/tmp/agent-config/policy-weights.json")
      }

      // Clone repo and launch autoresearch
      await backend.exec(agentName, `cd /tmp && git clone '${targetRepo}' workspace 2>/dev/null && cd workspace && mkdir -p .jfl && cp /tmp/agent-config/identity.json .jfl/agent-identity.json && cp /tmp/agent-config/policy-weights.json .jfl/policy-weights.json 2>/dev/null; nohup jfl peter autoresearch --rounds ${rounds} > /tmp/autoresearch.log 2>&1 &`)

      wave.agents.push(agent)
      started++
      console.log(chalk.green(`OK (${ip})`))
    } catch (err: any) {
      agent.status = "error"
      wave.agents.push(agent)
      console.log(chalk.red(`FAILED: ${err.message}`))
      await backend.destroy(agentName).catch(() => {})
    }
  }

  state.waves.push(wave)
  saveFleetState(projectRoot, state)

  console.log()
  console.log(chalk.cyan("  ─".repeat(28)))
  console.log(chalk.green(`  ✓ ${started}/${count} agents running`))
  console.log(chalk.white(`  Wave ID: ${waveId}`))
  console.log()
  console.log(chalk.gray(`  Status:   jfl pi fleet status`))
  console.log(chalk.gray(`  Collect:  jfl pi fleet collect`))
  console.log(chalk.gray(`  Logs:     jfl pi fleet logs agent-${waveId}-1`))
  console.log(chalk.gray(`  Destroy:  jfl pi fleet destroy ${waveId}`))
  console.log()
}

export async function fleetStatus(): Promise<void> {
  const projectRoot = process.cwd()
  const state = loadFleetState(projectRoot)
  const backend = getBackend(state.backend || "lume")

  console.log(chalk.cyan("\n  JFL Agent Fleet Status"))
  console.log(chalk.gray("  ─".repeat(28)))
  console.log(chalk.white(`  Backend:  ${state.backend || "lume"}`))
  console.log(chalk.white(`  Base VM:  ${state.base_vm || "jfl-base"}`))

  const activeWaves = state.waves.filter(w => w.status === "running")
  if (activeWaves.length === 0) {
    console.log(chalk.gray("\n  No active waves.\n"))
    return
  }

  let vms: Awaited<ReturnType<VMBackend["list"]>> = []
  try {
    vms = await backend.list()
  } catch {}

  for (const wave of activeWaves) {
    console.log()
    console.log(chalk.white(`  Wave ${wave.id}`))
    console.log(chalk.gray(`  Started: ${wave.started_at}`))
    console.log(chalk.gray(`  Repo: ${wave.target_repo}`))
    console.log(chalk.gray(`  Rounds: ${wave.rounds}`))
    console.log()

    for (const agent of wave.agents) {
      const vmInfo = vms.find(v => v.name === agent.vm_name)
      const isRunning = vmInfo?.status === "running"
      const icon = isRunning ? chalk.green("●") : agent.status === "error" ? chalk.red("●") : chalk.gray("○")

      let tuples = ""
      if (isRunning && agent.ip) {
        try {
          const count = await backend.exec(agent.vm_name, "wc -l < /tmp/workspace/.jfl/training-buffer.jsonl 2>/dev/null || echo 0")
          tuples = chalk.gray(` (${count.trim()} tuples)`)
        } catch {}
      }

      console.log(`  ${icon} ${agent.name} ${chalk.gray(agent.ip || "no ip")}${tuples}`)
    }
  }

  console.log()
}

export async function fleetCollect(waveId?: string): Promise<void> {
  const projectRoot = process.cwd()
  const state = loadFleetState(projectRoot)
  const backend = getBackend(state.backend || "lume")

  const wave = waveId
    ? state.waves.find(w => w.id === waveId)
    : state.waves.filter(w => w.status === "running").pop()

  if (!wave) {
    console.log(chalk.red("\n  No active wave found. Specify wave ID.\n"))
    process.exit(1)
  }

  console.log(chalk.cyan(`\n  Collecting tuples from wave ${wave.id}...`))
  console.log(chalk.gray("  ─".repeat(28)))

  const collectDir = join(projectRoot, ".jfl", "fleet-collected", wave.id)
  mkdirSync(collectDir, { recursive: true })

  const localBufferPath = join(projectRoot, ".jfl", "training-buffer.jsonl")
  const existingIds = new Set<string>()

  if (existsSync(localBufferPath)) {
    for (const line of readFileSync(localBufferPath, "utf-8").trim().split("\n")) {
      try {
        const entry = JSON.parse(line)
        if (entry.id) existingIds.add(entry.id)
      } catch {}
    }
  }

  let totalNew = 0

  for (const agent of wave.agents) {
    if (agent.status === "error") continue
    process.stdout.write(chalk.gray(`  ${agent.name}... `))

    try {
      // Collect training tuples
      const tuplesPath = join(collectDir, `${agent.name}-tuples.jsonl`)
      await backend.copyFrom(agent.vm_name, "/tmp/workspace/.jfl/training-buffer.jsonl", tuplesPath)

      let agentNew = 0
      if (existsSync(tuplesPath)) {
        for (const line of readFileSync(tuplesPath, "utf-8").trim().split("\n")) {
          if (!line.trim()) continue
          try {
            const entry = JSON.parse(line)
            if (entry.id && !existingIds.has(entry.id)) {
              appendFileSync(localBufferPath, line + "\n")
              existingIds.add(entry.id)
              agentNew++
            }
          } catch {}
        }
      }
      totalNew += agentNew

      // Collect eval results
      try {
        await backend.copyFrom(agent.vm_name, "/tmp/workspace/.jfl/eval.jsonl", join(collectDir, `${agent.name}-eval.jsonl`))
      } catch {}

      // Collect journals
      try {
        await backend.exec(agent.vm_name, `tar -czf /tmp/journal.tar.gz -C /tmp/workspace/.jfl/journal . 2>/dev/null`)
        await backend.copyFrom(agent.vm_name, "/tmp/journal.tar.gz", join(collectDir, `${agent.name}-journal.tar.gz`))
        execSync(`tar -xzf "${join(collectDir, `${agent.name}-journal.tar.gz`)}" -C "${join(projectRoot, ".jfl", "journal")}" 2>/dev/null || true`, { stdio: "pipe" })
      } catch {}

      agent.tuples_collected = agentNew
      console.log(chalk.green(`${agentNew} new tuples`))
    } catch (err: any) {
      console.log(chalk.red(`failed: ${err.message.slice(0, 60)}`))
    }
  }

  wave.status = "collecting"
  saveFleetState(projectRoot, state)

  console.log()
  console.log(chalk.cyan("  ─".repeat(28)))
  console.log(chalk.green(`  ✓ ${totalNew} new tuples collected`))
  console.log(chalk.white(`  Total in buffer: ${existingIds.size}`))

  // Check retrain threshold
  const weightsPath = join(projectRoot, ".jfl", "policy-weights.json")
  let trainedOn = 0
  if (existsSync(weightsPath)) {
    try {
      trainedOn = JSON.parse(readFileSync(weightsPath, "utf-8")).trained_on || 0
    } catch {}
  }

  const delta = existingIds.size - trainedOn
  if (delta >= 20) {
    console.log(chalk.yellow(`\n  ${delta} new tuples since last train — retrain recommended:`))
    console.log(chalk.cyan(`    python3 scripts/train-policy-head.py --epochs 200\n`))
  } else {
    console.log(chalk.gray(`  ${delta} tuples since last train (threshold: 20)\n`))
  }
}

export async function fleetDestroy(waveId?: string): Promise<void> {
  const projectRoot = process.cwd()
  const state = loadFleetState(projectRoot)
  const backend = getBackend(state.backend || "lume")

  const wave = waveId
    ? state.waves.find(w => w.id === waveId)
    : state.waves.filter(w => w.status === "running" || w.status === "collecting").pop()

  if (!wave) {
    console.log(chalk.red("\n  No active wave found.\n"))
    process.exit(1)
  }

  console.log(chalk.cyan(`\n  Destroying wave ${wave.id}...`))

  for (const agent of wave.agents) {
    process.stdout.write(chalk.gray(`  ${agent.name}... `))
    try {
      await backend.destroy(agent.vm_name)
      console.log(chalk.green("destroyed"))
    } catch {
      console.log(chalk.yellow("skipped"))
    }
  }

  wave.status = "destroyed"
  saveFleetState(projectRoot, state)

  console.log(chalk.green(`\n  ✓ Wave ${wave.id} destroyed\n`))
}

export async function fleetLogs(agentName: string): Promise<void> {
  const projectRoot = process.cwd()
  const state = loadFleetState(projectRoot)
  const backend = getBackend(state.backend || "lume")

  const agent = state.waves.flatMap(w => w.agents).find(a => a.name === agentName || a.vm_name === agentName)
  if (!agent) {
    console.log(chalk.red(`\n  Agent "${agentName}" not found.\n`))
    process.exit(1)
  }

  try {
    const logs = await backend.exec(agent.vm_name, "tail -50 /tmp/autoresearch.log 2>/dev/null || echo 'No logs yet'")
    console.log(chalk.cyan(`\n  Logs for ${agent.name}:`))
    console.log(chalk.gray("  ─".repeat(28)))
    console.log(logs)
    console.log()
  } catch (err: any) {
    console.log(chalk.red(`\n  Could not read logs: ${err.message}\n`))
  }
}
