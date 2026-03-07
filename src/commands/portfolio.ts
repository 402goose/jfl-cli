/**
 * @purpose Portfolio workspace management — register, list, and inspect child GTMs
 */

import { Command } from "commander"
import * as fs from "fs"
import * as path from "path"
import chalk from "chalk"
import {
  type ServiceConfig,
  type GTMConfig,
  type ServiceRegistration,
  getRegisteredServices,
  validateGTMParent,
} from "../lib/service-gtm.js"

function findProjectRoot(): string {
  let dir = process.cwd()
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".jfl", "config.json"))) return dir
    dir = path.dirname(dir)
  }
  return process.cwd()
}

function loadConfig(root: string): GTMConfig | null {
  const configPath = path.join(root, ".jfl", "config.json")
  if (!fs.existsSync(configPath)) return null
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as GTMConfig
  } catch {
    return null
  }
}

function requirePortfolio(root: string): GTMConfig {
  const config = loadConfig(root)
  if (!config || config.type !== "portfolio") {
    console.log(chalk.red("Not a portfolio workspace. Run from a portfolio directory or use 'jfl init' to create one."))
    process.exit(1)
  }
  return config
}

export function registerPortfolioCommand(program: Command): void {
  const portfolio = program
    .command("portfolio")
    .description("Manage portfolio of GTM workspaces")

  portfolio
    .command("register <path>")
    .description("Register a GTM workspace in this portfolio")
    .action(async (gtmPath: string) => {
      const root = findProjectRoot()
      const config = requirePortfolio(root)

      const resolvedPath = path.resolve(gtmPath)

      if (!fs.existsSync(resolvedPath)) {
        console.log(chalk.red(`Path does not exist: ${resolvedPath}`))
        return
      }

      const gtmConfigPath = path.join(resolvedPath, ".jfl", "config.json")
      if (!fs.existsSync(gtmConfigPath)) {
        console.log(chalk.red(`No .jfl/config.json found at ${resolvedPath}`))
        return
      }

      let gtmConfig: GTMConfig
      try {
        gtmConfig = JSON.parse(fs.readFileSync(gtmConfigPath, "utf-8"))
      } catch {
        console.log(chalk.red("Invalid config.json"))
        return
      }

      if (gtmConfig.type !== "gtm") {
        console.log(chalk.red(`Expected type "gtm", got "${gtmConfig.type}"`))
        return
      }

      if (!config.registered_services) config.registered_services = []

      const existing = config.registered_services.find(s => s.name === gtmConfig.name)
      if (existing) {
        console.log(chalk.yellow(`${gtmConfig.name} already registered. Updating.`))
        existing.path = resolvedPath
        existing.status = "active"
      } else {
        const serviceCount = getRegisteredServices(resolvedPath).length
        config.registered_services.push({
          name: gtmConfig.name,
          path: resolvedPath,
          type: "gtm",
          registered_at: new Date().toISOString(),
          status: "active",
          context_scope: gtmConfig.context_scope,
        })
        console.log(chalk.green(`Registered: ${gtmConfig.name} (${serviceCount} services)`))
      }

      // Write updated portfolio config
      const portfolioConfigPath = path.join(root, ".jfl", "config.json")
      fs.writeFileSync(portfolioConfigPath, JSON.stringify(config, null, 2))

      // Write portfolio_parent back to child GTM
      gtmConfig.portfolio_parent = root
      fs.writeFileSync(gtmConfigPath, JSON.stringify(gtmConfig, null, 2))

      console.log(chalk.green(`Portfolio link established`))
    })

  portfolio
    .command("list")
    .description("List registered GTM workspaces")
    .action(async () => {
      const root = findProjectRoot()
      const config = requirePortfolio(root)

      const children = config.registered_services ?? []
      if (children.length === 0) {
        console.log(chalk.yellow("No GTMs registered. Use 'jfl portfolio register <path>' to add one."))
        return
      }

      console.log(chalk.bold(`\n  Portfolio: ${config.name}\n`))

      const header = `  ${"Name".padEnd(25)} ${"Type".padEnd(8)} ${"Services".padEnd(10)} ${"Status".padEnd(10)} Path`
      const separator = `  ${"─".repeat(25)} ${"─".repeat(8)} ${"─".repeat(10)} ${"─".repeat(10)} ${"─".repeat(30)}`
      console.log(chalk.dim(header))
      console.log(chalk.dim(separator))

      for (const child of children) {
        const exists = fs.existsSync(child.path)
        let serviceCount = "—"
        if (exists) {
          const childServices = getRegisteredServices(child.path)
          serviceCount = String(childServices.length)
        }
        const statusColor = child.status === "active" && exists ? chalk.green : chalk.red
        const status = exists ? child.status : "missing"

        console.log(
          `  ${child.name.padEnd(25)} ${(child.type || "gtm").padEnd(8)} ${serviceCount.padEnd(10)} ${statusColor(status.padEnd(10))} ${chalk.dim(child.path)}`
        )
      }

      console.log()
    })

  portfolio
    .command("unregister <name>")
    .description("Remove a GTM workspace from this portfolio")
    .action(async (name: string) => {
      const root = findProjectRoot()
      const config = requirePortfolio(root)

      const children = config.registered_services ?? []
      const idx = children.findIndex(s => s.name === name)
      if (idx === -1) {
        console.log(chalk.red(`"${name}" is not registered in this portfolio.`))
        return
      }

      const child = children[idx]

      // Remove portfolio_parent from child GTM config
      if (fs.existsSync(child.path)) {
        const childConfigPath = path.join(child.path, ".jfl", "config.json")
        if (fs.existsSync(childConfigPath)) {
          try {
            const childConfig = JSON.parse(fs.readFileSync(childConfigPath, "utf-8"))
            delete childConfig.portfolio_parent
            fs.writeFileSync(childConfigPath, JSON.stringify(childConfig, null, 2))
          } catch {}
        }
      }

      children.splice(idx, 1)
      config.registered_services = children

      const portfolioConfigPath = path.join(root, ".jfl", "config.json")
      fs.writeFileSync(portfolioConfigPath, JSON.stringify(config, null, 2))

      console.log(chalk.green(`Unregistered: ${name}`))
    })

  portfolio
    .command("status")
    .description("Portfolio health and eval summary")
    .action(async () => {
      const root = findProjectRoot()
      const config = requirePortfolio(root)

      const children = config.registered_services ?? []
      console.log(chalk.bold(`\n  Portfolio: ${config.name}`))
      console.log(chalk.dim(`  ${children.length} GTM workspaces\n`))

      // Check eval data
      const evalPath = path.join(root, ".jfl", "eval.jsonl")
      let evalCount = 0
      const agentSet = new Set<string>()

      if (fs.existsSync(evalPath)) {
        const lines = fs.readFileSync(evalPath, "utf-8").split("\n").filter(l => l.trim())
        for (const line of lines) {
          try {
            const entry = JSON.parse(line)
            evalCount++
            if (entry.agent) agentSet.add(entry.agent)
          } catch {}
        }
      }

      console.log(`  Eval entries: ${evalCount}`)
      console.log(`  Agents tracked: ${[...agentSet].join(", ") || "none"}`)

      // Child status
      console.log(chalk.bold("\n  Child GTMs:\n"))

      for (const child of children) {
        const exists = fs.existsSync(child.path)
        const icon = exists ? chalk.green("●") : chalk.red("●")
        let detail = ""

        if (exists) {
          const childServices = getRegisteredServices(child.path)
          detail = chalk.dim(`${childServices.length} services`)

          const childEvalPath = path.join(child.path, ".jfl", "eval.jsonl")
          if (fs.existsSync(childEvalPath)) {
            const evals = fs.readFileSync(childEvalPath, "utf-8").split("\n").filter(l => l.trim()).length
            detail += chalk.dim(`, ${evals} evals`)
          }
        } else {
          detail = chalk.red("path missing")
        }

        console.log(`  ${icon} ${child.name}  ${detail}`)
      }

      console.log()
    })

  portfolio
    .command("phone-home")
    .description("Report this GTM's health to its portfolio parent")
    .action(async () => {
      const root = findProjectRoot()
      const config = loadConfig(root)
      if (!config) {
        console.log(chalk.red("No .jfl/config.json found."))
        return
      }

      const portfolioPath = (config as any).portfolio_parent
      if (!portfolioPath) {
        console.log(chalk.yellow("No portfolio_parent configured. This GTM is not part of a portfolio."))
        return
      }

      if (!fs.existsSync(portfolioPath)) {
        console.log(chalk.red(`Portfolio parent path not found: ${portfolioPath}`))
        return
      }

      // Build health report
      const services = getRegisteredServices(root)
      const evalPath = path.join(root, ".jfl", "eval.jsonl")
      let evalCount = 0
      let latestEval: string | null = null
      if (fs.existsSync(evalPath)) {
        const lines = fs.readFileSync(evalPath, "utf-8").split("\n").filter(l => l.trim())
        evalCount = lines.length
        if (lines.length > 0) {
          try {
            const last = JSON.parse(lines[lines.length - 1])
            latestEval = last.ts
          } catch {}
        }
      }

      const report = {
        name: config.name,
        type: config.type,
        services: services.length,
        evals: evalCount,
        latest_eval: latestEval,
        reported_at: new Date().toISOString(),
      }

      // Write report to portfolio's journal
      const portfolioJournalDir = path.join(portfolioPath, ".jfl", "journal")
      if (!fs.existsSync(portfolioJournalDir)) {
        fs.mkdirSync(portfolioJournalDir, { recursive: true })
      }
      const entry = {
        v: 1,
        ts: new Date().toISOString(),
        session: "phone-home",
        type: "discovery",
        title: `Phone home: ${config.name}`,
        summary: `${config.name} reports ${services.length} services, ${evalCount} evals. Latest eval: ${latestEval || "none"}.`,
        status: "complete",
      }
      const journalFile = path.join(portfolioJournalDir, "phone-home.jsonl")
      fs.appendFileSync(journalFile, JSON.stringify(entry) + "\n")

      // Try to emit event to portfolio hub
      const portfolioConfig = loadConfig(portfolioPath)
      if (portfolioConfig) {
        const tokenPath = path.join(portfolioPath, ".jfl", "context-hub.token")
        if (fs.existsSync(tokenPath)) {
          try {
            const token = fs.readFileSync(tokenPath, "utf-8").trim()
            const { getProjectPort } = await import("../utils/context-hub-port.js")
            const port = getProjectPort(portfolioPath)
            await fetch(`http://localhost:${port}/api/events`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
              },
              body: JSON.stringify({
                type: "portfolio:phone-home",
                source: config.name,
                data: report,
              }),
              signal: AbortSignal.timeout(5000),
            })
          } catch {}
        }
      }

      console.log(chalk.green(`Reported to portfolio: ${path.basename(portfolioPath)}`))
      console.log(chalk.dim(`  Services: ${services.length}`))
      console.log(chalk.dim(`  Evals: ${evalCount}`))
      console.log(chalk.dim(`  Latest eval: ${latestEval || "none"}`))
    })
}
