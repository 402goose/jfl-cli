import chalk from "chalk"
import ora from "ora"
import inquirer from "inquirer"
import { existsSync, mkdirSync, statSync, createWriteStream, unlinkSync, renameSync, readFileSync, writeFileSync, chmodSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { createHash, randomBytes } from "crypto"
import https from "https"
import http from "http"
import { spawn, execSync } from "child_process"
import { fileURLToPath } from "url"

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
function getJflDir(): string {
  return join(homedir(), ".jfl")
}

// Get models directory
function getModelsDir(): string {
  return join(getJflDir(), "models")
}

// Get voice config path (for general voice settings)
function getVoiceConfigPath(): string {
  return join(getJflDir(), "voice.yaml")
}

// Get voice server config path
function getVoiceServerConfigPath(): string {
  return join(getJflDir(), "voice-server.yaml")
}

// Get voice server PID file path
function getServerPidPath(): string {
  return join(getJflDir(), "voice-server.pid")
}

// Get voice server token path
function getServerTokenPath(): string {
  return join(getJflDir(), "voice-server.token")
}

// Get the whisper server binary path
function getWhisperServerPath(): string {
  // Try to find the server in the product directory relative to CLI
  // First check if we're running from the repo
  const possiblePaths = [
    // From JFL GTM repo
    join(process.cwd(), "product", "packages", "whisper-server", "build", "whisper-stream-server"),
    // From symlinked product
    join(process.cwd(), "..", "jfl-platform", "packages", "whisper-server", "build", "whisper-stream-server"),
    // Installed globally
    "/usr/local/bin/whisper-stream-server",
  ]

  for (const p of possiblePaths) {
    if (existsSync(p)) return p
  }

  return possiblePaths[0] // Return first path for error messages
}

// Get VAD model path
function getVadModelPath(): string {
  return join(getModelsDir(), "ggml-silero-vad.bin")
}

// VAD model info
const VAD_MODEL = {
  url: "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin",
  size: "1 MB",
  sizeBytes: 1_000_000,
}

// Server config interface
interface ServerConfig {
  model: string
  port: number
  host: string
  contexts: number
  threads: number
  vadThreshold: number
  vadSilence: number
  language: string
}

// Default server config
const DEFAULT_SERVER_CONFIG: ServerConfig = {
  model: "base",
  port: 9090,
  host: "127.0.0.1",
  contexts: 2,
  threads: 4,
  vadThreshold: 0.5,
  vadSilence: 1000,
  language: "en",
}

// Read server config
function readServerConfig(): ServerConfig {
  const configPath = getVoiceServerConfigPath()
  if (!existsSync(configPath)) {
    return { ...DEFAULT_SERVER_CONFIG }
  }

  try {
    const content = readFileSync(configPath, "utf-8")
    const config = { ...DEFAULT_SERVER_CONFIG }

    // Parse YAML manually (simple key: value format)
    for (const line of content.split("\n")) {
      const match = line.match(/^(\w+):\s*(.+)$/)
      if (match) {
        const [, key, value] = match
        switch (key) {
          case "model":
            config.model = value.trim()
            break
          case "port":
            config.port = parseInt(value, 10)
            break
          case "host":
            config.host = value.trim()
            break
          case "contexts":
            config.contexts = parseInt(value, 10)
            break
          case "threads":
            config.threads = parseInt(value, 10)
            break
          case "vadThreshold":
            config.vadThreshold = parseFloat(value)
            break
          case "vadSilence":
            config.vadSilence = parseInt(value, 10)
            break
          case "language":
            config.language = value.trim()
            break
        }
      }
    }

    return config
  } catch {
    return { ...DEFAULT_SERVER_CONFIG }
  }
}

// Write server config
function writeServerConfig(config: ServerConfig): void {
  ensureDirectories()
  const configPath = getVoiceServerConfigPath()

  const content = `# JFL Voice Server Configuration
# Generated by jfl voice server config

model: ${config.model}
port: ${config.port}
host: ${config.host}
contexts: ${config.contexts}
threads: ${config.threads}
vadThreshold: ${config.vadThreshold}
vadSilence: ${config.vadSilence}
language: ${config.language}
`

  writeFileSync(configPath, content, { mode: 0o644 })
}

// Generate or read auth token
function getOrCreateServerToken(): string {
  const tokenPath = getServerTokenPath()
  ensureDirectories()

  if (existsSync(tokenPath)) {
    return readFileSync(tokenPath, "utf-8").trim()
  }

  // Generate new 32-byte token
  const token = randomBytes(32).toString("hex")
  writeFileSync(tokenPath, token, { mode: 0o600 })
  chmodSync(tokenPath, 0o600) // Ensure restricted permissions
  return token
}

// Get server PID if running
function getServerPid(): number | null {
  const pidPath = getServerPidPath()
  if (!existsSync(pidPath)) return null

  try {
    const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10)
    if (isNaN(pid)) return null

    // Check if process is actually running
    try {
      process.kill(pid, 0) // Signal 0 just checks if process exists
      return pid
    } catch {
      // Process not running, clean up stale PID file
      unlinkSync(pidPath)
      return null
    }
  } catch {
    return null
  }
}

// Check if server is running
function isServerRunning(): boolean {
  return getServerPid() !== null
}

// Get server memory usage (macOS/Linux)
function getProcessMemory(pid: number): string | null {
  try {
    if (process.platform === "darwin") {
      const output = execSync(`ps -o rss= -p ${pid}`, { encoding: "utf-8" })
      const kb = parseInt(output.trim(), 10)
      if (isNaN(kb)) return null
      return formatBytes(kb * 1024)
    } else if (process.platform === "linux") {
      const output = execSync(`ps -o rss= -p ${pid}`, { encoding: "utf-8" })
      const kb = parseInt(output.trim(), 10)
      if (isNaN(kb)) return null
      return formatBytes(kb * 1024)
    }
    return null
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

// ============================================================================
// SERVER COMMANDS
// ============================================================================

// Download VAD model if needed
async function ensureVadModel(): Promise<boolean> {
  const vadPath = getVadModelPath()
  if (existsSync(vadPath)) {
    return true
  }

  console.log(chalk.yellow("VAD model not found. Downloading..."))

  const spinner = ora({
    text: "Downloading VAD model...",
    prefixText: "  ",
  }).start()

  try {
    const partialPath = vadPath + ".partial"
    await downloadFile(
      VAD_MODEL.url,
      vadPath,
      partialPath,
      VAD_MODEL.sizeBytes,
      () => {} // No progress for small file
    )
    spinner.succeed("VAD model downloaded")
    return true
  } catch (error) {
    spinner.fail("Failed to download VAD model")
    console.error(chalk.red(error))
    return false
  }
}

// Server start command
export async function serverStartCommand(options?: { background?: boolean }): Promise<void> {
  console.log(chalk.bold("\n🎤 JFL Voice Server - Start\n"))

  // Check if already running
  const existingPid = getServerPid()
  if (existingPid) {
    console.log(chalk.yellow(`Server is already running (PID: ${existingPid})`))
    console.log(chalk.gray("Run 'jfl voice server stop' to stop it first."))
    return
  }

  // Load config
  const config = readServerConfig()

  // Check if whisper server binary exists
  const serverPath = getWhisperServerPath()
  if (!existsSync(serverPath)) {
    console.log(chalk.red("Whisper server binary not found."))
    console.log(chalk.gray("\nTo build the server:"))
    console.log(chalk.gray("  cd product/packages/whisper-server"))
    console.log(chalk.gray("  ./scripts/build.sh"))
    return
  }

  // Check if model is downloaded
  const modelPath = getModelPath(config.model)
  if (!existsSync(modelPath)) {
    console.log(chalk.yellow(`Model '${config.model}' is not downloaded.`))

    const { download } = await inquirer.prompt([
      {
        type: "confirm",
        name: "download",
        message: `Download '${config.model}' model now?`,
        default: true,
      },
    ])

    if (download) {
      await downloadModelCommand(config.model)
      if (!existsSync(modelPath)) {
        console.log(chalk.red("Model download failed. Cannot start server."))
        return
      }
    } else {
      return
    }
  }

  // Ensure VAD model exists
  if (!(await ensureVadModel())) {
    console.log(chalk.red("Cannot start server without VAD model."))
    return
  }

  const vadPath = getVadModelPath()
  const token = getOrCreateServerToken()

  // Build command arguments
  const args = [
    "--model", modelPath,
    "--vad-model", vadPath,
    "--port", config.port.toString(),
    "--host", config.host,
    "--contexts", config.contexts.toString(),
    "--threads", config.threads.toString(),
    "--token", token,
    "--vad-threshold", config.vadThreshold.toString(),
    "--vad-silence", config.vadSilence.toString(),
    "--language", config.language,
  ]

  console.log(chalk.gray(`Server: ${serverPath}`))
  console.log(chalk.gray(`Model: ${config.model}`))
  console.log(chalk.gray(`Port: ${config.port}`))
  console.log(chalk.gray(`Host: ${config.host}`))
  console.log(chalk.gray(`Token: ${token.slice(0, 8)}...`))
  console.log()

  if (options?.background) {
    // Daemonize the server
    const child = spawn(serverPath, args, {
      detached: true,
      stdio: "ignore",
    })

    child.unref()

    // Save PID
    const pidPath = getServerPidPath()
    writeFileSync(pidPath, child.pid!.toString(), { mode: 0o644 })

    console.log(chalk.green(`✓ Server started in background (PID: ${child.pid})`))
    console.log(chalk.gray(`  Config: ${getVoiceServerConfigPath()}`))
    console.log(chalk.gray(`  Token: ${getServerTokenPath()}`))
    console.log(chalk.gray(`  PID: ${pidPath}`))
    console.log()
    console.log(chalk.cyan("Commands:"))
    console.log("  jfl voice server status   Check server status")
    console.log("  jfl voice server stop     Stop the server")
  } else {
    // Run in foreground
    console.log(chalk.cyan("Starting server in foreground... (Ctrl+C to stop)\n"))

    const child = spawn(serverPath, args, {
      stdio: "inherit",
    })

    // Handle graceful shutdown
    const cleanup = () => {
      if (!child.killed) {
        child.kill("SIGTERM")
      }
    }

    process.on("SIGINT", cleanup)
    process.on("SIGTERM", cleanup)

    child.on("exit", (code) => {
      process.off("SIGINT", cleanup)
      process.off("SIGTERM", cleanup)
      console.log(chalk.gray(`\nServer exited with code ${code}`))
    })

    // Wait for child to exit
    await new Promise<void>((resolve) => {
      child.on("exit", () => resolve())
    })
  }
}

// Server stop command
export async function serverStopCommand(): Promise<void> {
  console.log(chalk.bold("\n🎤 JFL Voice Server - Stop\n"))

  const pid = getServerPid()
  if (!pid) {
    console.log(chalk.yellow("Server is not running."))
    return
  }

  console.log(chalk.gray(`Stopping server (PID: ${pid})...`))

  try {
    // Send SIGTERM for graceful shutdown
    process.kill(pid, "SIGTERM")

    // Wait for process to exit (up to 5 seconds)
    const startTime = Date.now()
    while (Date.now() - startTime < 5000) {
      try {
        process.kill(pid, 0) // Check if still running
        await new Promise((r) => setTimeout(r, 100))
      } catch {
        // Process has exited
        break
      }
    }

    // Check if it's still running
    try {
      process.kill(pid, 0)
      // Still running, force kill
      console.log(chalk.yellow("Server didn't stop gracefully, force killing..."))
      process.kill(pid, "SIGKILL")
    } catch {
      // Process has exited
    }

    // Clean up PID file
    const pidPath = getServerPidPath()
    if (existsSync(pidPath)) {
      unlinkSync(pidPath)
    }

    console.log(chalk.green("✓ Server stopped"))
  } catch (error) {
    console.log(chalk.red(`Failed to stop server: ${error}`))
  }
}

// Server status command
export async function serverStatusCommand(): Promise<void> {
  console.log(chalk.bold("\n🎤 JFL Voice Server - Status\n"))

  const config = readServerConfig()
  const pid = getServerPid()
  const tokenPath = getServerTokenPath()
  const hasToken = existsSync(tokenPath)

  // Status
  if (pid) {
    console.log(chalk.green("● Running"))
    console.log(chalk.gray(`  PID: ${pid}`))

    const memory = getProcessMemory(pid)
    if (memory) {
      console.log(chalk.gray(`  Memory: ${memory}`))
    }
  } else {
    console.log(chalk.red("○ Stopped"))
  }

  console.log()

  // Configuration
  console.log(chalk.cyan("Configuration"))
  console.log(chalk.gray(`  Config file: ${getVoiceServerConfigPath()}`))
  console.log(chalk.gray(`  Model: ${config.model}`))
  console.log(chalk.gray(`  Host: ${config.host}`))
  console.log(chalk.gray(`  Port: ${config.port}`))
  console.log(chalk.gray(`  Contexts: ${config.contexts}`))
  console.log(chalk.gray(`  Threads: ${config.threads}`))
  console.log(chalk.gray(`  Language: ${config.language}`))

  console.log()

  // Model status
  console.log(chalk.cyan("Model Status"))
  const modelPath = getModelPath(config.model)
  const modelExists = existsSync(modelPath)
  console.log(`  ${modelExists ? chalk.green("✓") : chalk.red("✗")} Whisper model: ${config.model}`)

  const vadPath = getVadModelPath()
  const vadExists = existsSync(vadPath)
  console.log(`  ${vadExists ? chalk.green("✓") : chalk.red("✗")} VAD model`)

  console.log()

  // Auth
  console.log(chalk.cyan("Authentication"))
  if (hasToken) {
    const token = readFileSync(tokenPath, "utf-8").trim()
    console.log(chalk.gray(`  Token: ${token.slice(0, 8)}...${token.slice(-4)}`))
    console.log(chalk.gray(`  Token file: ${tokenPath}`))
  } else {
    console.log(chalk.yellow("  No token configured (will be generated on start)"))
  }

  console.log()

  // Connection info
  if (pid) {
    console.log(chalk.cyan("Connection"))
    console.log(chalk.gray(`  WebSocket: ws://${config.host}:${config.port}`))
    console.log(chalk.gray(`  HTTP: http://${config.host}:${config.port}/v1/transcribe`))
  }

  console.log()
}

// Server config command
export async function serverConfigCommand(
  key?: string,
  value?: string
): Promise<void> {
  const config = readServerConfig()

  // If no key provided, show current config
  if (!key) {
    console.log(chalk.bold("\n🎤 JFL Voice Server - Configuration\n"))
    console.log(chalk.gray(`Config file: ${getVoiceServerConfigPath()}\n`))

    console.log(chalk.cyan("Current settings:"))
    console.log(`  model: ${chalk.white(config.model)}`)
    console.log(`  port: ${chalk.white(config.port)}`)
    console.log(`  host: ${chalk.white(config.host)}`)
    console.log(`  contexts: ${chalk.white(config.contexts)}`)
    console.log(`  threads: ${chalk.white(config.threads)}`)
    console.log(`  vadThreshold: ${chalk.white(config.vadThreshold)}`)
    console.log(`  vadSilence: ${chalk.white(config.vadSilence)}`)
    console.log(`  language: ${chalk.white(config.language)}`)

    console.log()
    console.log(chalk.cyan("Usage:"))
    console.log("  jfl voice server config <key> <value>")
    console.log()
    console.log(chalk.cyan("Examples:"))
    console.log("  jfl voice server config model small")
    console.log("  jfl voice server config port 8080")
    console.log("  jfl voice server config contexts 4")
    console.log()
    return
  }

  // Validate key
  const validKeys = Object.keys(DEFAULT_SERVER_CONFIG)
  if (!validKeys.includes(key)) {
    console.log(chalk.red(`Unknown config key: ${key}`))
    console.log(chalk.gray(`\nValid keys: ${validKeys.join(", ")}`))
    return
  }

  // If no value, show current value
  if (value === undefined) {
    console.log(chalk.gray(`${key}: ${(config as any)[key]}`))
    return
  }

  // Update config
  switch (key) {
    case "model":
      // Validate model name
      if (!(value in WHISPER_MODELS)) {
        console.log(chalk.red(`Unknown model: ${value}`))
        console.log(chalk.gray("\nAvailable models:"))
        for (const name of Object.keys(WHISPER_MODELS)) {
          console.log(`  - ${name}`)
        }
        return
      }
      config.model = value
      break
    case "port":
      const port = parseInt(value, 10)
      if (isNaN(port) || port < 1 || port > 65535) {
        console.log(chalk.red("Invalid port number. Must be 1-65535."))
        return
      }
      config.port = port
      break
    case "host":
      config.host = value
      break
    case "contexts":
      const contexts = parseInt(value, 10)
      if (isNaN(contexts) || contexts < 1 || contexts > 16) {
        console.log(chalk.red("Invalid contexts. Must be 1-16."))
        return
      }
      config.contexts = contexts
      break
    case "threads":
      const threads = parseInt(value, 10)
      if (isNaN(threads) || threads < 1 || threads > 32) {
        console.log(chalk.red("Invalid threads. Must be 1-32."))
        return
      }
      config.threads = threads
      break
    case "vadThreshold":
      const threshold = parseFloat(value)
      if (isNaN(threshold) || threshold < 0 || threshold > 1) {
        console.log(chalk.red("Invalid VAD threshold. Must be 0.0-1.0."))
        return
      }
      config.vadThreshold = threshold
      break
    case "vadSilence":
      const silence = parseInt(value, 10)
      if (isNaN(silence) || silence < 100 || silence > 10000) {
        console.log(chalk.red("Invalid VAD silence. Must be 100-10000 ms."))
        return
      }
      config.vadSilence = silence
      break
    case "language":
      config.language = value
      break
  }

  writeServerConfig(config)
  console.log(chalk.green(`✓ Set ${key} = ${value}`))

  // Warn if server is running
  if (isServerRunning()) {
    console.log(chalk.yellow("\nNote: Restart the server for changes to take effect."))
    console.log(chalk.gray("  jfl voice server stop && jfl voice server start"))
  }
}

// Main voice command handler
export async function voiceCommand(
  action?: string,
  subaction?: string,
  arg?: string,
  options?: { force?: boolean; background?: boolean }
): Promise<void> {
  if (!action) {
    // Show help
    console.log(chalk.bold("\n🎤 JFL Voice\n"))
    console.log(chalk.gray("Push-to-talk voice input for JFL CLI.\n"))

    console.log(chalk.cyan("Model Management:"))
    console.log("  jfl voice model list              List available models")
    console.log("  jfl voice model download <name>   Download a model")
    console.log("  jfl voice model default <name>    Set default model")

    console.log(chalk.cyan("\nServer Commands:"))
    console.log("  jfl voice server start            Start whisper server (foreground)")
    console.log("  jfl voice server start --background  Start in background")
    console.log("  jfl voice server stop             Stop whisper server")
    console.log("  jfl voice server status           Show server status")
    console.log("  jfl voice server config           Show/update server config")

    console.log(chalk.cyan("\nVoice Commands: (coming soon)"))
    console.log(chalk.gray("  jfl voice setup                   First-time setup wizard"))
    console.log(chalk.gray("  jfl voice test                    Test voice input"))

    console.log()
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

  if (action === "server") {
    if (!subaction || subaction === "status") {
      await serverStatusCommand()
    } else if (subaction === "start") {
      await serverStartCommand({ background: options?.background })
    } else if (subaction === "stop") {
      await serverStopCommand()
    } else if (subaction === "config") {
      // arg is the key, options has the value via a different route
      // For config, we need to handle: jfl voice server config <key> <value>
      // subaction=config, arg=key, and we need a way to pass value
      await serverConfigCommand(arg)
    } else {
      console.log(chalk.red(`Unknown server command: ${subaction}`))
      console.log(chalk.gray("\nAvailable commands: start, stop, status, config"))
    }
    return
  }

  // Placeholder for future commands
  if (action === "setup" || action === "test") {
    console.log(chalk.yellow(`\n⚠️  'jfl voice ${action}' is coming soon.\n`))
    console.log(chalk.gray("For now, use 'jfl voice model' and 'jfl voice server' commands."))
    console.log()
    return
  }

  console.log(chalk.red(`Unknown voice command: ${action}`))
  console.log(chalk.gray("Run 'jfl voice' for help."))
}

// Export for server subcommand with extra arg
export async function voiceServerConfigCommand(
  key?: string,
  value?: string
): Promise<void> {
  await serverConfigCommand(key, value)
}
