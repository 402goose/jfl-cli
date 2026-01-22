import chalk from "chalk"
import ora, { Ora } from "ora"
import inquirer from "inquirer"
import { existsSync, mkdirSync, statSync, createWriteStream, unlinkSync, renameSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir, platform } from "os"
import { createHash } from "crypto"
import https from "https"
import http from "http"
import { EventEmitter } from "events"
import WebSocket from "ws"
import { spawn, ChildProcess, execSync } from "child_process"
import { Readable } from "stream"

// VAD Configuration
const VAD_SILENCE_THRESHOLD_DB = -40 // dB threshold for silence detection
const VAD_SILENCE_DURATION_MS = 1500 // Stop after 1.5 seconds of silence

// =============================================================================
// Voice Error Handling System
// =============================================================================

/**
 * Error types for voice-related failures
 */
export enum VoiceErrorType {
  SERVER_NOT_RUNNING = "SERVER_NOT_RUNNING",
  MIC_UNAVAILABLE = "MIC_UNAVAILABLE",
  CONNECTION_DROPPED = "CONNECTION_DROPPED",
  TRANSCRIPTION_EMPTY = "TRANSCRIPTION_EMPTY",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  MODEL_NOT_FOUND = "MODEL_NOT_FOUND",
  AUTH_FAILED = "AUTH_FAILED",
  SOX_NOT_INSTALLED = "SOX_NOT_INSTALLED",
  RECORDING_FAILED = "RECORDING_FAILED",
  TIMEOUT = "TIMEOUT",
}

/**
 * Error messages and recovery suggestions for each error type
 */
const VOICE_ERROR_MESSAGES: Record<VoiceErrorType, { message: string; suggestions: string[] }> = {
  [VoiceErrorType.SERVER_NOT_RUNNING]: {
    message: "Voice server is not running.",
    suggestions: [
      "Start the server with: jfl voice server start",
      "Check if another process is using the port",
    ],
  },
  [VoiceErrorType.MIC_UNAVAILABLE]: {
    message: "Microphone not available.",
    suggestions: [
      platform() === "darwin"
        ? "Check Settings > Privacy & Security > Microphone"
        : platform() === "win32"
        ? "Check Settings > Privacy > Microphone"
        : "Check your audio settings and permissions",
      "Ensure your microphone is connected and enabled",
      "Try selecting a different device with: jfl voice devices",
    ],
  },
  [VoiceErrorType.CONNECTION_DROPPED]: {
    message: "Connection to voice server lost.",
    suggestions: [
      "Check if the server is still running: jfl voice server status",
      "Restart the server: jfl voice server start",
      "Check your network connection",
    ],
  },
  [VoiceErrorType.TRANSCRIPTION_EMPTY]: {
    message: "No speech detected.",
    suggestions: [
      "Try speaking louder or more clearly",
      "Move closer to your microphone",
      "Check your microphone is working: jfl voice test",
      "Ensure background noise is minimized",
    ],
  },
  [VoiceErrorType.PERMISSION_DENIED]: {
    message: "Microphone permission denied.",
    suggestions:
      platform() === "darwin"
        ? [
            "Open System Settings > Privacy & Security > Microphone",
            "Grant permission to Terminal (or your terminal app)",
            "You may need to restart your terminal after granting permission",
          ]
        : platform() === "win32"
        ? [
            "Open Settings > Privacy > Microphone",
            "Enable 'Allow apps to access your microphone'",
            "Ensure your terminal app is allowed",
          ]
        : [
            "Check your system's audio permissions",
            "On some systems, run: sudo usermod -aG audio $USER",
            "Then log out and log back in",
          ],
  },
  [VoiceErrorType.MODEL_NOT_FOUND]: {
    message: "Whisper model not found.",
    suggestions: [
      "Download a model with: jfl voice model download base",
      "List available models: jfl voice model list",
      "Run setup wizard: jfl voice setup",
    ],
  },
  [VoiceErrorType.AUTH_FAILED]: {
    message: "Authentication failed. Server token may have changed.",
    suggestions: [
      "Restart the voice server: jfl voice server start",
      "If the issue persists, delete ~/.jfl/voice-server.token and restart",
    ],
  },
  [VoiceErrorType.SOX_NOT_INSTALLED]: {
    message: "Audio recording tool (sox) not found.",
    suggestions:
      platform() === "darwin"
        ? ["Install with: brew install sox"]
        : platform() === "win32"
        ? ["Install with: choco install sox.portable"]
        : [
            "Install with: sudo apt-get install sox libsox-fmt-all",
            "Or for Fedora/RHEL: sudo dnf install sox",
          ],
  },
  [VoiceErrorType.RECORDING_FAILED]: {
    message: "Failed to start recording.",
    suggestions: [
      "Check microphone connection",
      "Try a different audio device: jfl voice devices",
      "Check if another application is using the microphone",
    ],
  },
  [VoiceErrorType.TIMEOUT]: {
    message: "Operation timed out.",
    suggestions: [
      "The server may be overloaded - try again",
      "Check server status: jfl voice server status",
      "For large audio files, the model may need more time",
    ],
  },
}

/**
 * Custom error class for voice-related errors
 */
export class VoiceError extends Error {
  public readonly type: VoiceErrorType
  public readonly originalError?: Error
  public readonly context?: Record<string, unknown>
  public readonly recoverable: boolean
  public readonly audioBuffer?: Buffer // Preserved audio for retry

  constructor(
    type: VoiceErrorType,
    options?: {
      originalError?: Error
      context?: Record<string, unknown>
      recoverable?: boolean
      audioBuffer?: Buffer
    }
  ) {
    const errorInfo = VOICE_ERROR_MESSAGES[type]
    super(errorInfo.message)
    this.name = "VoiceError"
    this.type = type
    this.originalError = options?.originalError
    this.context = options?.context
    this.recoverable = options?.recoverable ?? false
    this.audioBuffer = options?.audioBuffer

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, VoiceError)
    }
  }

  /**
   * Get user-friendly suggestions for recovering from this error
   */
  getSuggestions(): string[] {
    return VOICE_ERROR_MESSAGES[this.type].suggestions
  }

  /**
   * Get full error message including original error if present
   */
  getFullMessage(): string {
    let msg = this.message
    if (this.originalError) {
      msg += ` (${this.originalError.message})`
    }
    return msg
  }
}

/**
 * Display a voice error with formatted output and suggestions
 */
export function handleVoiceError(error: VoiceError | Error, spinner?: Ora): void {
  // Stop spinner if active
  if (spinner) {
    spinner.stop()
  }

  // Handle VoiceError with full formatting
  if (error instanceof VoiceError) {
    console.log()
    console.log(chalk.red(`  ✗ ${error.getFullMessage()}`))
    console.log()

    const suggestions = error.getSuggestions()
    if (suggestions.length > 0) {
      console.log(chalk.yellow("  Suggestions:"))
      for (const suggestion of suggestions) {
        console.log(chalk.gray(`    - ${suggestion}`))
      }
      console.log()
    }

    // Show additional context if in debug mode
    if (process.env.DEBUG && error.context) {
      console.log(chalk.gray("  Debug context:"))
      console.log(chalk.gray(`    ${JSON.stringify(error.context, null, 2)}`))
      console.log()
    }

    // Indicate if the error is recoverable
    if (error.recoverable && error.audioBuffer) {
      console.log(chalk.cyan("  Audio has been preserved. You can retry the transcription."))
      console.log()
    }
  } else {
    // Handle generic errors
    console.log()
    console.log(chalk.red(`  ✗ Error: ${error.message}`))
    console.log()

    // Try to infer error type from message and provide suggestions
    const inferredSuggestions = inferErrorSuggestions(error)
    if (inferredSuggestions.length > 0) {
      console.log(chalk.yellow("  Suggestions:"))
      for (const suggestion of inferredSuggestions) {
        console.log(chalk.gray(`    - ${suggestion}`))
      }
      console.log()
    }
  }
}

/**
 * Try to infer helpful suggestions from a generic error
 */
function inferErrorSuggestions(error: Error): string[] {
  const message = error.message.toLowerCase()

  if (message.includes("enoent") || message.includes("not found")) {
    if (message.includes("sock") || message.includes("socket")) {
      return VOICE_ERROR_MESSAGES[VoiceErrorType.SERVER_NOT_RUNNING].suggestions
    }
    if (message.includes("model") || message.includes("ggml")) {
      return VOICE_ERROR_MESSAGES[VoiceErrorType.MODEL_NOT_FOUND].suggestions
    }
    if (message.includes("sox") || message.includes("rec")) {
      return VOICE_ERROR_MESSAGES[VoiceErrorType.SOX_NOT_INSTALLED].suggestions
    }
  }

  if (message.includes("permission") || message.includes("denied") || message.includes("access")) {
    return VOICE_ERROR_MESSAGES[VoiceErrorType.PERMISSION_DENIED].suggestions
  }

  if (message.includes("auth") || message.includes("token") || message.includes("401")) {
    return VOICE_ERROR_MESSAGES[VoiceErrorType.AUTH_FAILED].suggestions
  }

  if (message.includes("timeout") || message.includes("timed out")) {
    return VOICE_ERROR_MESSAGES[VoiceErrorType.TIMEOUT].suggestions
  }

  if (message.includes("connection") || message.includes("connect") || message.includes("econnrefused")) {
    return VOICE_ERROR_MESSAGES[VoiceErrorType.CONNECTION_DROPPED].suggestions
  }

  if (message.includes("microphone") || message.includes("mic") || message.includes("audio")) {
    return VOICE_ERROR_MESSAGES[VoiceErrorType.MIC_UNAVAILABLE].suggestions
  }

  return []
}

/**
 * Create appropriate VoiceError based on error analysis
 */
export function createVoiceError(
  error: Error,
  context?: Record<string, unknown>,
  audioBuffer?: Buffer
): VoiceError {
  const message = error.message.toLowerCase()

  // Determine error type from message patterns
  let type: VoiceErrorType

  if (message.includes("socket not found") || message.includes("voice server socket")) {
    type = VoiceErrorType.SERVER_NOT_RUNNING
  } else if (message.includes("auth") || message.includes("token") || message.includes("unauthorized")) {
    type = VoiceErrorType.AUTH_FAILED
  } else if (message.includes("permission") || message.includes("denied")) {
    type = VoiceErrorType.PERMISSION_DENIED
  } else if (message.includes("model") && (message.includes("not found") || message.includes("missing"))) {
    type = VoiceErrorType.MODEL_NOT_FOUND
  } else if (message.includes("no speech") || message.includes("empty transcript")) {
    type = VoiceErrorType.TRANSCRIPTION_EMPTY
  } else if (message.includes("connection") || message.includes("disconnect")) {
    type = VoiceErrorType.CONNECTION_DROPPED
  } else if (message.includes("sox") || message.includes("no audio recording tool")) {
    type = VoiceErrorType.SOX_NOT_INSTALLED
  } else if (message.includes("microphone") || message.includes("audio device")) {
    type = VoiceErrorType.MIC_UNAVAILABLE
  } else if (message.includes("timeout")) {
    type = VoiceErrorType.TIMEOUT
  } else if (message.includes("record")) {
    type = VoiceErrorType.RECORDING_FAILED
  } else {
    // Default to recording failed for unknown errors
    type = VoiceErrorType.RECORDING_FAILED
  }

  // Determine if recoverable (has audio buffer for retry)
  const recoverable = audioBuffer !== undefined && audioBuffer.length > 0

  return new VoiceError(type, {
    originalError: error,
    context,
    recoverable,
    audioBuffer,
  })
}

/**
 * Check if server is running and return appropriate error if not
 */
export function checkServerRunning(): VoiceError | null {
  const socketPath = getVoiceSocketPath()
  if (!existsSync(socketPath)) {
    return new VoiceError(VoiceErrorType.SERVER_NOT_RUNNING)
  }
  return null
}

/**
 * Check if auth token exists and return appropriate error if not
 */
export function checkAuthToken(): VoiceError | null {
  const token = readAuthToken()
  if (!token) {
    return new VoiceError(VoiceErrorType.AUTH_FAILED, {
      context: { reason: "Token file not found or empty" },
    })
  }
  return null
}

/**
 * Check if a model is available and return appropriate error if not
 */
export function checkModelAvailable(modelName?: string): VoiceError | null {
  const model = modelName || getCurrentDefaultModel()
  if (!isModelDownloaded(model)) {
    return new VoiceError(VoiceErrorType.MODEL_NOT_FOUND, {
      context: { modelName: model },
    })
  }
  return null
}

// Whisper model definitions
// Source: https://huggingface.co/ggerganov/whisper.cpp
const WHISPER_MODELS = {
  tiny: {
    name: "tiny",
    displayName: "Tiny",
    size: "75 MB",
    sizeBytes: 75_000_000,
    description: "Fastest, lowest accuracy. Good for quick testing.",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
  },
  "tiny.en": {
    name: "tiny.en",
    displayName: "Tiny (English)",
    size: "75 MB",
    sizeBytes: 75_000_000,
    description: "English-only tiny model. Slightly better for English.",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    sha256: "921e4cf8b0c2c68d26b626b8b0adfe5f188ccd0e42f74ea3a3c4a02313978c93",
  },
  base: {
    name: "base",
    displayName: "Base",
    size: "142 MB",
    sizeBytes: 142_000_000,
    description: "Balanced speed/accuracy. Recommended default.",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
  },
  "base.en": {
    name: "base.en",
    displayName: "Base (English)",
    size: "142 MB",
    sizeBytes: 142_000_000,
    description: "English-only base model.",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    sha256: "a03779c86df3323075f5e796b3f6af1e6faa6a45b5eb1ef6c3fba57b4ccd0f66",
  },
  small: {
    name: "small",
    displayName: "Small",
    size: "466 MB",
    sizeBytes: 466_000_000,
    description: "Higher accuracy, slower. Good for important transcriptions.",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1c8c6f0da8",
  },
  "small.en": {
    name: "small.en",
    displayName: "Small (English)",
    size: "466 MB",
    sizeBytes: 466_000_000,
    description: "English-only small model.",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    sha256: "db8a495a91d927739e50b3fc1830cbe8b5d3ce7c499c1ab2c1a4d508d4f5bede",
  },
} as const

type ModelName = keyof typeof WHISPER_MODELS

const DEFAULT_MODEL: ModelName = "base"

// Get JFL directory
export function getJflDir(): string {
  return join(homedir(), ".jfl")
}

// Get models directory
function getModelsDir(): string {
  return join(getJflDir(), "models")
}

// Get voice config path
function getVoiceConfigPath(): string {
  return join(getJflDir(), "voice.yaml")
}

// Get voice socket path
function getVoiceSocketPath(): string {
  return join(getJflDir(), "voice.sock")
}

// Get voice server token path
function getVoiceTokenPath(): string {
  return join(getJflDir(), "voice-server.token")
}

// Read auth token from file
export function readAuthToken(): string | null {
  const tokenPath = getVoiceTokenPath()
  if (!existsSync(tokenPath)) {
    return null
  }
  try {
    return readFileSync(tokenPath, "utf-8").trim()
  } catch {
    return null
  }
}

// Ensure directories exist
function ensureDirectories(): void {
  const jflDir = getJflDir()
  const modelsDir = getModelsDir()

  if (!existsSync(jflDir)) {
    mkdirSync(jflDir, { mode: 0o700 })
  }

  if (!existsSync(modelsDir)) {
    mkdirSync(modelsDir, { mode: 0o755 })
  }
}

// Get path for a model file
function getModelPath(modelName: string): string {
  return join(getModelsDir(), `ggml-${modelName}.bin`)
}

// Get path for partial download file
function getPartialPath(modelName: string): string {
  return join(getModelsDir(), `ggml-${modelName}.bin.partial`)
}

// Check if model is downloaded
function isModelDownloaded(modelName: string): boolean {
  const modelPath = getModelPath(modelName)
  if (!existsSync(modelPath)) return false

  const model = WHISPER_MODELS[modelName as ModelName]
  if (!model) return false

  // Check file size is approximately correct (within 1%)
  const stats = statSync(modelPath)
  const expectedSize = model.sizeBytes
  const tolerance = expectedSize * 0.01
  return Math.abs(stats.size - expectedSize) < tolerance
}

// Get current default model from config
function getCurrentDefaultModel(): string {
  const configPath = getVoiceConfigPath()
  if (!existsSync(configPath)) return DEFAULT_MODEL

  try {
    const content = readFileSync(configPath, "utf-8")
    const match = content.match(/^model:\s*(\S+)/m)
    return match ? match[1] : DEFAULT_MODEL
  } catch {
    return DEFAULT_MODEL
  }
}

// Set default model in config
function setDefaultModel(modelName: string): void {
  const configPath = getVoiceConfigPath()
  ensureDirectories()

  let content = ""
  if (existsSync(configPath)) {
    content = readFileSync(configPath, "utf-8")
    if (content.match(/^model:/m)) {
      content = content.replace(/^model:\s*\S+/m, `model: ${modelName}`)
    } else {
      content = `model: ${modelName}\n${content}`
    }
  } else {
    content = `# JFL Voice Configuration\nmodel: ${modelName}\n`
  }

  writeFileSync(configPath, content, { mode: 0o644 })
}

// Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// Download file with progress and resume support
async function downloadFile(
  url: string,
  destPath: string,
  partialPath: string,
  expectedSize: number,
  onProgress: (downloaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check for existing partial download
    let startByte = 0
    if (existsSync(partialPath)) {
      const stats = statSync(partialPath)
      startByte = stats.size
    }

    const headers: Record<string, string> = {}
    if (startByte > 0) {
      headers["Range"] = `bytes=${startByte}-`
    }

    const protocol = url.startsWith("https") ? https : http
    const request = protocol.get(url, { headers }, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
        const redirectUrl = response.headers.location
        if (redirectUrl) {
          downloadFile(redirectUrl, destPath, partialPath, expectedSize, onProgress)
            .then(resolve)
            .catch(reject)
          return
        }
      }

      // Handle 416 Range Not Satisfiable (file already complete)
      if (response.statusCode === 416) {
        if (existsSync(partialPath)) {
          renameSync(partialPath, destPath)
        }
        resolve()
        return
      }

      // Check for successful response
      if (response.statusCode !== 200 && response.statusCode !== 206) {
        reject(new Error(`Download failed with status ${response.statusCode}`))
        return
      }

      const totalSize = response.statusCode === 206
        ? expectedSize
        : parseInt(response.headers["content-length"] || "0", 10)

      const fileStream = createWriteStream(partialPath, {
        flags: startByte > 0 ? "a" : "w",
        mode: 0o644,
      })

      let downloaded = startByte

      response.on("data", (chunk: Buffer) => {
        downloaded += chunk.length
        onProgress(downloaded, totalSize || expectedSize)
      })

      response.pipe(fileStream)

      fileStream.on("finish", () => {
        fileStream.close()
        // Move partial to final destination
        renameSync(partialPath, destPath)
        resolve()
      })

      fileStream.on("error", (err) => {
        fileStream.close()
        reject(err)
      })

      response.on("error", (err) => {
        fileStream.close()
        reject(err)
      })
    })

    request.on("error", (err) => {
      reject(err)
    })
  })
}

// Verify downloaded file SHA256
function verifyChecksum(filePath: string, expectedHash: string): boolean {
  const fileBuffer = readFileSync(filePath)
  const hash = createHash("sha256").update(fileBuffer).digest("hex")
  return hash === expectedHash
}

// =============================================================================
// VoiceClient - WebSocket client for connecting to the whisper server
// =============================================================================

/** Transcript message received from the whisper server */
interface TranscriptMessage {
  type: "partial" | "final"
  text: string
  timestamp?: number
}

/** Error message from the whisper server */
interface ErrorMessage {
  type: "error"
  error: string
  code?: string
}

/** Server message types */
type ServerMessage = TranscriptMessage | ErrorMessage

/** Connection state for the VoiceClient */
type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting"

/** Options for VoiceClient */
export interface VoiceClientOptions {
  /** Path to the Unix socket (default: ~/.jfl/voice.sock) */
  socketPath?: string
  /** Auth token (default: read from ~/.jfl/voice-server.token) */
  authToken?: string
  /** Maximum reconnection attempts (default: 5) */
  maxReconnectAttempts?: number
  /** Initial reconnection delay in ms (default: 1000) */
  initialReconnectDelay?: number
  /** Maximum reconnection delay in ms (default: 30000) */
  maxReconnectDelay?: number
}

/**
 * VoiceClient - Manages WebSocket connection to the whisper server
 *
 * Features:
 * - Connects to Unix socket at ~/.jfl/voice.sock
 * - Authenticates with token from ~/.jfl/voice-server.token
 * - Streams 16-bit PCM audio at 16kHz mono
 * - Receives partial and final transcripts
 * - Auto-reconnects with exponential backoff
 *
 * Usage:
 * ```typescript
 * const client = new VoiceClient()
 *
 * client.onTranscript((text, isFinal) => {
 *   if (isFinal) console.log("Final:", text)
 *   else console.log("Partial:", text)
 * })
 *
 * client.onError((error) => {
 *   console.error("Error:", error.message)
 * })
 *
 * await client.connect()
 *
 * // Send audio chunks (16-bit PCM, 16kHz mono)
 * client.sendAudio(audioBuffer)
 *
 * // When done
 * client.disconnect()
 * ```
 */
export class VoiceClient extends EventEmitter {
  private ws: WebSocket | null = null
  private socketPath: string
  private authToken: string | null
  private state: ConnectionState = "disconnected"
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = false

  // Configuration
  private maxReconnectAttempts: number
  private initialReconnectDelay: number
  private maxReconnectDelay: number

  // Callback holders
  private transcriptCallbacks: Array<(text: string, isFinal: boolean) => void> = []
  private errorCallbacks: Array<(error: Error) => void> = []
  private connectionCallbacks: Array<(state: ConnectionState) => void> = []

  constructor(options: VoiceClientOptions = {}) {
    super()
    this.socketPath = options.socketPath ?? getVoiceSocketPath()
    this.authToken = options.authToken ?? null
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5
    this.initialReconnectDelay = options.initialReconnectDelay ?? 1000
    this.maxReconnectDelay = options.maxReconnectDelay ?? 30000
  }

  /**
   * Get the current connection state
   */
  getState(): ConnectionState {
    return this.state
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === "connected" && this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Connect to the whisper server
   *
   * @throws VoiceError if socket file doesn't exist (SERVER_NOT_RUNNING)
   * @throws VoiceError if auth token is missing (AUTH_FAILED)
   * @throws VoiceError if connection fails
   */
  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      return
    }

    // Check if socket file exists
    if (!existsSync(this.socketPath)) {
      throw new VoiceError(VoiceErrorType.SERVER_NOT_RUNNING, {
        context: { socketPath: this.socketPath },
      })
    }

    // Get auth token if not provided
    if (!this.authToken) {
      this.authToken = readAuthToken()
    }

    if (!this.authToken) {
      throw new VoiceError(VoiceErrorType.AUTH_FAILED, {
        context: { tokenPath: getVoiceTokenPath(), reason: "Token not found" },
      })
    }

    this.setState("connecting")
    this.shouldReconnect = true
    this.reconnectAttempts = 0

    return this.doConnect()
  }

  /**
   * Internal connection method
   */
  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Create WebSocket connection over Unix socket
        // The ws library supports Unix sockets via the socketPath option
        this.ws = new WebSocket(`ws+unix://${this.socketPath}`, {
          headers: {
            Authorization: `Bearer ${this.authToken}`,
          },
        })

        const connectionTimeout = setTimeout(() => {
          if (this.state === "connecting") {
            this.ws?.terminate()
            const error = new Error("Connection timeout")
            this.handleError(error)
            reject(error)
          }
        }, 10000)

        this.ws.on("open", () => {
          clearTimeout(connectionTimeout)
          this.setState("connected")
          this.reconnectAttempts = 0
          this.emit("connected")
          resolve()
        })

        this.ws.on("message", (data: WebSocket.Data) => {
          this.handleMessage(data)
        })

        this.ws.on("error", (error: Error) => {
          clearTimeout(connectionTimeout)
          this.handleError(error)
          if (this.state === "connecting") {
            reject(error)
          }
        })

        this.ws.on("close", (code: number, reason: Buffer) => {
          clearTimeout(connectionTimeout)
          this.handleClose(code, reason.toString())
        })

      } catch (error) {
        this.setState("disconnected")
        const err = error instanceof Error ? error : new Error(String(error))
        this.handleError(err)
        reject(err)
      }
    })
  }

  /**
   * Disconnect from the whisper server
   */
  disconnect(): void {
    this.shouldReconnect = false
    this.clearReconnectTimer()

    if (this.ws) {
      // Remove listeners to prevent reconnection attempts
      this.ws.removeAllListeners()

      if (this.ws.readyState === WebSocket.OPEN ||
          this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, "Client disconnect")
      }

      this.ws = null
    }

    this.setState("disconnected")
    this.emit("disconnected")
  }

  /**
   * Send audio data to the whisper server
   *
   * @param buffer - 16-bit PCM audio data at 16kHz mono
   * @throws Error if not connected
   */
  sendAudio(buffer: Buffer): void {
    if (!this.isConnected()) {
      throw new Error("Not connected to voice server")
    }

    if (!this.ws) {
      throw new Error("WebSocket is null")
    }

    // Send binary audio data
    this.ws.send(buffer, { binary: true }, (error) => {
      if (error) {
        this.handleError(error)
      }
    })
  }

  /**
   * Send end-of-audio signal to get final transcript
   */
  endAudio(): void {
    if (!this.isConnected() || !this.ws) {
      return
    }

    // Send a JSON message indicating end of audio stream
    this.ws.send(JSON.stringify({ type: "end_audio" }))
  }

  /**
   * Register callback for transcript events
   *
   * @param callback - Called with transcript text and whether it's final
   */
  onTranscript(callback: (text: string, isFinal: boolean) => void): void {
    this.transcriptCallbacks.push(callback)
  }

  /**
   * Register callback for error events
   *
   * @param callback - Called with error
   */
  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback)
  }

  /**
   * Register callback for connection state changes
   *
   * @param callback - Called with new connection state
   */
  onConnectionStateChange(callback: (state: ConnectionState) => void): void {
    this.connectionCallbacks.push(callback)
  }

  /**
   * Remove all callbacks
   */
  removeAllCallbacks(): void {
    this.transcriptCallbacks = []
    this.errorCallbacks = []
    this.connectionCallbacks = []
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state
      for (const callback of this.connectionCallbacks) {
        try {
          callback(state)
        } catch (e) {
          // Ignore callback errors
        }
      }
    }
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      // Parse JSON message
      const message: ServerMessage = JSON.parse(data.toString())

      if (message.type === "error") {
        const errorMsg = message as ErrorMessage
        const error = new Error(errorMsg.error)
        this.handleError(error)
        return
      }

      if (message.type === "partial" || message.type === "final") {
        const transcript = message as TranscriptMessage
        const isFinal = transcript.type === "final"

        for (const callback of this.transcriptCallbacks) {
          try {
            callback(transcript.text, isFinal)
          } catch (e) {
            // Ignore callback errors
          }
        }

        this.emit("transcript", transcript.text, isFinal)
      }

    } catch (e) {
      // Failed to parse message - could be binary data or malformed JSON
      // Log but don't treat as error
      if (process.env.DEBUG) {
        console.error("Failed to parse server message:", e)
      }
    }
  }

  private handleError(error: Error): void {
    // Notify error callbacks
    for (const callback of this.errorCallbacks) {
      try {
        callback(error)
      } catch (e) {
        // Ignore callback errors
      }
    }

    this.emit("error", error)
  }

  private handleClose(code: number, reason: string): void {
    const wasConnected = this.state === "connected"
    this.ws = null

    if (process.env.DEBUG) {
      console.log(`WebSocket closed: code=${code}, reason=${reason}`)
    }

    // Check if we should attempt to reconnect
    if (this.shouldReconnect && wasConnected) {
      this.scheduleReconnect()
    } else {
      this.setState("disconnected")
    }

    this.emit("close", code, reason)
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      const error = new Error(
        `Failed to reconnect after ${this.maxReconnectAttempts} attempts`
      )
      this.handleError(error)
      this.setState("disconnected")
      this.emit("reconnect_failed")
      return
    }

    this.setState("reconnecting")
    this.reconnectAttempts++

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.initialReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    )

    if (process.env.DEBUG) {
      console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
    }

    this.emit("reconnecting", this.reconnectAttempts, delay)

    this.reconnectTimer = setTimeout(async () => {
      if (!this.shouldReconnect) {
        return
      }

      try {
        await this.doConnect()
        this.emit("reconnected")
      } catch (error) {
        // doConnect will schedule another reconnect attempt on failure
        // through handleClose callback
      }
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}

// =============================================================================
// AudioRecorder - Cross-platform audio recording from microphone
// =============================================================================

/** Represents an audio input device */
export interface AudioDevice {
  /** Unique identifier for the device */
  id: string
  /** Human-readable device name */
  name: string
  /** Whether this is the system default device */
  isDefault: boolean
}

/** Options for AudioRecorder */
export interface AudioRecorderOptions {
  /** Device ID to record from (default: system default device) */
  device?: string
  /** Target sample rate in Hz (default: 16000) */
  sampleRate?: number
  /** Recording backend to use: 'auto', 'sox', 'arecord', 'rec' (default: 'auto') */
  recorder?: "auto" | "sox" | "arecord" | "rec"
}

/** Recording state */
type RecordingState = "idle" | "recording" | "stopping" | "error"

/**
 * AudioRecorder - Cross-platform audio recording with sample rate conversion
 *
 * Records audio from the system microphone and outputs 16-bit PCM at 16kHz mono.
 * Works on macOS, Linux, and Windows using sox/rec/arecord backends.
 *
 * Prerequisites:
 * - macOS: `brew install sox`
 * - Linux: `sudo apt-get install sox libsox-fmt-all` or `alsa-utils`
 * - Windows: `choco install sox.portable`
 *
 * Usage:
 * ```typescript
 * const recorder = new AudioRecorder({ sampleRate: 16000 })
 *
 * recorder.on('data', (chunk: Buffer) => {
 *   // Process 16-bit PCM audio data
 *   voiceClient.sendAudio(chunk)
 * })
 *
 * recorder.on('error', (error: Error) => {
 *   console.error('Recording error:', error)
 * })
 *
 * await recorder.start()
 *
 * // Later...
 * recorder.stop()
 * ```
 */
export class AudioRecorder extends EventEmitter {
  private state: RecordingState = "idle"
  private process: ChildProcess | null = null
  private device: string | undefined
  private targetSampleRate: number
  private recorderBackend: "sox" | "arecord" | "rec"
  private currentPlatform: NodeJS.Platform
  private disconnectCheckInterval: ReturnType<typeof setInterval> | null = null

  constructor(options: AudioRecorderOptions = {}) {
    super()
    this.device = options.device
    this.targetSampleRate = options.sampleRate ?? 16000
    this.currentPlatform = platform()
    this.recorderBackend = this.selectRecorder(options.recorder ?? "auto")
  }

  /**
   * List available audio input devices
   *
   * @returns Promise resolving to array of available audio devices
   */
  static async listDevices(): Promise<AudioDevice[]> {
    const currentPlatform = platform()

    try {
      if (currentPlatform === "darwin") {
        return await AudioRecorder.listDevicesMacOS()
      } else if (currentPlatform === "linux") {
        return await AudioRecorder.listDevicesLinux()
      } else if (currentPlatform === "win32") {
        return await AudioRecorder.listDevicesWindows()
      } else {
        throw new Error(`Unsupported platform: ${currentPlatform}`)
      }
    } catch (error) {
      // If listing fails, return empty array with a warning
      console.warn("Failed to list audio devices:", error)
      return []
    }
  }

  /**
   * List audio devices on macOS using sox
   */
  private static async listDevicesMacOS(): Promise<AudioDevice[]> {
    const devices: AudioDevice[] = []

    try {
      // On macOS, sox -d uses coreaudio which lists devices differently
      // Try using system_profiler for detailed device list
      const output = execSync(
        "system_profiler SPAudioDataType -json 2>/dev/null",
        { encoding: "utf-8", timeout: 5000 }
      )

      const data = JSON.parse(output)
      const audioData = data.SPAudioDataType

      if (audioData && Array.isArray(audioData)) {
        for (const device of audioData) {
          // Each audio device group may have input devices
          const name = device._name || "Unknown Device"
          const items = device._items || []

          for (const item of items) {
            if (item.coreaudio_input_source) {
              devices.push({
                id: String(item.coreaudio_device_input || name),
                name: String(item._name || name),
                isDefault: item.coreaudio_default_audio_input_device === "yes",
              })
            }
          }

          // Also check the main device entry
          if (device.coreaudio_input_source) {
            devices.push({
              id: String(device.coreaudio_device_input || name),
              name: String(name),
              isDefault: device.coreaudio_default_audio_input_device === "yes",
            })
          }
        }
      }
    } catch {
      // Fallback: try using sox to list devices if available
      try {
        // Sox on macOS with coreaudio can list devices
        const soxOutput = execSync("rec -q --list-devices 2>&1 || true", {
          encoding: "utf-8",
          timeout: 5000,
        })

        // Parse sox output for device names
        const lines = soxOutput.split("\n")
        for (const line of lines) {
          const match = line.match(/^\s*(\d+)\s+(.+)$/)
          if (match) {
            devices.push({
              id: match[1],
              name: match[2].trim(),
              isDefault: match[1] === "0",
            })
          }
        }
      } catch {
        // Last resort: add a default device entry
        devices.push({
          id: "default",
          name: "Default Input Device",
          isDefault: true,
        })
      }
    }

    // If no devices found, add default
    if (devices.length === 0) {
      devices.push({
        id: "default",
        name: "Default Input Device",
        isDefault: true,
      })
    }

    return devices
  }

  /**
   * List audio devices on Linux using arecord or pactl
   */
  private static async listDevicesLinux(): Promise<AudioDevice[]> {
    const devices: AudioDevice[] = []

    // Try PulseAudio/PipeWire first
    try {
      const pactlOutput = execSync("pactl list short sources 2>/dev/null", {
        encoding: "utf-8",
        timeout: 5000,
      })

      const lines = pactlOutput.trim().split("\n")
      for (const line of lines) {
        const parts = line.split("\t")
        if (parts.length >= 2) {
          const id = parts[1]
          // Skip monitor devices (output monitors)
          if (id.includes(".monitor")) continue

          devices.push({
            id,
            name: id,
            isDefault: id.includes("@DEFAULT_SOURCE@") || devices.length === 0,
          })
        }
      }

      if (devices.length > 0) {
        return devices
      }
    } catch {
      // PulseAudio not available, try ALSA
    }

    // Try ALSA
    try {
      const arecordOutput = execSync("arecord -l 2>/dev/null", {
        encoding: "utf-8",
        timeout: 5000,
      })

      const lines = arecordOutput.split("\n")
      for (const line of lines) {
        // Parse lines like: "card 0: PCH [HDA Intel PCH], device 0: ALC892 Analog [ALC892 Analog]"
        const match = line.match(/^card\s+(\d+):\s+([^,]+),\s+device\s+(\d+):\s+(.+)$/)
        if (match) {
          const cardNum = match[1]
          const deviceNum = match[3]
          const deviceName = match[4].trim()

          devices.push({
            id: `hw:${cardNum},${deviceNum}`,
            name: `${match[2].trim()} - ${deviceName}`,
            isDefault: devices.length === 0,
          })
        }
      }
    } catch {
      // ALSA not available
    }

    // Fallback to default
    if (devices.length === 0) {
      devices.push({
        id: "default",
        name: "Default Input Device",
        isDefault: true,
      })
    }

    return devices
  }

  /**
   * List audio devices on Windows using sox or powershell
   */
  private static async listDevicesWindows(): Promise<AudioDevice[]> {
    const devices: AudioDevice[] = []

    try {
      // Use PowerShell to list audio input devices
      const psCommand = `
        Get-WmiObject Win32_SoundDevice |
        Where-Object { $_.Status -eq 'OK' } |
        Select-Object DeviceID, Name |
        ConvertTo-Json
      `

      const output = execSync(`powershell -Command "${psCommand}"`, {
        encoding: "utf-8",
        timeout: 10000,
      })

      const data = JSON.parse(output)
      const deviceList = Array.isArray(data) ? data : [data]

      for (let i = 0; i < deviceList.length; i++) {
        const device = deviceList[i]
        if (device && device.Name) {
          devices.push({
            id: device.DeviceID || String(i),
            name: device.Name,
            isDefault: i === 0,
          })
        }
      }
    } catch {
      // Fallback to default
    }

    if (devices.length === 0) {
      devices.push({
        id: "-1",
        name: "Default Input Device",
        isDefault: true,
      })
    }

    return devices
  }

  /**
   * Select the appropriate recorder backend based on platform and availability
   */
  private selectRecorder(preference: "auto" | "sox" | "arecord" | "rec"): "sox" | "arecord" | "rec" {
    if (preference !== "auto") {
      // Verify the requested backend is available
      if (this.isRecorderAvailable(preference)) {
        return preference
      }
      console.warn(`Recorder '${preference}' not available, falling back to auto-detection`)
    }

    // Auto-detect based on platform
    if (this.currentPlatform === "darwin") {
      // macOS: prefer rec (comes with sox), then sox
      if (this.isRecorderAvailable("rec")) return "rec"
      if (this.isRecorderAvailable("sox")) return "sox"
    } else if (this.currentPlatform === "linux") {
      // Linux: prefer arecord (ALSA), then sox
      if (this.isRecorderAvailable("arecord")) return "arecord"
      if (this.isRecorderAvailable("sox")) return "sox"
      if (this.isRecorderAvailable("rec")) return "rec"
    } else if (this.currentPlatform === "win32") {
      // Windows: prefer sox
      if (this.isRecorderAvailable("sox")) return "sox"
      if (this.isRecorderAvailable("rec")) return "rec"
    }

    // Default fallback - throw VoiceError
    throw new VoiceError(VoiceErrorType.SOX_NOT_INSTALLED)
  }

  /**
   * Check if a recorder binary is available
   */
  private isRecorderAvailable(recorder: string): boolean {
    try {
      const command = this.currentPlatform === "win32" ? `where ${recorder}` : `which ${recorder}`
      execSync(command, { stdio: "ignore", timeout: 3000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.state === "recording"
  }

  /**
   * Get current recording state
   */
  getState(): RecordingState {
    return this.state
  }

  /**
   * Start recording audio
   *
   * @throws Error if already recording
   * @throws Error if recorder is not available
   */
  async start(): Promise<void> {
    if (this.state === "recording") {
      throw new Error("Already recording")
    }

    this.state = "recording"

    try {
      const args = this.buildRecorderArgs()
      const command = this.recorderBackend === "arecord" ? "arecord" : this.recorderBackend

      if (process.env.DEBUG) {
        console.log(`Starting recorder: ${command} ${args.join(" ")}`)
      }

      this.process = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
      })

      if (!this.process.stdout) {
        throw new Error("Failed to open audio stream")
      }

      // Set up stdout as the audio data stream
      const stdout = this.process.stdout as Readable

      // Buffer for collecting data
      let audioBuffer = Buffer.alloc(0)
      const chunkSize = 3200 // 100ms of 16kHz 16-bit mono audio

      stdout.on("data", (chunk: Buffer) => {
        // Accumulate data
        audioBuffer = Buffer.concat([audioBuffer, chunk])

        // Emit complete chunks
        while (audioBuffer.length >= chunkSize) {
          const emitChunk = audioBuffer.subarray(0, chunkSize)
          audioBuffer = audioBuffer.subarray(chunkSize)
          this.emit("data", emitChunk)
        }
      })

      stdout.on("end", () => {
        // Emit any remaining data
        if (audioBuffer.length > 0) {
          this.emit("data", audioBuffer)
        }
        this.handleProcessEnd()
      })

      stdout.on("error", (error: Error) => {
        this.handleError(error)
      })

      // Handle stderr for warnings/errors
      if (this.process.stderr) {
        this.process.stderr.on("data", (data: Buffer) => {
          const message = data.toString()
          // Only emit as error if it contains actual error indicators
          if (message.toLowerCase().includes("error") ||
              message.toLowerCase().includes("fail") ||
              message.toLowerCase().includes("cannot")) {
            this.handleError(new Error(`Recorder error: ${message}`))
          } else if (process.env.DEBUG) {
            console.warn("Recorder stderr:", message)
          }
        })
      }

      // Handle process errors
      this.process.on("error", (error: Error) => {
        this.handleError(error)
      })

      this.process.on("exit", (code, signal) => {
        if (this.state === "recording") {
          // Unexpected exit
          if (code !== 0 && code !== null) {
            this.handleError(new Error(`Recorder exited with code ${code}`))
          } else if (signal) {
            this.handleError(new Error(`Recorder killed by signal ${signal}`))
          } else {
            this.handleProcessEnd()
          }
        }
      })

      // Start monitoring for device disconnect
      this.startDisconnectMonitor()

    } catch (error) {
      this.state = "error"
      throw error
    }
  }

  /**
   * Stop recording
   */
  stop(): void {
    if (this.state !== "recording") {
      return
    }

    this.state = "stopping"
    this.stopDisconnectMonitor()

    if (this.process) {
      // Send SIGTERM for graceful shutdown
      try {
        this.process.kill("SIGTERM")
      } catch {
        // Process may have already exited
      }

      // Force kill after timeout
      const killTimeout = setTimeout(() => {
        if (this.process) {
          try {
            this.process.kill("SIGKILL")
          } catch {
            // Ignore
          }
        }
      }, 1000)

      this.process.once("exit", () => {
        clearTimeout(killTimeout)
        this.process = null
        this.state = "idle"
        this.emit("stopped")
      })
    } else {
      this.state = "idle"
      this.emit("stopped")
    }
  }

  /**
   * Build command-line arguments for the recorder
   */
  private buildRecorderArgs(): string[] {
    const args: string[] = []

    if (this.recorderBackend === "arecord") {
      // ALSA arecord arguments
      args.push(
        "-f", "S16_LE",           // 16-bit signed little-endian
        "-r", String(this.targetSampleRate),
        "-c", "1",                // Mono
        "-t", "raw",              // Raw PCM output
        "-q"                      // Quiet mode
      )

      if (this.device) {
        args.push("-D", this.device)
      }
    } else if (this.recorderBackend === "sox" || this.recorderBackend === "rec") {
      // sox/rec arguments for recording
      // Format: rec [options] output-file
      args.push(
        "-q",                     // Quiet
        "-r", String(this.targetSampleRate),
        "-c", "1",                // Mono
        "-b", "16",               // 16-bit
        "-e", "signed-integer",   // Signed integer encoding
        "-t", "raw",              // Raw PCM output
        "-"                       // Output to stdout
      )

      if (this.device) {
        // Device specification differs by platform
        if (this.currentPlatform === "darwin") {
          // macOS: use -d for default device or specify device
          args.unshift("-d", this.device)
        } else if (this.currentPlatform === "linux") {
          // Linux: AUDIODEV environment or -d flag
          args.unshift("-d", this.device)
        } else if (this.currentPlatform === "win32") {
          // Windows: use -t waveaudio with device number
          args.unshift("-t", "waveaudio", this.device)
        }
      } else {
        // Default device
        if (this.currentPlatform === "darwin") {
          args.unshift("-d", "coreaudio", "default")
        } else if (this.currentPlatform === "linux") {
          // Linux: pulseaudio or alsa default
          args.unshift("-d")
        } else if (this.currentPlatform === "win32") {
          args.unshift("-t", "waveaudio", "-1")
        }
      }
    }

    return args
  }

  /**
   * Start monitoring for device disconnect
   */
  private startDisconnectMonitor(): void {
    // Check every 2 seconds if the process is still healthy
    this.disconnectCheckInterval = setInterval(() => {
      if (this.state === "recording" && this.process) {
        // Check if process is still running
        try {
          // Sending signal 0 checks if process exists without affecting it
          process.kill(this.process.pid!, 0)
        } catch {
          // Process doesn't exist
          this.handleError(new Error("Audio device disconnected or recorder stopped unexpectedly"))
          this.stop()
        }
      }
    }, 2000)
  }

  /**
   * Stop disconnect monitoring
   */
  private stopDisconnectMonitor(): void {
    if (this.disconnectCheckInterval) {
      clearInterval(this.disconnectCheckInterval)
      this.disconnectCheckInterval = null
    }
  }

  /**
   * Handle process end
   */
  private handleProcessEnd(): void {
    this.stopDisconnectMonitor()

    if (this.state === "recording") {
      this.state = "idle"
      this.emit("end")
    }
  }

  /**
   * Handle recording error
   */
  private handleError(error: Error): void {
    this.stopDisconnectMonitor()
    this.state = "error"
    this.emit("error", error)
  }
}

// List models command
export async function listModelsCommand(): Promise<void> {
  console.log(chalk.bold("\n🎤 JFL Voice - Available Models\n"))

  ensureDirectories()
  const currentDefault = getCurrentDefaultModel()

  console.log(chalk.gray("Models are downloaded from Hugging Face (ggerganov/whisper.cpp)\n"))

  const modelNames = Object.keys(WHISPER_MODELS) as ModelName[]

  // Table header
  console.log(
    chalk.gray("  ") +
    chalk.bold("Model".padEnd(14)) +
    chalk.bold("Size".padEnd(10)) +
    chalk.bold("Status".padEnd(14)) +
    chalk.bold("Description")
  )
  console.log(chalk.gray("  " + "─".repeat(70)))

  for (const name of modelNames) {
    const model = WHISPER_MODELS[name]
    const isDownloaded = isModelDownloaded(name)
    const isDefault = name === currentDefault

    const statusIcon = isDownloaded ? chalk.green("✓") : chalk.gray("○")
    const defaultMarker = isDefault ? chalk.cyan(" (default)") : ""
    const status = isDownloaded ? chalk.green("downloaded") + defaultMarker : chalk.gray("not downloaded")

    console.log(
      `  ${statusIcon} ` +
      chalk.white(name.padEnd(12)) +
      chalk.gray(model.size.padEnd(10)) +
      status.padEnd(24) +
      chalk.gray(model.description)
    )
  }

  console.log()
  console.log(chalk.cyan("Commands:"))
  console.log("  jfl voice model download <name>   Download a model")
  console.log("  jfl voice model default <name>    Set default model")
  console.log()
}

// Download model command
export async function downloadModelCommand(modelName: string, options?: { force?: boolean }): Promise<void> {
  console.log(chalk.bold("\n🎤 JFL Voice - Download Model\n"))

  // Validate model name
  if (!(modelName in WHISPER_MODELS)) {
    console.log(chalk.red(`Unknown model: ${modelName}`))
    console.log(chalk.gray("\nAvailable models:"))
    for (const name of Object.keys(WHISPER_MODELS)) {
      console.log(`  - ${name}`)
    }
    return
  }

  const model = WHISPER_MODELS[modelName as ModelName]
  ensureDirectories()

  const modelPath = getModelPath(modelName)
  const partialPath = getPartialPath(modelName)

  // Check if already downloaded
  if (isModelDownloaded(modelName) && !options?.force) {
    console.log(chalk.green(`✓ Model '${modelName}' is already downloaded`))
    console.log(chalk.gray(`  Location: ${modelPath}`))
    return
  }

  // Check for partial download
  let resuming = false
  if (existsSync(partialPath)) {
    const stats = statSync(partialPath)
    const percent = ((stats.size / model.sizeBytes) * 100).toFixed(1)
    console.log(chalk.yellow(`Found incomplete download (${percent}% complete)`))

    const { resume } = await inquirer.prompt([
      {
        type: "confirm",
        name: "resume",
        message: "Resume download?",
        default: true,
      },
    ])

    if (!resume) {
      unlinkSync(partialPath)
    } else {
      resuming = true
    }
  }

  console.log(chalk.gray(`Model: ${model.displayName}`))
  console.log(chalk.gray(`Size: ${model.size}`))
  console.log(chalk.gray(`URL: ${model.url}`))
  if (resuming) {
    console.log(chalk.cyan("Resuming download..."))
  }
  console.log()

  const spinner = ora({
    text: "Starting download...",
    prefixText: "  ",
  }).start()

  const startTime = Date.now()
  let lastUpdate = 0

  try {
    await downloadFile(
      model.url,
      modelPath,
      partialPath,
      model.sizeBytes,
      (downloaded, total) => {
        const now = Date.now()
        // Update at most every 100ms to avoid flickering
        if (now - lastUpdate < 100) return
        lastUpdate = now

        const percent = ((downloaded / total) * 100).toFixed(1)
        const elapsed = (now - startTime) / 1000
        const speed = downloaded / elapsed
        const remaining = (total - downloaded) / speed

        spinner.text = `Downloading: ${percent}% (${formatBytes(downloaded)}/${formatBytes(total)}) - ${formatBytes(speed)}/s - ${remaining.toFixed(0)}s remaining`
      }
    )

    spinner.text = "Verifying checksum..."

    // Verify checksum
    if (!verifyChecksum(modelPath, model.sha256)) {
      spinner.fail("Checksum verification failed")
      console.log(chalk.red("\nThe downloaded file is corrupted."))
      console.log(chalk.gray("Try downloading again with: jfl voice model download " + modelName + " --force"))
      unlinkSync(modelPath)
      return
    }

    spinner.succeed("Download complete!")

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log()
    console.log(chalk.green(`✓ Model '${modelName}' downloaded successfully`))
    console.log(chalk.gray(`  Location: ${modelPath}`))
    console.log(chalk.gray(`  Time: ${elapsed}s`))

    // Offer to set as default if base model
    if (modelName === "base" && getCurrentDefaultModel() !== "base") {
      const { setDefault } = await inquirer.prompt([
        {
          type: "confirm",
          name: "setDefault",
          message: "Set 'base' as your default model?",
          default: true,
        },
      ])

      if (setDefault) {
        setDefaultModel("base")
        console.log(chalk.green("✓ Default model set to 'base'"))
      }
    }
  } catch (error) {
    spinner.fail("Download failed")
    console.error(chalk.red(error))
    console.log(chalk.gray("\nYou can resume the download by running the same command again."))
  }

  console.log()
}

// Set default model command
export async function setDefaultModelCommand(modelName: string): Promise<void> {
  // Validate model name
  if (!(modelName in WHISPER_MODELS)) {
    console.log(chalk.red(`Unknown model: ${modelName}`))
    console.log(chalk.gray("\nAvailable models:"))
    for (const name of Object.keys(WHISPER_MODELS)) {
      console.log(`  - ${name}`)
    }
    return
  }

  // Check if model is downloaded
  if (!isModelDownloaded(modelName)) {
    console.log(chalk.yellow(`Model '${modelName}' is not downloaded yet.`))

    const { download } = await inquirer.prompt([
      {
        type: "confirm",
        name: "download",
        message: "Download it now?",
        default: true,
      },
    ])

    if (download) {
      await downloadModelCommand(modelName)
    }
    return
  }

  setDefaultModel(modelName)
  console.log(chalk.green(`✓ Default model set to '${modelName}'`))
}

// List audio devices command
export async function listDevicesCommand(): Promise<void> {
  console.log(chalk.bold("\n🎤 JFL Voice - Audio Devices\n"))

  const spinner = ora({
    text: "Detecting audio devices...",
    prefixText: "  ",
  }).start()

  try {
    const devices = await AudioRecorder.listDevices()

    spinner.stop()

    if (devices.length === 0) {
      console.log(chalk.yellow("  No audio input devices found."))
      console.log()
      console.log(chalk.gray("  Make sure you have a microphone connected and permissions granted."))
      console.log()
      return
    }

    console.log(chalk.gray(`  Found ${devices.length} audio input device${devices.length > 1 ? "s" : ""}:\n`))

    // Table header
    console.log(
      chalk.gray("  ") +
      chalk.bold("Device".padEnd(40)) +
      chalk.bold("ID".padEnd(30)) +
      chalk.bold("Default")
    )
    console.log(chalk.gray("  " + "─".repeat(75)))

    for (const device of devices) {
      const defaultMarker = device.isDefault ? chalk.green("✓") : chalk.gray("-")
      const deviceName = String(device.name || "Unknown").substring(0, 38).padEnd(40)
      const deviceId = String(device.id || "default").substring(0, 28).padEnd(30)
      console.log(
        `  ${deviceName}` +
        chalk.gray(deviceId) +
        defaultMarker
      )
    }

    console.log()
    console.log(chalk.cyan("Usage:"))
    console.log("  jfl voice test                    Test with default device")
    console.log("  jfl voice test --device <id>      Test with specific device")
    console.log()

  } catch (error) {
    spinner.fail("Failed to list devices")
    console.error(chalk.red(`  ${error}`))
    console.log()
  }
}

// Voice test command - records audio and sends to whisper server for transcription
export async function voiceTestCommand(options?: { device?: string }): Promise<void> {
  console.log(chalk.bold("\n🎤 JFL Voice - Test\n"))

  const duration = 3 // Fixed 3 second recording

  // Step 1: Check if whisper server is running
  const serverError = checkServerRunning()
  if (serverError) {
    handleVoiceError(serverError)
    return
  }

  // Step 2: Check for auth token
  const authError = checkAuthToken()
  if (authError) {
    handleVoiceError(authError)
    return
  }

  const authToken = readAuthToken()!
  const socketPath = getVoiceSocketPath()

  // Step 3: Check for sox/rec availability
  let recorder: AudioRecorder
  try {
    recorder = new AudioRecorder({
      device: options?.device,
      sampleRate: 16000,
    })
  } catch (error) {
    if (error instanceof VoiceError) {
      handleVoiceError(error)
    } else {
      handleVoiceError(createVoiceError(error instanceof Error ? error : new Error(String(error))))
    }
    return
  }

  console.log(chalk.gray("  Recording for 3 seconds..."))
  console.log(chalk.gray("  Speak clearly into your microphone!\n"))

  // Collect audio data
  const audioChunks: Buffer[] = []
  let peakLevel = 0

  recorder.on("data", (chunk: Buffer) => {
    audioChunks.push(chunk)

    // Calculate peak level from 16-bit samples
    for (let i = 0; i < chunk.length - 1; i += 2) {
      const sample = chunk.readInt16LE(i)
      const level = Math.abs(sample) / 32768
      if (level > peakLevel) {
        peakLevel = level
      }
    }
  })

  let recordingError: Error | null = null
  recorder.on("error", (error: Error) => {
    recordingError = error
  })

  // Step 4: Start recording with countdown
  try {
    await recorder.start()
  } catch (error) {
    const voiceError = new VoiceError(VoiceErrorType.RECORDING_FAILED, {
      originalError: error instanceof Error ? error : new Error(String(error)),
      context: { device: options?.device },
    })
    handleVoiceError(voiceError)
    return
  }

  // Countdown display
  for (let i = duration; i > 0; i--) {
    process.stdout.write(`  Recording... ${chalk.cyan(String(i))}...\r`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  process.stdout.write("                              \r") // Clear countdown line

  recorder.stop()

  // Wait for recorder to fully stop
  await new Promise<void>((resolve) => {
    const checkStopped = () => {
      if (recorder.getState() === "idle") {
        resolve()
      } else {
        setTimeout(checkStopped, 50)
      }
    }
    setTimeout(checkStopped, 100)
  })

  if (recordingError !== null) {
    const voiceError = new VoiceError(VoiceErrorType.RECORDING_FAILED, {
      originalError: recordingError,
      context: { device: options?.device },
    })
    handleVoiceError(voiceError)
    return
  }

  // Check if we got any audio
  const totalBytes = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  if (totalBytes === 0) {
    const voiceError = new VoiceError(VoiceErrorType.MIC_UNAVAILABLE, {
      context: { totalBytes: 0, device: options?.device },
    })
    handleVoiceError(voiceError)
    return
  }

  // Check audio levels
  if (peakLevel < 0.01) {
    // Low audio but not an error, just a warning
    console.log(chalk.yellow("  ⚠ Very low audio level detected"))
    console.log(chalk.gray("  Suggestion: Try speaking louder or check microphone"))
    console.log()
  }

  // Combine all audio chunks
  const audioBuffer = Buffer.concat(audioChunks)

  // Step 5: Connect to whisper server and send audio
  console.log(chalk.gray("  Transcribing..."))

  const client = new VoiceClient({
    socketPath,
    authToken,
    maxReconnectAttempts: 1, // Don't retry for test
  })

  let transcription = ""
  let transcriptionReceived = false
  let transcriptionError: Error | null = null

  client.onTranscript((text, isFinal) => {
    if (isFinal) {
      transcription = text
      transcriptionReceived = true
    }
  })

  client.onError((error) => {
    transcriptionError = error
  })

  try {
    await client.connect()

    // Send audio data
    client.sendAudio(audioBuffer)

    // Signal end of audio
    client.endAudio()

    // Wait for transcription with timeout
    const timeout = 10000 // 10 seconds
    const startTime = Date.now()

    while (!transcriptionReceived && !transcriptionError) {
      if (Date.now() - startTime > timeout) {
        transcriptionError = new VoiceError(VoiceErrorType.TIMEOUT, {
          context: { timeout, operation: "transcription" },
          recoverable: true,
          audioBuffer,
        })
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    client.disconnect()

  } catch (error) {
    client.disconnect()
    const voiceError = error instanceof VoiceError
      ? error
      : createVoiceError(
          error instanceof Error ? error : new Error(String(error)),
          { operation: "connect" },
          audioBuffer
        )
    handleVoiceError(voiceError)
    return
  }

  // Step 6: Display results
  console.log()

  if (transcriptionError) {
    const voiceError = transcriptionError instanceof VoiceError
      ? transcriptionError
      : createVoiceError(transcriptionError, { operation: "transcription" }, audioBuffer)
    handleVoiceError(voiceError)
    return
  }

  if (!transcription || transcription.trim() === "") {
    const voiceError = new VoiceError(VoiceErrorType.TRANSCRIPTION_EMPTY, {
      context: { audioLength: totalBytes, peakLevel },
      recoverable: true,
      audioBuffer,
    })
    handleVoiceError(voiceError)
    return
  }

  // Success! Show the transcription
  console.log(chalk.green("  ✓ Transcription successful!\n"))
  console.log(chalk.white("  You said:"))
  console.log(chalk.cyan(`  "${transcription.trim()}"`))
  console.log()

  // Show audio stats
  const durationActual = totalBytes / (16000 * 2) // 16kHz, 16-bit
  console.log(chalk.gray(`  Audio: ${durationActual.toFixed(1)}s, peak level ${(peakLevel * 100).toFixed(0)}%`))
  console.log()
}

// Test audio recording command (without transcription, for debugging)
export async function testRecordingCommand(options?: { device?: string, duration?: number }): Promise<void> {
  console.log(chalk.bold("\n🎤 JFL Voice - Recording Test\n"))

  const duration = options?.duration ?? 5

  // Check for sox/rec availability
  try {
    const recorder = new AudioRecorder({
      device: options?.device,
      sampleRate: 16000,
    })

    console.log(chalk.gray(`  Recording for ${duration} seconds...`))
    console.log(chalk.gray(`  Format: 16-bit PCM, 16kHz, mono`))
    if (options?.device) {
      console.log(chalk.gray(`  Device: ${options.device}`))
    } else {
      console.log(chalk.gray(`  Device: default`))
    }
    console.log()

    let totalBytes = 0
    let chunkCount = 0
    let peakLevel = 0

    recorder.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length
      chunkCount++

      // Calculate peak level from 16-bit samples
      for (let i = 0; i < chunk.length - 1; i += 2) {
        const sample = chunk.readInt16LE(i)
        const level = Math.abs(sample) / 32768
        if (level > peakLevel) {
          peakLevel = level
        }
      }
    })

    recorder.on("error", (error: Error) => {
      console.error(chalk.red(`\n  Recording error: ${error.message}`))
    })

    const spinner = ora({
      text: "Recording...",
      prefixText: "  ",
    }).start()

    await recorder.start()

    // Record for specified duration
    await new Promise<void>((resolve) => {
      const startTime = Date.now()
      const updateInterval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000
        const remaining = Math.max(0, duration - elapsed)

        // Create a visual level meter
        const levelBars = Math.round(peakLevel * 20)
        const meter = "█".repeat(levelBars) + "░".repeat(20 - levelBars)

        spinner.text = `Recording... ${remaining.toFixed(1)}s remaining  [${meter}]`

        if (elapsed >= duration) {
          clearInterval(updateInterval)
          recorder.stop()
          resolve()
        }
      }, 100)
    })

    spinner.succeed("Recording complete!")
    console.log()

    // Show stats
    const durationActual = totalBytes / (16000 * 2) // 16kHz, 16-bit
    console.log(chalk.gray("  Statistics:"))
    console.log(`  - Duration: ${durationActual.toFixed(2)}s`)
    console.log(`  - Data received: ${formatBytes(totalBytes)}`)
    console.log(`  - Chunks: ${chunkCount}`)
    console.log(`  - Peak level: ${(peakLevel * 100).toFixed(1)}%`)

    if (peakLevel < 0.01) {
      console.log()
      console.log(chalk.yellow("  ⚠️  No audio detected. Check your microphone:"))
      console.log(chalk.gray("      - Is the microphone connected and enabled?"))
      console.log(chalk.gray("      - Does the application have microphone permission?"))
      console.log(chalk.gray("      - Try speaking louder or moving closer to the mic."))
    } else if (peakLevel < 0.1) {
      console.log()
      console.log(chalk.yellow("  ⚠️  Audio level is low. Consider:"))
      console.log(chalk.gray("      - Speaking louder"))
      console.log(chalk.gray("      - Increasing microphone gain"))
      console.log(chalk.gray("      - Moving closer to the microphone"))
    } else {
      console.log()
      console.log(chalk.green("  ✓ Audio input is working correctly!"))
    }

    console.log()

  } catch (error) {
    if (error instanceof VoiceError) {
      handleVoiceError(error)
    } else {
      handleVoiceError(createVoiceError(error instanceof Error ? error : new Error(String(error))))
    }
  }
}

// Voice configuration interface
interface VoiceConfig {
  model: string
  device: string
  sampleRate: number
  autoStart: boolean
}

// Read voice config from YAML file
function readVoiceConfig(): VoiceConfig | null {
  const configPath = getVoiceConfigPath()
  if (!existsSync(configPath)) {
    return null
  }

  try {
    const content = readFileSync(configPath, "utf-8")
    const config: VoiceConfig = {
      model: "base",
      device: "default",
      sampleRate: 16000,
      autoStart: false,
    }

    // Parse YAML manually (simple key: value format)
    const lines = content.split("\n")
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith("#") || !trimmed.includes(":")) continue

      const [key, ...valueParts] = trimmed.split(":")
      const value = valueParts.join(":").trim()

      if (key === "model") config.model = value
      else if (key === "device") config.device = value
      else if (key === "sampleRate") config.sampleRate = parseInt(value, 10) || 16000
      else if (key === "autoStart") config.autoStart = value === "true"
    }

    return config
  } catch {
    return null
  }
}

// Write voice config to YAML file
function writeVoiceConfig(config: VoiceConfig): void {
  ensureDirectories()
  const configPath = getVoiceConfigPath()

  const content = `# JFL Voice Configuration
# Generated by: jfl voice setup
# Re-run setup to change settings: jfl voice setup

model: ${config.model}
device: ${config.device}
sampleRate: ${config.sampleRate}
autoStart: ${config.autoStart}
`

  writeFileSync(configPath, content, { mode: 0o644 })
}

// Check microphone permissions on macOS
async function checkMicPermissions(): Promise<{ granted: boolean; message: string }> {
  if (platform() !== "darwin") {
    return { granted: true, message: "Permissions check not required on this platform" }
  }

  try {
    // On macOS, try a quick recording test to trigger permission prompt
    // If sox can record, permissions are granted
    execSync("rec -q -r 16000 -c 1 -b 16 -e signed-integer -t raw - trim 0 0.1 2>/dev/null | head -c 1", {
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    })
    return { granted: true, message: "Microphone access granted" }
  } catch (error) {
    // Check if it's a permission error
    try {
      // Try to check system preferences
      const result = execSync(
        "defaults read com.apple.controlcenter 'NSStatusItem Visible Microphone' 2>/dev/null || echo 'unknown'",
        { encoding: "utf-8", timeout: 3000 }
      ).trim()

      if (result === "unknown") {
        return {
          granted: false,
          message: "Unable to determine microphone permission status. Try recording to trigger permission prompt.",
        }
      }
    } catch {
      // Ignore
    }

    return {
      granted: false,
      message: "Microphone access may not be granted. Go to System Preferences > Privacy & Security > Microphone",
    }
  }
}

// Test audio device with a short recording
async function testAudioDevice(
  device: string | undefined,
  durationSecs: number = 3
): Promise<{ success: boolean; peakLevel: number; error?: string }> {
  return new Promise((resolve) => {
    try {
      const recorder = new AudioRecorder({
        device: device === "default" ? undefined : device,
        sampleRate: 16000,
      })

      let totalBytes = 0
      let peakLevel = 0
      let hasError = false

      recorder.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length

        // Calculate peak level from 16-bit samples
        for (let i = 0; i < chunk.length - 1; i += 2) {
          const sample = chunk.readInt16LE(i)
          const level = Math.abs(sample) / 32768
          if (level > peakLevel) {
            peakLevel = level
          }
        }
      })

      recorder.on("error", (error: Error) => {
        hasError = true
        recorder.stop()
        resolve({ success: false, peakLevel: 0, error: error.message })
      })

      recorder.start().then(() => {
        // Record for specified duration
        setTimeout(() => {
          recorder.stop()

          if (!hasError) {
            resolve({
              success: totalBytes > 0,
              peakLevel,
              error: totalBytes === 0 ? "No audio data received" : undefined,
            })
          }
        }, durationSecs * 1000)
      }).catch((error) => {
        resolve({ success: false, peakLevel: 0, error: String(error) })
      })

    } catch (error) {
      resolve({ success: false, peakLevel: 0, error: String(error) })
    }
  })
}

// First-time setup wizard
export async function voiceSetupCommand(): Promise<void> {
  console.log(chalk.bold("\n🎤 JFL Voice - Setup Wizard\n"))

  // Check for existing config
  const existingConfig = readVoiceConfig()
  if (existingConfig) {
    console.log(chalk.gray("  Existing configuration found:"))
    console.log(chalk.gray(`    Model: ${existingConfig.model}`))
    console.log(chalk.gray(`    Device: ${existingConfig.device}`))
    console.log(chalk.gray(`    Sample Rate: ${existingConfig.sampleRate}Hz`))
    console.log(chalk.gray(`    Auto Start: ${existingConfig.autoStart}`))
    console.log()

    const { reconfigure } = await inquirer.prompt([
      {
        type: "confirm",
        name: "reconfigure",
        message: "Reconfigure voice settings?",
        default: false,
      },
    ])

    if (!reconfigure) {
      console.log(chalk.gray("\n  Setup cancelled. Using existing configuration.\n"))
      return
    }
    console.log()
  }

  console.log(chalk.gray("  This wizard will help you set up voice input for JFL."))
  console.log(chalk.gray("  You'll configure:"))
  console.log(chalk.gray("    1. Whisper model (for speech-to-text)"))
  console.log(chalk.gray("    2. Microphone device"))
  console.log(chalk.gray("    3. Test the audio pipeline"))
  console.log()

  ensureDirectories()

  // ============================================================================
  // Step 1: Select and download whisper model
  // ============================================================================
  console.log(chalk.cyan.bold("  Step 1: Select Whisper Model\n"))

  // Build model choices with download status
  const modelChoices = [
    {
      name: `${chalk.white("tiny")}     (75 MB)  - Fastest, lowest accuracy ${isModelDownloaded("tiny") ? chalk.green("[downloaded]") : ""}`,
      value: "tiny",
    },
    {
      name: `${chalk.white("tiny.en")}  (75 MB)  - English-only tiny ${isModelDownloaded("tiny.en") ? chalk.green("[downloaded]") : ""}`,
      value: "tiny.en",
    },
    {
      name: `${chalk.white("base")}     (142 MB) - Balanced, recommended ${isModelDownloaded("base") ? chalk.green("[downloaded]") : chalk.yellow("[recommended]")}`,
      value: "base",
    },
    {
      name: `${chalk.white("base.en")}  (142 MB) - English-only base ${isModelDownloaded("base.en") ? chalk.green("[downloaded]") : ""}`,
      value: "base.en",
    },
    {
      name: `${chalk.white("small")}    (466 MB) - Higher accuracy, slower ${isModelDownloaded("small") ? chalk.green("[downloaded]") : ""}`,
      value: "small",
    },
    {
      name: `${chalk.white("small.en")} (466 MB) - English-only small ${isModelDownloaded("small.en") ? chalk.green("[downloaded]") : ""}`,
      value: "small.en",
    },
  ]

  const { selectedModel } = await inquirer.prompt([
    {
      type: "list",
      name: "selectedModel",
      message: "Select a whisper model:",
      choices: modelChoices,
      default: "base",
    },
  ])

  // Download model if needed
  if (!isModelDownloaded(selectedModel)) {
    console.log()
    const { confirmDownload } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmDownload",
        message: `Download ${selectedModel} model (${WHISPER_MODELS[selectedModel as ModelName].size})?`,
        default: true,
      },
    ])

    if (!confirmDownload) {
      console.log(chalk.yellow("\n  Model not downloaded. Setup incomplete.\n"))
      console.log(chalk.gray("  Run 'jfl voice setup' again when ready.\n"))
      return
    }

    // Download the model
    await downloadModelCommand(selectedModel)

    // Verify download succeeded
    if (!isModelDownloaded(selectedModel)) {
      console.log(chalk.red("\n  Model download failed. Setup incomplete.\n"))
      return
    }
  } else {
    console.log(chalk.green(`\n  ✓ Model '${selectedModel}' is already downloaded.\n`))
  }

  // ============================================================================
  // Step 2: Select microphone device
  // ============================================================================
  console.log(chalk.cyan.bold("  Step 2: Select Microphone\n"))

  const spinner = ora({
    text: "Detecting audio devices...",
    prefixText: "  ",
  }).start()

  const devices = await AudioRecorder.listDevices()
  spinner.stop()

  if (devices.length === 0) {
    console.log(chalk.yellow("  No audio input devices found."))
    console.log(chalk.gray("  Make sure you have a microphone connected.\n"))

    const { continueWithDefault } = await inquirer.prompt([
      {
        type: "confirm",
        name: "continueWithDefault",
        message: "Continue with default device anyway?",
        default: true,
      },
    ])

    if (!continueWithDefault) {
      console.log(chalk.yellow("\n  Setup cancelled.\n"))
      return
    }
  }

  let selectedDevice = "default"

  if (devices.length > 0) {
    // Build device choices
    const deviceChoices = devices.map((device) => ({
      name: `${device.name}${device.isDefault ? chalk.cyan(" (system default)") : ""}`,
      value: device.id,
    }))

    // Add "default" option at the top
    deviceChoices.unshift({
      name: `${chalk.white("default")} - Use system default device`,
      value: "default",
    })

    const { device } = await inquirer.prompt([
      {
        type: "list",
        name: "device",
        message: "Select microphone:",
        choices: deviceChoices,
        default: "default",
      },
    ])

    selectedDevice = device
  }

  // ============================================================================
  // Step 3: Check permissions (macOS)
  // ============================================================================
  if (platform() === "darwin") {
    console.log(chalk.cyan.bold("\n  Step 3: Check Permissions\n"))

    const permSpinner = ora({
      text: "Checking microphone permissions...",
      prefixText: "  ",
    }).start()

    const permStatus = await checkMicPermissions()

    if (permStatus.granted) {
      permSpinner.succeed("Microphone permission granted")
    } else {
      permSpinner.warn("Microphone permission may be needed")
      console.log(chalk.yellow(`\n  ${permStatus.message}`))
      console.log()

      const { openPrefs } = await inquirer.prompt([
        {
          type: "confirm",
          name: "openPrefs",
          message: "Open System Preferences > Privacy & Security?",
          default: true,
        },
      ])

      if (openPrefs) {
        try {
          execSync("open x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone", {
            stdio: "ignore",
          })
          console.log(chalk.gray("\n  Grant microphone access to Terminal (or your terminal app).\n"))

          const { permGranted } = await inquirer.prompt([
            {
              type: "confirm",
              name: "permGranted",
              message: "Did you grant microphone permission?",
              default: true,
            },
          ])

          if (!permGranted) {
            console.log(chalk.yellow("\n  You may need to grant permission for voice input to work.\n"))
          }
        } catch {
          console.log(chalk.gray("  Could not open System Preferences automatically."))
          console.log(chalk.gray("  Please manually go to System Preferences > Privacy & Security > Microphone\n"))
        }
      }
    }
  }

  // ============================================================================
  // Step 4: Test the microphone
  // ============================================================================
  console.log(chalk.cyan.bold("\n  Step 4: Test Microphone\n"))

  const { runTest } = await inquirer.prompt([
    {
      type: "confirm",
      name: "runTest",
      message: "Test the microphone for 3 seconds?",
      default: true,
    },
  ])

  let testPassed = false

  if (runTest) {
    console.log(chalk.gray("\n  Recording for 3 seconds... Speak into your microphone!\n"))

    const testSpinner = ora({
      text: "Recording...",
      prefixText: "  ",
    }).start()

    const result = await testAudioDevice(selectedDevice, 3)

    if (result.success) {
      testSpinner.succeed("Recording complete!")
      console.log()

      // Show level meter
      const levelBars = Math.round(result.peakLevel * 20)
      const meter = "█".repeat(levelBars) + "░".repeat(20 - levelBars)
      console.log(chalk.gray(`  Peak level: [${meter}] ${(result.peakLevel * 100).toFixed(1)}%`))

      if (result.peakLevel < 0.01) {
        console.log(chalk.yellow("\n  ⚠️  No audio detected. Check your microphone connection."))
      } else if (result.peakLevel < 0.1) {
        console.log(chalk.yellow("\n  ⚠️  Audio level is low. Consider increasing microphone gain."))
        testPassed = true
      } else {
        console.log(chalk.green("\n  ✓ Audio input is working correctly!"))
        testPassed = true
      }
    } else {
      testSpinner.fail("Test failed")
      console.log(chalk.red(`\n  Error: ${result.error}`))
      console.log(chalk.gray("\n  Make sure you have sox installed:"))
      console.log(chalk.gray("    macOS:   brew install sox"))
      console.log(chalk.gray("    Linux:   sudo apt-get install sox libsox-fmt-all"))
      console.log(chalk.gray("    Windows: choco install sox.portable"))
    }

    // Option to retry with different device
    if (!testPassed && devices.length > 1) {
      console.log()
      const { tryAnother } = await inquirer.prompt([
        {
          type: "confirm",
          name: "tryAnother",
          message: "Try a different device?",
          default: true,
        },
      ])

      if (tryAnother) {
        // Let them pick again
        const remainingDevices = devices.filter((d) => d.id !== selectedDevice)
        const retryChoices = remainingDevices.map((device) => ({
          name: `${device.name}${device.isDefault ? chalk.cyan(" (system default)") : ""}`,
          value: device.id,
        }))

        if (retryChoices.length > 0) {
          const { retryDevice } = await inquirer.prompt([
            {
              type: "list",
              name: "retryDevice",
              message: "Select another device:",
              choices: retryChoices,
            },
          ])

          selectedDevice = retryDevice

          console.log(chalk.gray("\n  Recording for 3 seconds with new device...\n"))

          const retrySpinner = ora({
            text: "Recording...",
            prefixText: "  ",
          }).start()

          const retryResult = await testAudioDevice(selectedDevice, 3)

          if (retryResult.success && retryResult.peakLevel >= 0.01) {
            retrySpinner.succeed("Recording complete!")
            const levelBars2 = Math.round(retryResult.peakLevel * 20)
            const meter2 = "█".repeat(levelBars2) + "░".repeat(20 - levelBars2)
            console.log(chalk.gray(`\n  Peak level: [${meter2}] ${(retryResult.peakLevel * 100).toFixed(1)}%`))
            console.log(chalk.green("\n  ✓ Audio input is working with this device!"))
            testPassed = true
          } else {
            retrySpinner.fail("Test failed with this device too")
          }
        }
      }
    }
  } else {
    console.log(chalk.gray("\n  Skipping microphone test."))
    testPassed = true // Assume it works if user skips
  }

  // ============================================================================
  // Step 5: Save configuration
  // ============================================================================
  console.log(chalk.cyan.bold("\n  Step 5: Save Configuration\n"))

  // Ask about auto-start preference
  const { autoStart } = await inquirer.prompt([
    {
      type: "confirm",
      name: "autoStart",
      message: "Auto-start whisper server when using voice? (recommended)",
      default: false,
    },
  ])

  // Build final config
  const config: VoiceConfig = {
    model: selectedModel,
    device: selectedDevice,
    sampleRate: 16000,
    autoStart,
  }

  // Save config
  writeVoiceConfig(config)
  setDefaultModel(selectedModel)

  console.log(chalk.green("\n  ✓ Configuration saved to ~/.jfl/voice.yaml"))
  console.log()
  console.log(chalk.gray("  Configuration:"))
  console.log(chalk.gray(`    Model: ${config.model}`))
  console.log(chalk.gray(`    Device: ${config.device}`))
  console.log(chalk.gray(`    Sample Rate: ${config.sampleRate}Hz`))
  console.log(chalk.gray(`    Auto Start: ${config.autoStart}`))

  // ============================================================================
  // Summary
  // ============================================================================
  console.log(chalk.bold("\n  ✅ Setup Complete!\n"))

  if (testPassed) {
    console.log(chalk.green("  Voice input is ready to use."))
  } else {
    console.log(chalk.yellow("  Voice input configured, but microphone test did not pass."))
    console.log(chalk.gray("  Run 'jfl voice test' to troubleshoot."))
  }

  console.log()
  console.log(chalk.cyan("  Next steps:"))
  console.log(chalk.gray("    jfl voice test              Test microphone again"))
  console.log(chalk.gray("    jfl voice server start      Start the whisper server"))
  console.log(chalk.gray("    jfl voice setup             Re-run this wizard"))
  console.log()
}

// =============================================================================
// Voice Slash Command - /voice with VAD
// =============================================================================

/** Show voice command help */
function showVoiceHelp(): void {
  console.log(chalk.bold("\n🎤 JFL Voice\n"))
  console.log(chalk.gray("Voice input for JFL CLI with automatic silence detection.\n"))

  console.log(chalk.cyan("Quick Start:"))
  console.log("  jfl voice                         Start recording (stops on silence)")
  console.log("  jfl voice record                  Same as above")

  console.log(chalk.cyan("\nModel Management:"))
  console.log("  jfl voice model list              List available models")
  console.log("  jfl voice model download <name>   Download a model")
  console.log("  jfl voice model default <name>    Set default model")

  console.log(chalk.cyan("\nAudio Input:"))
  console.log("  jfl voice devices                 List audio input devices")
  console.log("  jfl voice test                    Test voice input (record + transcribe)")
  console.log("  jfl voice test --device <id>      Test with specific device")
  console.log("  jfl voice recording               Test recording only (no transcription)")
  console.log("  jfl voice recording --duration N  Record for N seconds (default: 5)")

  console.log(chalk.cyan("\nServer Commands: (coming soon)"))
  console.log(chalk.gray("  jfl voice server start            Start whisper server"))
  console.log(chalk.gray("  jfl voice server stop             Stop whisper server"))
  console.log(chalk.gray("  jfl voice server status           Show server status"))

  console.log(chalk.cyan("\nSetup:"))
  console.log("  jfl voice setup                   First-time setup wizard")
  console.log("  jfl voice help                    Show this help")

  console.log()
}

/** Convert linear amplitude to dB */
function amplitudeToDb(amplitude: number): number {
  if (amplitude <= 0) return -100
  return 20 * Math.log10(amplitude)
}

/** Calculate peak amplitude from 16-bit PCM audio chunk */
function calculatePeakAmplitude(chunk: Buffer): number {
  let peak = 0
  for (let i = 0; i < chunk.length - 1; i += 2) {
    const sample = chunk.readInt16LE(i)
    const amplitude = Math.abs(sample) / 32768
    if (amplitude > peak) {
      peak = amplitude
    }
  }
  return peak
}

/** Copy text to clipboard (cross-platform) */
function copyToClipboard(text: string): boolean {
  const currentPlatform = platform()
  try {
    if (currentPlatform === "darwin") {
      execSync("pbcopy", { input: text, stdio: ["pipe", "ignore", "ignore"] })
      return true
    } else if (currentPlatform === "linux") {
      // Try xclip first, then xsel
      try {
        execSync("xclip -selection clipboard", { input: text, stdio: ["pipe", "ignore", "ignore"] })
        return true
      } catch {
        try {
          execSync("xsel --clipboard --input", { input: text, stdio: ["pipe", "ignore", "ignore"] })
          return true
        } catch {
          return false
        }
      }
    } else if (currentPlatform === "win32") {
      execSync("clip", { input: text, stdio: ["pipe", "ignore", "ignore"] })
      return true
    }
    return false
  } catch {
    return false
  }
}

/** Voice recording with VAD options */
interface VoiceRecordOptions {
  /** Audio device ID */
  device?: string
  /** Silence threshold in dB (default: -40) */
  silenceThresholdDb?: number
  /** Silence duration in ms before stopping (default: 1500) */
  silenceDurationMs?: number
  /** Maximum recording duration in seconds (default: 60) */
  maxDurationSecs?: number
}

/**
 * Voice Slash Command - /voice
 *
 * Records audio with VAD (voice activity detection), transcribes it,
 * and offers to send to Claude Code or copy to clipboard.
 */
export async function voiceSlashCommand(options: VoiceRecordOptions = {}): Promise<void> {
  const silenceThresholdDb = options.silenceThresholdDb ?? VAD_SILENCE_THRESHOLD_DB
  const silenceDurationMs = options.silenceDurationMs ?? VAD_SILENCE_DURATION_MS
  const maxDurationSecs = options.maxDurationSecs ?? 60

  console.log(chalk.bold("\n🎤 Voice Recording\n"))
  console.log(chalk.gray("  Speak into your microphone. Recording will stop automatically"))
  console.log(chalk.gray(`  after ${(silenceDurationMs / 1000).toFixed(1)}s of silence, or press Ctrl+C to stop.\n`))

  // Step 1: Check if whisper server is running
  const serverError = checkServerRunning()
  if (serverError) {
    handleVoiceError(serverError)
    return
  }

  // Step 2: Check for auth token
  const authError = checkAuthToken()
  if (authError) {
    handleVoiceError(authError)
    return
  }

  const authToken = readAuthToken()!
  const socketPath = getVoiceSocketPath()

  // Step 3: Initialize audio recorder
  let recorder: AudioRecorder
  try {
    recorder = new AudioRecorder({
      device: options.device,
      sampleRate: 16000,
    })
  } catch (error) {
    if (error instanceof VoiceError) {
      handleVoiceError(error)
    } else {
      handleVoiceError(createVoiceError(error instanceof Error ? error : new Error(String(error))))
    }
    return
  }

  // Collect audio data
  const audioChunks: Buffer[] = []
  let peakLevel = 0
  let recordingError: Error | null = null

  // VAD state
  let silenceStartTime: number | null = null
  let hasVoiceActivity = false
  const startTime = Date.now()

  // Spinner for recording indicator
  const spinner = ora({
    text: chalk.cyan("Recording...") + chalk.gray(" (waiting for voice)"),
    prefixText: "  ",
    spinner: "dots",
  })

  // Handle Ctrl+C gracefully
  let interrupted = false
  const handleInterrupt = () => {
    interrupted = true
    recorder.stop()
  }

  process.on("SIGINT", handleInterrupt)
  process.on("SIGTERM", handleInterrupt)

  // Set up recorder event handlers
  recorder.on("data", (chunk: Buffer) => {
    audioChunks.push(chunk)

    // Calculate peak level
    const chunkPeak = calculatePeakAmplitude(chunk)
    if (chunkPeak > peakLevel) {
      peakLevel = chunkPeak
    }

    // VAD: Check if audio level is above silence threshold
    const peakDb = amplitudeToDb(chunkPeak)
    const isSilent = peakDb < silenceThresholdDb

    if (!isSilent) {
      // Voice activity detected
      hasVoiceActivity = true
      silenceStartTime = null

      // Update spinner to show active recording
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      const levelBars = Math.round(chunkPeak * 15)
      const meter = "█".repeat(levelBars) + "░".repeat(15 - levelBars)
      spinner.text = chalk.cyan("Recording") + chalk.gray(` [${meter}] ${elapsed}s`)
    } else if (hasVoiceActivity) {
      // Silence detected after voice activity
      if (silenceStartTime === null) {
        silenceStartTime = Date.now()
      } else {
        const silenceDuration = Date.now() - silenceStartTime

        // Update spinner to show silence detection
        const remaining = Math.max(0, silenceDurationMs - silenceDuration)
        if (remaining > 0) {
          spinner.text = chalk.cyan("Recording") + chalk.yellow(` (silence: ${(remaining / 1000).toFixed(1)}s until stop)`)
        }

        // Stop recording after silence duration
        if (silenceDuration >= silenceDurationMs) {
          recorder.stop()
        }
      }
    }

    // Check max duration
    const elapsed = (Date.now() - startTime) / 1000
    if (elapsed >= maxDurationSecs) {
      recorder.stop()
    }
  })

  recorder.on("error", (error: Error) => {
    recordingError = error
    recorder.stop()
  })

  // Start recording
  try {
    await recorder.start()
    spinner.start()
  } catch (error) {
    const voiceError = new VoiceError(VoiceErrorType.RECORDING_FAILED, {
      originalError: error instanceof Error ? error : new Error(String(error)),
      context: { device: options.device },
    })
    handleVoiceError(voiceError)
    process.removeListener("SIGINT", handleInterrupt)
    process.removeListener("SIGTERM", handleInterrupt)
    return
  }

  // Wait for recording to stop
  await new Promise<void>((resolve) => {
    const checkStopped = () => {
      if (recorder.getState() === "idle" || recorder.getState() === "error") {
        resolve()
      } else {
        setTimeout(checkStopped, 50)
      }
    }
    // Small delay to let the stop signal propagate
    setTimeout(checkStopped, 100)
  })

  // Clean up interrupt handler
  process.removeListener("SIGINT", handleInterrupt)
  process.removeListener("SIGTERM", handleInterrupt)

  // Stop spinner
  spinner.stop()

  // Handle interruption
  if (interrupted) {
    console.log(chalk.yellow("\n  Recording stopped by user.\n"))
  }

  // Handle recording error
  if (recordingError !== null) {
    const voiceError = new VoiceError(VoiceErrorType.RECORDING_FAILED, {
      originalError: recordingError,
      context: { device: options.device },
    })
    handleVoiceError(voiceError)
    return
  }

  // Check if we got any audio
  const totalBytes = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  if (totalBytes === 0) {
    const voiceError = new VoiceError(VoiceErrorType.MIC_UNAVAILABLE, {
      context: { totalBytes: 0, device: options.device },
    })
    handleVoiceError(voiceError)
    return
  }

  // Check if there was any voice activity
  if (!hasVoiceActivity) {
    const voiceError = new VoiceError(VoiceErrorType.TRANSCRIPTION_EMPTY, {
      context: { reason: "No voice activity detected", peakLevel },
    })
    handleVoiceError(voiceError)
    return
  }

  // Combine all audio chunks
  const audioBuffer = Buffer.concat(audioChunks)
  const durationSecs = totalBytes / (16000 * 2) // 16kHz, 16-bit

  console.log(chalk.gray(`\n  Recorded ${durationSecs.toFixed(1)}s of audio.`))
  console.log(chalk.gray("  Transcribing...\n"))

  // Step 4: Connect to whisper server and send audio
  const transcribeSpinner = ora({
    text: "Transcribing...",
    prefixText: "  ",
  }).start()

  const client = new VoiceClient({
    socketPath,
    authToken,
    maxReconnectAttempts: 1,
  })

  let transcription = ""
  let transcriptionReceived = false
  let transcriptionError: Error | null = null

  client.onTranscript((text, isFinal) => {
    if (isFinal) {
      transcription = text
      transcriptionReceived = true
    }
  })

  client.onError((error) => {
    transcriptionError = error
  })

  try {
    await client.connect()

    // Send audio data
    client.sendAudio(audioBuffer)

    // Signal end of audio
    client.endAudio()

    // Wait for transcription with timeout
    const timeout = 30000 // 30 seconds
    const transcribeStartTime = Date.now()

    while (!transcriptionReceived && !transcriptionError) {
      if (Date.now() - transcribeStartTime > timeout) {
        transcriptionError = new VoiceError(VoiceErrorType.TIMEOUT, {
          context: { timeout, operation: "transcription" },
          recoverable: true,
          audioBuffer,
        })
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    client.disconnect()

  } catch (error) {
    client.disconnect()
    const voiceError = error instanceof VoiceError
      ? error
      : createVoiceError(
          error instanceof Error ? error : new Error(String(error)),
          { operation: "connect" },
          audioBuffer
        )
    handleVoiceError(voiceError, transcribeSpinner)
    return
  }

  // Handle transcription error
  if (transcriptionError) {
    const voiceError = transcriptionError instanceof VoiceError
      ? transcriptionError
      : createVoiceError(transcriptionError, { operation: "transcription" }, audioBuffer)
    handleVoiceError(voiceError, transcribeSpinner)
    return
  }

  // Handle empty transcription
  if (!transcription || transcription.trim() === "") {
    const voiceError = new VoiceError(VoiceErrorType.TRANSCRIPTION_EMPTY, {
      context: { audioLength: totalBytes, durationSecs, peakLevel },
      recoverable: true,
      audioBuffer,
    })
    handleVoiceError(voiceError, transcribeSpinner)
    return
  }

  transcribeSpinner.succeed("Transcription complete!")

  // Step 5: Display transcription
  console.log()
  console.log(chalk.bold("  Transcription:"))
  console.log()
  console.log(chalk.cyan(`  "${transcription.trim()}"`))
  console.log()

  // Step 6: Ask what to do with the transcription
  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { name: "Send to Claude Code (paste into conversation)", value: "send" },
        { name: "Copy to clipboard", value: "copy" },
        { name: "Cancel (do nothing)", value: "cancel" },
      ],
      default: "send",
    },
  ])

  if (action === "send") {
    // For "send to Claude Code", we simply output the text so the user can paste it
    // In a full implementation, this could integrate with Claude Code's API
    console.log(chalk.green("\n  ✓ Text ready to send to Claude Code:\n"))
    console.log(chalk.white(`  ${transcription.trim()}`))
    console.log()
    console.log(chalk.gray("  Copy and paste this into your Claude Code conversation."))
    console.log()
  } else if (action === "copy") {
    const copied = copyToClipboard(transcription.trim())
    if (copied) {
      console.log(chalk.green("\n  ✓ Copied to clipboard!"))
    } else {
      console.log(chalk.yellow("\n  ⚠ Could not copy to clipboard."))
      console.log(chalk.gray("  On Linux, install xclip or xsel for clipboard support."))
      console.log(chalk.gray("\n  Text:"))
      console.log(chalk.white(`  ${transcription.trim()}`))
    }
    console.log()
  } else {
    console.log(chalk.gray("\n  Cancelled.\n"))
  }
}

// Main voice command handler
export async function voiceCommand(
  action?: string,
  subaction?: string,
  arg?: string,
  options?: { force?: boolean, device?: string, duration?: number, help?: boolean }
): Promise<void> {
  // If no action, run the voice slash command (default behavior)
  if (!action) {
    await voiceSlashCommand({ device: options?.device })
    return
  }

  // Handle help explicitly
  if (action === "help" || options?.help) {
    showVoiceHelp()
    return
  }

  // Handle "record" as alias for the default voice slash command
  if (action === "record") {
    await voiceSlashCommand({ device: options?.device })
    return
  }

  if (action === "model") {
    if (!subaction || subaction === "list") {
      await listModelsCommand()
    } else if (subaction === "download") {
      if (!arg) {
        console.log(chalk.red("Missing model name."))
        console.log(chalk.gray("Usage: jfl voice model download <name>"))
        console.log(chalk.gray("\nExample: jfl voice model download base"))
        return
      }
      await downloadModelCommand(arg, options)
    } else if (subaction === "default") {
      if (!arg) {
        const current = getCurrentDefaultModel()
        console.log(chalk.gray(`Current default model: ${chalk.white(current)}`))
        console.log(chalk.gray("Usage: jfl voice model default <name>"))
        return
      }
      await setDefaultModelCommand(arg)
    } else {
      console.log(chalk.red(`Unknown model command: ${subaction}`))
      console.log(chalk.gray("\nAvailable commands: list, download, default"))
    }
    return
  }

  if (action === "devices") {
    await listDevicesCommand()
    return
  }

  if (action === "test") {
    await voiceTestCommand({
      device: options?.device,
    })
    return
  }

  if (action === "recording") {
    await testRecordingCommand({
      device: options?.device,
      duration: options?.duration,
    })
    return
  }

  if (action === "setup") {
    await voiceSetupCommand()
    return
  }

  // Placeholder for future commands
  if (action === "server") {
    console.log(chalk.yellow(`\n⚠️  'jfl voice ${action}' is coming soon.\n`))
    console.log(chalk.gray("For now, use 'jfl voice model' commands to manage whisper models."))
    console.log()
    return
  }

  console.log(chalk.red(`Unknown voice command: ${action}`))
  console.log(chalk.gray("Run 'jfl voice' for help."))
}
