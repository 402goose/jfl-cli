import chalk from "chalk"
import ora from "ora"
import inquirer from "inquirer"
import * as p from "@clack/prompts"
import { execSync, spawn } from "child_process"
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { isAuthenticated, getUser, getAuthMethod, getX402Address } from "./login.js"

const TEMPLATE_REPO = "https://github.com/402goose/jfl-template.git"

export async function initCommand(options?: { name?: string }) {
  // Start Clawdbot-style flow
  p.intro(chalk.hex("#FFD700")("┌  JFL - Initialize GTM Workspace"))

  // Check authentication - owner needs to be verified
  let ownerName = ""
  let ownerGithub = ""
  let ownerX402 = ""

  if (isAuthenticated()) {
    const authMethod = getAuthMethod()
    if (authMethod === "github") {
      const user = getUser()
      ownerName = user?.name || ""
      // Try to get GitHub username from git config
      try {
        const gitUser = execSync("git config user.name", { encoding: "utf-8" }).trim()
        ownerGithub = gitUser
        if (!ownerName) ownerName = gitUser
      } catch {
        ownerGithub = user?.name || ""
      }
    } else if (authMethod === "x402") {
      ownerX402 = getX402Address() || ""
      ownerName = `x402:${ownerX402.slice(0, 8)}...`
    }
    p.log.success(chalk.hex("#00FF88")(`Authenticated as ${ownerName}`))
  } else {
    p.log.warning("Not authenticated. You can create a workspace, but run 'jfl login' to claim ownership.")
  }

  // Get project name
  let projectName = options?.name
  if (!projectName) {
    const name = await p.text({
      message: "Project name:",
      placeholder: "my-project-gtm",
      validate: (input: string) => {
        if (!input) return "Project name is required"
        if (!/^[a-z0-9-]+$/.test(input)) {
          return "Use lowercase letters, numbers, and hyphens only"
        }
      },
    })

    if (p.isCancel(name)) {
      p.cancel("Setup cancelled.")
      process.exit(0)
    }

    projectName = name as string
  }

  const projectPath = join(process.cwd(), projectName!)

  // Check if directory exists
  if (existsSync(projectPath)) {
    console.log(chalk.red(`\nDirectory ${projectName} already exists.`))
    return
  }

  // Pre-flight check: is git installed?
  try {
    execSync("git --version", { stdio: "pipe" })
  } catch {
    p.log.error("git is not installed. JFL requires git.")
    p.log.info("Install git:")
    p.log.info("  macOS: brew install git")
    p.log.info("  Windows: https://git-scm.com/download/win")
    p.log.info("  Linux: sudo apt install git")
    p.outro(chalk.red("Setup failed"))
    return
  }

  // Clone template to temp directory, copy only template/ folder
  const spinner = ora("Downloading GTM template...").start()
  const tempDir = join(tmpdir(), `jfl-init-${Date.now()}`)

  try {
    // Clone to temp
    execSync(`git clone --depth 1 ${TEMPLATE_REPO} ${tempDir}`, {
      stdio: "pipe",
    })

    // Create project directory
    mkdirSync(projectPath, { recursive: true })

    // jfl-template repo has files at root
    const templatePath = tempDir

    if (existsSync(join(templatePath, "CLAUDE.md"))) {
      // Copy template contents (files and folders)
      execSync(`cp -r ${templatePath}/* ${projectPath}/`, { stdio: "pipe" })

      // Copy hidden files (like .jfl, .gitignore)
      execSync(`cp -r ${templatePath}/.[!.]* ${projectPath}/ 2>/dev/null || true`, { stdio: "pipe" })

      // Verify we got the expected structure
      const expectedDirs = [".claude/skills", "templates", "knowledge", "content", "suggestions", "previews", ".jfl", "scripts/session"]
      const missingDirs = expectedDirs.filter(dir => !existsSync(join(projectPath, dir)))

      if (missingDirs.length > 0) {
        throw new Error(`Template copy incomplete. Missing: ${missingDirs.join(", ")}`)
      }
    } else {
      throw new Error("Template folder not found in repository")
    }

    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true })

    // Remove template's .git if it was copied (we want a fresh repo)
    const templateGit = join(projectPath, ".git")
    if (existsSync(templateGit)) {
      rmSync(templateGit, { recursive: true, force: true })
    }

    // Initialize new git repo
    execSync(`git init`, { cwd: projectPath, stdio: "pipe" })

    spinner.succeed("GTM workspace created!")

    const description = await p.text({
      message: "One-line description:",
      placeholder: "My project",
    })

    if (p.isCancel(description)) {
      p.cancel("Setup cancelled.")
      process.exit(0)
    }

    let productRepo = null
    let productPath = null

    // Ask about product repo
    const productChoice = await p.select({
      message: "Product repo:",
      options: [
        {
          label: "I have an existing repo (add as submodule)",
          value: "existing",
          hint: "Requires: git"
        },
        {
          label: "Create a new repo for me",
          value: "create",
          hint: "Requires: git, gh CLI, gh auth login"
        },
        {
          label: "I'll add it later",
          value: "later",
          hint: "Recommended if unsure"
        },
      ],
    })

    if (p.isCancel(productChoice)) {
      p.cancel("Setup cancelled.")
      process.exit(0)
    }

    if (productChoice !== "later") {

      if (productChoice === "existing") {
        const repoUrl = await p.text({
          message: "Product repo URL:",
          placeholder: "https://github.com/user/repo.git",
          validate: (input: string) => {
            if (!input.trim()) {
              return "Please enter a repo URL"
            }
          },
        })

        if (p.isCancel(repoUrl)) {
          p.cancel("Setup cancelled.")
          process.exit(0)
        }

        productRepo = repoUrl as string

        // Add as submodule
        const submoduleSpinner = ora("Adding product repo as submodule...").start()
        try {
          execSync(`git submodule add ${productRepo} product`, {
            cwd: projectPath,
            stdio: "pipe",
          })
          submoduleSpinner.succeed("Product repo linked!")
          productPath = "product/"
        } catch (err: any) {
          submoduleSpinner.fail("Failed to add submodule")
          console.log(chalk.yellow("  You can add it manually later:"))
          console.log(chalk.gray(`  git submodule add ${productRepo} product`))
        }
      } else if (productChoice === "create") {
        // Check if gh CLI is available
        try {
          execSync("gh --version", { stdio: "pipe" })

          const repoName = await p.text({
            message: "New repo name:",
            placeholder: projectName!.replace(/-gtm$/, ""),
            validate: (input: string) => {
              if (!input.trim()) {
                return "Please enter a repo name"
              }
              if (/\s/.test(input)) {
                return "Repo names cannot contain spaces. Use hyphens instead (e.g., 'my-project')"
              }
              if (!/^[a-zA-Z0-9._-]+$/.test(input)) {
                return "Repo names can only contain letters, numbers, hyphens, underscores, and dots"
              }
            },
          })

          if (p.isCancel(repoName)) {
            p.cancel("Setup cancelled.")
            process.exit(0)
          }

          const visibility = await p.select({
            message: "Visibility:",
            options: [
              { label: "Private", value: "private" },
              { label: "Public", value: "public" },
            ],
          })

          if (p.isCancel(visibility)) {
            p.cancel("Setup cancelled.")
            process.exit(0)
          }

          const createSpinner = ora("Creating product repo...").start()
          try {
            // Create the repo on GitHub
            const visFlag = visibility === "private" ? "--private" : "--public"
            const finalRepoName = (repoName as string).trim().replace(/\s+/g, '-')

            try {
              execSync(`gh repo create ${finalRepoName} ${visFlag} --clone`, {
                cwd: projectPath,
                stdio: "pipe",
                encoding: "utf-8",
              })
            } catch (createErr: any) {
              // Show the actual error from gh CLI
              createSpinner.fail("Failed to create repo")
              console.log("")

              const errorMsg = createErr.stderr || createErr.message || String(createErr)

              // Check if it's an authentication issue
              if (errorMsg.includes("authentication") || errorMsg.includes("not logged in") || errorMsg.includes("HTTP 401")) {
                console.log(chalk.red("GitHub authentication required"))
                console.log("")
                p.log.info("Authenticate with GitHub:")
                p.log.info("  gh auth login")
                console.log("")
                p.log.info("Then try again or add the repo manually:")
                p.log.info(`  gh repo create ${finalRepoName} ${visFlag}`)
              } else {
                console.log(chalk.red("Error from GitHub CLI:"))
                console.log(chalk.gray(errorMsg))
                console.log("")
                p.log.info(`Try manually: gh repo create ${finalRepoName} ${visFlag}`)
              }
              throw createErr
            }

            // Get the repo URL
            const repoUrl = execSync(`gh repo view ${finalRepoName} --json url -q .url`, {
              cwd: projectPath,
              encoding: "utf-8",
            }).trim()

            // Move the cloned repo to product/ and set up as submodule
            execSync(`mv ${finalRepoName} product`, { cwd: projectPath, stdio: "pipe" })
            execSync(`git submodule add ${repoUrl} product`, { cwd: projectPath, stdio: "pipe" })

            createSpinner.succeed(`Product repo created: ${repoUrl}`)
            productRepo = repoUrl
            productPath = "product/"
          } catch (err: any) {
            // Already handled above
          }
        } catch {
          p.log.warning("GitHub CLI (gh) not found. Install it to create repos:")
          p.log.info("brew install gh && gh auth login")
          p.log.info("\nOr create the repo manually and add as submodule:")
          p.log.info("git submodule add <repo-url> product")
        }
      } else {
        p.log.info("Add your product repo later:")
        p.log.info("git submodule add <repo-url> product")
      }
    }

    // Update .jfl/config.json
    const configDir = join(projectPath, ".jfl")
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }

    const configPath = join(configDir, "config.json")
    const config: Record<string, any> = {
      name: projectName,
      type: "gtm",
      description: description,
    }

    // Save owner info if authenticated
    if (ownerGithub) {
      config.owner = {
        name: ownerName,
        github: ownerGithub,
      }
    } else if (ownerX402) {
      config.owner = {
        name: ownerName,
        x402: ownerX402,
      }
    }

    if (productRepo) {
      config.product_repo = productRepo
    }
    if (productPath) {
      config.product_path = productPath
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")

    // Update CLAUDE.md with owner info if authenticated
    const claudePath = join(projectPath, "CLAUDE.md")
    if (existsSync(claudePath) && (ownerGithub || ownerX402)) {
      let claudeContent = readFileSync(claudePath, "utf-8")

      if (ownerGithub) {
        claudeContent = claudeContent.replace("{your_name}", ownerName)
        claudeContent = claudeContent.replace("{your_github}", ownerGithub)
      } else if (ownerX402) {
        claudeContent = claudeContent.replace("{your_name}", ownerName)
        claudeContent = claudeContent.replace("{your_github}", `x402:${ownerX402}`)
      }

      writeFileSync(claudePath, claudeContent)
      p.log.success("Owner set in CLAUDE.md")
    }

    p.log.success("GTM config saved")

    // Initial commit
    try {
      execSync(`git add .`, { cwd: projectPath, stdio: "pipe" })
      execSync(`git commit -m "Initialize JFL GTM workspace"`, { cwd: projectPath, stdio: "pipe" })
      p.log.success("Initial commit created")
    } catch {
      // Ignore commit errors
    }

    // Offer semantic search setup
    p.note(
      chalk.gray(
        "Search your workspace by meaning, not just keywords.\n" +
        "Requires qmd (local search engine) + ~1.5GB for models."
      ),
      chalk.hex("#FFA500")("📚 Semantic Search")
    )

    const enableSearch = await p.confirm({
      message: "Enable semantic search?",
      initialValue: true,
    })

    if (p.isCancel(enableSearch)) {
      p.cancel("Setup cancelled.")
      process.exit(0)
    }

    if (enableSearch) {
      // Check if qmd is installed
      let qmdInstalled = false
      try {
        execSync("which qmd", { stdio: "pipe" })
        qmdInstalled = true
      } catch {
        // qmd not installed
      }

      if (!qmdInstalled) {
        // Check if bun is installed
        let bunInstalled = false
        try {
          execSync("which bun", { stdio: "pipe" })
          bunInstalled = true
        } catch {
          // bun not installed
        }

        if (bunInstalled) {
          const installQmd = await p.confirm({
            message: "qmd not found. Install it now?",
            initialValue: true,
          })

          if (p.isCancel(installQmd)) {
            p.cancel("Setup cancelled.")
            process.exit(0)
          }

          if (installQmd) {
            const qmdSpinner = ora("Installing qmd...").start()
            try {
              execSync("bun install -g https://github.com/tobi/qmd", { stdio: "pipe" })
              qmdSpinner.succeed("qmd installed!")
              qmdInstalled = true
            } catch {
              qmdSpinner.fail("Failed to install qmd")
              console.log(chalk.yellow("  Install manually: bun install -g https://github.com/tobi/qmd"))
            }
          }
        } else {
          console.log(chalk.yellow("  qmd requires bun. Install bun first:"))
          console.log(chalk.gray("  curl -fsSL https://bun.sh/install | bash"))
          console.log(chalk.gray("  Then: bun install -g https://github.com/tobi/qmd"))
        }
      }

      if (qmdInstalled) {
        const searchSpinner = ora("Setting up search index...").start()
        try {
          // Add collection
          execSync(`qmd collection add . --name ${projectName}`, { cwd: projectPath, stdio: "pipe" })

          // Add context
          execSync(`qmd context add qmd://${projectName} "GTM workspace: vision, strategy, content, decisions"`, {
            cwd: projectPath,
            stdio: "pipe"
          })
          execSync(`qmd context add qmd://${projectName}/knowledge "Strategic docs: vision, thesis, roadmap, brand"`, {
            cwd: projectPath,
            stdio: "pipe"
          })
          execSync(`qmd context add qmd://${projectName}/content "Marketing content: articles, threads, posts"`, {
            cwd: projectPath,
            stdio: "pipe"
          })

          searchSpinner.text = "Generating embeddings (first time downloads ~1.5GB of models)..."
          execSync(`qmd embed`, { cwd: projectPath, stdio: "pipe" })

          searchSpinner.succeed("Search index ready!")

          // Save to config
          config.search = {
            enabled: true,
            collection: projectName,
          }
          writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")

        } catch (err: any) {
          searchSpinner.fail("Search setup failed")
          console.log(chalk.yellow("  Set up manually later:"))
          console.log(chalk.gray(`  qmd collection add . --name ${projectName}`))
          console.log(chalk.gray(`  qmd context add qmd://${projectName} "GTM workspace"`))
          console.log(chalk.gray("  qmd embed"))
        }
      }
    } else {
      console.log(chalk.gray("  Enable later with /search in Claude Code"))
    }

    // Success message
    p.note(
      chalk.gray(
        `${projectName}/\n` +
        "├── .claude/skills/ ← JFL skills\n" +
        "├── .jfl/           ← Project config\n" +
        "├── knowledge/      ← Strategy & context\n" +
        "├── content/        ← Marketing content\n" +
        "├── suggestions/    ← Contributor work\n" +
        "├── previews/       ← Generated assets\n" +
        "├── templates/      ← Doc templates\n" +
        "├── CLAUDE.md       ← AI instructions\n" +
        "└── product/        ← Your code (add as submodule)"
      ),
      chalk.hex("#00FF88")("✅ GTM workspace initialized!")
    )

    // Ask about launching Claude Code
    const launchClaude = await p.confirm({
      message: "Start Claude Code now?",
      initialValue: true,
    })

    if (p.isCancel(launchClaude)) {
      p.cancel("Setup cancelled.")
      process.exit(0)
    }

    let dangerMode = false
    if (launchClaude) {
      const dangerouslySkip = await p.confirm({
        message: "Skip permission prompts? (dangerously-skip-permissions)",
        initialValue: true,
      })

      if (p.isCancel(dangerouslySkip)) {
        p.cancel("Setup cancelled.")
        process.exit(0)
      }

      dangerMode = dangerouslySkip
    }

    if (launchClaude) {
      p.log.info(chalk.hex("#FFA500")("🚀 Launching Claude Code..."))

      // Build the command args
      const claudeArgs: string[] = []
      if (dangerMode) {
        claudeArgs.push("--dangerously-skip-permissions")
      }

      // Spawn claude in the project directory
      const claude = spawn("claude", claudeArgs, {
        cwd: projectPath,
        stdio: "inherit",
        shell: true,
      })

      claude.on("error", (err) => {
        p.log.error("Failed to launch Claude Code")
        p.log.info("Make sure claude is installed: npm install -g @anthropic-ai/claude-code")
        p.log.info(`Then: cd ${projectName} && claude`)
      })

      // Don't exit - let claude take over
      return
    }

    // If not launching, show manual instructions
    let nextSteps = `cd ${projectName}\n\nThen:`
    if (!productRepo) {
      nextSteps += "\n  git submodule add <your-product-repo> product"
    }
    nextSteps += "\n  jfl status           # Check status"
    nextSteps += "\n  claude               # Start Claude Code"
    nextSteps += "\n\nIn Claude Code:"
    nextSteps += "\n  /hud                 # See dashboard"
    nextSteps += "\n  /brand-architect     # Create brand"
    nextSteps += "\n  /content thread      # Write content"
    nextSteps += "\n\nUpdate GTM toolkit anytime:"
    nextSteps += "\n  jfl update           # Pull latest skills, CLAUDE.md"

    p.outro(chalk.hex("#FFA500")(nextSteps))

  } catch (error) {
    spinner.fail("Failed to create GTM workspace")
    p.log.error(String(error))
    p.outro(chalk.red("Setup failed"))
  }
}
