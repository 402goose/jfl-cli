import { spawn, type ChildProcess } from "child_process"
import { StringDecoder } from "string_decoder"
import { EventEmitter } from "events"
import { randomUUID } from "crypto"
import type {
  PiRpcCommand,
  PiRpcResponse,
  PiRpcEvent,
  BridgeOptions,
  SessionStats,
  ModelInfo,
  BridgeEventType,
} from "./types.js"

type PendingRequest = {
  resolve: (resp: PiRpcResponse) => void
  reject: (err: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

export class PiRpcBridge extends EventEmitter {
  private proc: ChildProcess | null = null
  private pending = new Map<string, PendingRequest>()
  private options: BridgeOptions
  private buffer = ""
  private decoder = new StringDecoder("utf8")
  private _started = false
  private _exited = false

  constructor(options: BridgeOptions = {}) {
    super()
    this.options = options
  }

  get started(): boolean { return this._started }
  get exited(): boolean { return this._exited }
  get pid(): number | undefined { return this.proc?.pid }

  async start(): Promise<void> {
    if (this._started) throw new Error("Bridge already started")

    const args = ["--mode", "rpc"]

    if (this.options.extensionPath) args.push("--extension", this.options.extensionPath)
    if (this.options.skillsPath) args.push("--skill", this.options.skillsPath)
    if (this.options.themePath) args.push("--theme", this.options.themePath)
    if (this.options.yolo) args.push("--yolo")
    if (this.options.noSession) args.push("--no-session")
    if (this.options.sessionDir) args.push("--session-dir", this.options.sessionDir)
    if (this.options.provider) args.push("--provider", this.options.provider)
    if (this.options.model) args.push("--model", this.options.model)

    const env = { ...process.env, ...this.options.env }

    this.proc = spawn("pi", args, {
      cwd: this.options.cwd ?? process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env,
    })

    this.proc.on("exit", (code, signal) => {
      this._exited = true
      this.rejectAllPending(new Error(`Pi process exited: code=${code} signal=${signal}`))
      this.emit("exit", { code, signal })
    })

    this.proc.on("error", (err) => {
      this._exited = true
      this.rejectAllPending(err)
      this.emit("error", err)
    })

    this.attachReader(this.proc.stdout!, (line) => this.handleLine(line))

    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      if (text.trim()) this.emit("stderr", text)
    })

    this._started = true
  }

  async shutdown(): Promise<void> {
    if (!this.proc || this._exited) return

    await this.send({ type: "abort" }).catch(() => {})

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.proc?.kill("SIGKILL")
        resolve()
      }, 5000)

      this.proc!.on("exit", () => {
        clearTimeout(timer)
        resolve()
      })

      this.proc!.kill("SIGTERM")
    })
  }

  async prompt(message: string, options?: { images?: unknown[]; streamingBehavior?: "steer" | "followUp" }): Promise<PiRpcResponse> {
    const cmd: PiRpcCommand = { type: "prompt", message }
    if (options?.images) cmd.images = options.images
    if (options?.streamingBehavior) cmd.streamingBehavior = options.streamingBehavior
    return this.send(cmd)
  }

  async steer(message: string, images?: unknown[]): Promise<PiRpcResponse> {
    const cmd: PiRpcCommand = { type: "steer", message }
    if (images) cmd.images = images
    return this.send(cmd)
  }

  async followUp(message: string, images?: unknown[]): Promise<PiRpcResponse> {
    const cmd: PiRpcCommand = { type: "follow_up", message }
    if (images) cmd.images = images
    return this.send(cmd)
  }

  async abort(): Promise<PiRpcResponse> {
    return this.send({ type: "abort" })
  }

  async newSession(parentSession?: string): Promise<PiRpcResponse> {
    const cmd: PiRpcCommand = { type: "new_session" }
    if (parentSession) cmd.parentSession = parentSession
    return this.send(cmd)
  }

  async getState(): Promise<PiRpcResponse> {
    return this.send({ type: "get_state" })
  }

  async getMessages(): Promise<PiRpcResponse> {
    return this.send({ type: "get_messages" })
  }

  async setModel(provider: string, modelId: string): Promise<PiRpcResponse> {
    return this.send({ type: "set_model", provider, modelId })
  }

  async cycleModel(): Promise<PiRpcResponse> {
    return this.send({ type: "cycle_model" })
  }

  async getAvailableModels(): Promise<PiRpcResponse> {
    return this.send({ type: "get_available_models" })
  }

  async setThinkingLevel(level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"): Promise<PiRpcResponse> {
    return this.send({ type: "set_thinking_level", level })
  }

  async cycleThinkingLevel(): Promise<PiRpcResponse> {
    return this.send({ type: "cycle_thinking_level" })
  }

  async setSteeringMode(mode: "all" | "one-at-a-time"): Promise<PiRpcResponse> {
    return this.send({ type: "set_steering_mode", mode })
  }

  async setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<PiRpcResponse> {
    return this.send({ type: "set_follow_up_mode", mode })
  }

  async compact(customInstructions?: string): Promise<PiRpcResponse> {
    const cmd: PiRpcCommand = { type: "compact" }
    if (customInstructions) cmd.customInstructions = customInstructions
    return this.send(cmd)
  }

  async setAutoCompaction(enabled: boolean): Promise<PiRpcResponse> {
    return this.send({ type: "set_auto_compaction", enabled })
  }

  async setAutoRetry(enabled: boolean): Promise<PiRpcResponse> {
    return this.send({ type: "set_auto_retry", enabled })
  }

  async abortRetry(): Promise<PiRpcResponse> {
    return this.send({ type: "abort_retry" })
  }

  async bash(command: string): Promise<PiRpcResponse> {
    return this.send({ type: "bash", command })
  }

  async abortBash(): Promise<PiRpcResponse> {
    return this.send({ type: "abort_bash" })
  }

  async getSessionStats(): Promise<PiRpcResponse> {
    return this.send({ type: "get_session_stats" })
  }

  async exportHtml(outputPath?: string): Promise<PiRpcResponse> {
    const cmd: PiRpcCommand = { type: "export_html" }
    if (outputPath) cmd.outputPath = outputPath
    return this.send(cmd)
  }

  async switchSession(sessionPath: string): Promise<PiRpcResponse> {
    return this.send({ type: "switch_session", sessionPath })
  }

  async fork(entryId: string): Promise<PiRpcResponse> {
    return this.send({ type: "fork", entryId })
  }

  async getForkMessages(): Promise<PiRpcResponse> {
    return this.send({ type: "get_fork_messages" })
  }

  async getLastAssistantText(): Promise<string | null> {
    const resp = await this.send({ type: "get_last_assistant_text" })
    if (!resp.success) return null
    return (resp.data as any)?.text ?? null
  }

  async setSessionName(name: string): Promise<PiRpcResponse> {
    return this.send({ type: "set_session_name", name })
  }

  async getCommands(): Promise<PiRpcResponse> {
    return this.send({ type: "get_commands" })
  }

  async respondToExtensionUi(id: string, payload: Record<string, unknown>): Promise<void> {
    this.write({ type: "extension_ui_response", id, ...payload })
  }

  async send(cmd: PiRpcCommand, timeoutMs = 120_000): Promise<PiRpcResponse> {
    if (!this.proc || this._exited) throw new Error("Bridge not running")

    const id = cmd.id ?? randomUUID()
    cmd.id = id

    return new Promise<PiRpcResponse>((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timeout after ${timeoutMs}ms: ${cmd.type}`))
      }, timeoutMs) : undefined

      this.pending.set(id, { resolve, reject, timer })
      this.write(cmd)
    })
  }

  private write(obj: Record<string, unknown>): void {
    if (!this.proc?.stdin?.writable) throw new Error("stdin not writable")
    this.proc.stdin.write(JSON.stringify(obj) + "\n")
  }

  private handleLine(line: string): void {
    if (!line.trim()) return

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line)
    } catch {
      this.emit("parse_error", line)
      return
    }

    if (parsed.type === "response" && parsed.id) {
      const pending = this.pending.get(parsed.id as string)
      if (pending) {
        this.pending.delete(parsed.id as string)
        if (pending.timer) clearTimeout(pending.timer)
        pending.resolve(parsed as unknown as PiRpcResponse)
        return
      }
    }

    this.emit(parsed.type as string, parsed)
    this.emit("raw", parsed)
  }

  private attachReader(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
    stream.on("data", (chunk: Buffer) => {
      this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk)

      while (true) {
        const idx = this.buffer.indexOf("\n")
        if (idx === -1) break
        let line = this.buffer.slice(0, idx)
        this.buffer = this.buffer.slice(idx + 1)
        if (line.endsWith("\r")) line = line.slice(0, -1)
        onLine(line)
      }
    })

    stream.on("end", () => {
      this.buffer += this.decoder.end()
      if (this.buffer.length > 0) {
        onLine(this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer)
        this.buffer = ""
      }
    })
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
  }
}
