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

export class LumeBackend implements VMBackend {
  name = "lume"

  isInstalled(): boolean {
    try {
      execSync("which lume", { stdio: "pipe" })
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
    const cpus = opts?.cpus ?? 2
    const memory = opts?.memory ?? 2048
    console.log(`  Creating base VM "${name}" (${cpus} CPU, ${memory}MB RAM)...`)
    execSync(`lume create ${name} --os macos --cpu ${cpus} --memory ${memory}`, { stdio: "inherit", timeout: 1800000 })
  }

  async clone(base: string, name: string): Promise<void> {
    execSync(`lume clone ${base} ${name}`, { stdio: "pipe", timeout: 60000 })
  }

  async start(name: string, headless = true): Promise<void> {
    const args = ["run", name]
    if (headless) args.push("--no-display")

    const child = nodeSpawn("lume", args, {
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
    try {
      execSync(`lume stop ${name}`, { stdio: "pipe", timeout: 30000 })
    } catch {}
  }

  async destroy(name: string): Promise<void> {
    await this.stop(name)
    try {
      execSync(`lume delete ${name}`, { stdio: "pipe", timeout: 30000 })
    } catch {}
  }

  async getIP(name: string): Promise<string> {
    try {
      const output = execSync(`lume get ${name} -f json`, { stdio: "pipe", timeout: 10000 }).toString().trim()
      const info = JSON.parse(output)
      return info.ip || info.IP || info.ipAddress || ""
    } catch {
      const output = execSync(`lume get ${name}`, { stdio: "pipe", timeout: 10000 }).toString().trim()
      const match = output.match(/(?:ip|IP|address)[:\s]+(\d+\.\d+\.\d+\.\d+)/)
      return match?.[1] || ""
    }
  }

  async list(): Promise<VMInfo[]> {
    try {
      const output = execSync("lume ls -f json", { stdio: "pipe", timeout: 10000 }).toString().trim()
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
      const output = execSync("lume ls", { stdio: "pipe", timeout: 10000 }).toString().trim()
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
    const ip = await this.getIP(name)
    return execSync(
      `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 admin@${ip} '${command.replace(/'/g, "'\\''")}'`,
      { stdio: "pipe", timeout: 60000 }
    ).toString().trim()
  }

  async copyTo(name: string, localPath: string, remotePath: string): Promise<void> {
    const ip = await this.getIP(name)
    execSync(
      `scp -o StrictHostKeyChecking=no "${localPath}" admin@${ip}:"${remotePath}"`,
      { stdio: "pipe", timeout: 60000 }
    )
  }

  async copyFrom(name: string, remotePath: string, localPath: string): Promise<void> {
    const ip = await this.getIP(name)
    execSync(
      `scp -o StrictHostKeyChecking=no admin@${ip}:"${remotePath}" "${localPath}"`,
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
