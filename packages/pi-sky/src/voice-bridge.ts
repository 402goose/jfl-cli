import { spawn, type ChildProcess } from "child_process"
import { EventEmitter } from "events"
import type { PiRpcBridge } from "./bridge.js"

interface VoiceBridgeOptions {
  device?: string
  mode?: "steer" | "follow_up" | "prompt"
  vadSilenceMs?: number
}

export class VoiceBridge extends EventEmitter {
  private bridge: PiRpcBridge
  private options: VoiceBridgeOptions
  private voiceProc: ChildProcess | null = null
  private running = false

  constructor(bridge: PiRpcBridge, options: VoiceBridgeOptions = {}) {
    super()
    this.bridge = bridge
    this.options = {
      mode: "steer",
      vadSilenceMs: 1500,
      ...options,
    }
  }

  get isRunning(): boolean { return this.running }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    const args = ["voice", "record"]
    if (this.options.device) args.push("-d", this.options.device)

    this.voiceProc = spawn("jfl", args, {
      stdio: ["pipe", "pipe", "pipe"],
    })

    let buffer = ""

    this.voiceProc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
          const data = JSON.parse(trimmed)
          if (data.text) {
            this.handleTranscription(data.text)
          }
        } catch {
          if (trimmed.length > 2 && !trimmed.startsWith("[")) {
            this.handleTranscription(trimmed)
          }
        }
      }
    })

    this.voiceProc.on("exit", () => {
      this.running = false
      this.emit("stopped")
    })

    this.emit("started")
  }

  stop(): void {
    if (!this.running) return
    this.voiceProc?.kill("SIGTERM")
    this.voiceProc = null
    this.running = false
  }

  private async handleTranscription(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || trimmed.length < 3) return

    this.emit("transcription", trimmed)

    if (this.bridge.exited) {
      this.emit("error", new Error("Bridge has exited"))
      return
    }

    try {
      switch (this.options.mode) {
        case "steer":
          await this.bridge.steer(trimmed)
          break
        case "follow_up":
          await this.bridge.followUp(trimmed)
          break
        case "prompt":
          await this.bridge.prompt(trimmed, { streamingBehavior: "steer" })
          break
      }
      this.emit("sent", { text: trimmed, mode: this.options.mode })
    } catch (err) {
      this.emit("error", err)
    }
  }
}
