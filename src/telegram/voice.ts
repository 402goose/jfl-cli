/**
 * Telegram Voice Message Handler
 *
 * TG-001: Add voice message handler to Telegram bot
 * TG-002: Implement OGG to WAV conversion
 * TG-003: Connect Telegram to whisper HTTP endpoint
 *
 * Handles voice messages from Telegram, converts OGG Opus to WAV,
 * and sends to local whisper server for transcription.
 */

import { spawn } from 'child_process'
import { promisify } from 'util'
import { Readable } from 'stream'

// ============================================================================
// Types
// ============================================================================

/** Telegram context object (stub for integration) */
export interface TelegramContext {
  message?: {
    voice?: {
      file_id: string
      file_unique_id: string
      duration: number
      mime_type?: string
      file_size?: number
    }
    from?: {
      id: number
      username?: string
      first_name?: string
    }
    chat: {
      id: number
      type: string
    }
  }
  reply: (text: string, options?: ReplyOptions) => Promise<void>
  replyWithMarkdown?: (text: string, options?: ReplyOptions) => Promise<void>
}

interface ReplyOptions {
  reply_to_message_id?: number
  parse_mode?: string
}

/** Telegram file response */
interface TelegramFileResponse {
  ok: boolean
  result?: {
    file_id: string
    file_unique_id: string
    file_size?: number
    file_path?: string
  }
  description?: string
}

/** Whisper transcription response */
interface WhisperResponse {
  text: string
  segments?: Array<{
    start: number
    end: number
    text: string
  }>
  language?: string
  duration?: number
}

/** Rate limit entry */
interface RateLimitEntry {
  count: number
  windowStart: number
}

/** Voice handler configuration */
export interface VoiceHandlerConfig {
  /** Telegram Bot API token */
  botToken: string
  /** Whisper server URL (default: http://localhost:8080) */
  whisperUrl?: string
  /** Max file size in bytes (default: 20MB) */
  maxFileSize?: number
  /** Max duration in seconds (default: 120s) */
  maxDuration?: number
  /** Rate limit: max messages per window (default: 10) */
  rateLimitMax?: number
  /** Rate limit window in ms (default: 60000 = 1 minute) */
  rateLimitWindow?: number
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: Required<Omit<VoiceHandlerConfig, 'botToken'>> = {
  whisperUrl: 'http://localhost:8080',
  maxFileSize: 20 * 1024 * 1024, // 20MB
  maxDuration: 120, // 120 seconds
  rateLimitMax: 10,
  rateLimitWindow: 60 * 1000, // 1 minute
}

const TELEGRAM_API_BASE = 'https://api.telegram.org'

// OGG magic bytes: "OggS"
const OGG_MAGIC = Buffer.from([0x4f, 0x67, 0x67, 0x53])

// WAV format constants
const WAV_SAMPLE_RATE = 16000
const WAV_BITS_PER_SAMPLE = 16
const WAV_CHANNELS = 1

// ============================================================================
// Rate Limiting
// ============================================================================

/** Per-user rate limit tracking */
const rateLimitMap = new Map<number, RateLimitEntry>()

/**
 * Check if user is rate limited
 * @returns true if rate limited, false if allowed
 */
function isRateLimited(
  userId: number,
  maxMessages: number,
  windowMs: number
): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(userId)

  if (!entry) {
    // First request from this user
    rateLimitMap.set(userId, { count: 1, windowStart: now })
    return false
  }

  // Check if window has expired
  if (now - entry.windowStart > windowMs) {
    // Reset window
    rateLimitMap.set(userId, { count: 1, windowStart: now })
    return false
  }

  // Within window - check count
  if (entry.count >= maxMessages) {
    return true
  }

  // Increment count
  entry.count++
  return false
}

/**
 * Clear expired rate limit entries (call periodically)
 */
export function cleanupRateLimits(windowMs: number = DEFAULT_CONFIG.rateLimitWindow): void {
  const now = Date.now()
  const entries = Array.from(rateLimitMap.entries())
  for (const [userId, entry] of entries) {
    if (now - entry.windowStart > windowMs) {
      rateLimitMap.delete(userId)
    }
  }
}

// ============================================================================
// Telegram API
// ============================================================================

/**
 * Download audio file from Telegram servers
 * TG-001: Downloads audio file from Telegram servers
 */
export async function downloadTelegramAudio(
  fileId: string,
  botToken: string
): Promise<Buffer> {
  // Step 1: Get file path from Telegram
  const getFileUrl = `${TELEGRAM_API_BASE}/bot${botToken}/getFile?file_id=${fileId}`

  const fileInfoResponse = await fetch(getFileUrl)
  if (!fileInfoResponse.ok) {
    throw new Error(`Failed to get file info: ${fileInfoResponse.statusText}`)
  }

  const fileInfo: TelegramFileResponse = await fileInfoResponse.json()
  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    throw new Error(`Telegram API error: ${fileInfo.description || 'No file path returned'}`)
  }

  // Step 2: Download the actual file
  const downloadUrl = `${TELEGRAM_API_BASE}/file/bot${botToken}/${fileInfo.result.file_path}`

  const fileResponse = await fetch(downloadUrl)
  if (!fileResponse.ok) {
    throw new Error(`Failed to download file: ${fileResponse.statusText}`)
  }

  const arrayBuffer = await fileResponse.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// ============================================================================
// Audio Conversion
// ============================================================================

/**
 * Validate OGG file by checking magic bytes
 */
function validateOggFile(buffer: Buffer): boolean {
  if (buffer.length < 4) {
    return false
  }
  return buffer.subarray(0, 4).equals(OGG_MAGIC)
}

/**
 * Convert OGG Opus audio to WAV format
 * TG-002: Convert Telegram OGG Opus audio to WAV format
 *
 * Uses ffmpeg for conversion. ffmpeg is widely available and handles
 * OGG Opus → WAV conversion reliably.
 *
 * Output: 16-bit PCM WAV, 16kHz sample rate, mono
 */
export async function convertOggToWav(oggBuffer: Buffer): Promise<Buffer> {
  // Validate input
  if (!validateOggFile(oggBuffer)) {
    throw new Error('Invalid OGG file: magic bytes do not match')
  }

  return new Promise((resolve, reject) => {
    // ffmpeg args:
    // -f ogg: input format
    // -i pipe:0: read from stdin
    // -f wav: output format
    // -acodec pcm_s16le: 16-bit PCM
    // -ar 16000: 16kHz sample rate
    // -ac 1: mono
    // pipe:1: write to stdout
    const ffmpeg = spawn('ffmpeg', [
      '-f', 'ogg',
      '-i', 'pipe:0',
      '-f', 'wav',
      '-acodec', 'pcm_s16le',
      '-ar', String(WAV_SAMPLE_RATE),
      '-ac', String(WAV_CHANNELS),
      '-loglevel', 'error',
      'pipe:1'
    ])

    const chunks: Buffer[] = []
    let errorOutput = ''

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    ffmpeg.stderr.on('data', (data: Buffer) => {
      errorOutput += data.toString()
    })

    ffmpeg.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(
          'ffmpeg not found. Please install ffmpeg:\n' +
          '  macOS: brew install ffmpeg\n' +
          '  Ubuntu: sudo apt install ffmpeg\n' +
          '  Windows: choco install ffmpeg'
        ))
      } else {
        reject(new Error(`ffmpeg error: ${err.message}`))
      }
    })

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks))
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${errorOutput}`))
      }
    })

    // Write OGG data to ffmpeg stdin
    ffmpeg.stdin.write(oggBuffer)
    ffmpeg.stdin.end()
  })
}

/**
 * Alternative: Convert OGG to WAV without ffmpeg using opusenc/opusdec
 * This is a fallback if someone wants to avoid ffmpeg dependency.
 * Currently not implemented - would require opus-tools.
 */
export async function convertOggToWavNative(_oggBuffer: Buffer): Promise<Buffer> {
  throw new Error(
    'Native OGG to WAV conversion not implemented. ' +
    'Please install ffmpeg or contribute an implementation using opus-tools.'
  )
}

// ============================================================================
// Whisper Integration
// ============================================================================

/**
 * Send audio to whisper server for transcription
 * TG-003: POST to /v1/transcribe with WAV body
 */
export async function transcribeAudio(
  wavBuffer: Buffer,
  whisperUrl: string = DEFAULT_CONFIG.whisperUrl
): Promise<WhisperResponse> {
  const url = `${whisperUrl}/v1/transcribe`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'audio/wav',
    },
    body: new Uint8Array(wavBuffer),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Whisper transcription failed (${response.status}): ${errorText}`)
  }

  const result: WhisperResponse = await response.json()
  return result
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Main voice message handler
 * TG-001, TG-002, TG-003: Complete voice message handling flow
 *
 * 1. Validates the voice message (size, duration, rate limit)
 * 2. Sends acknowledgment to user
 * 3. Downloads audio from Telegram
 * 4. Converts OGG Opus to WAV
 * 5. Sends to whisper server for transcription
 * 6. Returns transcription to user
 */
export async function handleVoiceMessage(
  ctx: TelegramContext,
  config: VoiceHandlerConfig
): Promise<void> {
  const {
    botToken,
    whisperUrl = DEFAULT_CONFIG.whisperUrl,
    maxFileSize = DEFAULT_CONFIG.maxFileSize,
    maxDuration = DEFAULT_CONFIG.maxDuration,
    rateLimitMax = DEFAULT_CONFIG.rateLimitMax,
    rateLimitWindow = DEFAULT_CONFIG.rateLimitWindow,
  } = config

  // Validate message has voice
  const voice = ctx.message?.voice
  if (!voice) {
    await ctx.reply('No voice message found.')
    return
  }

  const userId = ctx.message?.from?.id
  if (!userId) {
    await ctx.reply('Could not identify user.')
    return
  }

  // TG-001: Rate limiting per user
  if (isRateLimited(userId, rateLimitMax, rateLimitWindow)) {
    await ctx.reply(
      'You are sending voice messages too quickly. Please wait a moment before trying again.',
      { reply_to_message_id: ctx.message?.chat.id }
    )
    return
  }

  // TG-001: Validate file size
  if (voice.file_size && voice.file_size > maxFileSize) {
    const maxMb = Math.round(maxFileSize / (1024 * 1024))
    await ctx.reply(
      `Voice message too large. Maximum size is ${maxMb}MB.`,
      { reply_to_message_id: ctx.message?.chat.id }
    )
    return
  }

  // TG-001: Validate duration
  if (voice.duration > maxDuration) {
    await ctx.reply(
      `Voice message too long. Maximum duration is ${maxDuration} seconds.`,
      { reply_to_message_id: ctx.message?.chat.id }
    )
    return
  }

  // TG-003: Send acknowledgment before processing
  await ctx.reply('Transcribing your voice message...')

  try {
    // TG-001: Download audio from Telegram
    const oggBuffer = await downloadTelegramAudio(voice.file_id, botToken)

    // Double-check downloaded size
    if (oggBuffer.length > maxFileSize) {
      await ctx.reply('Downloaded file exceeded maximum size.')
      return
    }

    // TG-002: Convert OGG to WAV
    const wavBuffer = await convertOggToWav(oggBuffer)

    // TG-003: Send to whisper for transcription
    const transcription = await transcribeAudio(wavBuffer, whisperUrl)

    // Send transcription result
    if (transcription.text && transcription.text.trim()) {
      const response = `Transcription:\n\n${transcription.text.trim()}`
      if (ctx.replyWithMarkdown) {
        await ctx.replyWithMarkdown(`*Transcription:*\n\n${transcription.text.trim()}`)
      } else {
        await ctx.reply(response)
      }
    } else {
      await ctx.reply('No speech detected in the voice message.')
    }
  } catch (error) {
    // TG-003: Handle transcription failures gracefully
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Voice transcription error:', errorMessage)

    // User-friendly error messages
    if (errorMessage.includes('ffmpeg not found')) {
      await ctx.reply(
        'Voice transcription is not available. The server is missing required audio processing tools.'
      )
    } else if (errorMessage.includes('Whisper transcription failed')) {
      await ctx.reply(
        'Transcription service is temporarily unavailable. Please try again later.'
      )
    } else if (errorMessage.includes('Invalid OGG file')) {
      await ctx.reply(
        'Could not process the audio file. Please try recording again.'
      )
    } else {
      await ctx.reply(
        'An error occurred while processing your voice message. Please try again.'
      )
    }
  }
}

// ============================================================================
// Bot Integration Helpers
// ============================================================================

/**
 * Create a voice handler with pre-configured settings
 * Use this to integrate with telegraf or other bot frameworks
 *
 * @example
 * ```ts
 * import { Telegraf } from 'telegraf'
 * import { createVoiceHandler } from './telegram/voice.js'
 *
 * const bot = new Telegraf(process.env.BOT_TOKEN)
 * const handleVoice = createVoiceHandler({
 *   botToken: process.env.BOT_TOKEN,
 *   whisperUrl: 'http://localhost:8080'
 * })
 *
 * bot.on('voice', handleVoice)
 * ```
 */
export function createVoiceHandler(
  config: VoiceHandlerConfig
): (ctx: TelegramContext) => Promise<void> {
  return (ctx: TelegramContext) => handleVoiceMessage(ctx, config)
}

/**
 * Middleware to add voice handling to an existing bot
 *
 * @example
 * ```ts
 * import { Telegraf } from 'telegraf'
 * import { voiceMiddleware } from './telegram/voice.js'
 *
 * const bot = new Telegraf(process.env.BOT_TOKEN)
 * bot.use(voiceMiddleware({
 *   botToken: process.env.BOT_TOKEN,
 *   whisperUrl: 'http://localhost:8080'
 * }))
 * ```
 */
export function voiceMiddleware(config: VoiceHandlerConfig) {
  return async (ctx: TelegramContext, next: () => Promise<void>) => {
    if (ctx.message?.voice) {
      await handleVoiceMessage(ctx, config)
    } else {
      await next()
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  DEFAULT_CONFIG,
  WAV_SAMPLE_RATE,
  WAV_BITS_PER_SAMPLE,
  WAV_CHANNELS,
}
