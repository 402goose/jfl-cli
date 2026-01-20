/**
 * Wallet utilities for JFL CLI
 *
 * Local wallet generation and management for x402 payments.
 * Private keys never leave the user's machine.
 */

import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { HDKey } from '@scure/bip32'
import { createHash, randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from 'crypto'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, parseAbi } from 'viem'
import { base, baseSepolia } from 'viem/chains'

const PBKDF2_ITERATIONS = 100000
const SALT_LENGTH = 32
const IV_LENGTH = 16
const KEY_LENGTH = 32 // AES-256

// Network configuration
const USE_TESTNET = process.env.JFL_TESTNET === 'true' || process.env.NODE_ENV !== 'production'

// USDC contract addresses
const USDC_ADDRESSES = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  baseSepolia: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
} as const

function getChain() {
  return USE_TESTNET ? baseSepolia : base
}

function getUsdcAddress() {
  return USE_TESTNET ? USDC_ADDRESSES.baseSepolia : USDC_ADDRESSES.base
}

export function getNetworkName() {
  return USE_TESTNET ? 'Base Sepolia (testnet)' : 'Base'
}

/**
 * Generate a BIP-39 seed phrase
 */
export function generateSeedPhrase(wordCount: 12 | 24 = 12): string {
  const strength = wordCount === 12 ? 128 : 256
  return generateMnemonic(wordlist, strength)
}

/**
 * Validate a BIP-39 seed phrase
 */
export function validateSeedPhrase(phrase: string): boolean {
  return validateMnemonic(phrase, wordlist)
}

/**
 * Derive a private key from a seed phrase using BIP-32/BIP-44
 */
export function seedPhraseToPrivateKey(seedPhrase: string, index: number = 0): Hex {
  if (!validateSeedPhrase(seedPhrase)) {
    throw new Error('Invalid seed phrase')
  }

  const seed = mnemonicToSeedSync(seedPhrase)
  const hdKey = HDKey.fromMasterSeed(seed)

  // BIP-44 path: m/44'/60'/0'/0/index (Ethereum)
  const derived = hdKey.derive(`m/44'/60'/0'/0/${index}`)

  if (!derived.privateKey) {
    throw new Error('Failed to derive private key from seed phrase')
  }

  return `0x${Buffer.from(derived.privateKey).toString('hex')}` as Hex
}

/**
 * Derive key from password using PBKDF2
 */
function deriveKeyFromPassword(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
}

/**
 * Encrypt data using AES-256-GCM
 */
export function encryptData(data: string, password: string): string {
  if (!password) {
    throw new Error('Password is required for encryption')
  }

  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = deriveKeyFromPassword(password, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  let encrypted = cipher.update(data, 'utf8')
  encrypted = Buffer.concat([encrypted, cipher.final()])
  const authTag = cipher.getAuthTag()

  // Format: salt:iv:encrypted:authTag (all base64)
  return [
    salt.toString('base64'),
    iv.toString('base64'),
    encrypted.toString('base64'),
    authTag.toString('base64'),
  ].join(':')
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decryptData(encryptedData: string, password: string): string {
  if (!password) {
    throw new Error('Password is required for decryption')
  }

  const parts = encryptedData.split(':')
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted data format')
  }

  const [saltB64, ivB64, encryptedB64, authTagB64] = parts
  const salt = Buffer.from(saltB64, 'base64')
  const iv = Buffer.from(ivB64, 'base64')
  const encrypted = Buffer.from(encryptedB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')

  const key = deriveKeyFromPassword(password, salt)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted)
  decrypted = Buffer.concat([decrypted, decipher.final()])

  return decrypted.toString('utf8')
}

/**
 * Get address from private key
 */
export function getAddressFromPrivateKey(privateKey: Hex): string {
  const account = privateKeyToAccount(privateKey)
  return account.address
}

/**
 * Check on-chain USDC balance
 */
export async function checkUsdcBalance(address: string): Promise<{ balance: bigint; formatted: string }> {
  const client = createPublicClient({
    chain: getChain(),
    transport: http(),
  })

  const ERC20_ABI = parseAbi([
    'function balanceOf(address owner) view returns (uint256)',
  ])

  try {
    const balance = await client.readContract({
      address: getUsdcAddress() as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    })

    return {
      balance,
      formatted: formatUnits(balance, 6), // USDC has 6 decimals
    }
  } catch (error) {
    // Return 0 if balance check fails
    return {
      balance: BigInt(0),
      formatted: '0.00',
    }
  }
}

/**
 * Check on-chain ETH balance
 */
export async function checkEthBalance(address: string): Promise<{ balance: bigint; formatted: string }> {
  const client = createPublicClient({
    chain: getChain(),
    transport: http(),
  })

  try {
    const balance = await client.getBalance({ address: address as `0x${string}` })
    const { formatEther } = await import('viem')

    return {
      balance,
      formatted: formatEther(balance),
    }
  } catch (error) {
    return {
      balance: BigInt(0),
      formatted: '0.00',
    }
  }
}

/**
 * Wait for USDC balance to reach minimum amount
 * Polls every 5 seconds
 * Returns true if funded, false if cancelled
 */
export async function waitForUsdcBalance(
  address: string,
  minBalance: number,
  onUpdate?: (balance: number) => void
): Promise<boolean> {
  let cancelled = false

  // Set up keyboard listener for escape
  const handleKeypress = (key: Buffer) => {
    const char = key.toString()
    // q, Q, Escape (0x1b), or Ctrl+C (0x03)
    if (char === 'q' || char === 'Q' || char === '\x1b' || char === '\x03') {
      cancelled = true
    }
  }

  // Enable raw mode to capture keypresses
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', handleKeypress)
  }

  try {
    while (!cancelled) {
      const { formatted } = await checkUsdcBalance(address)
      const balanceNum = parseFloat(formatted)

      if (onUpdate) {
        onUpdate(balanceNum)
      }

      if (balanceNum >= minBalance) {
        return true // Funded!
      }

      // Wait 5 seconds before checking again (but check cancelled flag more often)
      for (let i = 0; i < 10 && !cancelled; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }

    return false // Cancelled
  } finally {
    // Clean up keyboard listener
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false)
      process.stdin.removeListener('data', handleKeypress)
      process.stdin.pause()
    }
  }
}

/**
 * Transfer USDC to another address via x402 facilitator (gasless)
 *
 * Wraps httpcat-cli under the hood:
 * - httpcat send usdc <address> <amount>
 * - Uses x402 payment proxy (no ETH needed for gas)
 */
export async function transferUsdc(
  toAddress: string,
  amount: number
): Promise<string> {
  const { execSync } = require('child_process')

  try {
    // Check if httpcat-cli is installed
    execSync('which httpcat', { stdio: 'pipe' })
  } catch {
    throw new Error(
      'httpcat-cli not installed. Install with: npm install -g httpcat-cli'
    )
  }

  try {
    // Execute gasless transfer via httpcat
    const result = execSync(
      `httpcat send usdc ${toAddress} ${amount} --no-confirm --wait`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    )

    // Try to extract tx hash from output
    const txMatch = result.match(/0x[a-fA-F0-9]{64}/)
    return txMatch ? txMatch[0] : 'transfer-complete'
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Parse common errors
    if (errorMessage.includes('Insufficient')) {
      throw new Error('Insufficient USDC balance')
    }
    if (errorMessage.includes('not adopted') || errorMessage.includes('No cat')) {
      throw new Error('httpcat not configured. Run: httpcat observe')
    }

    throw new Error(`Transfer failed: ${errorMessage}`)
  }
}
