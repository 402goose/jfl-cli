/**
 * @purpose VM backend adapter — abstracts Lume/Tart/Fly for agent fleet management
 */

import { execSync, spawn as nodeSpawn } from "child_process"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

export interface VMInfo {
  name: string
  status: "running" | "stopped" | "creating" | "unknown"
  ip?: string
  cpus?: number
  memory?: number
}

export interface VMBackend {
  name: string
  isInstalled(): boolean
  install(): Promise<void>
  createBase(name: string, opts?: { cpus?: number; memory?: number }): Promise<void>
  clone(base: string, name: string): Promise<void>
  start(name: string, headless?: boolean): Promise<void>
  stop(name: string): Promise<void>
  destroy(name: string): Promise<void>
  getIP(name: string): Promise<string>
  list(): Promise<VMInfo[]>
  exec(name: string, command: string): Promise<string>
  copyTo(name: string, localPath: string, remotePath: string): Promise<void>
  copyFrom(name: string, remotePath: string, localPath: string): Promise<void>
}

function lumeBin(): string {
  const localBin = join(process.env.HOME || "", ".local", "bin", "lume")
  if (existsSync(localBin)) return localBin
  try {
    return execSync("which lume", { stdio: "pipe" }).toString().trim()
  } catch {
    return "lume"
  }
}

function lume(args: string, opts?: { stdio?: "pipe" | "inherit"; timeout?: number }): string {
  const bin = lumeBin()
  return execSync(`"${bin}" ${args}`, {
    stdio: opts?.stdio ?? "pipe",
    timeout: opts?.timeout ?? 30000,
  }).toString().trim()
}

export class LumeBackend implements VMBackend {
  name = "lume"

  isInstalled(): boolean {
    try {
      lume("--version")
      return true
    } catch {
      return false
    }
  }

  async install(): Promise<void> {
    console.log("  Installing Lume via official installer...")
    execSync('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/lume/scripts/install.sh)"', { stdio: "inherit", timeout: 300000 })
  }

  async createBase(name: string, opts?: { cpus?: number; memory?: number }): Promise<void> {
    const cpus = opts?.cpus ?? 4
    const memoryMB = opts?.memory ?? 4096
    const bin = lumeBin()
    console.log(`  Creating base VM "${name}" (${cpus} CPU, ${memoryMB}MB RAM)...`)
    console.log("  This includes IPSW download + unattended macOS setup (30-60 min).")

    return new Promise((resolve, reject) => {
      const child = nodeSpawn(bin, [
        "create", name,
        "--os", "macos",
        "--cpu", String(cpus),
        "--memory", `${memoryMB}MB`,
        "--ipsw", "latest",
        "--unattended", "sequoia",
      ], { stdio: "inherit" })

      child.on("close", (code) => {
        if (code === 0) resolve()
        else reject(new Error(`lume create exited with code ${code}`))
      })
      child.on("error", reject)
    })
  }

  async clone(base: string, name: string): Promise<void> {
    lume(`clone ${base} ${name}`, { timeout: 60000 })
  }

  async start(name: string, headless = true): Promise<void> {
    const bin = lumeBin()
    const args = ["run", name]
    if (headless) args.push("--no-display")

    const child = nodeSpawn(bin, args, {
      stdio: "ignore",
      detached: true,
    })
    child.unref()

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        const ip = await this.getIP(name)
        if (ip && ip !== "0.0.0.0" && ip !== "") return
      } catch {}
    }
    throw new Error(`VM "${name}" failed to get IP after 60s`)
  }

  async stop(name: string): Promise<void> {
    try { lume(`stop ${name}`) } catch {}
  }

  async destroy(name: string): Promise<void> {
    await this.stop(name)
    try { lume(`delete ${name} --force`) } catch {}
  }

  async getIP(name: string): Promise<string> {
    try {
      const output = lume(`get ${name} -f json`, { timeout: 10000 })
      const info = JSON.parse(output)
      return info.ip || info.IP || info.ipAddress || ""
    } catch {
      const output = lume(`get ${name}`, { timeout: 10000 })
      const match = output.match(/(?:ip|IP|address)[:\s]+(\d+\.\d+\.\d+\.\d+)/)
      return match?.[1] || ""
    }
  }

  async list(): Promise<VMInfo[]> {
    try {
      const output = lume("ls -f json", { timeout: 10000 })
      if (!output) return []
      const vms = JSON.parse(output)
      return (Array.isArray(vms) ? vms : []).map((vm: any) => ({
        name: vm.name || vm.Name,
        status: (vm.status || vm.Status || "unknown").toLowerCase() as VMInfo["status"],
        ip: vm.ip || vm.IP,
        cpus: vm.cpus || vm.CPU,
        memory: vm.memory || vm.Memory,
      }))
    } catch {
      const output = lume("ls", { timeout: 10000 })
      const vms: VMInfo[] = []
      for (const line of output.split("\n").slice(1)) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 2) {
          vms.push({ name: parts[0], status: parts[1].toLowerCase() as VMInfo["status"] })
        }
      }
      return vms
    }
  }

  async exec(name: string, command: string): Promise<string> {
    return lume(`ssh ${name} -- ${command}`, { timeout: 60000 })
  }

  async copyTo(name: string, localPath: string, remotePath: string): Promise<void> {
    const ip = await this.getIP(name)
    execSync(
      `scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "${localPath}" admin@${ip}:"${remotePath}"`,
      { stdio: "pipe", timeout: 60000 }
    )
  }

  async copyFrom(name: string, remotePath: string, localPath: string): Promise<void> {
    const ip = await this.getIP(name)
    execSync(
      `scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null admin@${ip}:"${remotePath}" "${localPath}"`,
      { stdio: "pipe", timeout: 60000 }
    )
  }
}

export interface FleetState {
  waves: WaveState[]
  base_vm: string
  backend: string
}

export interface WaveState {
  id: string
  agents: AgentState[]
  started_at: string
  status: "running" | "collecting" | "completed" | "destroyed"
  target_repo: string
  rounds: number
}

export interface AgentState {
  name: string
  vm_name: string
  wave_id: string
  index: number
  status: "booting" | "running" | "done" | "error"
  ip?: string
  tuples_collected?: number
}

const FLEET_STATE_PATH = ".jfl/fleet-state.json"

export function loadFleetState(projectRoot: string): FleetState {
  const p = join(projectRoot, FLEET_STATE_PATH)
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, "utf-8"))
    } catch {}
  }
  return { waves: [], base_vm: "jfl-base", backend: "lume" }
}

export function saveFleetState(projectRoot: string, state: FleetState): void {
  const p = join(projectRoot, FLEET_STATE_PATH)
  mkdirSync(join(projectRoot, ".jfl"), { recursive: true })
  writeFileSync(p, JSON.stringify(state, null, 2))
}

export function getBackend(name: string): VMBackend {
  switch (name) {
    case "lume":
      return new LumeBackend()
    default:
      throw new Error(`Unknown VM backend: ${name}. Supported: lume`)
  }
}
