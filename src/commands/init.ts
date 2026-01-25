import chalk from "chalk"
import ora from "ora"
import inquirer from "inquirer"
import { execSync, spawn } from "child_process"
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { isAuthenticated, getUser, getAuthMethod, getX402Address } from "./login.js"

const TEMPLATE_REPO = "https://github.com/402goose/jfl-template.git"

export async function initCommand(options?: { name?: string }) {
  console.log(chalk.bold("\n🚀 JFL - Initialize GTM Workspace\n"))

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
    console.log(chalk.green(`✓ Authenticated as ${ownerName}`))
  } else {
    console.log(chalk.yellow("Not authenticated. You can still create a workspace,"))
    console.log(chalk.yellow("but you'll need to run 'jfl login' to claim ownership.\n"))
  }

  // Get project name
  let projectName = options?.name
  if (!projectName) {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Project name:",
        default: "my-project-gtm",
        validate: (input: string) => {
          if (!/^[a-z0-9-]+$/.test(input)) {
            return "Use lowercase letters, numbers, and hyphens only"
          }
          return true
        },
      },
    ])
    projectName = answer.name
  }

  const projectPath = join(process.cwd(), projectName!)

  // Check if directory exists
  if (existsSync(projectPath)) {
    console.log(chalk.red(`\nDirectory ${projectName} already exists.`))
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
      const expectedDirs = [".claude/skills", "templates", "knowledge", "content", "suggestions", "previews", ".jfl"]
      const missingDirs = expectedDirs.filter(dir => !existsSync(join(projectPath, dir)))

      if (missingDirs.length > 0) {
        throw new Error(`Template copy incomplete. Missing: ${missingDirs.join(", ")}`)
      }
    } else {
      throw new Error("Template folder not found in repository")
    }

    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true })

    // Initialize new git repo
    execSync(`git init`, { cwd: projectPath, stdio: "pipe" })

    spinner.succeed("GTM workspace created!")

    // Explain the architecture
    console.log(chalk.cyan("\n📋 JFL Architecture\n"))
    console.log(chalk.gray("  A GTM workspace is a context layer for building/launching."))
    console.log(chalk.gray("  Product code lives in its own repo, linked as a submodule.\n"))

    // Ask about project setup
    const projectSetup = await inquirer.prompt([
      {
        type: "list",
        name: "setup",
        message: "What's your setup?",
        choices: [
          { name: "Building a product (I have or need a product repo)", value: "building-product" },
          { name: "GTM only (team handles code, I do content/marketing)", value: "gtm-only" },
          { name: "Contributor (working on specific tasks)", value: "contributor" },
        ],
      },
      {
        type: "input",
        name: "description",
        message: "One-line description:",
        default: "My project",
      },
    ])

    let productRepo = null
    let productPath = null

    // If building product, handle the product repo
    if (projectSetup.setup === "building-product") {
      const productChoice = await inquirer.prompt([
        {
          type: "list",
          name: "choice",
          message: "Product repo:",
          choices: [
            { name: "I have an existing repo (add as submodule)", value: "existing" },
            { name: "Create a new repo for me", value: "create" },
            { name: "I'll add it later", value: "later" },
          ],
        },
      ])

      if (productChoice.choice === "existing") {
        const repoAnswer = await inquirer.prompt([
          {
            type: "input",
            name: "productRepo",
            message: "Product repo URL:",
            validate: (input: string) => {
              if (!input.trim()) {
                return "Please enter a repo URL"
              }
              return true
            },
          },
        ])
        productRepo = repoAnswer.productRepo

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
      } else if (productChoice.choice === "create") {
        // Check if gh CLI is available
        try {
          execSync("gh --version", { stdio: "pipe" })

          const repoDetails = await inquirer.prompt([
            {
              type: "input",
              name: "repoName",
              message: "New repo name:",
              default: projectName!.replace(/-gtm$/, ""),
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
                return true
              },
              filter: (input: string) => {
                // Auto-convert spaces to hyphens as a convenience
                return input.trim().replace(/\s+/g, '-')
              },
            },
            {
              type: "list",
              name: "visibility",
              message: "Visibility:",
              choices: [
                { name: "Private", value: "private" },
                { name: "Public", value: "public" },
              ],
            },
          ])

          const createSpinner = ora("Creating product repo...").start()
          try {
            // Create the repo on GitHub
            const visFlag = repoDetails.visibility === "private" ? "--private" : "--public"
            execSync(`gh repo create ${repoDetails.repoName} ${visFlag} --clone`, {
              cwd: projectPath,
              stdio: "pipe",
            })

            // Get the repo URL
            const repoUrl = execSync(`gh repo view ${repoDetails.repoName} --json url -q .url`, {
              cwd: projectPath,
              encoding: "utf-8",
            }).trim()

            // Move the cloned repo to product/ and set up as submodule
            execSync(`mv ${repoDetails.repoName} product`, { cwd: projectPath, stdio: "pipe" })
            execSync(`git submodule add ${repoUrl} product`, { cwd: projectPath, stdio: "pipe" })

            createSpinner.succeed(`Product repo created: ${repoUrl}`)
            productRepo = repoUrl
            productPath = "product/"
          } catch (err: any) {
            createSpinner.fail("Failed to create repo")
            console.log(chalk.yellow("  You can create it manually:"))
            console.log(chalk.gray(`  gh repo create ${repoDetails.repoName} --private`))
          }
        } catch {
          console.log(chalk.yellow("\n  GitHub CLI (gh) not found. Install it to create repos:"))
          console.log(chalk.gray("  brew install gh && gh auth login"))
          console.log(chalk.gray("\n  Or create the repo manually and add as submodule:"))
          console.log(chalk.gray("  git submodule add <repo-url> product"))
        }
      } else {
        console.log(chalk.gray("\n  Add your product repo later:"))
        console.log(chalk.gray("  git submodule add <repo-url> product"))
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
      setup: projectSetup.setup,
      description: projectSetup.description,
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
      console.log(chalk.green("\n✓ Owner set in CLAUDE.md"))
    }

    console.log(chalk.green("✓ GTM config saved"))

    // Initial commit
    try {
      execSync(`git add .`, { cwd: projectPath, stdio: "pipe" })
      execSync(`git commit -m "Initialize JFL GTM workspace"`, { cwd: projectPath, stdio: "pipe" })
      console.log(chalk.green("✓ Initial commit created"))
    } catch {
      // Ignore commit errors
    }

    // Offer semantic search setup
    console.log(chalk.cyan("\n📚 Semantic Search\n"))
    console.log(chalk.gray("  Search your workspace by meaning, not just keywords."))
    console.log(chalk.gray("  Requires qmd (local search engine) + ~1.5GB for models.\n"))

    const searchSetup = await inquirer.prompt([
      {
        type: "confirm",
        name: "enableSearch",
        message: "Enable semantic search?",
        default: true,
      },
    ])

    if (searchSetup.enableSearch) {
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
          const installQmd = await inquirer.prompt([
            {
              type: "confirm",
              name: "install",
              message: "qmd not found. Install it now?",
              default: true,
            },
          ])

          if (installQmd.install) {
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
    console.log(chalk.bold.green("\n✅ GTM workspace initialized!\n"))

    console.log(chalk.gray("Structure:"))
    console.log(chalk.gray(`  ${projectName}/`))
    console.log(chalk.gray("  ├── .claude/skills/ ← JFL skills"))
    console.log(chalk.gray("  ├── .jfl/           ← Project config"))
    console.log(chalk.gray("  ├── knowledge/      ← Strategy & context"))
    console.log(chalk.gray("  ├── content/        ← Marketing content"))
    console.log(chalk.gray("  ├── suggestions/    ← Contributor work"))
    console.log(chalk.gray("  ├── previews/       ← Generated assets"))
    console.log(chalk.gray("  ├── templates/      ← Doc templates"))
    console.log(chalk.gray("  ├── CLAUDE.md       ← AI instructions"))
    console.log(chalk.gray("  └── product/        ← Your code (add as submodule)"))
    console.log()

    // Ask about launching Claude Code
    const launchOptions = await inquirer.prompt([
      {
        type: "confirm",
        name: "launchClaude",
        message: "Start Claude Code now?",
        default: true,
      },
    ])

    let dangerMode = false
    if (launchOptions.launchClaude) {
      const dangerOptions = await inquirer.prompt([
        {
          type: "confirm",
          name: "dangerouslySkip",
          message: "Skip permission prompts? (dangerously-skip-permissions)",
          default: true,
        },
      ])
      dangerMode = dangerOptions.dangerouslySkip
    }

    if (launchOptions.launchClaude) {
      console.log(chalk.cyan("\n🚀 Launching Claude Code...\n"))

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
        console.log(chalk.red("\n❌ Failed to launch Claude Code"))
        console.log(chalk.gray("  Make sure claude is installed: npm install -g @anthropic-ai/claude-code"))
        console.log(chalk.gray(`\n  Then: cd ${projectName} && claude`))
      })

      // Don't exit - let claude take over
      return
    }

    // If not launching, show manual instructions
    console.log(chalk.bgCyan.black.bold(" 👉 NEXT: Enter your project "))
    console.log()
    console.log(chalk.cyan.bold(`   cd ${projectName}`))
    console.log()

    console.log(chalk.gray("Then:"))
    if (projectSetup.setup === "building-product" && !productRepo) {
      console.log("  git submodule add <your-product-repo> product")
    }
    console.log("  jfl status           # Check status")
    console.log("  claude               # Start Claude Code")
    console.log()
    console.log(chalk.gray("In Claude Code:"))
    console.log("  /hud                 # See dashboard")
    console.log("  /brand-architect     # Create brand")
    console.log("  /content thread      # Write content")
    console.log()
    console.log(chalk.cyan("Update GTM toolkit anytime:"))
    console.log("  jfl update           # Pull latest skills, CLAUDE.md")
    console.log()
  } catch (error) {
    spinner.fail("Failed to create GTM workspace")
    console.error(chalk.red(error))
  }
}
