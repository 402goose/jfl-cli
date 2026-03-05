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
}
