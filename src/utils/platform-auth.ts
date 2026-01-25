/**
 * Platform Authentication for JFL CLI
 *
 * Uses device linking flow to connect CLI to jfl-platform:
 * 1. Register device and get a code (e.g., "ABC-123")
 * 2. User authenticates on platform and enters code
 * 3. Poll until device is linked
 * 4. Receive JWT token for API authentication
 */

import Conf from 'conf'
import chalk from 'chalk'
import type { Ora } from 'ora'
import { execSync } from 'child_process'

const config = new Conf({ projectName: 'jfl' })
const PLATFORM_URL = process.env.JFL_PLATFORM_URL || 'https://jfl.run'

interface DeviceRegistrationResponse {
  deviceId: string
  deviceCode: string
  expiresIn: number
  verificationUrl: string
}

interface DeviceStatusResponse {
  status: 'pending' | 'linked' | 'expired'
  jwt?: string
  user?: {
    id: string
    email: string
    name?: string
    tier?: string
    dynamicUserId?: string
  }
}

interface PlatformUser {
  id: string
  email: string
  name?: string
  tier?: string
  dynamicUserId?: string
}

/**
 * Register a new device and get a device code
 */
export async function registerDevice(): Promise<DeviceRegistrationResponse> {
  try {
    // Get machine/device name
    let machineName = 'unknown'
    try {
      if (process.platform === 'darwin' || process.platform === 'linux') {
        machineName = execSync('hostname', { encoding: 'utf-8' }).trim()
      } else if (process.platform === 'win32') {
        machineName = execSync('hostname', { encoding: 'utf-8' }).trim()
      }
    } catch {
      // Use fallback
      machineName = 'cli-device'
    }

    const response = await fetch(`${PLATFORM_URL}/api/cli/register-device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceName: 'JFL CLI',
        machineName,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to register device: ${response.statusText}`)
    }

    const data = await response.json()
    return {
      deviceId: data.deviceId,
      deviceCode: data.deviceCode,
      expiresIn: data.expiresIn,
      verificationUrl: `${PLATFORM_URL}/link?code=${data.deviceCode}`,
    }
  } catch (error) {
    throw new Error(
      `Failed to register device: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Check device linking status
 */
export async function checkDeviceStatus(deviceId: string): Promise<DeviceStatusResponse> {
  try {
    const response = await fetch(`${PLATFORM_URL}/api/cli/device-status?deviceId=${deviceId}`)

    if (!response.ok) {
      if (response.status === 404) {
        return { status: 'expired' }
      }
      throw new Error(`Failed to check device status: ${response.statusText}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    throw new Error(
      `Failed to check device status: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Poll device status until linked or timeout
 */
export async function pollDeviceStatus(
  deviceId: string,
  timeoutSeconds: number = 300,
  spinner?: Ora
): Promise<{ success: boolean; jwt?: string; user?: PlatformUser; reason?: string }> {
  const startTime = Date.now()
  const timeoutMs = timeoutSeconds * 1000
  const pollIntervalMs = 2000 // Poll every 2 seconds

  while (Date.now() - startTime < timeoutMs) {
    try {
      const status = await checkDeviceStatus(deviceId)

      if (status.status === 'linked' && status.jwt && status.user) {
        return {
          success: true,
          jwt: status.jwt,
          user: status.user,
        }
      }

      if (status.status === 'expired') {
        return { success: false, reason: 'expired' }
      }

      // Still pending, update spinner if provided
      const remainingSeconds = Math.floor((timeoutMs - (Date.now() - startTime)) / 1000)
      if (spinner) {
        spinner.text = `Waiting for authentication... (${remainingSeconds}s remaining)`
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    } catch (error) {
      console.error(chalk.red(`Polling error: ${error}`))
      // Continue polling on errors (network issues, etc.)
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }
  }

  // Timeout
  return { success: false, reason: 'timeout' }
}

/**
 * Verify a JWT token is valid
 */
export async function verifyPlatformToken(token: string): Promise<PlatformUser | null> {
  try {
    const response = await fetch(`${PLATFORM_URL}/api/cli/verify`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data.user || null
  } catch {
    return null
  }
}

/**
 * Get stored platform token
 */
export function getPlatformToken(): string | null {
  return config.get('platformToken') as string | null
}

/**
 * Get stored platform user
 */
export function getPlatformUser(): PlatformUser | null {
  return config.get('platformUser') as PlatformUser | null
}

/**
 * Save platform authentication
 */
export function savePlatformAuth(jwt: string, user: PlatformUser): void {
  config.set('platformToken', jwt)
  config.set('platformUser', user)
  config.set('authMethod', 'platform')
}

/**
 * Clear platform authentication
 */
export function clearPlatformAuth(): void {
  config.delete('platformToken')
  config.delete('platformUser')
}

/**
 * Check if authenticated with platform
 */
export async function isPlatformAuthenticated(): Promise<boolean> {
  const token = getPlatformToken()
  if (!token) {
    return false
  }

  // Verify token is still valid
  const user = await verifyPlatformToken(token)
  if (!user) {
    // Token expired or invalid, clear it
    clearPlatformAuth()
    return false
  }

  return true
}

/**
 * Get platform auth headers for API requests
 */
export function getPlatformAuthHeaders(): Record<string, string> {
  const token = getPlatformToken()
  if (!token) {
    return {}
  }

  return {
    Authorization: `Bearer ${token}`,
  }
}
