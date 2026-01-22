import chalk from "chalk"
import ora, { Ora } from "ora"
import inquirer from "inquirer"
import { existsSync, mkdirSync, statSync, createWriteStream, unlinkSync, renameSync, readFileSync, writeFileSync, openSync, closeSync } from "fs"
import { join } from "path"
import { homedir, platform } from "os"
import { createHash } from "crypto"
import https from "https"
import http from "http"
import { EventEmitter } from "events"
import WebSocket from "ws"
import { spawn, ChildProcess, execSync } from "child_process"
import { Readable } from "stream"
import * as readline from "readline"
// @ts-ignore - node-global-key-listener doesn't have type definitions
import { GlobalKeyboardListener, IGlobalKeyEvent, IGlobalKeyDownMap } from "node-global-key-listener"

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
  ACCESSIBILITY_NOT_GRANTED = "ACCESSIBILITY_NOT_GRANTED",
  PLATFORM_NOT_SUPPORTED = "PLATFORM_NOT_SUPPORTED",
  WAYLAND_NOT_SUPPORTED = "WAYLAND_NOT_SUPPORTED",
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
  [VoiceErrorType.ACCESSIBILITY_NOT_GRANTED]: {
    message: "Accessibility permission not granted.",
    suggestions: [
      "Open System Settings > Privacy & Security > Accessibility",
      "Add your terminal app (Terminal, iTerm2, etc.) to the allowed list",
      "Toggle the permission off and on if already added",
      "You may need to restart your terminal after granting permission",
    ],
  },
  [VoiceErrorType.PLATFORM_NOT_SUPPORTED]: {
    message: "Global hotkey is not supported on this platform.",
    suggestions: [
      "Use 'jfl voice' for manual recording",
      "Supported platforms: macOS, Linux (X11), Windows 10/11",
    ],
  },
  [VoiceErrorType.WAYLAND_NOT_SUPPORTED]: {
    message: "Global hotkey is not supported on Wayland.",
    suggestions: [
      "Use 'jfl voice' for manual recording instead",
      "Switch to an X11 session for hotkey support",
      "Or use an X11-based desktop environment (GNOME on X11, KDE on X11)",
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

// Get voice daemon PID file path
function getVoiceDaemonPidPath(): string {
  return join(getJflDir(), "voice-daemon.pid")
}

// Get voice daemon log file path
function getVoiceDaemonLogPath(): string {
  return join(getJflDir(), "voice-daemon.log")
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

// Hotkey mode type
type HotkeyMode = "auto" | "tap" | "hold"

// Hotkey configuration
interface HotkeyConfig {
  mode: HotkeyMode
  holdThreshold: number // ms
}

// Preview configuration for transcript review before sending
interface PreviewConfig {
  timeout: number // seconds, 0 = disabled (require explicit Enter)
}

// Default preview configuration
const DEFAULT_PREVIEW_CONFIG: PreviewConfig = {
  timeout: 2.5, // seconds
}

// Security configuration for clipboard hygiene and recording limits (VS-SEC-3)
interface SecurityConfig {
  maxRecordingDuration: number // seconds, max recording time before auto-stop
  clipboardClearDelay: number  // seconds, time to wait after paste before clearing clipboard
}

// Default security configuration
const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  maxRecordingDuration: 60, // 60 seconds max recording
  clipboardClearDelay: 5,   // Clear clipboard 5 seconds after paste
}

// Voice configuration interface
interface VoiceConfig {
  model: string
  device: string
  sampleRate: number
  autoStart: boolean
  hotkey: HotkeyConfig
  preview: PreviewConfig
  security: SecurityConfig
}

// Default hotkey configuration
const DEFAULT_HOTKEY_CONFIG: HotkeyConfig = {
  mode: "auto",
  holdThreshold: 300, // ms
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
      hotkey: { ...DEFAULT_HOTKEY_CONFIG },
      preview: { ...DEFAULT_PREVIEW_CONFIG },
      security: { ...DEFAULT_SECURITY_CONFIG },
    }

    // Parse YAML manually (simple key: value format)
    // Supports nested hotkey, preview, and security sections
    const lines = content.split("\n")
    let currentSection: "none" | "hotkey" | "preview" | "security" = "none"

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith("#") || trimmed === "") continue

      // Check if entering a section
      if (trimmed === "hotkey:") {
        currentSection = "hotkey"
        continue
      }
      if (trimmed === "preview:") {
        currentSection = "preview"
        continue
      }
      if (trimmed === "security:") {
        currentSection = "security"
        continue
      }

      // Check if leaving section (new top-level key)
      if (!line.startsWith(" ") && !line.startsWith("\t") && trimmed.includes(":")) {
        currentSection = "none"
      }

      if (!trimmed.includes(":")) continue

      const [key, ...valueParts] = trimmed.split(":")
      const value = valueParts.join(":").trim()

      if (currentSection === "hotkey") {
        // Parse hotkey sub-keys
        if (key === "mode" && (value === "auto" || value === "tap" || value === "hold")) {
          config.hotkey.mode = value as HotkeyMode
        } else if (key === "holdThreshold") {
          config.hotkey.holdThreshold = parseInt(value, 10) || 300
        }
      } else if (currentSection === "preview") {
        // Parse preview sub-keys
        if (key === "timeout") {
          const parsed = parseFloat(value)
          // Validate: 0 (disabled) or 1-10 seconds
          if (!isNaN(parsed) && (parsed === 0 || (parsed >= 1 && parsed <= 10))) {
            config.preview.timeout = parsed
          }
        }
      } else if (currentSection === "security") {
        // Parse security sub-keys (VS-SEC-3)
        if (key === "maxRecordingDuration") {
          const parsed = parseInt(value, 10)
          // Validate: 10-300 seconds (reasonable bounds)
          if (!isNaN(parsed) && parsed >= 10 && parsed <= 300) {
            config.security.maxRecordingDuration = parsed
          }
        } else if (key === "clipboardClearDelay") {
          const parsed = parseInt(value, 10)
          // Validate: 1-60 seconds
          if (!isNaN(parsed) && parsed >= 1 && parsed <= 60) {
            config.security.clipboardClearDelay = parsed
          }
        }
      } else {
        // Parse top-level keys
        if (key === "model") config.model = value
        else if (key === "device") config.device = value
        else if (key === "sampleRate") config.sampleRate = parseInt(value, 10) || 16000
        else if (key === "autoStart") config.autoStart = value === "true"
      }
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

  // Ensure config sections have defaults if not provided
  const hotkeyConfig = config.hotkey || DEFAULT_HOTKEY_CONFIG
  const previewConfig = config.preview || DEFAULT_PREVIEW_CONFIG
  const securityConfig = config.security || DEFAULT_SECURITY_CONFIG

  const content = `# JFL Voice Configuration
# Generated by: jfl voice setup
# Re-run setup to change settings: jfl voice setup

model: ${config.model}
device: ${config.device}
sampleRate: ${config.sampleRate}
autoStart: ${config.autoStart}

# Hotkey settings for voice hotkey mode
# mode: auto (smart detection), tap (tap-to-toggle), or hold (hold-to-talk)
# holdThreshold: ms to hold before entering hold-to-talk mode (default: 300)
hotkey:
  mode: ${hotkeyConfig.mode}
  holdThreshold: ${hotkeyConfig.holdThreshold}

# Preview settings for transcript review before sending
# timeout: seconds to wait before auto-sending (1-10, or 0 to disable auto-send)
# When preview is shown: Enter=send immediately, Esc=cancel, any other key=edit mode
preview:
  timeout: ${previewConfig.timeout}

# Security settings for clipboard hygiene and recording limits (VS-SEC-3)
# maxRecordingDuration: seconds before auto-stop (10-300, default: 60)
# clipboardClearDelay: seconds after paste before clearing clipboard (1-60, default: 5)
security:
  maxRecordingDuration: ${securityConfig.maxRecordingDuration}
  clipboardClearDelay: ${securityConfig.clipboardClearDelay}
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

  // Build final config (preserve existing hotkey, preview, and security settings if any)
  const existingVoiceConfig = readVoiceConfig()
  const config: VoiceConfig = {
    model: selectedModel,
    device: selectedDevice,
    sampleRate: 16000,
    autoStart,
    hotkey: existingVoiceConfig?.hotkey || { ...DEFAULT_HOTKEY_CONFIG },
    preview: existingVoiceConfig?.preview || { ...DEFAULT_PREVIEW_CONFIG },
    security: existingVoiceConfig?.security || { ...DEFAULT_SECURITY_CONFIG },
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

  console.log(chalk.cyan("\nHotkey Mode (macOS):"))
  console.log("  jfl voice hotkey                  Start global hotkey listener")
  console.log("  jfl voice hotkey --mode <mode>    Set hotkey mode: auto, tap, or hold")
  console.log(chalk.gray("                                    Ctrl+Shift+Space triggers recording"))
  console.log(chalk.gray("                                    auto:  Tap to toggle, or hold to talk"))
  console.log(chalk.gray("                                    tap:   Tap to start/stop recording"))
  console.log(chalk.gray("                                    hold:  Hold to record, release to stop"))
  console.log(chalk.gray("                                    Requires Accessibility permission"))

  console.log(chalk.cyan("\nDaemon Mode (macOS):"))
  console.log("  jfl voice daemon start            Start hotkey listener in background")
  console.log("  jfl voice daemon stop             Stop the background daemon")
  console.log("  jfl voice daemon status           Show daemon status and uptime")
  console.log("  jfl voice daemon start --mode <m> Start daemon with mode: auto, tap, hold")
  console.log(chalk.gray("                                    Daemon survives terminal close"))
  console.log(chalk.gray("                                    PID stored in ~/.jfl/voice-daemon.pid"))

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

// =============================================================================
// VS-012: Waveform Visualization
// =============================================================================

/** Unicode block characters for waveform visualization (sorted by height) */
const WAVEFORM_BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

/** Rolling buffer size for waveform display */
const WAVEFORM_BUFFER_SIZE = 7

/** Rolling buffer to store recent audio levels for waveform display */
let waveformBuffer: number[] = []

/**
 * Map a dB level to a waveform character
 * @param dbLevel - Audio level in dB (typically -60 to 0)
 * @returns A Unicode block character representing the level
 */
function dbToWaveformChar(dbLevel: number): string {
  // Map dB range (-60 to 0) to character index (0 to 7)
  // -60 dB or below = lowest bar, 0 dB = highest bar
  const minDb = -60
  const maxDb = 0
  const clampedDb = Math.max(minDb, Math.min(maxDb, dbLevel))

  // Normalize to 0-1 range
  const normalized = (clampedDb - minDb) / (maxDb - minDb)

  // Map to character index
  const index = Math.floor(normalized * (WAVEFORM_BLOCKS.length - 1))
  return WAVEFORM_BLOCKS[index]
}

/**
 * Add a level to the waveform buffer
 * @param dbLevel - Audio level in dB
 */
function addToWaveformBuffer(dbLevel: number): void {
  waveformBuffer.push(dbLevel)
  if (waveformBuffer.length > WAVEFORM_BUFFER_SIZE) {
    waveformBuffer.shift()
  }
}

/**
 * Reset the waveform buffer (call at start of new recording)
 */
function resetWaveformBuffer(): void {
  waveformBuffer = []
}

/**
 * Render the waveform visualization from the rolling buffer
 * @returns A string like "▁▃▅▇▅▃▁" representing recent audio levels
 */
function renderWaveform(): string {
  if (waveformBuffer.length === 0) {
    // Return minimal bars when no data yet
    return WAVEFORM_BLOCKS[0].repeat(WAVEFORM_BUFFER_SIZE)
  }

  // Pad with low values if buffer isn't full yet
  const paddedBuffer = [...waveformBuffer]
  while (paddedBuffer.length < WAVEFORM_BUFFER_SIZE) {
    paddedBuffer.unshift(-60) // Pad with silence at the start
  }

  return paddedBuffer.map(db => dbToWaveformChar(db)).join("")
}

/**
 * Check if terminal supports Unicode waveform characters
 * @returns true if waveform should be displayed
 */
function supportsWaveform(): boolean {
  // Check for dumb terminal
  if (process.env.TERM === "dumb") {
    return false
  }
  // Check for Windows cmd.exe (not PowerShell or Windows Terminal)
  if (process.platform === "win32" && !process.env.WT_SESSION && !process.env.TERM_PROGRAM) {
    return false
  }
  return true
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

/**
 * Clear the clipboard contents (VS-SEC-3: clipboard hygiene)
 * Uses osascript on macOS to set clipboard to empty string
 * Returns true on success, false on failure
 */
function clearClipboard(): boolean {
  const currentPlatform = platform()
  try {
    if (currentPlatform === "darwin") {
      // Use osascript to clear clipboard on macOS
      execSync(
        `osascript -e 'set the clipboard to ""'`,
        { stdio: ["pipe", "ignore", "ignore"] }
      )
      return true
    } else if (currentPlatform === "linux") {
      // Try xclip first, then xsel
      try {
        execSync("xclip -selection clipboard", { input: "", stdio: ["pipe", "ignore", "ignore"] })
        return true
      } catch {
        try {
          execSync("xsel --clipboard --input", { input: "", stdio: ["pipe", "ignore", "ignore"] })
          return true
        } catch {
          return false
        }
      }
    } else if (currentPlatform === "win32") {
      // Use PowerShell to clear clipboard on Windows
      execSync("powershell.exe -command \"Set-Clipboard -Value ''\"", { stdio: ["pipe", "ignore", "ignore"] })
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Schedule clipboard clearing after a delay (VS-SEC-3)
 * @param delaySeconds Seconds to wait before clearing (default: 5)
 * @returns Timer reference for potential cancellation
 */
function scheduleClipboardClear(delaySeconds: number = 5): NodeJS.Timeout {
  return setTimeout(() => {
    const cleared = clearClipboard()
    if (process.env.DEBUG && cleared) {
      console.log(chalk.gray("  [debug] Clipboard cleared for security"))
    }
  }, delaySeconds * 1000)
}

/**
 * Securely zero out a Buffer's contents (VS-SEC-3: buffer hygiene)
 * Overwrites the buffer with zeros to prevent sensitive audio data from lingering in memory
 * @param buffer The Buffer to zero out
 */
function zeroBuffer(buffer: Buffer): void {
  if (buffer && buffer.length > 0) {
    buffer.fill(0)
  }
}

/**
 * Securely zero out an array of Buffers (VS-SEC-3)
 * @param buffers Array of Buffers to zero out
 */
function zeroBuffers(buffers: Buffer[]): void {
  for (const buffer of buffers) {
    zeroBuffer(buffer)
  }
  // Clear the array reference
  buffers.length = 0
}

/**
 * Get the name of the currently focused application
 * - macOS: via osascript
 * - Linux: via xdotool (X11 only)
 * - Windows: via PowerShell
 * VS-010/VS-011: Cross-platform focused app detection
 * Returns null if unable to determine
 */
function getFocusedApp(): string | null {
  const currentPlatform = platform()

  try {
    if (currentPlatform === "darwin") {
      const result = execSync(
        `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      )
      return result.trim()
    } else if (currentPlatform === "linux") {
      // VS-010: Get focused window on Linux X11 using xdotool
      const windowId = execSync(
        `xdotool getactivewindow`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      ).trim()
      if (windowId) {
        const windowName = execSync(
          `xdotool getwindowname ${windowId}`,
          { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
        ).trim()
        return windowName || null
      }
      return null
    } else if (currentPlatform === "win32") {
      // VS-011: Get focused window on Windows using PowerShell
      const result = execSync(
        `powershell.exe -command "(Get-Process | Where-Object {$_.MainWindowHandle -eq (Add-Type -MemberDefinition '[DllImport(\\\"user32.dll\\\")]public static extern IntPtr GetForegroundWindow();' -Name 'Win32' -Namespace 'Native' -PassThru)::GetForegroundWindow()}).MainWindowTitle"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      )
      return result.trim() || null
    }
    return null
  } catch {
    return null
  }
}

/**
 * Get the platform-appropriate paste shortcut string for display
 * VS-010/VS-011: Cross-platform paste shortcut labels
 */
function getPasteShortcut(): string {
  const currentPlatform = platform()
  if (currentPlatform === "darwin") {
    return "Cmd+V"
  } else if (currentPlatform === "linux") {
    return "Ctrl+Shift+V"
  } else {
    return "Ctrl+V"
  }
}

/**
 * Simulate paste keystroke
 * - macOS: Cmd+V via osascript
 * - Linux: Ctrl+Shift+V via xdotool (X11 only)
 * - Windows: Ctrl+V via PowerShell SendKeys
 * VS-010/VS-011: Cross-platform paste simulation
 * Returns true on success, false on failure
 */
function simulatePaste(): boolean {
  const currentPlatform = platform()

  try {
    if (currentPlatform === "darwin") {
      execSync(
        `osascript -e 'tell application "System Events" to keystroke "v" using command down'`,
        { stdio: ["pipe", "ignore", "ignore"] }
      )
      return true
    } else if (currentPlatform === "linux") {
      // VS-010: Linux paste via xdotool (X11 only)
      // Use Ctrl+Shift+V for terminal compatibility
      execSync(
        `xdotool key --clearmodifiers ctrl+shift+v`,
        { stdio: ["pipe", "ignore", "ignore"] }
      )
      return true
    } else if (currentPlatform === "win32") {
      // VS-011: Windows paste via PowerShell SendKeys
      // ^v is Ctrl+V in SendKeys notation
      execSync(
        `powershell.exe -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"`,
        { stdio: ["pipe", "ignore", "ignore"] }
      )
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Show a desktop notification with title and message
 * - macOS: via osascript
 * - Linux: via notify-send (libnotify)
 * - Windows: via PowerShell toast notification
 * VS-010/VS-011: Cross-platform notification support
 * Returns true on success, false on failure
 */
function showNotification(title: string, message: string): boolean {
  const currentPlatform = platform()

  try {
    if (currentPlatform === "darwin") {
      // Escape backslashes and double quotes for AppleScript strings
      const escapedMessage = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      const escapedTitle = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      execSync(
        `osascript -e 'display notification "${escapedMessage}" with title "${escapedTitle}"'`,
        { stdio: ["pipe", "ignore", "ignore"] }
      )
      return true
    } else if (currentPlatform === "linux") {
      // VS-010: Linux notification via notify-send (part of libnotify)
      // Escape single quotes for shell
      const escapedMessage = message.replace(/'/g, "'\\''")
      const escapedTitle = title.replace(/'/g, "'\\''")
      execSync(
        `notify-send '${escapedTitle}' '${escapedMessage}'`,
        { stdio: ["pipe", "ignore", "ignore"] }
      )
      return true
    } else if (currentPlatform === "win32") {
      // VS-011: Windows toast notification via PowerShell
      // Escape for PowerShell string
      const escapedMessage = message.replace(/'/g, "''").replace(/`/g, "``")
      const escapedTitle = title.replace(/'/g, "''").replace(/`/g, "``")
      execSync(
        `powershell.exe -command "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $texts = $xml.GetElementsByTagName('text'); $texts[0].AppendChild($xml.CreateTextNode('${escapedTitle}')); $texts[1].AppendChild($xml.CreateTextNode('${escapedMessage}')); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('JFL Voice').Show([Windows.UI.Notifications.ToastNotification]::new($xml))"`,
        { stdio: ["pipe", "ignore", "ignore"] }
      )
      return true
    }
    return false
  } catch {
    return false
  }
}

// =============================================================================
// VS-UX-2: System Recording Indicator
// =============================================================================

/**
 * Show system recording indicator via desktop notification
 * This provides a visual indicator that recording is active, even when terminal is not visible
 * VS-010/VS-011: Now works on macOS, Linux, and Windows
 * Returns true on success, false on failure
 */
export function showRecordingIndicator(): boolean {
  return showNotification("Voice Recording", "Recording started... Press Ctrl+Shift+Space to stop")
}

/**
 * Hide system recording indicator (show stopped notification)
 * VS-010/VS-011: Now works on macOS, Linux, and Windows
 * Returns true on success, false on failure
 */
export function hideRecordingIndicator(reason?: "stopped" | "cancelled" | "completed"): boolean {
  const messages: Record<string, string> = {
    stopped: "Recording stopped",
    cancelled: "Recording cancelled",
    completed: "Recording complete - transcribing...",
  }
  const message = messages[reason || "stopped"] || "Recording stopped"
  return showNotification("Voice Recording", message)
}

/**
 * Result of preview transcript interaction
 */
type PreviewResult =
  | { action: "send"; text: string }
  | { action: "cancel" }
  | { action: "edit"; text: string }

/**
 * Preview transcript with configurable auto-send countdown
 *
 * Behavior:
 * - Shows transcript with countdown (if timeout > 0)
 * - Enter: send immediately
 * - Esc: cancel entirely
 * - Any other key: pause countdown and enter edit mode
 * - In edit mode: user can modify text, Enter to send, Esc to cancel
 * - If countdown reaches 0: send automatically
 *
 * @param transcript - The transcribed text to preview
 * @param timeoutSeconds - Countdown duration (0 = disabled, require explicit Enter)
 * @returns PreviewResult indicating user action and final text
 */
async function previewTranscript(
  transcript: string,
  timeoutSeconds: number
): Promise<PreviewResult> {
  return new Promise((resolve) => {
    // Set up raw mode for immediate key detection
    const stdin = process.stdin
    const stdout = process.stdout

    // Store original mode to restore later
    const wasRaw = stdin.isRaw
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding("utf8")

    let currentText = transcript
    let countdownValue = timeoutSeconds
    let countdownInterval: NodeJS.Timeout | null = null
    let inEditMode = false
    let editBuffer = ""
    let cursorPos = 0

    // Helper to clear the current line and write new content
    const clearAndWrite = (text: string) => {
      stdout.write("\r\x1b[K" + text)
    }

    // Helper to show the preview line
    const showPreview = () => {
      if (inEditMode) {
        // Edit mode: show editable text with cursor
        const before = editBuffer.slice(0, cursorPos)
        const cursor = editBuffer[cursorPos] || " "
        const after = editBuffer.slice(cursorPos + 1)
        clearAndWrite(
          chalk.gray("  Edit: ") +
          chalk.cyan(before) +
          chalk.bgCyan.black(cursor) +
          chalk.cyan(after) +
          chalk.gray(" [Enter=send, Esc=cancel]")
        )
      } else if (timeoutSeconds === 0) {
        // No countdown - require explicit action
        clearAndWrite(
          chalk.gray("  ") +
          chalk.cyan(`"${currentText}"`) +
          chalk.gray(" [Enter=send, Esc=cancel, any key=edit]")
        )
      } else {
        // Show countdown
        const countdownDisplay = countdownValue.toFixed(1)
        clearAndWrite(
          chalk.gray("  ") +
          chalk.cyan(`"${currentText}"`) +
          chalk.yellow(` Sending in ${countdownDisplay}s...`) +
          chalk.gray(" [Enter=send, Esc=cancel, any key=edit]")
        )
      }
    }

    // Cleanup function
    const cleanup = () => {
      if (countdownInterval) {
        clearInterval(countdownInterval)
        countdownInterval = null
      }
      stdin.setRawMode(wasRaw || false)
      stdin.removeListener("data", onData)
      stdout.write("\n")
    }

    // Start countdown if enabled
    if (timeoutSeconds > 0) {
      countdownInterval = setInterval(() => {
        countdownValue -= 0.1
        if (countdownValue <= 0) {
          cleanup()
          resolve({ action: "send", text: currentText })
        } else {
          showPreview()
        }
      }, 100)
    }

    // Handle key input
    const onData = (key: string) => {
      // Handle special keys
      const keyCode = key.charCodeAt(0)

      if (inEditMode) {
        // Edit mode key handling
        if (key === "\r" || key === "\n") {
          // Enter - send the edited text
          cleanup()
          resolve({ action: "send", text: editBuffer })
        } else if (key === "\x1b") {
          // Check for escape sequences (arrow keys, etc.)
          // Simple escape = cancel
          // Arrow keys come as \x1b[A, \x1b[B, \x1b[C, \x1b[D
          // We'll handle simple escape for now
          cleanup()
          resolve({ action: "cancel" })
        } else if (key === "\x7f" || key === "\b") {
          // Backspace - delete character before cursor
          if (cursorPos > 0) {
            editBuffer = editBuffer.slice(0, cursorPos - 1) + editBuffer.slice(cursorPos)
            cursorPos--
            showPreview()
          }
        } else if (key === "\x1b[D") {
          // Left arrow
          if (cursorPos > 0) {
            cursorPos--
            showPreview()
          }
        } else if (key === "\x1b[C") {
          // Right arrow
          if (cursorPos < editBuffer.length) {
            cursorPos++
            showPreview()
          }
        } else if (key === "\x03") {
          // Ctrl+C - cancel
          cleanup()
          resolve({ action: "cancel" })
        } else if (keyCode >= 32 && keyCode < 127) {
          // Printable character - insert at cursor
          editBuffer = editBuffer.slice(0, cursorPos) + key + editBuffer.slice(cursorPos)
          cursorPos++
          showPreview()
        }
      } else {
        // Preview mode key handling
        if (key === "\r" || key === "\n") {
          // Enter - send immediately
          cleanup()
          resolve({ action: "send", text: currentText })
        } else if (key === "\x1b") {
          // Escape - cancel
          cleanup()
          resolve({ action: "cancel" })
        } else if (key === "\x03") {
          // Ctrl+C - cancel
          cleanup()
          resolve({ action: "cancel" })
        } else {
          // Any other key - enter edit mode
          if (countdownInterval) {
            clearInterval(countdownInterval)
            countdownInterval = null
          }
          inEditMode = true
          editBuffer = currentText
          // If printable character, start with it
          if (keyCode >= 32 && keyCode < 127) {
            editBuffer = currentText + key
            cursorPos = editBuffer.length
          } else {
            cursorPos = editBuffer.length
          }
          showPreview()
        }
      }
    }

    stdin.on("data", onData)

    // Show initial preview
    console.log() // New line before preview
    showPreview()
  })
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

  // VS-012: Reset waveform buffer for new recording
  resetWaveformBuffer()
  const useWaveform = supportsWaveform()

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

    // VS-012: Add level to waveform buffer on every chunk
    addToWaveformBuffer(peakDb)

    // VS-012: Update spinner with waveform on every chunk for real-time feedback
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    if (useWaveform) {
      const waveform = renderWaveform()
      spinner.text = chalk.cyan("Recording") + chalk.gray(` ${waveform} (${elapsed}s)`)
    }

    if (!isSilent) {
      // Voice activity detected
      hasVoiceActivity = true
      silenceStartTime = null
    } else if (hasVoiceActivity) {
      // Silence detected after voice activity
      if (silenceStartTime === null) {
        silenceStartTime = Date.now()
      } else {
        const silenceDuration = Date.now() - silenceStartTime

        // Update spinner to show silence detection
        const remaining = Math.max(0, silenceDurationMs - silenceDuration)
        if (remaining > 0) {
          if (useWaveform) {
            const waveform = renderWaveform()
            spinner.text = chalk.cyan("Recording") + chalk.gray(` ${waveform}`) + chalk.yellow(` (silence: ${(remaining / 1000).toFixed(1)}s)`)
          } else {
            spinner.text = chalk.cyan("Recording") + chalk.yellow(` (silence: ${(remaining / 1000).toFixed(1)}s until stop)`)
          }
        }

        // Stop recording after silence duration
        if (silenceDuration >= silenceDurationMs) {
          recorder.stop()
        }
      }
    }

    // Check max duration
    const elapsedSecs = (Date.now() - startTime) / 1000
    if (elapsedSecs >= maxDurationSecs) {
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
    // VS-UX-2: Show system recording indicator (notification on macOS)
    showRecordingIndicator()
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
    // VS-UX-2: Show cancelled indicator
    hideRecordingIndicator("cancelled")
    console.log(chalk.yellow("\n  Recording stopped by user.\n"))
  }

  // Handle recording error
  if (recordingError !== null) {
    // VS-UX-2: Show stopped indicator on error
    hideRecordingIndicator("stopped")
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
    // VS-UX-2: Show stopped indicator when no audio
    hideRecordingIndicator("stopped")
    const voiceError = new VoiceError(VoiceErrorType.MIC_UNAVAILABLE, {
      context: { totalBytes: 0, device: options.device },
    })
    handleVoiceError(voiceError)
    return
  }

  // Check if there was any voice activity
  if (!hasVoiceActivity) {
    // VS-UX-2: Show stopped indicator when no voice detected
    hideRecordingIndicator("stopped")
    const voiceError = new VoiceError(VoiceErrorType.TRANSCRIPTION_EMPTY, {
      context: { reason: "No voice activity detected", peakLevel },
    })
    handleVoiceError(voiceError)
    return
  }

  // Combine all audio chunks
  const audioBuffer = Buffer.concat(audioChunks)
  const durationSecs = totalBytes / (16000 * 2) // 16kHz, 16-bit

  // VS-UX-2: Show completed indicator when moving to transcription
  hideRecordingIndicator("completed")

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

// =============================================================================
// Hotkey Command - Global Keyboard Shortcut for Voice Recording
// =============================================================================

/**
 * Check if running on Wayland (Linux only)
 * VS-010: Wayland detection for Linux hotkey support
 * @returns true if running on Wayland, false otherwise
 */
function isWayland(): boolean {
  if (platform() !== "linux") {
    return false
  }
  // Check for Wayland indicators
  // WAYLAND_DISPLAY is set when running under a Wayland compositor
  // XDG_SESSION_TYPE is set to "wayland" on Wayland sessions
  return !!(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland")
}

/**
 * Check if Accessibility/keyboard permission is available
 * - macOS: Requires Accessibility permission for global hotkey capture
 * - Linux X11: Uses XGrabKey, no special permissions needed
 * - Linux Wayland: Not supported (returns false)
 * - Windows: Uses RegisterHotKey, no admin privileges needed
 */
function checkAccessibilityPermission(): boolean {
  const currentPlatform = platform()

  if (currentPlatform === "darwin") {
    try {
      // Use osascript to check if Accessibility permission is granted
      // This method attempts to list processes, which requires accessibility
      const result = execSync(
        `osascript -e 'tell application "System Events" to get name of first process'`,
        { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
      )
      return true
    } catch (error) {
      // If the script fails, accessibility permission is likely not granted
      return false
    }
  } else if (currentPlatform === "linux") {
    // On Linux X11, we just need to verify X11 is available
    // The node-global-key-listener uses XGrabKey which doesn't need special permissions
    // Just check that we're not on Wayland (handled separately)
    return !isWayland()
  } else if (currentPlatform === "win32") {
    // On Windows, RegisterHotKey doesn't require special permissions
    // Works without admin privileges
    return true
  }

  return false
}

/**
 * Open system settings for keyboard/accessibility permissions
 * - macOS: Opens Accessibility pane in System Settings
 * - Linux: Prints instructions (no GUI settings for X11)
 * - Windows: Prints instructions (no special permissions needed)
 * VS-010/VS-011: Cross-platform settings guidance
 */
function openAccessibilitySettings(): void {
  const currentPlatform = platform()

  if (currentPlatform === "darwin") {
    try {
      // macOS 13+ uses System Settings, older versions use System Preferences
      execSync(
        `open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"`,
        { stdio: "ignore" }
      )
    } catch {
      // Fallback for older macOS versions
      try {
        execSync(
          `open "/System/Library/PreferencePanes/Security.prefPane"`,
          { stdio: "ignore" }
        )
      } catch {
        console.log(chalk.gray("  Could not open System Settings automatically."))
      }
    }
  } else if (currentPlatform === "linux") {
    // VS-010: Linux doesn't have a system settings pane for X11 keyboard access
    // Just print helpful information
    console.log(chalk.gray("  Linux X11 hotkey requirements:"))
    console.log(chalk.gray("    - Install xdotool: sudo apt-get install xdotool"))
    console.log(chalk.gray("    - Ensure you're running X11, not Wayland"))
    console.log(chalk.gray("    - Check session type: echo $XDG_SESSION_TYPE"))
  } else if (currentPlatform === "win32") {
    // VS-011: Windows doesn't need special permissions for RegisterHotKey
    console.log(chalk.gray("  Windows hotkey should work without special permissions."))
    console.log(chalk.gray("  If you have issues, try running as Administrator."))
  }
}

// =============================================================================
// VS-013: Voice Daemon Commands
// =============================================================================

/**
 * Read the daemon PID from the PID file
 * @returns The PID number or null if not found/invalid
 */
function readDaemonPid(): number | null {
  const pidPath = getVoiceDaemonPidPath()
  if (!existsSync(pidPath)) {
    return null
  }
  try {
    const pidStr = readFileSync(pidPath, "utf-8").trim()
    const pid = parseInt(pidStr, 10)
    if (isNaN(pid) || pid <= 0) {
      return null
    }
    return pid
  } catch {
    return null
  }
}

/**
 * Check if a process with the given PID is running
 * @param pid - Process ID to check
 * @returns true if process is running, false otherwise
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 doesn't kill the process, just checks if it exists
    process.kill(pid, 0)
    return true
  } catch (error) {
    return false
  }
}

/**
 * Get daemon uptime if running
 * @returns Uptime string or null if not running
 */
function getDaemonUptime(): string | null {
  const pidPath = getVoiceDaemonPidPath()
  if (!existsSync(pidPath)) {
    return null
  }
  try {
    const stats = statSync(pidPath)
    const startTime = stats.mtime.getTime()
    const uptime = Date.now() - startTime

    // Format uptime
    const seconds = Math.floor(uptime / 1000) % 60
    const minutes = Math.floor(uptime / (1000 * 60)) % 60
    const hours = Math.floor(uptime / (1000 * 60 * 60)) % 24
    const days = Math.floor(uptime / (1000 * 60 * 60 * 24))

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    } else {
      return `${seconds}s`
    }
  } catch {
    return null
  }
}

/**
 * Daemon Start Command - Launch voice hotkey listener in background
 *
 * Spawns a detached child process running the hotkey listener that survives
 * terminal close. PID is stored in ~/.jfl/voice-daemon.pid
 */
export async function daemonStartCommand(options: { mode?: HotkeyMode } = {}): Promise<void> {
  // Check platform - daemon only supported on macOS for now
  if (platform() !== "darwin") {
    const error = new VoiceError(VoiceErrorType.PLATFORM_NOT_SUPPORTED)
    handleVoiceError(error)
    return
  }

  console.log(chalk.bold("\n🎤 Voice Daemon\n"))

  // Check if daemon is already running
  const existingPid = readDaemonPid()
  if (existingPid && isProcessRunning(existingPid)) {
    console.log(chalk.yellow("  Daemon is already running."))
    console.log(chalk.gray(`  PID: ${existingPid}`))
    console.log(chalk.gray(`  Uptime: ${getDaemonUptime()}`))
    console.log()
    console.log(chalk.gray("  Use 'jfl voice daemon stop' to stop it."))
    console.log(chalk.gray("  Use 'jfl voice daemon status' to check status."))
    console.log()
    return
  }

  // Check Accessibility permission first
  console.log(chalk.gray("  Checking Accessibility permission..."))
  if (!checkAccessibilityPermission()) {
    console.log()
    const error = new VoiceError(VoiceErrorType.ACCESSIBILITY_NOT_GRANTED)
    handleVoiceError(error)

    console.log(chalk.cyan("  Opening System Settings..."))
    openAccessibilitySettings()

    console.log()
    console.log(chalk.yellow("  After granting permission:"))
    console.log(chalk.gray("    1. Add your terminal app to Accessibility"))
    console.log(chalk.gray("    2. Restart your terminal"))
    console.log(chalk.gray("    3. Run 'jfl voice daemon start' again"))
    console.log()
    return
  }
  console.log(chalk.green("  ✓ Accessibility permission granted"))

  // Check other prerequisites (server, auth)
  const serverError = checkServerRunning()
  if (serverError) {
    handleVoiceError(serverError)
    return
  }

  const authError = checkAuthToken()
  if (authError) {
    handleVoiceError(authError)
    return
  }

  console.log(chalk.gray("  Starting daemon..."))

  // Get the path to the current executable (jfl CLI)
  const jflPath = process.argv[1]
  const nodePath = process.argv[0]

  // Build the command arguments
  const args = ["voice", "hotkey"]
  if (options.mode) {
    args.push("--mode", options.mode)
  }

  // Spawn detached process
  const logPath = getVoiceDaemonLogPath()
  const pidPath = getVoiceDaemonPidPath()

  ensureDirectories()

  // Create log file for daemon output
  const logFd = openSync(logPath, "a")

  const child = spawn(nodePath, [jflPath, ...args], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      JFL_VOICE_DAEMON: "1", // Mark this as daemon mode
    },
  })

  // Write PID to file
  if (child.pid) {
    writeFileSync(pidPath, child.pid.toString(), { mode: 0o644 })

    // Unref so parent can exit independently
    child.unref()

    // Close the log file descriptor in the parent
    closeSync(logFd)

    // Give it a moment to start and check if it's running
    await new Promise(resolve => setTimeout(resolve, 500))

    if (isProcessRunning(child.pid)) {
      console.log(chalk.green("\n  ✓ Daemon started successfully!"))
      console.log(chalk.gray(`  PID: ${child.pid}`))
      console.log(chalk.gray(`  Log: ${logPath}`))
      console.log()
      console.log(chalk.cyan("  Hotkey: Ctrl+Shift+Space"))
      console.log(chalk.gray("  The daemon will continue running after you close this terminal."))
      console.log()
      console.log(chalk.gray("  Commands:"))
      console.log(chalk.gray("    jfl voice daemon status   Check daemon status"))
      console.log(chalk.gray("    jfl voice daemon stop     Stop the daemon"))
      console.log()
    } else {
      // Daemon may have exited immediately - check log for errors
      console.log(chalk.red("\n  ✗ Daemon failed to start"))
      console.log(chalk.gray(`  Check log for details: ${logPath}`))
      // Clean up PID file
      try {
        unlinkSync(pidPath)
      } catch {}
      console.log()
    }
  } else {
    closeSync(logFd)
    console.log(chalk.red("\n  ✗ Failed to spawn daemon process"))
    console.log()
  }
}

/**
 * Daemon Stop Command - Stop the voice daemon gracefully
 *
 * Reads PID from ~/.jfl/voice-daemon.pid and sends SIGTERM
 */
export async function daemonStopCommand(): Promise<void> {
  console.log(chalk.bold("\n🎤 Voice Daemon\n"))

  const pid = readDaemonPid()
  const pidPath = getVoiceDaemonPidPath()

  if (!pid) {
    console.log(chalk.yellow("  Daemon is not running (no PID file)."))
    console.log()
    return
  }

  if (!isProcessRunning(pid)) {
    console.log(chalk.yellow("  Daemon is not running (stale PID file)."))
    console.log(chalk.gray("  Cleaning up PID file..."))
    try {
      unlinkSync(pidPath)
    } catch {}
    console.log(chalk.green("  ✓ Cleaned up"))
    console.log()
    return
  }

  console.log(chalk.gray(`  Stopping daemon (PID: ${pid})...`))

  try {
    // Send SIGTERM for graceful shutdown
    process.kill(pid, "SIGTERM")

    // Wait for process to stop (up to 5 seconds)
    let stopped = false
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 100))
      if (!isProcessRunning(pid)) {
        stopped = true
        break
      }
    }

    if (stopped) {
      console.log(chalk.green("  ✓ Daemon stopped successfully"))
      // Clean up PID file
      try {
        unlinkSync(pidPath)
      } catch {}
    } else {
      console.log(chalk.yellow("  Daemon did not stop gracefully, sending SIGKILL..."))
      try {
        process.kill(pid, "SIGKILL")
        await new Promise(resolve => setTimeout(resolve, 500))
        console.log(chalk.green("  ✓ Daemon killed"))
        try {
          unlinkSync(pidPath)
        } catch {}
      } catch (error) {
        console.log(chalk.red("  ✗ Failed to kill daemon"))
        console.log(chalk.gray(`  You may need to manually kill PID ${pid}`))
      }
    }
  } catch (error) {
    console.log(chalk.red("  ✗ Failed to stop daemon"))
    if (error instanceof Error) {
      console.log(chalk.gray(`  ${error.message}`))
    }
    console.log(chalk.gray(`  You may need to manually kill PID ${pid}`))
  }

  console.log()
}

/**
 * Daemon Status Command - Show daemon running status
 *
 * Checks if daemon is running based on PID file and process existence
 */
export async function daemonStatusCommand(): Promise<void> {
  console.log(chalk.bold("\n🎤 Voice Daemon Status\n"))

  const pid = readDaemonPid()
  const pidPath = getVoiceDaemonPidPath()
  const logPath = getVoiceDaemonLogPath()

  if (!pid) {
    console.log(chalk.yellow("  Status: stopped"))
    console.log(chalk.gray("  (no PID file found)"))
    console.log()
    console.log(chalk.gray("  Start with: jfl voice daemon start"))
    console.log()
    return
  }

  if (!isProcessRunning(pid)) {
    console.log(chalk.yellow("  Status: stopped (stale)"))
    console.log(chalk.gray(`  PID file exists but process ${pid} is not running`))
    console.log()
    console.log(chalk.gray("  Cleaning up stale PID file..."))
    try {
      unlinkSync(pidPath)
      console.log(chalk.green("  ✓ Cleaned up"))
    } catch {}
    console.log()
    console.log(chalk.gray("  Start with: jfl voice daemon start"))
    console.log()
    return
  }

  // Daemon is running
  const uptime = getDaemonUptime()

  console.log(chalk.green("  Status: running"))
  console.log(chalk.gray(`  PID: ${pid}`))
  if (uptime) {
    console.log(chalk.gray(`  Uptime: ${uptime}`))
  }
  console.log(chalk.gray(`  Log: ${logPath}`))
  console.log()
  console.log(chalk.cyan("  Hotkey: Ctrl+Shift+Space"))
  console.log()
  console.log(chalk.gray("  Commands:"))
  console.log(chalk.gray("    jfl voice daemon stop   Stop the daemon"))
  console.log()

  // Show last few lines of log if it exists
  if (existsSync(logPath)) {
    try {
      const logContent = readFileSync(logPath, "utf-8")
      const lines = logContent.trim().split("\n")
      const lastLines = lines.slice(-5)
      if (lastLines.length > 0 && lastLines[0]) {
        console.log(chalk.gray("  Recent log:"))
        for (const line of lastLines) {
          console.log(chalk.gray(`    ${line.substring(0, 80)}`))
        }
        console.log()
      }
    } catch {}
  }
}

/**
 * Hotkey Command - Start global hotkey listener
 *
 * Listens for Ctrl+Shift+Space globally (even when other apps have focus).
 * Supports multiple modes:
 * - auto: Smart detection - tap to toggle, or hold for hold-to-talk
 * - tap: Tap to start/stop recording
 * - hold: Hold to record, release to stop
 * VS-010/VS-011: Supported on macOS, Linux (X11), and Windows.
 * Requires Accessibility permission on macOS. On Linux Wayland, hotkeys are not supported.
 */
export async function hotkeyCommand(options: { device?: string; mode?: HotkeyMode } = {}): Promise<void> {
  const currentPlatform = platform()

  // VS-010: Check for Linux Wayland (not supported)
  if (currentPlatform === "linux" && isWayland()) {
    const error = new VoiceError(VoiceErrorType.WAYLAND_NOT_SUPPORTED)
    handleVoiceError(error)
    return
  }

  // Check platform - hotkey supported on macOS, Linux (X11), and Windows
  if (currentPlatform !== "darwin" && currentPlatform !== "linux" && currentPlatform !== "win32") {
    const error = new VoiceError(VoiceErrorType.PLATFORM_NOT_SUPPORTED)
    handleVoiceError(error)
    return
  }

  // Load hotkey config from voice.yaml, with command-line override
  const voiceConfig = readVoiceConfig()
  const hotkeyConfig: HotkeyConfig = voiceConfig?.hotkey || DEFAULT_HOTKEY_CONFIG
  const securityConfig: SecurityConfig = voiceConfig?.security || DEFAULT_SECURITY_CONFIG
  const activeMode: HotkeyMode = options.mode || hotkeyConfig.mode
  const holdThreshold = hotkeyConfig.holdThreshold

  console.log(chalk.bold("\n🎤 Voice Hotkey Mode\n"))
  console.log(chalk.gray("  Global hotkey: Ctrl+Shift+Space"))

  // Show mode-specific instructions
  if (activeMode === "tap") {
    console.log(chalk.gray("  Mode: tap-to-toggle"))
    console.log(chalk.gray("  First tap starts recording, second tap stops.\n"))
  } else if (activeMode === "hold") {
    console.log(chalk.gray("  Mode: hold-to-talk"))
    console.log(chalk.gray("  Hold to record, release to stop.\n"))
  } else {
    console.log(chalk.gray("  Mode: auto (smart detection)"))
    console.log(chalk.gray(`  Quick tap (<${holdThreshold}ms): toggle recording`))
    console.log(chalk.gray(`  Hold (>${holdThreshold}ms): hold-to-talk\n`))
  }

  // Check Accessibility/keyboard permission (platform-specific)
  if (currentPlatform === "darwin") {
    console.log(chalk.gray("  Checking Accessibility permission..."))
  } else if (currentPlatform === "linux") {
    console.log(chalk.gray("  Checking X11 environment..."))
  } else if (currentPlatform === "win32") {
    console.log(chalk.gray("  Checking keyboard access..."))
  }

  if (!checkAccessibilityPermission()) {
    console.log()
    if (currentPlatform === "darwin") {
      const error = new VoiceError(VoiceErrorType.ACCESSIBILITY_NOT_GRANTED)
      handleVoiceError(error)

      console.log(chalk.cyan("  Opening System Settings..."))
      openAccessibilitySettings()

      console.log()
      console.log(chalk.yellow("  After granting permission:"))
      console.log(chalk.gray("    1. Add your terminal app to Accessibility"))
      console.log(chalk.gray("    2. Restart your terminal"))
      console.log(chalk.gray("    3. Run 'jfl voice hotkey' again"))
    } else if (currentPlatform === "linux") {
      // VS-010: Linux X11 requirements
      console.log(chalk.red("  X11 environment not detected or xdotool not available."))
      console.log()
      console.log(chalk.yellow("  Requirements for Linux hotkey support:"))
      console.log(chalk.gray("    1. Must be running an X11 session (not Wayland)"))
      console.log(chalk.gray("    2. Install xdotool: sudo apt-get install xdotool"))
      console.log(chalk.gray("    3. Run 'jfl voice hotkey' again"))
      console.log()
      console.log(chalk.gray("  To check your session type: echo $XDG_SESSION_TYPE"))
    } else if (currentPlatform === "win32") {
      // VS-011: Windows should work without special permissions
      console.log(chalk.red("  Keyboard access check failed."))
      console.log(chalk.gray("  This is unexpected on Windows. Please try restarting your terminal."))
    }
    console.log()
    return
  }

  if (currentPlatform === "darwin") {
    console.log(chalk.green("  ✓ Accessibility permission granted\n"))
  } else if (currentPlatform === "linux") {
    console.log(chalk.green("  ✓ X11 environment detected\n"))
  } else if (currentPlatform === "win32") {
    console.log(chalk.green("  ✓ Keyboard access available\n"))
  }

  // Check other prerequisites (server, auth, model)
  const serverError = checkServerRunning()
  if (serverError) {
    handleVoiceError(serverError)
    return
  }

  const authError = checkAuthToken()
  if (authError) {
    handleVoiceError(authError)
    return
  }

  // Initialize keyboard listener
  let keyboardListener: GlobalKeyboardListener
  try {
    keyboardListener = new GlobalKeyboardListener()
  } catch (error) {
    console.log(chalk.red("\n  Failed to initialize keyboard listener."))
    if (currentPlatform === "darwin") {
      console.log(chalk.gray("  This may be due to missing Accessibility permission."))
      console.log()
      openAccessibilitySettings()
    } else if (currentPlatform === "linux") {
      // VS-010: Linux-specific error guidance
      console.log(chalk.gray("  On Linux X11, this requires the X11 display server."))
      console.log(chalk.gray("  Ensure you are running an X11 session and not Wayland."))
      console.log()
      console.log(chalk.yellow("  To check your session type:"))
      console.log(chalk.gray("    echo $XDG_SESSION_TYPE"))
    } else if (currentPlatform === "win32") {
      // VS-011: Windows-specific error guidance
      console.log(chalk.gray("  On Windows, this should work without special permissions."))
      console.log(chalk.gray("  Try running your terminal as Administrator if the issue persists."))
    }
    console.log()
    return
  }

  // State management for hotkey
  let isRecording = false
  let recordingPromise: Promise<void> | null = null
  let currentRecorder: AudioRecorder | null = null
  let audioChunks: Buffer[] = []
  let hasVoiceActivity = false
  let silenceStartTime: number | null = null
  let recordingStartTime: number | null = null
  let recordingSpinner: Ora | null = null
  let focusedAppAtStart: string | null = null // Track which app was focused when recording started

  // VAD settings
  const silenceThresholdDb = VAD_SILENCE_THRESHOLD_DB
  const silenceDurationMs = VAD_SILENCE_DURATION_MS

  // VS-SEC-3: Configurable max recording duration from security config
  const maxDurationSecs = securityConfig.maxRecordingDuration
  const warningThresholdSecs = Math.max(10, maxDurationSecs - 10) // Warning 10 seconds before limit
  let warningShown = false // Track if warning has been displayed

  // Helper function to start recording
  const startRecording = async () => {
    if (isRecording) return

    // Capture the focused app before we start recording (VS-SEC-2)
    focusedAppAtStart = getFocusedApp()
    if (process.env.DEBUG && focusedAppAtStart) {
      console.log(chalk.gray(`  [debug] Recording started in: ${focusedAppAtStart}`))
    }

    console.log(chalk.cyan("\n  Recording started... (press Ctrl+Shift+Space to stop)\n"))
    isRecording = true
    audioChunks = []
    hasVoiceActivity = false
    silenceStartTime = null
    recordingStartTime = Date.now()
    warningShown = false // VS-SEC-3: Reset warning flag for new recording

    // VS-012: Reset waveform buffer for new recording
    resetWaveformBuffer()
    const useWaveform = supportsWaveform()

    try {
      currentRecorder = new AudioRecorder({
        device: options.device,
        sampleRate: 16000,
      })
    } catch (error) {
      console.log(chalk.red("  Failed to initialize recorder"))
      isRecording = false
      return
    }

    recordingSpinner = ora({
      text: chalk.cyan("Recording...") + chalk.gray(" (waiting for voice)"),
      prefixText: "  ",
      spinner: "dots",
    })

    // Set up recorder event handlers
    currentRecorder.on("data", (chunk: Buffer) => {
      audioChunks.push(chunk)

      // Calculate peak level
      const chunkPeak = calculatePeakAmplitude(chunk)
      const peakDb = amplitudeToDb(chunkPeak)
      const isSilent = peakDb < silenceThresholdDb

      // VS-012: Add level to waveform buffer on every chunk
      addToWaveformBuffer(peakDb)

      // VS-012: Update spinner with waveform on every chunk
      if (recordingSpinner && recordingStartTime) {
        const elapsed = ((Date.now() - recordingStartTime) / 1000).toFixed(1)
        if (useWaveform) {
          const waveform = renderWaveform()
          recordingSpinner.text = chalk.cyan("Recording") + chalk.gray(` ${waveform} (${elapsed}s)`)
        }
      }

      if (!isSilent) {
        hasVoiceActivity = true
        silenceStartTime = null
      } else if (hasVoiceActivity) {
        if (silenceStartTime === null) {
          silenceStartTime = Date.now()
        } else {
          const silenceDuration = Date.now() - silenceStartTime
          if (silenceDuration >= silenceDurationMs) {
            // Auto-stop on silence
            stopRecording()
          }
        }
      }

      // Check max duration (VS-SEC-3)
      if (recordingStartTime) {
        const elapsed = (Date.now() - recordingStartTime) / 1000

        // Show warning 10 seconds before limit
        if (elapsed >= warningThresholdSecs && !warningShown) {
          warningShown = true
          const remaining = Math.ceil(maxDurationSecs - elapsed)
          console.log(chalk.yellow(`\n  ⚠ Recording will stop in ${remaining} seconds`))
        }

        // Auto-stop at max duration
        if (elapsed >= maxDurationSecs) {
          console.log(chalk.yellow(`\n  ⚠ Maximum recording duration (${maxDurationSecs}s) reached`))
          stopRecording()
        }
      }
    })

    currentRecorder.on("error", (error: Error) => {
      console.log(chalk.red(`\n  Recording error: ${error.message}`))
      isRecording = false
    })

    try {
      await currentRecorder.start()
      recordingSpinner.start()
      // VS-UX-2: Show system recording indicator (notification on macOS)
      showRecordingIndicator()
    } catch (error) {
      console.log(chalk.red("  Failed to start recording"))
      isRecording = false
    }
  }

  // Helper function to stop recording and transcribe
  const stopRecording = async () => {
    if (!isRecording || !currentRecorder) return

    currentRecorder.stop()
    isRecording = false

    // Wait for recorder to fully stop
    await new Promise<void>((resolve) => {
      const checkStopped = () => {
        if (!currentRecorder || currentRecorder.getState() === "idle" || currentRecorder.getState() === "error") {
          resolve()
        } else {
          setTimeout(checkStopped, 50)
        }
      }
      setTimeout(checkStopped, 100)
    })

    if (recordingSpinner) {
      recordingSpinner.stop()
      recordingSpinner = null
    }

    // Check if we have audio
    const totalBytes = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
    if (totalBytes === 0 || !hasVoiceActivity) {
      // VS-SEC-3: Zero audio buffers even on early return
      zeroBuffers(audioChunks)
      // VS-UX-2: Show stopped indicator when no audio
      hideRecordingIndicator("stopped")
      console.log(chalk.yellow("  No audio captured or no voice detected.\n"))
      console.log(chalk.gray("  Press Ctrl+Shift+Space to try again, or Ctrl+C to quit.\n"))
      return
    }

    // VS-UX-2: Show completed indicator when moving to transcription
    hideRecordingIndicator("completed")

    // Combine audio
    const audioBuffer = Buffer.concat(audioChunks)
    // VS-SEC-3: Zero the individual chunks immediately after combining
    zeroBuffers(audioChunks)
    const durationSecs = totalBytes / (16000 * 2)

    console.log(chalk.gray(`\n  Recorded ${durationSecs.toFixed(1)}s of audio.`))
    console.log(chalk.gray("  Transcribing...\n"))

    // Transcribe
    const transcribeSpinner = ora({
      text: "Transcribing...",
      prefixText: "  ",
    }).start()

    const authToken = readAuthToken()!
    const socketPath = getVoiceSocketPath()

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
      client.sendAudio(audioBuffer)
      client.endAudio()

      const timeout = 30000
      const startTime = Date.now()

      while (!transcriptionReceived && !transcriptionError) {
        if (Date.now() - startTime > timeout) {
          transcriptionError = new Error("Transcription timeout")
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      client.disconnect()
      // VS-SEC-3: Zero combined audio buffer immediately after transcription
      zeroBuffer(audioBuffer)
    } catch (error) {
      client.disconnect()
      // VS-SEC-3: Zero combined audio buffer on error
      zeroBuffer(audioBuffer)
      transcribeSpinner.fail("Transcription failed")
      console.log(chalk.red(`  ${error instanceof Error ? error.message : String(error)}\n`))
      console.log(chalk.gray("  Press Ctrl+Shift+Space to try again, or Ctrl+C to quit.\n"))
      return
    }

    if (transcriptionError || !transcription || transcription.trim() === "") {
      transcribeSpinner.fail("No transcription result")
      console.log(chalk.gray("  Press Ctrl+Shift+Space to try again, or Ctrl+C to quit.\n"))
      return
    }

    transcribeSpinner.succeed("Transcription complete!")

    const trimmedTranscription = transcription.trim()

    // VS-008: Preview transcript with configurable auto-send
    const previewConfig = voiceConfig?.preview || DEFAULT_PREVIEW_CONFIG
    const previewResult = await previewTranscript(trimmedTranscription, previewConfig.timeout)

    if (previewResult.action === "cancel") {
      console.log(chalk.yellow("  Cancelled."))
      console.log(chalk.gray("  Press Ctrl+Shift+Space to record again, or Ctrl+C to quit.\n"))
      return
    }

    // Use the final text (may have been edited by user)
    const finalText = previewResult.text

    // VS-SEC-2: Focus verification before paste
    // Check if the same app is still focused
    const currentFocusedApp = getFocusedApp()
    const focusUnchanged = focusedAppAtStart && currentFocusedApp && focusedAppAtStart === currentFocusedApp

    if (process.env.DEBUG) {
      console.log(chalk.gray(`  [debug] Focus at start: ${focusedAppAtStart}`))
      console.log(chalk.gray(`  [debug] Focus now: ${currentFocusedApp}`))
      console.log(chalk.gray(`  [debug] Focus unchanged: ${focusUnchanged}`))
    }

    if (focusUnchanged) {
      // VS-007: Same app focused - copy to clipboard and simulate paste
      const copied = copyToClipboard(finalText)
      if (copied) {
        // Small delay to ensure clipboard is ready
        await new Promise(resolve => setTimeout(resolve, 50))
        const pasted = simulatePaste()
        if (pasted) {
          console.log(chalk.green(`\n  ✓ Pasted to ${currentFocusedApp}!`))
          // VS-SEC-3: Schedule clipboard clear after successful paste
          scheduleClipboardClear(securityConfig.clipboardClearDelay)
          if (process.env.DEBUG) {
            console.log(chalk.gray(`  [debug] Clipboard will be cleared in ${securityConfig.clipboardClearDelay}s`))
          }
        } else {
          console.log(chalk.green("\n  ✓ Copied to clipboard!"))
          console.log(chalk.yellow(`  ⚠ Could not auto-paste (${getPasteShortcut()}). Text is on clipboard.`))
          // VS-SEC-3: Still schedule clipboard clear even if paste failed
          scheduleClipboardClear(securityConfig.clipboardClearDelay)
        }
      } else {
        console.log(chalk.yellow("\n  ⚠ Could not copy to clipboard"))
        // Display result for manual copy
        console.log()
        console.log(chalk.bold("  Transcription:"))
        console.log()
        console.log(chalk.cyan(`  "${finalText}"`))
      }
    } else {
      // Focus changed - show notification and don't auto-paste (security measure)
      console.log()
      console.log(chalk.yellow("  ⚠ Focus changed during recording"))
      if (focusedAppAtStart && currentFocusedApp) {
        console.log(chalk.gray(`    Started in: ${focusedAppAtStart}`))
        console.log(chalk.gray(`    Now in: ${currentFocusedApp}`))
      }

      // Copy to clipboard anyway for user convenience
      const copied = copyToClipboard(finalText)

      // Show notification with transcription
      const notified = showNotification(
        "Voice Transcription",
        finalText.length > 100
          ? finalText.substring(0, 97) + "..."
          : finalText
      )

      if (notified) {
        console.log(chalk.cyan("\n  📋 Notification shown with transcription"))
      }

      if (copied) {
        console.log(chalk.green(`  ✓ Copied to clipboard (${getPasteShortcut()} to paste manually)`))
        // VS-SEC-3: Schedule clipboard clear after copy
        scheduleClipboardClear(securityConfig.clipboardClearDelay)
      }

      // Display result
      console.log()
      console.log(chalk.bold("  Transcription:"))
      console.log()
      console.log(chalk.cyan(`  "${finalText}"`))
    }

    console.log()
    console.log(chalk.gray("  Press Ctrl+Shift+Space to record again, or Ctrl+C to quit.\n"))
  }

  // Track modifier keys state
  let ctrlPressed = false
  let shiftPressed = false

  // Hold-to-talk state tracking
  let keyDownTime: number | null = null
  let holdTimer: NodeJS.Timeout | null = null
  let isInHoldMode = false // True when user has held key past threshold

  // Clear hold timer
  const clearHoldTimer = () => {
    if (holdTimer) {
      clearTimeout(holdTimer)
      holdTimer = null
    }
  }

  // Add keyboard listener
  keyboardListener.addListener((event: IGlobalKeyEvent, isDown: IGlobalKeyDownMap) => {
    // Update modifier key states
    if (event.name === "LEFT CTRL" || event.name === "RIGHT CTRL") {
      ctrlPressed = event.state === "DOWN"
    }
    if (event.name === "LEFT SHIFT" || event.name === "RIGHT SHIFT") {
      shiftPressed = event.state === "DOWN"
    }

    // Check for Ctrl+Shift+Space
    const isHotkeyCombo = event.name === "SPACE" && ctrlPressed && shiftPressed

    if (!isHotkeyCombo) return

    if (event.state === "DOWN") {
      // Key pressed down
      if (keyDownTime !== null) {
        // Already tracking a press, ignore (debounce)
        return
      }

      keyDownTime = Date.now()

      if (activeMode === "tap") {
        // Pure tap mode: toggle on keydown
        if (isRecording) {
          stopRecording()
        } else {
          startRecording()
        }
      } else if (activeMode === "hold") {
        // Pure hold mode: start recording immediately on keydown
        if (!isRecording) {
          isInHoldMode = true
          startRecording()
        }
      } else {
        // Auto mode: wait for threshold to determine behavior
        // Start a timer to enter hold mode
        holdTimer = setTimeout(() => {
          // Timer fired - we're in hold mode now
          isInHoldMode = true
          if (!isRecording) {
            startRecording()
          }
        }, holdThreshold)
      }
    } else if (event.state === "UP") {
      // Key released
      const pressDuration = keyDownTime !== null ? Date.now() - keyDownTime : 0
      keyDownTime = null
      clearHoldTimer()

      if (activeMode === "tap") {
        // Pure tap mode: already handled on keydown, nothing to do on keyup
        // Reset state
        isInHoldMode = false
      } else if (activeMode === "hold") {
        // Pure hold mode: stop recording on keyup
        if (isRecording) {
          stopRecording()
        }
        isInHoldMode = false
      } else {
        // Auto mode: check if this was a tap or hold
        if (isInHoldMode) {
          // Was holding - stop recording on release
          if (isRecording) {
            stopRecording()
          }
          isInHoldMode = false
        } else {
          // Was a quick tap (released before threshold)
          // Toggle recording
          if (isRecording) {
            stopRecording()
          } else {
            startRecording()
          }
        }
      }
    }
  })

  console.log(chalk.green("  ✓ Hotkey listener started"))
  if (activeMode === "tap") {
    console.log(chalk.gray("  Press Ctrl+Shift+Space to start/stop recording"))
  } else if (activeMode === "hold") {
    console.log(chalk.gray("  Hold Ctrl+Shift+Space to record, release to stop"))
  } else {
    console.log(chalk.gray("  Tap Ctrl+Shift+Space to toggle, or hold to talk"))
  }
  console.log(chalk.gray("  Press Ctrl+C to quit\n"))

  // Handle Ctrl+C to exit
  const cleanup = () => {
    console.log(chalk.yellow("\n  Stopping hotkey listener...\n"))
    clearHoldTimer()
    keyboardListener.kill()
    if (currentRecorder) {
      currentRecorder.stop()
    }
    process.exit(0)
  }

  process.on("SIGINT", cleanup)
  process.on("SIGTERM", cleanup)

  // Keep the process running
  await new Promise(() => {
    // This promise never resolves - we run until Ctrl+C
  })
}

// Helper functions used by hotkeyCommand (reference existing functions)
// calculatePeakAmplitude is already defined elsewhere in this file
// amplitudeToDb is already defined elsewhere in this file
// copyToClipboard is already defined elsewhere in this file

// Main voice command handler
export async function voiceCommand(
  action?: string,
  subaction?: string,
  arg?: string,
  options?: { force?: boolean, device?: string, duration?: number, help?: boolean, mode?: string }
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

  if (action === "hotkey") {
    // Validate mode option if provided
    const validModes: HotkeyMode[] = ["auto", "tap", "hold"]
    let mode: HotkeyMode | undefined
    if (options?.mode) {
      if (validModes.includes(options.mode as HotkeyMode)) {
        mode = options.mode as HotkeyMode
      } else {
        console.log(chalk.red(`Invalid mode: ${options.mode}`))
        console.log(chalk.gray("Valid modes: auto, tap, hold"))
        return
      }
    }
    await hotkeyCommand({ device: options?.device, mode })
    return
  }

  // VS-013: Daemon commands for background hotkey listening
  if (action === "daemon") {
    // Validate mode option if provided
    const validModes: HotkeyMode[] = ["auto", "tap", "hold"]
    let mode: HotkeyMode | undefined
    if (options?.mode) {
      if (validModes.includes(options.mode as HotkeyMode)) {
        mode = options.mode as HotkeyMode
      } else {
        console.log(chalk.red(`Invalid mode: ${options.mode}`))
        console.log(chalk.gray("Valid modes: auto, tap, hold"))
        return
      }
    }

    if (!subaction || subaction === "status") {
      await daemonStatusCommand()
    } else if (subaction === "start") {
      await daemonStartCommand({ mode })
    } else if (subaction === "stop") {
      await daemonStopCommand()
    } else {
      console.log(chalk.red(`Unknown daemon command: ${subaction}`))
      console.log(chalk.gray("\nAvailable commands: start, stop, status"))
    }
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
