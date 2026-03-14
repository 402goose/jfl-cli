import { EventEmitter } from "events"
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PiRpcBridge } from "./bridge.js"
import type { BridgeOptions, SessionStats } from "./types.js"

interface ServiceConfig {
  name: string
  path: string
  type?: string
}

interface SweepResult {
  service: string
  path: string
  success: boolean
  output?: string
  stats?: SessionStats
  error?: string
  durationMs: number
}

interface EvalSweepOptions {
  bridgeOptions?: Partial<BridgeOptions>
  concurrency?: number
  evalCommand?: string
  hubUrl?: string
}

export class EvalSweep extends EventEmitter {
  private options: EvalSweepOptions

  constructor(options: EvalSweepOptions = {}) {
    super()
    this.options = {
      concurrency: 4,
      evalCommand: "Run the test suite and report results as JSON: {\"pass\": N, \"fail\": N, \"total\": N, \"composite\": 0.0-1.0}",
      ...options,
    }
  }

  async sweep(projectRoot: string): Promise<SweepResult[]> {
    const services = this.loadServices(projectRoot)
    if (!services.length) {
      this.emit("error", new Error("No services found"))
      return []
    }

    this.emit("start", { services: services.map(s => s.name), concurrency: this.options.concurrency })

    const results: SweepResult[] = []
    const concurrency = this.options.concurrency ?? 4

    for (let i = 0; i < services.length; i += concurrency) {
      const batch = services.slice(i, i + concurrency)
      const batchResults = await Promise.all(
        batch.map(service => this.evalService(service))
      )
      results.push(...batchResults)
    }

    this.emit("complete", { results })

    if (this.options.hubUrl) {
      await this.postResults(results)
    }

    return results
  }

  private loadServices(projectRoot: string): ServiceConfig[] {
    const servicesPath = join(projectRoot, ".jfl", "services.json")
    if (!existsSync(servicesPath)) return []

    try {
      const data = JSON.parse(readFileSync(servicesPath, "utf-8"))
      const services: ServiceConfig[] = []

      for (const [name, config] of Object.entries(data)) {
        const svc = config as Record<string, unknown>
        if (svc.path && typeof svc.path === "string") {
          services.push({ name, path: svc.path, type: svc.type as string })
        }
      }

      return services
    } catch {
      return []
    }
  }

  private async evalService(service: ServiceConfig): Promise<SweepResult> {
    const start = Date.now()

    this.emit("service_start", { service: service.name, path: service.path })

    const bridge = new PiRpcBridge({
      ...this.options.bridgeOptions,
      cwd: service.path,
      noSession: true,
      yolo: true,
    })

    try {
      await bridge.start()

      let response = ""
      bridge.on("message_update", (event: any) => {
        const delta = event.assistantMessageEvent
        if (delta?.type === "text_delta" && delta.delta) {
          response += delta.delta
        }
      })

      const endPromise = new Promise<void>((resolve) => {
        bridge.on("agent_end", () => resolve())
      })

      await bridge.prompt(this.options.evalCommand!)
      await endPromise

      if (!response) {
        response = await bridge.getLastAssistantText() ?? ""
      }

      let stats: SessionStats | undefined
      try {
        const statsResp = await bridge.getSessionStats()
        if (statsResp.success) stats = statsResp.data as SessionStats
      } catch {}

      const result: SweepResult = {
        service: service.name,
        path: service.path,
        success: true,
        output: response,
        stats,
        durationMs: Date.now() - start,
      }

      this.emit("service_end", result)
      return result
    } catch (err: any) {
      const result: SweepResult = {
        service: service.name,
        path: service.path,
        success: false,
        error: err.message,
        durationMs: Date.now() - start,
      }
      this.emit("service_end", result)
      return result
    } finally {
      await bridge.shutdown().catch(() => {})
    }
  }

  private async postResults(results: SweepResult[]): Promise<void> {
    if (!this.options.hubUrl) return

    try {
      await fetch(`${this.options.hubUrl}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "eval:sweep",
          ts: new Date().toISOString(),
          data: {
            services: results.length,
            passed: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            results: results.map(r => ({
              service: r.service,
              success: r.success,
              durationMs: r.durationMs,
            })),
          },
        }),
      })
    } catch {
      // best effort
    }
  }
}
