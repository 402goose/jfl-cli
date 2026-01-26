#!/usr/bin/env npx tsx
/**
 * Demo: New JFL Onboarding Flow
 * 
 * Run: npx tsx cli/demo-onboarding.ts
 */

import {
  intro,
  outro,
  text,
  select,
  confirm,
  spinner,
  isCancel,
  cancel,
  logStep,
  logSuccess,
  logWarning,
  note,
  theme,
} from "./src/ui/index.js"

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════
  // WELCOME
  // ═══════════════════════════════════════════════════════════════════════════

  intro("0.1.0")

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN FLOW
  // ═══════════════════════════════════════════════════════════════════════════

  const action = await select({
    message: "What brings you here?",
    options: [
      { value: "new", label: "Start a new project", hint: "create workspace" },
      { value: "join", label: "Join existing project", hint: "I was invited" },
      { value: "explore", label: "Just exploring", hint: "show me around" },
    ],
  })

  if (isCancel(action)) {
    cancel()
    process.exit(0)
  }

  if (action === "explore") {
    note(
      `JFL is your context layer for shipping products.

• Create GTM workspaces with AI-ready context
• Generate brand, content, and strategy docs
• Works with Claude Code, Clawdbot, or any AI

Get started: jfl init my-project`,
      "Welcome to JFL"
    )
    outro("Run 'jfl init' when you're ready to ship.")
    return
  }

  if (action === "join") {
    logStep("GitHub authentication will discover projects you can join...")
    // In real impl: authenticateWithGitHub() → discoverJflProjects()
    outro("Run 'jfl' to authenticate and join a project.")
    return
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NEW PROJECT FLOW (QuickStart - 3 prompts max)
  // ═══════════════════════════════════════════════════════════════════════════

  const projectName = await text({
    message: "Project name:",
    placeholder: "my-startup",
    defaultValue: "my-startup",
    validate: (value) => {
      if (!/^[a-z0-9-]+$/.test(value)) {
        return "Use lowercase letters, numbers, and hyphens only"
      }
    },
  })

  if (isCancel(projectName)) {
    cancel()
    process.exit(0)
  }

  const paymentPlan = await select({
    message: "How do you want to pay?",
    options: [
      { value: "trial", label: "Trial", hint: "free, bring your own AI key" },
      { value: "daypass", label: "Day Pass", hint: "$5/day, AI included" },
      { value: "platform", label: "Platform", hint: "manage on jfl.run" },
    ],
  })

  if (isCancel(paymentPlan)) {
    cancel()
    process.exit(0)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE PROJECT
  // ═══════════════════════════════════════════════════════════════════════════

  const s = spinner()
  s.start("Creating workspace...")

  // Simulate work
  await sleep(800)
  s.message("Initializing git...")
  await sleep(400)
  s.message("Installing core skills...")
  await sleep(600)

  s.stop("Workspace created!")

  // Show what was created
  logSuccess(`Created ${theme.accent(projectName as string)}/`)
  console.log(theme.dim("  ├── .claude/skills/ ← AI skills"))
  console.log(theme.dim("  ├── knowledge/      ← Strategy docs"))
  console.log(theme.dim("  ├── content/        ← Marketing"))
  console.log(theme.dim("  └── CLAUDE.md       ← Context layer"))
  console.log()

  // ═══════════════════════════════════════════════════════════════════════════
  // LAUNCH
  // ═══════════════════════════════════════════════════════════════════════════

  const launchNow = await confirm({
    message: "Launch Claude Code now?",
    initialValue: true,
  })

  if (isCancel(launchNow) || !launchNow) {
    outro(`Run: cd ${projectName} && claude`)
    return
  }

  // In real impl: spawn Claude Code
  console.log()
  logStep("Launching Claude Code...")
  console.log(theme.dim("Context loaded from CLAUDE.md + knowledge/"))
  console.log()

  // Bootstrap ritual would happen in Claude Code now
  note(
    `Claude Code is now running with your project context.

On first message, it will ask you:
• What are you building?
• Who is it for?
• When do you want to ship?

This creates your foundation docs automatically.`,
    "Bootstrap Ritual"
  )

  outro("Let's fucking ship it. 🚀")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch(console.error)
