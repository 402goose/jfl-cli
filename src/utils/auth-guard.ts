/**
 * Auth Guard for JFL CLI
 *
 * Payment model:
 * - Project has ONE wallet (owner's) that pays for the project
 * - Contributors can optionally have their own wallet
 * - If project wallet low + contributor has wallet → can transfer directly
 */

import chalk from 'chalk'
import ora from 'ora'
import inquirer from 'inquirer'
import { getConfigValue, setConfig } from './jfl-config.js'
import {
  getDayPass,
  getDayPassTimeRemaining,
  purchaseDayPass,
  DayPass,
} from './x402-client.js'
import {
  checkUsdcBalance,
  waitForUsdcBalance,
  getNetworkName,
  seedPhraseToPrivateKey,
  transferUsdc,
} from './wallet.js'
import {
  getProjectWallet,
  setProjectWallet,
  getProjectName,
} from './project-config.js'
import type { Hex } from 'viem'

export interface AuthResult {
  authenticated: boolean
  dayPass?: DayPass
  reason?: string
}

/**
 * Get private key from config
 */
function getPrivateKey(): Hex | null {
  // Try seed phrase first
  const seedPhrase = getConfigValue('x402SeedPhrase') as string | undefined
  if (seedPhrase) {
    return seedPhraseToPrivateKey(seedPhrase, 0)
  }

  // Try direct private key
  const privateKey = getConfigValue('x402PrivateKey') as Hex | undefined
  if (privateKey) {
    return privateKey
  }

  return null
}

/**
 * Check if user is authenticated (has wallet with signing capability)
 */
export function hasWallet(): boolean {
  const address = getConfigValue('x402Address')
  const hasKey = getConfigValue('x402PrivateKey') || getConfigValue('x402SeedPhrase')
  return !!(address && hasKey)
}

/**
 * Get user's wallet address
 */
export function getWalletAddress(): string | null {
  return getConfigValue('x402Address') as string | null
}

/**
 * Check auth status and day pass
 * Uses PROJECT wallet for payment, not user wallet
 */
export async function checkAuth(): Promise<AuthResult> {
  // Check if project has a wallet configured
  const projectWallet = getProjectWallet()
  if (!projectWallet) {
    return {
      authenticated: false,
      reason: 'no_project_wallet',
    }
  }

  // Check if day pass is valid (tied to project wallet)
  const dayPass = getDayPass()
  if (dayPass && dayPass.userAddress.toLowerCase() === projectWallet.toLowerCase()) {
    return {
      authenticated: true,
      dayPass,
    }
  }

  // No day pass - need payment
  return {
    authenticated: false,
    reason: 'no_day_pass',
  }
}

/**
 * Ensure project has valid day pass
 * Uses PROJECT wallet for payment
 * If project wallet low + user has wallet → offers transfer
 */
export async function ensureDayPass(): Promise<DayPass | null> {
  const auth = await checkAuth()
  const projectName = getProjectName()

  if (auth.authenticated && auth.dayPass) {
    return auth.dayPass
  }

  // No project wallet configured - owner needs to set one up
  if (auth.reason === 'no_project_wallet') {
    console.log(chalk.yellow(`\n⚠️  No project wallet configured for "${projectName}"`))
    console.log(chalk.gray('   Project owner needs to run: jfl login --x402\n'))
    return null
  }

  // Project has wallet but needs day pass
  const projectWallet = getProjectWallet()!
  const userWallet = getWalletAddress()
  const userPrivateKey = getPrivateKey()
  const networkName = getNetworkName()

  console.log(chalk.cyan(`\n💰 Day Pass Required ($5/day)\n`))
  console.log(chalk.dim(`Project: ${projectName}`))
  console.log(chalk.dim(`Network: ${networkName}`))

  // Check project wallet balance
  const spinner = ora('Checking project wallet...').start()
  const { formatted } = await checkUsdcBalance(projectWallet)
  const projectBalance = parseFloat(formatted)
  spinner.stop()

  console.log(chalk.gray(`Project wallet: ${projectWallet.slice(0, 10)}...${projectWallet.slice(-8)}`))
  console.log(chalk.gray(`Balance: ${projectBalance >= 5 ? chalk.green('$' + projectBalance.toFixed(2)) : chalk.yellow('$' + projectBalance.toFixed(2))} USDC`))

  // If project wallet has enough funds, try to purchase
  if (projectBalance >= 5) {
    return await purchaseProjectDayPass(projectWallet)
  }

  // Project wallet is low - check if user can help
  console.log(chalk.yellow(`\n⚠️  Project wallet needs $${(5 - projectBalance).toFixed(2)} more USDC\n`))

  // Does user have their own wallet with funds?
  if (userWallet && userPrivateKey) {
    const userSpinner = ora('Checking your wallet...').start()
    const userUsdc = await checkUsdcBalance(userWallet)
    const userBalance = parseFloat(userUsdc.formatted)
    userSpinner.stop()

    if (userBalance >= 5) {
      console.log(chalk.green(`Your wallet has $${userBalance.toFixed(2)} USDC`))
      console.log()

      const { transfer } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'transfer',
          message: `Transfer $5 to project wallet? (gasless via x402)`,
          default: true,
        },
      ])

      if (transfer) {
        const transferSpinner = ora('Transferring via x402 (no gas needed)...').start()
        try {
          await transferUsdc(projectWallet, 5)
          transferSpinner.succeed('Transferred $5 to project wallet!')
          console.log()

          // Now purchase day pass with project wallet
          return await purchaseProjectDayPass(projectWallet)
        } catch (error) {
          transferSpinner.fail('Transfer failed')
          const errorMsg = error instanceof Error ? error.message : String(error)
          console.error(chalk.red(errorMsg))

          // If httpcat not installed, show manual instructions
          if (errorMsg.includes('not installed')) {
            console.log(chalk.dim('\nManual option - send USDC directly to:'))
            console.log(chalk.cyan(`  ${projectWallet}`))
          }
          console.log()
        }
      }
    } else if (userBalance > 0) {
      console.log(chalk.gray(`Your wallet: $${userBalance.toFixed(2)} USDC (not enough to transfer)`))
    }
  }

  // Can't auto-transfer - show funding options
  console.log(chalk.bold('To fund the project, send USDC to:'))
  console.log(chalk.cyan(`  ${projectWallet}\n`))

  if (userWallet) {
    console.log(chalk.dim('Or top up your wallet and run jfl again to transfer'))
    console.log(chalk.dim(`Your wallet: ${userWallet}`))
  } else {
    console.log(chalk.dim('Want your own wallet? Run: jfl login --x402'))
  }

  console.log(chalk.dim('\nPress q or Escape to exit'))
  console.log()

  // Wait for project wallet funding
  const fundingSpinner = ora('Waiting for project wallet funds...').start()

  const funded = await waitForUsdcBalance(projectWallet, 5, (bal) => {
    fundingSpinner.text = `Project balance: $${bal.toFixed(2)} USDC (need $5.00) - press q to exit`
  })

  if (!funded) {
    fundingSpinner.info('Exited')
    return null
  }

  fundingSpinner.succeed('Project funded!')
  console.log()

  return await purchaseProjectDayPass(projectWallet)
}

/**
 * Purchase day pass using project wallet
 * Owner's private key is needed - stored in project config or user config if they're the owner
 */
async function purchaseProjectDayPass(projectWallet: string): Promise<DayPass | null> {
  // Check if current user is the owner (has the private key for project wallet)
  const userWallet = getWalletAddress()
  const userPrivateKey = getPrivateKey()

  // User is the owner if their wallet matches project wallet
  if (userWallet?.toLowerCase() === projectWallet.toLowerCase() && userPrivateKey) {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Activate Day Pass for $5? (valid for 24 hours)`,
        default: true,
      },
    ])

    if (!confirm) {
      console.log(chalk.gray('Cancelled'))
      return null
    }

    const purchaseSpinner = ora('Activating Day Pass...').start()

    try {
      const dayPass = await purchaseDayPass(userPrivateKey)
      purchaseSpinner.succeed('Day Pass activated!')

      const remaining = getDayPassTimeRemaining()
      if (remaining) {
        console.log(chalk.green(`\n✅ Day Pass valid for ${remaining.hours}h ${remaining.minutes}m`))
      }
      console.log()

      return dayPass
    } catch (error) {
      purchaseSpinner.fail('Failed to activate Day Pass')
      console.error(chalk.red(error))
      return null
    }
  }

  // User is NOT the owner - they can't sign for project wallet
  console.log(chalk.yellow('\n⚠️  Project wallet has funds but needs owner to activate'))
  console.log(chalk.gray('   Ask the project owner to run: jfl\n'))
  return null
}

/**
 * Show day pass status
 */
export function showDayPassStatus(): void {
  const dayPass = getDayPass()

  if (!dayPass) {
    console.log(chalk.yellow('No active Day Pass'))
    console.log(chalk.gray('Run a JFL command to purchase one'))
    return
  }

  const remaining = getDayPassTimeRemaining()
  if (!remaining) {
    console.log(chalk.yellow('Day Pass expired'))
    return
  }

  console.log(chalk.green(`✅ Day Pass active`))
  console.log(chalk.gray(`   Expires in: ${remaining.hours}h ${remaining.minutes}m`))
  console.log(chalk.gray(`   Address: ${dayPass.userAddress}`))
}

/**
 * Guard decorator for commands requiring day pass
 * Use this to wrap command handlers
 */
export async function requireDayPass<T>(
  handler: (dayPass: DayPass) => Promise<T>
): Promise<T | null> {
  const dayPass = await ensureDayPass()

  if (!dayPass) {
    return null
  }

  return handler(dayPass)
}

/**
 * Check if running in trial mode (no payment required)
 * Trial mode allows foundation + brand setup without payment
 *
 * Trial ends when:
 * 1. Foundation is complete, OR
 * 2. A teammate has actually joined (authenticated)
 *    - Creating a suggestions file doesn't end trial
 *    - Teammate must run `jfl login` to trigger payment
 */
export function isTrialMode(): boolean {
  // Check if user has completed foundation
  const foundationComplete = getConfigValue('foundationComplete') as boolean | undefined
  if (foundationComplete) return false

  // Check if any teammates have actually joined (authenticated)
  const hasJoinedTeammates = checkForJoinedTeammates()
  if (hasJoinedTeammates) return false

  return true
}

/**
 * Check if any teammates have actually joined (authenticated)
 * Looks for <!-- joined: DATE --> marker in suggestions/*.md files
 */
function checkForJoinedTeammates(): boolean {
  const cwd = process.cwd()
  const suggestionsDir = `${cwd}/suggestions`

  try {
    const { readdirSync, existsSync, readFileSync } = require('fs')
    if (!existsSync(suggestionsDir)) return false

    const files = readdirSync(suggestionsDir) as string[]
    const teammates = files.filter((f: string) => f.endsWith('.md'))

    // Check each teammate file for joined marker
    for (const file of teammates) {
      const content = readFileSync(`${suggestionsDir}/${file}`, 'utf-8')
      if (content.includes('<!-- joined:')) {
        return true
      }
    }

    return false
  } catch {
    return false
  }
}

/**
 * Mark a teammate as joined in their suggestions file
 */
export function markTeammateJoined(username: string): boolean {
  const cwd = process.cwd()
  const filePath = `${cwd}/suggestions/${username}.md`

  try {
    const { existsSync, readFileSync, writeFileSync } = require('fs')
    if (!existsSync(filePath)) return false

    const content = readFileSync(filePath, 'utf-8')

    // Already joined?
    if (content.includes('<!-- joined:')) return true

    // Add joined marker at the top
    const date = new Date().toISOString().split('T')[0]
    const newContent = `<!-- joined: ${date} -->\n${content}`
    writeFileSync(filePath, newContent)

    return true
  } catch {
    return false
  }
}

/**
 * Mark foundation as complete (triggers payment requirement)
 */
export function markFoundationComplete(): void {
  setConfig('foundationComplete', true)
}

/**
 * Check if feature requires payment
 */
export function requiresPayment(feature: string): boolean {
  const freeFeatures = [
    'init',
    'login',
    'logout',
    'status',
    'help',
    'version',
    'update',
    // Trial features (until foundation complete)
    ...(isTrialMode() ? ['foundation', 'brand', 'vision', 'narrative', 'thesis'] : []),
  ]

  return !freeFeatures.includes(feature)
}
