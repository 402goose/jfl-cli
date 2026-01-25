import chalk from "chalk"
import ora from "ora"
import inquirer from "inquirer"
import Conf from "conf"
import { execSync } from "child_process"
import {
  generateSeedPhrase,
  seedPhraseToPrivateKey,
  getAddressFromPrivateKey,
  checkUsdcBalance,
  validateSeedPhrase,
  waitForUsdcBalance,
  getNetworkName,
} from "../utils/wallet.js"
import { getDayPass, getDayPassTimeRemaining } from "../utils/x402-client.js"
import { markTeammateJoined } from "../utils/auth-guard.js"
import { getProjectWallet, setProjectWallet, isJflProject } from "../utils/project-config.js"
import {
  registerDevice,
  pollDeviceStatus,
  savePlatformAuth,
  getPlatformToken,
  getPlatformUser,
} from "../utils/platform-auth.js"
import type { Hex } from "viem"

const config = new Conf({ projectName: "jfl" })
const PLATFORM_URL = process.env.JFL_PLATFORM_URL || "https://jfl.run"

/**
 * Show account status when already authenticated
 */
async function showAccountStatus(
  walletAddress: string | undefined,
  platformToken: unknown,
  isInteractive: boolean
): Promise<void> {
  console.log(chalk.bold("\n💰 JFL Account\n"))

  const platformUser = getPlatformUser()

  if (platformUser && platformToken) {
    // Platform account mode
    console.log(chalk.cyan("Platform Account"))
    console.log(chalk.gray(`  User: ${platformUser.name || platformUser.email || "Unknown"}`))
    console.log(chalk.gray(`  Tier: ${platformUser.tier || "Unknown"}`))
    console.log()
  } else if (walletAddress) {
    // x402 wallet mode
    console.log(chalk.cyan("Wallet"))
    console.log(chalk.gray(`  Address: ${walletAddress}`))
    console.log(chalk.gray("  Mode: x402 Day Pass ($5/day)"))
    console.log()

    // Check balance
    const spinner = ora("Checking balance...").start()
    try {
      const usdc = await checkUsdcBalance(walletAddress)
      const usdcNum = parseFloat(usdc.formatted)
      spinner.stop()

      console.log(chalk.cyan("Balance"))
      console.log(chalk.gray(`  USDC: ${usdcNum >= 5 ? chalk.green("$" + usdcNum.toFixed(2)) : chalk.yellow("$" + usdcNum.toFixed(2))}`))

      // Day pass status
      const dayPass = getDayPass()
      const remaining = getDayPassTimeRemaining()

      if (dayPass && remaining) {
        console.log(chalk.green(`  Day Pass: Active (${remaining.hours}h ${remaining.minutes}m remaining)`))
      } else if (usdcNum >= 5) {
        console.log(chalk.gray("  Day Pass: Ready to activate"))
      } else {
        console.log(chalk.yellow("  Day Pass: Need $5 USDC"))
      }
      console.log()

      // Top up instructions if low
      if (usdcNum < 5) {
        console.log(chalk.yellow("To top up, send USDC to:"))
        console.log(chalk.cyan(`  ${walletAddress}`))
        console.log(chalk.dim("(No ETH needed - x402 facilitator covers gas)"))
        console.log()
      }
    } catch (error) {
      spinner.fail("Could not check balance")
    }
  }

  // Show options
  if (!isInteractive) {
    console.log(chalk.gray("Options:"))
    console.log(chalk.white("  jfl login --force") + chalk.gray("     Change wallet or re-authenticate"))
    console.log(chalk.white("  jfl login --solo") + chalk.gray("      Upgrade to Solo ($49/mo)"))
    console.log(chalk.white("  jfl login --team") + chalk.gray("      Upgrade to Team ($199/mo)"))
    console.log(chalk.white("  jfl logout") + chalk.gray("            Sign out"))
    console.log()
    return
  }

  // Interactive menu
  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "What do you want to do?",
      choices: [
        { name: "Nothing, just checking", value: "exit" },
        { name: "Change wallet", value: "change" },
        { name: "Upgrade to Solo ($49/mo)", value: "solo" },
        { name: "Upgrade to Team ($199/mo)", value: "team" },
        { name: "Log out", value: "logout" },
      ],
    },
  ])

  if (action === "exit") {
    return
  } else if (action === "logout") {
    // Confirm logout since it clears wallet/seed phrase
    const { confirmLogout } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirmLogout",
        message: "This will clear your wallet and seed phrase. Are you sure?",
        default: false,
      },
    ])
    if (!confirmLogout) {
      console.log(chalk.gray("Cancelled"))
      return
    }
    logout()
    console.log(chalk.green("\n✓ Logged out\n"))
  } else if (action === "change") {
    // Re-run login flow
    await loginWithX402(true)
  } else if (action === "solo" || action === "team") {
    await loginWithGitHub(action === "team" ? "pro" : "solo", true)
  }
}

interface LoginOptions {
  x402?: boolean
  solo?: boolean
  team?: boolean
  free?: boolean
  platform?: boolean
  force?: boolean
}

export async function loginCommand(options: LoginOptions = {}) {
  // Check if running in non-TTY mode (e.g., from Claude Code)
  // Use !! to ensure boolean (undefined && undefined = undefined, which would trigger default param)
  const isInteractive = !!(process.stdin.isTTY && process.stdout.isTTY)

  // Determine plan from flags
  let plan: string | undefined
  if (options.x402) plan = "x402"
  else if (options.solo) plan = "solo"
  else if (options.team) plan = "pro"
  else if (options.free) plan = "free"
  else if (options.platform) plan = "platform"

  // Check if already logged in (with signing capability)
  const existingToken = config.get("token")
  const existingPlatformToken = getPlatformToken()
  const existingWallet = config.get("x402Address") as string | undefined
  const hasSigningKey = config.get("x402PrivateKey") || config.get("x402SeedPhrase")

  // If already authenticated and no specific plan requested, show account status
  if ((existingToken || existingPlatformToken || (existingWallet && hasSigningKey)) && !options.force && !plan) {
    await showAccountStatus(existingWallet, existingToken || existingPlatformToken, isInteractive)
    return
  }

  // View-only address exists - offer to upgrade
  if (existingWallet && !hasSigningKey && !plan) {
    console.log(chalk.bold("\n🔐 JFL - Authenticate\n"))
    console.log(chalk.yellow(`⚠️  You have a view-only address: ${existingWallet}`))
    console.log(chalk.gray("   View-only can't sign payments. Let's set up a real wallet.\n"))
  } else {
    console.log(chalk.bold("\n🔐 JFL - Authenticate\n"))
  }

  // Show authentication options
  console.log(chalk.bold("┌─────────────────────────────────────────────────────┐"))
  console.log(chalk.bold("│  Choose your authentication method                  │"))
  console.log(chalk.bold("├─────────────────────────────────────────────────────┤"))
  console.log(chalk.bold("│                                                     │"))
  console.log(chalk.cyan("│  Platform Account") + chalk.white(" (Recommended)                    │"))
  console.log(chalk.gray("│  ├─ Sign in with email or wallet                   │"))
  console.log(chalk.gray("│  ├─ Manage subscriptions on jfl.run                │"))
  console.log(chalk.gray("│  ├─ Dashboard + Deploy + Analytics                 │"))
  console.log(chalk.gray("│  └─ Free trial, then flexible pricing              │"))
  console.log(chalk.bold("│                                                     │"))
  console.log(chalk.cyan("│  Day Pass (x402)") + chalk.white("  $5/day per person              │"))
  console.log(chalk.gray("│  ├─ Only pay the days you use it                   │"))
  console.log(chalk.gray("│  ├─ AI included (no API key needed)                │"))
  console.log(chalk.gray("│  ├─ Pay with crypto wallet                         │"))
  console.log(chalk.gray("│  └─ No platform account needed                     │"))
  console.log(chalk.bold("│                                                     │"))
  console.log(chalk.bold("└─────────────────────────────────────────────────────┘"))

  // If no plan specified and non-interactive, show commands and exit
  if (!plan && !isInteractive) {
    console.log(chalk.yellow("\nRunning non-interactively. Specify an auth method:\n"))
    console.log(chalk.white("  jfl login --platform") + chalk.gray(" Platform account (recommended)"))
    console.log(chalk.white("  jfl login --x402") + chalk.gray("     Day Pass ($5/day, crypto)"))
    console.log(chalk.white("  jfl login --free") + chalk.gray("     Stay on trial"))
    console.log()
    return
  }

  // If no plan specified, prompt interactively
  if (!plan) {
    const { selectedPlan } = await inquirer.prompt([
      {
        type: "list",
        name: "selectedPlan",
        message: "How do you want to authenticate?",
        choices: [
          { name: chalk.cyan("Platform Account") + " - Email/wallet, manage on jfl.run (recommended)", value: "platform" },
          { name: chalk.cyan("Day Pass (x402)") + " - $5/day, pay with crypto", value: "x402" },
          new inquirer.Separator(),
          { name: chalk.gray("Stay on trial (local only, BYOAI)"), value: "free" },
        ],
      },
    ])
    plan = selectedPlan
  }

  if (plan === "free") {
    console.log(chalk.green("\n✓ Staying on trial"))
    console.log(chalk.gray("\nTrial includes:"))
    console.log("  • Full JFL toolkit")
    console.log("  • All skills (brand, content, etc)")
    console.log("  • Foundation + brand setup")
    console.log("  • Bring your own AI key")
    console.log(chalk.gray("\nUpgrade anytime with: jfl login"))
    return
  }

  if (plan === "platform") {
    await loginWithPlatform(isInteractive)
  } else if (plan === "x402") {
    await loginWithX402(isInteractive)
  } else {
    await loginWithGitHub(plan, isInteractive)
  }
}

async function loginWithX402(isInteractive: boolean = true) {
  console.log(chalk.cyan("\n💰 x402 Wallet Setup\n"))

  // Show network
  const networkName = getNetworkName()
  console.log(chalk.dim(`Network: ${networkName}\n`))

  // Check if wallet already exists
  const existingWallet = config.get("x402Address") as string | undefined
  const hasSigningKey = config.get("x402PrivateKey") || config.get("x402SeedPhrase")

  // If wallet exists with signing capability, just check balance and activate
  if (existingWallet && hasSigningKey) {
    console.log(chalk.green("✓ Wallet already configured: ") + chalk.cyan(existingWallet.slice(0, 10) + "..." + existingWallet.slice(-8)))
    console.log()

    // Skip to balance check
    const spinner = ora(`Checking balance on ${networkName}...`).start()
    try {
      const usdc = await checkUsdcBalance(existingWallet)
      const usdcNum = parseFloat(usdc.formatted)

      spinner.succeed("Balance checked!")
      console.log()
      console.log(chalk.gray(`USDC Balance: ${usdcNum >= 5 ? chalk.green("$" + usdcNum.toFixed(2)) : chalk.red("$" + usdcNum.toFixed(2))}`))
      console.log(chalk.dim("(No ETH needed - x402 facilitator covers gas)"))
      console.log()

      if (usdcNum >= 5) {
        console.log(chalk.bold.green("✅ Day Pass ready!"))
        console.log(chalk.gray("$5 will be deducted only on days you use JFL.\n"))
      } else {
        console.log(chalk.yellow("⚠️  Need $5 USDC to activate Day Pass"))
        console.log(chalk.bold("\nSend USDC to:"))
        console.log(chalk.cyan("  " + existingWallet))
        console.log()
      }
      return
    } catch (error) {
      spinner.fail("Failed to check balance")
      console.error(chalk.red(error))
      return
    }
  }

  // Explain how x402 works
  console.log(chalk.bold("How x402 works:"))
  console.log(chalk.gray("  • Your wallet lives on YOUR computer (never sent anywhere)"))
  console.log(chalk.gray(`  • You load it with USDC on ${networkName}`))
  console.log(chalk.gray("  • When you use JFL, it signs microtransactions automatically"))
  console.log(chalk.gray("  • $5/day is deducted only on days you actively use it"))
  console.log(chalk.gray("  • $0 on days you don't use it\n"))

  // Non-interactive and no wallet: tell them to run interactively
  if (!isInteractive) {
    console.log(chalk.yellow("No wallet configured yet.\n"))
    console.log(chalk.white("To create a wallet, run in your terminal:"))
    console.log(chalk.cyan("  jfl login --x402\n"))
    console.log(chalk.gray("(Wallet creation requires an interactive terminal for security)\n"))
    return
  }

  // Ask if they have a wallet or need one created
  const { walletChoice } = await inquirer.prompt([
    {
      type: "list",
      name: "walletChoice",
      message: "Do you have an Ethereum wallet?",
      choices: [
        { name: chalk.green("Create one for me") + " (recommended)", value: "create" },
        { name: "I have a seed phrase to import", value: "import_seed" },
        { name: "I have a private key to import", value: "import_key" },
        { name: "I just want to use an address (view-only)", value: "address_only" },
      ],
    },
  ])

  let address: string
  let privateKey: Hex | undefined

  if (walletChoice === "create") {
    const result = await createNewWallet()
    address = result.address
    privateKey = result.privateKey
  } else if (walletChoice === "import_seed") {
    const result = await importFromSeedPhrase()
    address = result.address
    privateKey = result.privateKey
  } else if (walletChoice === "import_key") {
    const result = await importFromPrivateKey()
    address = result.address
    privateKey = result.privateKey
  } else {
    // Address only - just for checking balance, can't sign transactions
    const { walletAddress } = await inquirer.prompt([
      {
        type: "input",
        name: "walletAddress",
        message: "Your wallet address (0x...):",
        validate: (input: string) => {
          if (!/^0x[a-fA-F0-9]{40}$/.test(input)) {
            return "Enter a valid Ethereum address"
          }
          return true
        },
      },
    ])
    address = walletAddress
    console.log(chalk.yellow("\n⚠️  View-only mode: You won't be able to sign transactions"))
    console.log(chalk.gray("   To enable full functionality, re-run with seed phrase or private key\n"))
  }

  // Check on-chain balance
  const spinner = ora(`Checking balance on ${networkName}...`).start()

  try {
    const usdc = await checkUsdcBalance(address)
    let usdcNum = parseFloat(usdc.formatted)

    spinner.succeed("Balance checked!")

    // Display balance
    console.log()
    console.log(chalk.gray(`Address: ${chalk.cyan(address.slice(0, 10) + "..." + address.slice(-8))}`))
    console.log(chalk.gray(`USDC Balance: ${usdcNum >= 5 ? chalk.green("$" + usdcNum.toFixed(2)) : chalk.red("$" + usdcNum.toFixed(2))}`))
    console.log(chalk.dim("(No ETH needed - x402 facilitator covers gas)"))
    console.log()

    // Save wallet to config first (so it persists even if they close)
    config.set("x402Address", address)
    config.set("authMethod", "x402")
    if (privateKey) {
      // Store encrypted private key (in production, use proper encryption)
      config.set("x402PrivateKey", privateKey)
    }
    config.delete("token") // Clear platform token if any

    // Check if they have enough
    if (usdcNum < 5) {
      console.log(chalk.yellow("⚠️  Need $5 USDC to activate Day Pass"))
      console.log()
      console.log(chalk.bold("Send USDC to:"))
      console.log()
      console.log(chalk.cyan("┌" + "─".repeat(44) + "┐"))
      console.log(chalk.cyan("│") + "  " + chalk.bold.white(address) + "  " + chalk.cyan("│"))
      console.log(chalk.cyan("└" + "─".repeat(44) + "┘"))
      console.log()
      console.log(chalk.dim("Tip: Use Coinbase, Bridge, or any exchange that supports Base"))
      console.log()
      console.log(chalk.dim("Press q or Escape to exit and fund later"))
      console.log()

      // Wait for funding
      const fundingSpinner = ora("Waiting for $5 USDC...").start()

      const funded = await waitForUsdcBalance(address, 5, (balance) => {
        fundingSpinner.text = `Balance: $${balance.toFixed(2)} USDC (need $5.00) - press q to exit`
      })

      if (!funded) {
        fundingSpinner.info("Exited - wallet saved")
        console.log()
        console.log(chalk.gray("Your wallet is saved. When you fund it with $5 USDC,"))
        console.log(chalk.gray("JFL will automatically activate your Day Pass."))
        console.log()
        return
      }

      fundingSpinner.succeed("Funded!")
      console.log()

      // Re-check balances
      const newUsdc = await checkUsdcBalance(address)
      usdcNum = parseFloat(newUsdc.formatted)
    }

    // Success!
    console.log(chalk.bold.green("✅ Wallet ready!"))
    console.log()
    console.log(chalk.gray("You now have access to:"))
    console.log("  • AI included (no API key needed)")
    console.log("  • Chat in Telegram, Slack, Discord")
    console.log("  • Dashboard + Deploy at jfl.run")
    console.log("  • Parallel agents")
    console.log()
    console.log(chalk.gray("$5 will be deducted only on days you use JFL."))
    console.log(chalk.gray("$0 on days you don't use it."))
    console.log()

    // If in a JFL project, set this as the project wallet if not already set
    await handleProjectWallet(address)

    // Check if user is joining as a teammate
    await handleTeammateJoin()
  } catch (error) {
    spinner.fail("Failed to check balance")
    console.error(chalk.red(error))
  }
}

async function createNewWallet(): Promise<{ address: string; privateKey: Hex }> {
  console.log(chalk.bold("\n🔐 Creating your wallet...\n"))

  // Security disclosure
  console.log(chalk.bold.cyan("Security & Privacy"))
  console.log(chalk.gray("─".repeat(60)))
  console.log()
  console.log(chalk.white("  • Your seed phrase is generated locally on THIS computer"))
  console.log(chalk.white("  • It will NEVER be sent to any server or third party"))
  console.log(chalk.white("  • All signing happens locally on your device"))
  console.log(chalk.white("  • You are in full control of your funds"))
  console.log()
  console.log(chalk.white("  • Your seed phrase will be stored encrypted at:"))
  console.log(chalk.cyan(`    ${config.path}`))
  console.log()
  console.log(chalk.bold.red("⚠️  If you lose your seed phrase, you lose access to your wallet"))
  console.log(chalk.bold.red("   There is no recovery. Write it down and store it safely."))
  console.log()

  const { understood } = await inquirer.prompt([
    {
      type: "confirm",
      name: "understood",
      message: "I understand. Generate my wallet.",
      default: false,
    },
  ])

  if (!understood) {
    throw new Error("Wallet creation cancelled")
  }

  // Generate seed phrase
  const seedPhrase = generateSeedPhrase(12)
  const privateKey = seedPhraseToPrivateKey(seedPhrase, 0)
  const address = getAddressFromPrivateKey(privateKey)

  // Display seed phrase prominently
  console.log()
  console.log(chalk.bold.yellow("📝 YOUR SEED PHRASE - WRITE THIS DOWN"))
  console.log()
  console.log(chalk.cyan("┌" + "─".repeat(58) + "┐"))

  const words = seedPhrase.split(" ")
  for (let i = 0; i < words.length; i += 3) {
    const row = words.slice(i, i + 3)
    const formatted = row.map((word, j) => {
      const num = (i + j + 1).toString().padStart(2, " ")
      return `${chalk.dim(num + ".")} ${chalk.bold.white(word.padEnd(12))}`
    }).join(" ")
    console.log(chalk.cyan("│") + "  " + formatted + "  " + chalk.cyan("│"))
  }

  console.log(chalk.cyan("└" + "─".repeat(58) + "┘"))
  console.log()
  console.log(chalk.dim("Copy this (select and copy the line below):"))
  console.log(chalk.white.bold(words.join(" ")))
  console.log()

  // Verify they saved it by asking for 3 words
  console.log(chalk.yellow("To confirm you saved it, enter these 3 words:\n"))

  const verifyIndices = [0, 5, 11] // Words #1, #6, #12
  for (const idx of verifyIndices) {
    const { word } = await inquirer.prompt([
      {
        type: "input",
        name: "word",
        message: `Word #${idx + 1}:`,
      },
    ])

    if (word.trim().toLowerCase() !== words[idx].toLowerCase()) {
      console.log(chalk.red("\n❌ Incorrect. Please write down your seed phrase and try again."))
      throw new Error("Seed phrase verification failed")
    }
  }

  console.log(chalk.green("\n✓ Seed phrase verified!"))

  // Display wallet address
  console.log()
  console.log(chalk.bold.green("✨ Wallet created!"))
  console.log()
  console.log(chalk.bold("Your wallet address:"))
  console.log(chalk.cyan("┌" + "─".repeat(44) + "┐"))
  console.log(chalk.cyan("│") + "  " + chalk.bold.white(address) + "  " + chalk.cyan("│"))
  console.log(chalk.cyan("└" + "─".repeat(44) + "┘"))
  console.log()

  // Save seed phrase
  config.set("x402SeedPhrase", seedPhrase)

  console.log(chalk.dim("💾 Config saved to: ") + chalk.cyan(config.path))
  console.log()

  return { address, privateKey }
}

async function importFromSeedPhrase(): Promise<{ address: string; privateKey: Hex }> {
  console.log(chalk.bold("\n🔐 Import from Seed Phrase\n"))

  const { seedPhrase } = await inquirer.prompt([
    {
      type: "password",
      name: "seedPhrase",
      message: "Enter your 12 or 24 word seed phrase:",
      mask: "•",
      validate: (input: string) => {
        const words = input.trim().split(/\s+/)
        if (words.length !== 12 && words.length !== 24) {
          return "Seed phrase must be 12 or 24 words"
        }
        if (!validateSeedPhrase(input.trim())) {
          return "Invalid seed phrase"
        }
        return true
      },
    },
  ])

  const privateKey = seedPhraseToPrivateKey(seedPhrase.trim(), 0)
  const address = getAddressFromPrivateKey(privateKey)

  console.log(chalk.green("\n✓ Seed phrase imported"))
  console.log(chalk.gray(`  Address: ${address}\n`))

  // Save seed phrase
  config.set("x402SeedPhrase", seedPhrase.trim())

  return { address, privateKey }
}

async function importFromPrivateKey(): Promise<{ address: string; privateKey: Hex }> {
  console.log(chalk.bold("\n🔐 Import from Private Key\n"))

  const { privateKeyInput } = await inquirer.prompt([
    {
      type: "password",
      name: "privateKeyInput",
      message: "Enter your private key (0x...):",
      mask: "•",
      validate: (input: string) => {
        if (!input.startsWith("0x") || input.length !== 66) {
          return "Private key must start with 0x and be 66 characters"
        }
        return true
      },
    },
  ])

  const privateKey = privateKeyInput as Hex
  const address = getAddressFromPrivateKey(privateKey)

  console.log(chalk.green("\n✓ Private key imported"))
  console.log(chalk.gray(`  Address: ${address}\n`))

  return { address, privateKey }
}

async function loginWithGitHub(plan: string = "solo", isInteractive: boolean = true) {
  const planName = plan === "pro" ? "Team ($199/mo)" : "Solo ($49/mo)"
  console.log(chalk.cyan(`\n🐙 GitHub Authentication - ${planName}\n`))

  const loginUrl = `${PLATFORM_URL}/login?cli=true&plan=${plan}`

  // Non-interactive: just show URL
  if (!isInteractive) {
    console.log(chalk.yellow("Running non-interactively.\n"))
    console.log(chalk.white("To authenticate:"))
    console.log(chalk.gray("  1. Open this URL in your browser:"))
    console.log(chalk.cyan(`     ${loginUrl}`))
    console.log(chalk.gray("  2. Sign in with GitHub"))
    console.log(chalk.gray("  3. Copy the API token"))
    console.log(chalk.gray("  4. Run: jfl login --token <your-token>\n"))
    return
  }

  console.log(chalk.gray("Opening browser for GitHub login...\n"))

  try {
    // Open browser
    const openCommand =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open"

    execSync(`${openCommand} "${loginUrl}"`, { stdio: "pipe" })
  } catch {
    console.log(chalk.yellow("Could not open browser automatically."))
    console.log(chalk.gray(`Please visit: ${loginUrl}`))
  }

  console.log(chalk.cyan("Waiting for authentication...\n"))

  // For production, use device code flow
  // For now, ask for token directly
  const { token } = await inquirer.prompt([
    {
      type: "password",
      name: "token",
      message: "Paste your API token from the browser:",
      mask: "*",
    },
  ])

  if (!token) {
    console.log(chalk.red("No token provided."))
    return
  }

  const spinner = ora("Verifying...").start()

  try {
    const res = await fetch(`${PLATFORM_URL}/api/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      spinner.fail("Invalid token")
      return
    }

    const user = await res.json()

    // Save token
    config.set("token", token)
    config.set("user", user)
    config.set("authMethod", "github")
    config.delete("x402Address") // Clear x402 if any

    spinner.succeed(`Logged in as ${user.name || user.email}`)

    console.log(chalk.bold.green("\n✅ Authenticated!\n"))
    console.log(chalk.gray(`Tier: ${user.tier}`))

    if (user.tier === "FREE" || user.tier === "TRIAL") {
      console.log(chalk.yellow("\n💡 You're on trial. Pay when you get value:"))
      console.log("   x402 ($5/day) - Per person, pay as you go")
      console.log("   Solo ($49/mo) - Just you, fixed monthly")
      console.log("   Pro ($199/mo) - Team up to 5 (+$25/seat)")
      console.log(chalk.gray(`\n   Visit: ${PLATFORM_URL}/dashboard/settings`))
    } else if (user.tier === "SOLO") {
      console.log(chalk.green("\n✓ Solo - AI included, Dashboard, Deploy"))
    } else if (user.tier === "PRO") {
      console.log(chalk.green("\n✓ Pro - Team, Parallel agents, Analytics"))
    } else if (user.tier === "X402") {
      console.log(chalk.green("\n✓ x402 - Pay as you go ($5/day active)"))
    }

    console.log()

    // Check if user is joining as a teammate
    await handleTeammateJoin()
  } catch (error) {
    spinner.fail("Authentication failed")
    console.error(chalk.red(error))
  }
}

async function loginWithPlatform(isInteractive: boolean = true) {
  console.log(chalk.cyan("\n🔐 Platform Authentication\n"))

  // Non-interactive: show instructions
  if (!isInteractive) {
    console.log(chalk.yellow("Running non-interactively.\n"))
    console.log(chalk.white("To authenticate with the platform:"))
    console.log(chalk.gray("  Run this command in your terminal:"))
    console.log(chalk.cyan("    jfl login --platform\n"))
    console.log(chalk.gray("(Platform login requires an interactive terminal)\n"))
    return
  }

  try {
    // Step 1: Register device and get code
    console.log(chalk.gray("Registering device...\n"))
    const { deviceId, deviceCode, verificationUrl, expiresIn } = await registerDevice()

    // Step 2: Show code to user
    console.log(chalk.bold("🔑 Device Code\n"))
    console.log(chalk.cyan("┌────────────┐"))
    console.log(chalk.cyan("│  ") + chalk.bold.white(deviceCode) + chalk.cyan("  │"))
    console.log(chalk.cyan("└────────────┘"))
    console.log()
    console.log(chalk.gray("1. Opening browser to link your device..."))
    console.log(chalk.gray(`2. Sign in with your email or wallet`))
    console.log(chalk.gray(`3. Enter the code: ${chalk.yellow(deviceCode)}`))
    console.log()
    console.log(chalk.dim(`Code expires in ${expiresIn} seconds`))
    console.log()

    // Step 3: Open browser
    try {
      const openCommand =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open"

      execSync(`${openCommand} "${verificationUrl}"`, { stdio: "pipe" })
    } catch {
      console.log(chalk.yellow("Could not open browser automatically."))
      console.log(chalk.gray(`Please visit: ${verificationUrl}`))
      console.log()
    }

    // Step 4: Poll for linking
    const spinner = ora("Waiting for authentication...").start()

    const result = await pollDeviceStatus(deviceId, expiresIn, spinner)

    if (!result.success || !result.jwt || !result.user) {
      if (result.reason === 'expired') {
        spinner.fail("Device code expired (5 minute limit)")
        console.log(chalk.yellow("\nThe device code has expired. Please try again:\n"))
      } else {
        spinner.fail("Authentication timed out")
        console.log(chalk.yellow("\nNo response received. Please try again:\n"))
      }
      console.log(chalk.cyan("  jfl login --platform\n"))
      return
    }

    // Step 5: Save authentication
    savePlatformAuth(result.jwt, result.user)

    spinner.succeed(`Authenticated as ${chalk.green(result.user.name || result.user.email)}`)

    console.log(chalk.bold.green("\n✅ Platform account linked!\n"))
    console.log(chalk.gray(`User: ${result.user.name || result.user.email}`))
    console.log(chalk.gray(`Tier: ${result.user.tier || "Free"}`))
    console.log()

    if (result.user.tier === "FREE" || !result.user.tier) {
      console.log(chalk.cyan("🎉 You're on the free trial!"))
      console.log(chalk.gray("\nUpgrade anytime at: ") + chalk.cyan(`${PLATFORM_URL}/dashboard/settings`))
    }
    console.log()

    // Check if user is joining as a teammate
    await handleTeammateJoin()
  } catch (error) {
    console.error(chalk.red("\n❌ Authentication failed"))
    console.error(chalk.gray(error instanceof Error ? error.message : String(error)))
    console.log()
  }
}

// ============================================================================
// PROJECT WALLET
// ============================================================================

/**
 * Set up project wallet if in a JFL project
 * Called after successful wallet setup
 */
async function handleProjectWallet(walletAddress: string): Promise<void> {
  // Check if we're in a JFL project
  if (!isJflProject()) return

  // Check if project already has a wallet
  const existingWallet = getProjectWallet()
  if (existingWallet) {
    // Project already has a wallet - check if it's this one
    if (existingWallet.toLowerCase() === walletAddress.toLowerCase()) {
      console.log(chalk.green("✓ This wallet is already the project wallet"))
    } else {
      console.log(chalk.gray(`Project wallet: ${existingWallet.slice(0, 10)}...${existingWallet.slice(-8)}`))
      console.log(chalk.gray("(Different from your wallet - you're a contributor)"))
    }
    return
  }

  // No project wallet yet - get username and set it
  let username = "owner"
  try {
    username = execSync("git config user.name", { encoding: "utf-8" }).trim()
  } catch {
    // Use default
  }

  // Set this as the project wallet
  setProjectWallet(walletAddress, username)
  console.log(chalk.green("✓ Set as project wallet"))
  console.log(chalk.gray("  Teammates can now contribute to this project"))
}

// ============================================================================
// TEAMMATE JOINING
// ============================================================================

/**
 * Check if current user is a teammate (has suggestions file) and mark them as joined
 * Called after successful authentication
 */
async function handleTeammateJoin(): Promise<void> {
  const cwd = process.cwd()
  const suggestionsDir = `${cwd}/suggestions`

  try {
    const { existsSync, readdirSync } = require('fs')
    if (!existsSync(suggestionsDir)) return

    // Get username from git config
    let username: string | undefined
    try {
      username = execSync('git config user.name', { encoding: 'utf-8' }).trim().toLowerCase()
    } catch {
      return // Can't determine username
    }

    if (!username) return

    // Check for matching suggestions file
    const files = readdirSync(suggestionsDir) as string[]
    const matchingFile = files.find((f: string) => {
      const name = f.replace('.md', '').toLowerCase()
      return name === username || name.includes(username)
    })

    if (matchingFile) {
      const teammateUsername = matchingFile.replace('.md', '')
      const marked = markTeammateJoined(teammateUsername)
      if (marked) {
        console.log(chalk.green(`\n✓ Joined project as teammate: ${teammateUsername}`))
      }
    }
  } catch {
    // Silent fail - not critical
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export function getToken(): string | undefined {
  return config.get("token") as string | undefined
}

export function getX402Address(): string | undefined {
  return config.get("x402Address") as string | undefined
}

export function getAuthMethod(): "github" | "x402" | "platform" | undefined {
  return config.get("authMethod") as "github" | "x402" | "platform" | undefined
}

export function getUser(): { id: string; name?: string; email: string; tier?: string } | undefined {
  // Check for platform user first (newer auth method)
  const platformUser = getPlatformUser()
  if (platformUser) {
    return {
      id: platformUser.id,
      name: platformUser.name,
      email: platformUser.email,
      tier: platformUser.tier,
    }
  }

  // Fall back to legacy GitHub auth user
  return config.get("user") as { id: string; name?: string; email: string; tier?: string } | undefined
}

export function isAuthenticated(): boolean {
  // For x402, need signing capability (not just view-only address)
  const hasX402Signing = getX402Address() && (config.get("x402PrivateKey") || config.get("x402SeedPhrase"))
  const hasPlatformAuth = getPlatformToken()
  return !!(getToken() || hasX402Signing || hasPlatformAuth)
}

export function isViewOnly(): boolean {
  return !!(getX402Address() && !config.get("x402PrivateKey") && !config.get("x402SeedPhrase"))
}

export function logout() {
  config.delete("token")
  config.delete("user")
  config.delete("x402Address")
  config.delete("x402PrivateKey")
  config.delete("x402SeedPhrase")
  config.delete("platformToken")
  config.delete("platformUser")
  config.delete("authMethod")
}
