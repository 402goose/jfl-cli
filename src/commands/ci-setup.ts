/**
 * @purpose CLI command for `jfl ci setup` — deploys eval + review CI workflows to a project
 */

import chalk from "chalk"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const TEMPLATE_DIR = join(__dirname, "../../template/.github/workflows")

const WORKFLOW_FILES = ["jfl-eval.yml", "jfl-review.yml"]

function getRepoSlug(): string {
  try {
    const remote = execSync("git remote get-url origin", { encoding: "utf-8" }).trim()
    const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/)
    return match?.[1] ?? "OWNER/REPO"
  } catch {
    return "OWNER/REPO"
  }
}

export async function ciSetupCommand(): Promise<void> {
  const cwd = process.cwd()
  const targetDir = join(cwd, ".github", "workflows")

  if (!existsSync(TEMPLATE_DIR)) {
    console.log(chalk.red("\n  Template workflows not found at: " + TEMPLATE_DIR))
    console.log(chalk.gray("  This usually means the jfl CLI package is incomplete. Try: npm install -g jfl\n"))
    process.exit(1)
  }

  if (!existsSync(join(cwd, ".github"))) {
    mkdirSync(join(cwd, ".github"), { recursive: true })
  }
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
  }

  let deployed = 0
  let skipped = 0

  for (const file of WORKFLOW_FILES) {
    const src = join(TEMPLATE_DIR, file)
    const dest = join(targetDir, file)

    if (!existsSync(src)) {
      console.log(chalk.yellow(`  Template missing: ${file} — skipping`))
      skipped++
      continue
    }

    const templateContent = readFileSync(src, "utf-8")

    if (existsSync(dest)) {
      const existingContent = readFileSync(dest, "utf-8")
      if (existingContent === templateContent) {
        console.log(chalk.gray(`  ${file} — already up to date`))
        deployed++
        continue
      }

      console.log(chalk.yellow(`  ${file} — exists and differs from template, overwriting`))
    }

    writeFileSync(dest, templateContent)
    console.log(chalk.green(`  ${file} — deployed`))
    deployed++
  }

  const repoSlug = getRepoSlug()

  console.log()
  if (deployed > 0) {
    console.log(chalk.green("  CI workflows deployed to .github/workflows/"))
  }
  if (skipped > 0) {
    console.log(chalk.yellow(`  ${skipped} workflow(s) skipped (template missing)`))
  }

  console.log()
  console.log(chalk.bold("  Required GitHub secrets") + chalk.gray(` (set at github.com/${repoSlug}/settings/secrets):`))
  console.log(chalk.cyan("    OPENAI_API_KEY") + chalk.gray("     — For AI quality assessment and code review"))
  console.log()
  console.log(chalk.bold("  Optional:"))
  console.log(chalk.cyan("    OPENROUTER_API_KEY") + chalk.gray(" — Fallback if OpenAI unavailable"))
  console.log(chalk.cyan("    JFL_HUB_URL") + chalk.gray("        — Context Hub URL for real-time dashboard updates"))
  console.log(chalk.cyan("    JFL_HUB_TOKEN") + chalk.gray("      — Auth token for hub API"))
  console.log()
  console.log(chalk.gray("  The eval workflow runs on PRs from Peter Parker (pp/ branches)."))
  console.log(chalk.gray("  To trigger manually, add the 'run-eval' or 'ai-review' label to any PR."))
  console.log()
}
