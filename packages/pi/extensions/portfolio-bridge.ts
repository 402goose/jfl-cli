/**
 * Portfolio Bridge Extension
 *
 * Handles cross-GTM coordination: phoneHome on session end, journal sync to parent,
 * and eval scores propagated to portfolio hub for cross-GTM RL training.
 *
 * @purpose Portfolio-GTM coordination — phoneHome, journal sync, eval propagation
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import type { PiContext, JflConfig } from "./types.js"
import { emitCustomEvent } from "./map-bridge.js"

let projectRoot = ""
let portfolioParent: string | null = null

async function phoneHome(ctx: PiContext): Promise<void> {
  if (!portfolioParent || !existsSync(portfolioParent)) return

  try {
    // @ts-ignore — resolved from jfl package at runtime
    const { phoneHomeToPortfolio } = await import("../../src/lib/service-gtm.js")
    await phoneHomeToPortfolio(projectRoot)
    ctx.log("Portfolio phoneHome complete", "debug")
  } catch (err) {
    ctx.log(`Portfolio phoneHome failed: ${err}`, "debug")
  }
}

async function syncJournalEntry(ctx: PiContext, entry: unknown): Promise<void> {
  if (!portfolioParent || !existsSync(portfolioParent)) return

  try {
    // @ts-ignore — resolved from jfl package at runtime
    const { writeSyncToParent } = await import("../../src/lib/service-gtm.js")
    await (writeSyncToParent as (root: string, entry: unknown) => Promise<void>)(projectRoot, entry)
  } catch (err) {
    ctx.log(`Journal sync to parent failed: ${err}`, "debug")
  }
}

async function propagateEvalToPortfolio(ctx: PiContext, evalData: unknown): Promise<void> {
  if (!portfolioParent) return

  const portfolioConfigPath = join(portfolioParent, ".jfl", "context-hub.port")
  if (!existsSync(portfolioConfigPath)) return

  try {
    const port = readFileSync(portfolioConfigPath, "utf-8").trim()
    const portfolioHub = `http://localhost:${port}`
    const tokenPath = join(portfolioParent, ".jfl", "context-hub.token")
    const token = existsSync(tokenPath) ? readFileSync(tokenPath, "utf-8").trim() : null

    await fetch(`${portfolioHub}/api/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        type: "eval:scored",
        source: projectRoot,
        data: evalData,
        ts: new Date().toISOString(),
      }),
    })
  } catch {}
}

export async function setupPortfolioBridge(ctx: PiContext, config: JflConfig): Promise<void> {
  projectRoot = ctx.session.projectRoot
  portfolioParent = config.portfolio_parent ?? null

  if (!portfolioParent) return

  ctx.on("map:journal:entry", (data) => syncJournalEntry(ctx, data))

  ctx.on("map:eval:scored", (data) => propagateEvalToPortfolio(ctx, data))

  ctx.on("map:portfolio:directive", async (data) => {
    const directive = data as { action?: string; payload?: unknown }
    ctx.log(`Portfolio directive received: ${directive.action}`, "info")
    await emitCustomEvent(ctx, "portfolio:directive:received", directive)
  })
}

export async function onPortfolioShutdown(ctx: PiContext): Promise<void> {
  await phoneHome(ctx)
}
