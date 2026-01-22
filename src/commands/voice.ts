import chalk from "chalk"
import ora from "ora"
import inquirer from "inquirer"
import { existsSync, mkdirSync, statSync, createWriteStream, unlinkSync, renameSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { createHash } from "crypto"
import https from "https"
import http from "http"

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

// Get voice config path
function getVoiceConfigPath(): string {
  return join(getJflDir(), "voice.yaml")
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

// Main voice command handler
export async function voiceCommand(
  action?: string,
  subaction?: string,
  arg?: string,
  options?: { force?: boolean }
): Promise<void> {
  if (!action) {
    // Show help
    console.log(chalk.bold("\n🎤 JFL Voice\n"))
    console.log(chalk.gray("Push-to-talk voice input for JFL CLI.\n"))

    console.log(chalk.cyan("Model Management:"))
    console.log("  jfl voice model list              List available models")
    console.log("  jfl voice model download <name>   Download a model")
    console.log("  jfl voice model default <name>    Set default model")

    console.log(chalk.cyan("\nServer Commands: (coming soon)"))
    console.log(chalk.gray("  jfl voice server start            Start whisper server"))
    console.log(chalk.gray("  jfl voice server stop             Stop whisper server"))
    console.log(chalk.gray("  jfl voice server status           Show server status"))

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

  // Placeholder for future commands
  if (action === "server" || action === "setup" || action === "test") {
    console.log(chalk.yellow(`\n⚠️  'jfl voice ${action}' is coming soon.\n`))
    console.log(chalk.gray("For now, use 'jfl voice model' commands to manage whisper models."))
    console.log()
    return
  }

  console.log(chalk.red(`Unknown voice command: ${action}`))
  console.log(chalk.gray("Run 'jfl voice' for help."))
}
