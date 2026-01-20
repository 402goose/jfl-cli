/**
 * x402 Payment Client for JFL
 *
 * Handles x402 micropayments for JFL Day Pass ($5/day)
 * Based on httpcat-cli implementation
 */

import { privateKeyToAccount } from 'viem/accounts'
import { randomBytes } from 'crypto'
import type { Hex } from 'viem'
import Conf from 'conf'
import { getNetworkName } from './wallet.js'

const config = new Conf({ projectName: 'jfl' })

// Network configuration
const USE_TESTNET = process.env.JFL_TESTNET === 'true' || process.env.NODE_ENV !== 'production'

const NETWORK_CONFIG = {
  testnet: {
    caip2: 'eip155:84532',
    chainId: 84532,
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    usdcName: 'USDC',
  },
  mainnet: {
    caip2: 'eip155:8453',
    chainId: 8453,
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdcName: 'USD Coin',
  },
}

function getNetwork() {
  return USE_TESTNET ? NETWORK_CONFIG.testnet : NETWORK_CONFIG.mainnet
}

// JFL API endpoints
const JFL_API_URL = process.env.JFL_API_URL || 'https://api.jfl.run'

// Day Pass cost: $5 = 5,000,000 (6 decimals)
const DAY_PASS_COST = BigInt(5_000_000)
const DAY_PASS_COST_HEX = '0x4c4b40' // 5,000,000 in hex

export interface DayPass {
  leaseId: string
  userAddress: string
  expiresAt: number  // Unix timestamp
  paidAt: number     // Unix timestamp
}

export interface PaymentRequirements {
  network: string
  maxAmountRequired: string
  payTo: string
  asset: string
  resource: string
}

/**
 * Create x402 client with signing capability
 */
export function createX402Client(privateKey: Hex) {
  const signer = privateKeyToAccount(privateKey)
  const network = getNetwork()

  return {
    signer,
    network,
    address: signer.address,

    /**
     * Create EIP-712 payment signature for x402
     */
    async createPaymentSignature(requirements: PaymentRequirements): Promise<string> {
      // Generate unique nonce (critical for each payment)
      const nonceBytes = randomBytes(32)
      const nonce = `0x${nonceBytes.toString('hex').padStart(64, '0')}` as `0x${string}`

      // Timing windows
      const validAfter = Math.floor(Date.now() / 1000) - 30  // 30s in past
      const validBefore = validAfter + 330  // 5 minutes total

      // Amount handling
      let valueHex: string
      if (requirements.maxAmountRequired.startsWith('0x')) {
        valueHex = requirements.maxAmountRequired
      } else {
        valueHex = `0x${BigInt(requirements.maxAmountRequired).toString(16)}`
      }

      // EIP-712 domain
      const domain = {
        name: network.usdcName,
        version: '2',
        chainId: network.chainId,
        verifyingContract: network.usdcAddress as `0x${string}`,
      }

      // EIP-712 types for TransferWithAuthorization (EIP-3009)
      const types = {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      }

      // Sign authorization
      const signature = await signer.signTypedData({
        domain,
        types,
        primaryType: 'TransferWithAuthorization',
        message: {
          from: signer.address,
          to: requirements.payTo as `0x${string}`,
          value: BigInt(valueHex),
          validAfter: BigInt(validAfter),
          validBefore: BigInt(validBefore),
          nonce: nonce,
        },
      })

      // Build x402 V2 payment payload
      const paymentPayload = {
        x402Version: 2,
        scheme: 'exact',
        network: network.caip2,
        payload: {
          signature: signature,
          authorization: {
            from: signer.address,
            to: requirements.payTo,
            value: valueHex,
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce: nonce,
          },
        },
      }

      // Encode as base64 for header
      return Buffer.from(JSON.stringify(paymentPayload)).toString('base64')
    },

    /**
     * Make x402 request with payment handling
     */
    async request(url: string, options: RequestInit = {}): Promise<Response> {
      // Initial request without payment
      const initialResponse = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })

      // Check for 402 Payment Required
      if (initialResponse.status === 402) {
        // Parse payment requirements
        const paymentRequiredHeader =
          initialResponse.headers.get('payment-required') ||
          initialResponse.headers.get('Payment-Required')

        let requirements: PaymentRequirements | null = null

        if (paymentRequiredHeader) {
          const decoded = Buffer.from(paymentRequiredHeader, 'base64').toString('utf-8')
          const headerData = JSON.parse(decoded)

          if (headerData.accepts && Array.isArray(headerData.accepts)) {
            requirements = headerData.accepts[0]
          } else if (headerData.network && headerData.maxAmountRequired) {
            requirements = headerData
          }
        }

        if (!requirements) {
          // Try to parse from body
          const responseText = await initialResponse.text()
          const paymentInfo = JSON.parse(responseText)
          requirements = paymentInfo.accepts?.[0]
        }

        if (!requirements) {
          throw new Error('Could not parse payment requirements from 402 response')
        }

        // Create payment signature
        const paymentHeader = await this.createPaymentSignature(requirements)

        // Retry with payment
        await new Promise((resolve) => setTimeout(resolve, 500))

        return fetch(url, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            'PAYMENT-SIGNATURE': paymentHeader,
            ...options.headers,
          },
        })
      }

      return initialResponse
    },
  }
}

/**
 * Check if user has valid day pass
 */
export function getDayPass(): DayPass | null {
  const dayPass = config.get('dayPass') as DayPass | undefined
  if (!dayPass) return null

  // Check if expired (day passes are valid for 24 hours)
  const now = Date.now()
  if (now > dayPass.expiresAt) {
    // Expired, clear it
    config.delete('dayPass')
    return null
  }

  return dayPass
}

/**
 * Save day pass after successful payment
 */
export function saveDayPass(leaseId: string, userAddress: string): DayPass {
  const now = Date.now()
  const dayPass: DayPass = {
    leaseId,
    userAddress,
    paidAt: now,
    expiresAt: now + 24 * 60 * 60 * 1000, // 24 hours
  }
  config.set('dayPass', dayPass)
  return dayPass
}

/**
 * Check if user needs to pay for today
 */
export function needsPayment(): boolean {
  const dayPass = getDayPass()
  return !dayPass
}

/**
 * Get time remaining on day pass
 */
export function getDayPassTimeRemaining(): { hours: number; minutes: number } | null {
  const dayPass = getDayPass()
  if (!dayPass) return null

  const remaining = dayPass.expiresAt - Date.now()
  if (remaining <= 0) return null

  const hours = Math.floor(remaining / (60 * 60 * 1000))
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000))

  return { hours, minutes }
}

/**
 * Purchase day pass via x402
 */
export async function purchaseDayPass(privateKey: Hex): Promise<DayPass> {
  const client = createX402Client(privateKey)
  const network = getNetwork()

  // Call JFL API to purchase day pass
  const response = await client.request(`${JFL_API_URL}/v1/daypass/purchase`, {
    method: 'POST',
    body: JSON.stringify({
      userAddress: client.address,
      network: network.caip2,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to purchase day pass: ${error}`)
  }

  const result = await response.json()

  // Save and return day pass
  return saveDayPass(result.leaseId, client.address)
}

/**
 * Verify day pass with JFL API
 */
export async function verifyDayPass(dayPass: DayPass): Promise<boolean> {
  try {
    const response = await fetch(`${JFL_API_URL}/v1/daypass/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leaseId: dayPass.leaseId,
        userAddress: dayPass.userAddress,
      }),
    })

    if (!response.ok) return false

    const result = await response.json()
    return result.valid === true
  } catch {
    // If API is down, trust local day pass if not expired
    return Date.now() < dayPass.expiresAt
  }
}
