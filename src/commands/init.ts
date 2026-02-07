import chalk from "chalk"
import ora from "ora"
import inquirer from "inquirer"
import * as p from "@clack/prompts"
import { execSync, spawn } from "child_process"
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir, homedir } from "os"
import { isAuthenticated, getUser, getAuthMethod, getX402Address } from "./login.js"
import { extractServiceMetadata } from "../lib/service-detector.js"
import { generateAgentDefinition, writeAgentDefinition } from "../lib/agent-generator.js"
import { writeSkillFiles } from "../lib/skill-generator.js"
import { getProfile } from "./profile.js"
import { generateClaudeMdFromProfile } from "../utils/claude-md-generator.js"
import { validateSettings, fixSettings } from "../utils/settings-validator.js"

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

      // Verify we got the core template structure
      const requiredDirs = [".claude/skills", "templates", ".jfl"]
      const missingRequired = requiredDirs.filter(dir => !existsSync(join(projectPath, dir)))

      if (missingRequired.length > 0) {
        throw new Error(`Template copy incomplete. Missing required: ${missingRequired.join(", ")}`)
      }

      // Create workspace directories if they don't exist
      const workspaceDirs = ["knowledge", "content", "suggestions", "previews", "scripts/session"]
      for (const dir of workspaceDirs) {
        const dirPath = join(projectPath, dir)
        if (!existsSync(dirPath)) {
          mkdirSync(dirPath, { recursive: true })
        }
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

    // Validate and fix .claude/settings.json
    const settingsPath = join(projectPath, ".claude", "settings.json")
    if (existsSync(settingsPath)) {
      const validationSpinner = ora("Validating .claude/settings.json...").start()
      try {
        const settingsContent = readFileSync(settingsPath, "utf-8")
        const settings = JSON.parse(settingsContent)
        const errors = validateSettings(settings)

        if (errors.length > 0) {
          const fixed = fixSettings(settings)
          writeFileSync(settingsPath, JSON.stringify(fixed, null, 2) + "\n")
          validationSpinner.succeed("Settings.json auto-fixed")
        } else {
          validationSpinner.succeed("Settings.json valid")
        }
      } catch (err) {
        validationSpinner.warn("Could not validate settings.json")
      }
    }

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

          let repoCreated = false
          let attemptCount = 0
          const maxAttempts = 3

          while (!repoCreated && attemptCount < maxAttempts) {
            attemptCount++

            const repoName = await p.text({
              message: attemptCount > 1 ? "Try a different name:" : "New repo name:",
              placeholder: attemptCount > 1
                ? `${projectName!.replace(/-gtm$/, "")}-${attemptCount}`
                : projectName!.replace(/-gtm$/, ""),
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
                repoCreated = true

              } catch (createErr: any) {
                // Show the actual error from gh CLI
                createSpinner.fail("Failed to create repo")
                console.log("")

                const errorMsg = createErr.stderr || createErr.message || String(createErr)

                // Check if it's a "name already exists" error
                if (errorMsg.includes("already exists") || errorMsg.includes("Name already exists")) {
                  console.log(chalk.yellow("⚠️  That name is already taken on your GitHub"))
                  console.log("")

                  if (attemptCount < maxAttempts) {
                    const retry = await p.confirm({
                      message: "Try a different name?",
                      initialValue: true,
                    })

                    if (p.isCancel(retry) || !retry) {
                      p.log.info("Skipping repo creation. Add it later with:")
                      p.log.info("  git submodule add <repo-url> product")
                      break
                    }
                    // Loop will continue with attemptCount++
                  } else {
                    p.log.warning("Max attempts reached. Add repo manually later:")
                    p.log.info("  git submodule add <repo-url> product")
                    break
                  }
                } else if (errorMsg.includes("authentication") || errorMsg.includes("not logged in") || errorMsg.includes("HTTP 401")) {
                  // Check if it's an authentication issue
                  console.log(chalk.red("GitHub authentication required"))
                  console.log("")
                  p.log.info("Authenticate with GitHub:")
                  p.log.info("  gh auth login")
                  console.log("")
                  p.log.info("Then try again or add the repo manually:")
                  p.log.info(`  gh repo create ${finalRepoName} ${visFlag}`)
                  break
                } else {
                  // Other error
                  console.log(chalk.red("Error from GitHub CLI:"))
                  console.log(chalk.gray(errorMsg))
                  console.log("")
                  p.log.info(`Try manually: gh repo create ${finalRepoName} ${visFlag}`)
                  break
                }
              }
            } catch (err: any) {
              // Break out of retry loop on unexpected errors
              break
            }
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

    // Generate or update CLAUDE.md
    const claudePath = join(projectPath, "CLAUDE.md")
    const profile = getProfile()

    if (profile) {
      // Generate CLAUDE.md from profile
      const projectDescription = `GTM workspace for ${projectName}`
      const claudeContent = generateClaudeMdFromProfile(profile, {
        name: projectName,
        description: projectDescription
      })
      writeFileSync(claudePath, claudeContent)
      p.log.success("CLAUDE.md generated from your profile")
    } else if (existsSync(claudePath) && (ownerGithub || ownerX402)) {
      // Fall back to template replacement
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
      p.log.info("Tip: Set up your profile with 'jfl profile' for better customization")
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

    // Offer service onboarding
    p.note(
      "Set up service agents for your repos (API, web app, etc.).\n" +
      "Each service gets its own agent that you can invoke via @-mentions.",
      chalk.hex("#FFA500")("🤖 Service Agents")
    )

    const onboardServices = await p.confirm({
      message: "Onboard services now?",
      initialValue: true,
    })

    if (p.isCancel(onboardServices)) {
      p.cancel("Setup cancelled.")
      process.exit(0)
    }

    const onboardedServices: string[] = []
    let serviceCount = 0

    if (onboardServices) {
      let addingServices = true

      while (addingServices) {
        const servicePath = await p.text({
          message: onboardedServices.length === 0
            ? "Service path or git URL:"
            : "Add another service (or press Enter to skip):",
          placeholder: onboardedServices.length === 0
            ? "/path/to/service or git@github.com:user/repo.git"
            : "Press Enter to continue",
          validate: (input: string) => {
            if (onboardedServices.length === 0 && !input.trim()) {
              return "Please enter a service path or URL"
            }
          },
        })

        if (p.isCancel(servicePath)) {
          p.cancel("Setup cancelled.")
          process.exit(0)
        }

        // If empty and not first service, user is done adding services
        if (!servicePath || (servicePath as string).trim() === "") {
          addingServices = false
          break
        }

        serviceCount++
        const servicePathStr = servicePath as string

        try {
          console.log(chalk.cyan(`\n━━━ Service ${serviceCount} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`))

          // Determine if path or URL
          const isGitURL =
            servicePathStr.startsWith("git@") ||
            servicePathStr.startsWith("https://") ||
            servicePathStr.startsWith("http://")

          let resolvedPath = servicePathStr

          // Clone if git URL
          if (isGitURL) {
            const spinner = ora(`[1/4] Cloning repository...`).start()
            try {
              // Extract repo name
              const match = servicePathStr.match(/\/([^\/]+?)(\.git)?$/)
              if (!match) {
                spinner.fail("Invalid git URL")
                continue
              }

              const repoName = match[1]
              const cloneDir = join(homedir(), "code/formation")

              // Check if already exists
              const repoPath = join(cloneDir, repoName)
              if (existsSync(repoPath)) {
                spinner.succeed(`[1/4] Using existing repo at ${repoPath}`)
                execSync("git pull", { cwd: repoPath, stdio: "pipe" })
              } else {
                // Clone
                execSync(`git clone ${servicePathStr} ${repoPath}`, { stdio: "pipe" })
                spinner.succeed(`[1/4] Cloned to ${repoPath}`)
              }

              resolvedPath = repoPath
            } catch (err: any) {
              spinner.fail("Failed to clone")
              console.log(chalk.gray(`  ${err.message}`))
              continue
            }
          } else {
            // Local path - resolve and check exists
            resolvedPath = join(process.cwd(), servicePathStr)
            if (!existsSync(resolvedPath)) {
              console.log(chalk.red(`  Path does not exist: ${resolvedPath}`))
              continue
            }
          }

          // Auto-detect metadata
          const stepNum = isGitURL ? 2 : 1
          const totalSteps = 4
          const spinner = ora(`[${stepNum}/${totalSteps}] Detecting service metadata...`).start()
          let metadata
          try {
            metadata = extractServiceMetadata(resolvedPath)
            spinner.succeed(`[${stepNum}/${totalSteps}] Detected: ${chalk.cyan(metadata.name)} (${chalk.gray(metadata.type)})`)
          } catch (err: any) {
            spinner.fail("Failed to detect metadata")
            console.log(chalk.gray(`  ${err.message}`))
            continue
          }

          // Run onboard script
          const onboardStepNum = isGitURL ? 3 : 2
          const onboardSpinner = ora(`[${onboardStepNum}/${totalSteps}] Setting up agent infrastructure...`).start()
          try {
            const scriptPath = join(projectPath, "scripts/services/onboard-service.sh")

            if (!existsSync(scriptPath)) {
              onboardSpinner.fail(`[${onboardStepNum}/${totalSteps}] Onboard script not found`)
              console.log(chalk.yellow("  Skipping - install services system first"))
              continue
            }

            // Run onboard-service.sh
            onboardSpinner.text = `[${onboardStepNum}/${totalSteps}] Creating service infrastructure...`
            execSync(
              `bash "${scriptPath}" "${resolvedPath}" "${metadata.name}" "${metadata.type}" "${metadata.description}"`,
              {
                cwd: projectPath,
                stdio: "pipe",
              }
            )

            // Generate agent definition
            const agentStepNum = isGitURL ? 4 : 3
            onboardSpinner.text = `[${agentStepNum}/${totalSteps}] Generating agent definition...`
            const agentDef = generateAgentDefinition(metadata, resolvedPath, projectPath)
            writeAgentDefinition(agentDef, projectPath)

            // Generate skill wrapper
            onboardSpinner.text = `[${agentStepNum}/${totalSteps}] Generating skill wrapper...`
            writeSkillFiles(metadata, resolvedPath, projectPath)

            // Update manifests
            const manifestStepNum = isGitURL ? 4 : 3
            onboardSpinner.text = `[${manifestStepNum}/${totalSteps}] Updating GTM manifests...`

            // Update services.json
            const servicesFile = join(projectPath, ".jfl/services.json")
            if (existsSync(servicesFile)) {
              const services = JSON.parse(readFileSync(servicesFile, "utf-8"))

              services[metadata.name] = {
                name: metadata.name.charAt(0).toUpperCase() + metadata.name.slice(1),
                type: metadata.type === "web" || metadata.type === "api" ? "process" : metadata.type,
                description: metadata.description,
                path: resolvedPath,
              }

              if (metadata.port) {
                services[metadata.name].port = metadata.port
                services[metadata.name].detection = `lsof -i :${metadata.port} | grep LISTEN`
              }

              if (metadata.commands) {
                services[metadata.name].commands = {}
                if (metadata.commands.start) services[metadata.name].commands.start = metadata.commands.start
                if (metadata.commands.stop) services[metadata.name].commands.stop = metadata.commands.stop
                if (metadata.commands.logs) services[metadata.name].commands.logs = metadata.commands.logs
              }

              if (metadata.healthcheck) {
                services[metadata.name].healthcheck = metadata.healthcheck
              }

              writeFileSync(servicesFile, JSON.stringify(services, null, 2) + "\n")
            }

            // Update projects.manifest.json
            const manifestFile = join(projectPath, ".jfl/projects.manifest.json")
            if (existsSync(manifestFile)) {
              const manifest = JSON.parse(readFileSync(manifestFile, "utf-8"))

              if (!manifest.projects) {
                manifest.projects = {}
              }

              manifest.projects[metadata.name] = {
                type: "service",
                service_type: metadata.type,
                location: resolvedPath,
                description: metadata.description,
                agent_enabled: true,
              }

              writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n")
            }

            onboardSpinner.succeed(
              `[${totalSteps}/${totalSteps}] ${chalk.green("✓")} Service agent ready: ${chalk.cyan("@" + metadata.name)}`
            )
            onboardedServices.push(metadata.name)
            console.log()
          } catch (err: any) {
            onboardSpinner.fail("Failed to onboard service")
            console.log(chalk.gray(`  ${err.message}`))
            continue
          }
        } catch (err: any) {
          console.log(chalk.red(`  Error: ${err.message}`))
        }
      }

      if (onboardedServices.length > 0) {
        console.log(chalk.cyan("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"))
        p.log.success(`${chalk.bold(onboardedServices.length)} service agent${onboardedServices.length > 1 ? "s" : ""} ready!`)
        console.log()
        onboardedServices.forEach((name) => {
          console.log(chalk.green("  ✓") + chalk.cyan(` @${name}`) + chalk.gray(` - invoke via @-mention or /${name}`))
        })
        console.log()

        // Commit the service onboarding
        try {
          execSync(`git add .`, { cwd: projectPath, stdio: "pipe" })
          execSync(`git commit -m "Onboard services: ${onboardedServices.join(", ")}"`, {
            cwd: projectPath,
            stdio: "pipe"
          })
        } catch {
          // Ignore commit errors
        }
      } else {
        p.log.info("No services onboarded. Add them later with: jfl onboard <path|url>")
      }
    } else {
      p.log.info("Skip service onboarding. Add services later with: jfl onboard <path|url>")
    }

    // Offer semantic search setup
    p.note(
      "Search your workspace by meaning, not just keywords.\n" +
      "Requires qmd (local search engine) + ~1.5GB for models.",
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
    let successMessage =
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

    if (onboardedServices.length > 0) {
      successMessage += "\n\nService Agents Ready:\n"
      onboardedServices.forEach((name) => {
        successMessage += `  • @${name} - invoke via @-mention or /${name}\n`
      })
    }

    p.note(successMessage, chalk.hex("#00FF88")("✅ GTM workspace initialized!"))

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

    if (onboardedServices.length > 0) {
      nextSteps += "\n\nService Agents:"
      onboardedServices.forEach((name) => {
        nextSteps += `\n  @${name}             # Invoke service agent`
        nextSteps += `\n  /${name} status      # Check service status`
      })
      nextSteps += "\n"
    }

    nextSteps += "\n  /brand-architect     # Create brand"
    nextSteps += "\n  /content thread      # Write content"

    if (onboardedServices.length === 0) {
      nextSteps += "\n\nAdd services anytime:"
      nextSteps += "\n  jfl onboard <path>   # Onboard service agent"
    }

    nextSteps += "\n\nUpdate GTM toolkit anytime:"
    nextSteps += "\n  jfl update           # Pull latest skills, CLAUDE.md"

    p.outro(chalk.hex("#FFA500")(nextSteps))

  } catch (error) {
    spinner.fail("Failed to create GTM workspace")
    p.log.error(String(error))
    p.outro(chalk.red("Setup failed"))
  }
}
