import chalk from "chalk"
import * as p from "@clack/prompts"
import { existsSync, readFileSync, writeFileSync } from "fs"
import Anthropic from "@anthropic-ai/sdk"
import { getConfig, setConfig, getConfigValue } from "../utils/jfl-config.js"

// Profile schema
export interface ProfileData {
  style?: {
    precision?: "direct" | "detailed" | "conversational"
    jargon?: "technical" | "mixed" | "plain"
    comments?: "never" | "when-asked" | "always"
    documentation?: "critical" | "important" | "standard"
  }
  languages?: {
    primary?: string[]
    comfortable?: string[]
  }
  frontend?: {
    framework?: string
    styling?: string[]
    hosting?: string
  }
  backend?: {
    databases?: string[]
    preferences?: string[]
  }
  infrastructure?: {
    primary?: string
    tools?: string[]
    cicd?: string
  }
  design?: {
    taste?: "strong" | "moderate" | "flexible"
    preferences?: string[]
  }
  git?: {
    branches?: {
      rc?: string
      stable?: string
    }
    releaseNotes?: boolean
  }
  custom?: {
    [key: string]: string
  }
}

export async function profileCommand(action?: string, options?: { file?: string; generate?: boolean }) {
  switch (action) {
    case "show":
      return showProfile()
    case "edit":
      return editProfile()
    case "export":
      return exportProfile(options?.file)
    case "import":
      return importProfile(options?.file)
    case "generate":
      return generateClaudeMd(options?.file)
    default:
      return setProfile()
  }
}

async function showProfile() {
  const profile = getConfigValue("profile") as ProfileData | undefined

  if (!profile) {
    console.log(chalk.yellow("\n⚠️  No profile set"))
    console.log(chalk.gray("   Run: jfl profile\n"))
    return
  }

  console.log(chalk.bold("\n👤 Your JFL Profile\n"))

  if (profile.style) {
    console.log(chalk.cyan("Style & Communication:"))
    console.log(chalk.gray(`  Precision: ${profile.style.precision || "not set"}`))
    console.log(chalk.gray(`  Jargon: ${profile.style.jargon || "not set"}`))
    console.log(chalk.gray(`  Comments: ${profile.style.comments || "not set"}`))
    console.log(chalk.gray(`  Documentation: ${profile.style.documentation || "not set"}`))
    console.log()
  }

  if (profile.languages?.primary) {
    console.log(chalk.cyan("Languages:"))
    console.log(chalk.gray(`  ${profile.languages.primary.join(", ")}`))
    console.log()
  }

  if (profile.frontend) {
    console.log(chalk.cyan("Frontend:"))
    if (profile.frontend.framework) console.log(chalk.gray(`  Framework: ${profile.frontend.framework}`))
    if (profile.frontend.styling) console.log(chalk.gray(`  Styling: ${profile.frontend.styling.join(", ")}`))
    if (profile.frontend.hosting) console.log(chalk.gray(`  Hosting: ${profile.frontend.hosting}`))
    console.log()
  }

  if (profile.backend) {
    console.log(chalk.cyan("Backend:"))
    if (profile.backend.databases) console.log(chalk.gray(`  Databases: ${profile.backend.databases.join(", ")}`))
    if (profile.backend.preferences) console.log(chalk.gray(`  Preferences: ${profile.backend.preferences.join(", ")}`))
    console.log()
  }

  if (profile.infrastructure) {
    console.log(chalk.cyan("Infrastructure:"))
    if (profile.infrastructure.primary) console.log(chalk.gray(`  Primary: ${profile.infrastructure.primary}`))
    if (profile.infrastructure.tools) console.log(chalk.gray(`  Tools: ${profile.infrastructure.tools.join(", ")}`))
    if (profile.infrastructure.cicd) console.log(chalk.gray(`  CI/CD: ${profile.infrastructure.cicd}`))
    console.log()
  }

  if (profile.git) {
    console.log(chalk.cyan("Git Workflow:"))
    if (profile.git.branches) {
      console.log(chalk.gray(`  RC branch: ${profile.git.branches.rc || "dev"}`))
      console.log(chalk.gray(`  Stable branch: ${profile.git.branches.stable || "main"}`))
    }
    if (profile.git.releaseNotes !== undefined) {
      console.log(chalk.gray(`  Release notes: ${profile.git.releaseNotes ? "yes" : "no"}`))
    }
    console.log()
  }

  console.log(chalk.gray("Run: jfl profile edit    # Update profile"))
  console.log()
}

async function setProfile() {
  p.intro(chalk.hex("#FFD700")("┌  Build Your JFL Profile"))

  p.log.step(chalk.gray("\nThis profile customizes how Claude works with you across all JFL projects.\n"))

  const profile: ProfileData = {}

  // ============================================================
  // Style & Communication
  // ============================================================
  p.log.step(chalk.yellow("Style & Communication"))

  const precision = await p.select({
    message: "How should Claude communicate?",
    options: [
      { value: "direct", label: "Direct & concise - get to the point" },
      { value: "detailed", label: "Detailed & thorough - explain everything" },
      { value: "conversational", label: "Conversational - natural back-and-forth" }
    ]
  })

  const jargon = await p.select({
    message: "Technical language preference?",
    options: [
      { value: "technical", label: "Use domain-appropriate jargon freely" },
      { value: "mixed", label: "Mix technical terms with explanations" },
      { value: "plain", label: "Plain language, avoid jargon" }
    ]
  })

  const comments = await p.select({
    message: "When should Claude add comments to code?",
    options: [
      { value: "never", label: "Never - code should be self-documenting", hint: "Recommended" },
      { value: "when-asked", label: "Only when I explicitly ask" },
      { value: "always", label: "Always add helpful comments" }
    ]
  })

  const documentation = await p.select({
    message: "Documentation importance?",
    options: [
      { value: "critical", label: "Critical - docs are a primary artifact" },
      { value: "important", label: "Important - keep docs updated" },
      { value: "standard", label: "Standard - docs when needed" }
    ]
  })

  if (p.isCancel(precision) || p.isCancel(jargon) || p.isCancel(comments) || p.isCancel(documentation)) {
    p.cancel("Profile setup cancelled")
    process.exit(0)
  }

  profile.style = {
    precision: precision as "direct" | "detailed" | "conversational",
    jargon: jargon as "technical" | "mixed" | "plain",
    comments: comments as "never" | "when-asked" | "always",
    documentation: documentation as "critical" | "important" | "standard"
  }

  // ============================================================
  // Languages
  // ============================================================
  p.log.step(chalk.yellow("\nLanguages & Stack"))

  const primaryLangs = await p.multiselect({
    message: "Primary languages?",
    options: [
      { value: "TypeScript", label: "TypeScript" },
      { value: "JavaScript", label: "JavaScript" },
      { value: "Python", label: "Python" },
      { value: "Rust", label: "Rust" },
      { value: "Go", label: "Go" },
      { value: "Java", label: "Java" },
      { value: "other", label: "Other (will prompt)" }
    ],
    required: true
  }) as string[]

  if (p.isCancel(primaryLangs)) {
    p.cancel("Profile setup cancelled")
    process.exit(0)
  }

  let allPrimaryLangs = [...primaryLangs]
  if (primaryLangs.includes("other")) {
    const otherLangs = await p.text({
      message: "Other languages (comma-separated):",
      placeholder: "C++, Ruby, Elixir"
    })
    if (typeof otherLangs === "string" && otherLangs.trim()) {
      allPrimaryLangs = allPrimaryLangs
        .filter(l => l !== "other")
        .concat(otherLangs.split(",").map(l => l.trim()))
    }
  }

  profile.languages = { primary: allPrimaryLangs }

  // ============================================================
  // Frontend (optional)
  // ============================================================
  const hasFrontend = await p.confirm({
    message: "Do you work on frontend?",
    initialValue: true
  })

  if (p.isCancel(hasFrontend)) {
    p.cancel("Profile setup cancelled")
    process.exit(0)
  }

  if (hasFrontend) {
    const framework = await p.select({
      message: "Primary frontend framework?",
      options: [
        { value: "react-nextjs", label: "React + Next.js" },
        { value: "react", label: "React (vanilla)" },
        { value: "vue", label: "Vue" },
        { value: "svelte", label: "Svelte" },
        { value: "solid", label: "Solid" },
        { value: "other", label: "Other" }
      ]
    })

    const styling = await p.multiselect({
      message: "Styling approach?",
      options: [
        { value: "tailwind", label: "TailwindCSS", hint: "Recommended" },
        { value: "css-modules", label: "CSS Modules" },
        { value: "styled-components", label: "Styled Components" },
        { value: "vanilla-css", label: "Vanilla CSS" }
      ]
    }) as string[]

    const hosting = await p.select({
      message: "Frontend hosting?",
      options: [
        { value: "vercel", label: "Vercel" },
        { value: "netlify", label: "Netlify" },
        { value: "cloudflare", label: "Cloudflare Pages" },
        { value: "fly", label: "Fly.io" },
        { value: "other", label: "Other" }
      ]
    })

    if (p.isCancel(framework) || p.isCancel(styling) || p.isCancel(hosting)) {
      p.cancel("Profile setup cancelled")
      process.exit(0)
    }

    profile.frontend = {
      framework: framework as string,
      styling,
      hosting: hosting as string
    }
  }

  // ============================================================
  // Backend (optional)
  // ============================================================
  const hasBackend = await p.confirm({
    message: "Do you work on backend?",
    initialValue: true
  })

  if (p.isCancel(hasBackend)) {
    p.cancel("Profile setup cancelled")
    process.exit(0)
  }

  if (hasBackend) {
    const databases = await p.multiselect({
      message: "Databases?",
      options: [
        { value: "postgresql", label: "PostgreSQL" },
        { value: "mysql", label: "MySQL" },
        { value: "mongodb", label: "MongoDB" },
        { value: "redis", label: "Redis" },
        { value: "sqlite", label: "SQLite" }
      ]
    }) as string[]

    const preferences = await p.multiselect({
      message: "Backend preferences?",
      options: [
        { value: "cost-conscious", label: "Cost-conscious (Fly > managed services)" },
        { value: "serverless", label: "Prefer serverless" },
        { value: "containers", label: "Prefer containers/VMs" }
      ]
    }) as string[]

    if (p.isCancel(databases) || p.isCancel(preferences)) {
      p.cancel("Profile setup cancelled")
      process.exit(0)
    }

    profile.backend = { databases, preferences }
  }

  // ============================================================
  // Infrastructure (optional)
  // ============================================================
  const hasInfra = await p.confirm({
    message: "Work with infrastructure?",
    initialValue: true
  })

  if (p.isCancel(hasInfra)) {
    p.cancel("Profile setup cancelled")
    process.exit(0)
  }

  if (hasInfra) {
    const primary = await p.select({
      message: "Primary platform?",
      options: [
        { value: "fly", label: "Fly.io" },
        { value: "aws", label: "AWS" },
        { value: "gcp", label: "Google Cloud" },
        { value: "kubernetes", label: "Kubernetes" },
        { value: "other", label: "Other" }
      ]
    })

    const tools = await p.multiselect({
      message: "Infrastructure tools?",
      options: [
        { value: "docker", label: "Docker" },
        { value: "docker-compose", label: "Docker Compose" },
        { value: "terraform", label: "Terraform" },
        { value: "ansible", label: "Ansible" }
      ]
    }) as string[]

    const cicd = await p.select({
      message: "CI/CD platform?",
      options: [
        { value: "github-actions", label: "GitHub Actions" },
        { value: "gitlab-ci", label: "GitLab CI" },
        { value: "circleci", label: "CircleCI" },
        { value: "other", label: "Other" }
      ]
    })

    if (p.isCancel(primary) || p.isCancel(tools) || p.isCancel(cicd)) {
      p.cancel("Profile setup cancelled")
      process.exit(0)
    }

    profile.infrastructure = {
      primary: primary as string,
      tools,
      cicd: cicd as string
    }
  }

  // ============================================================
  // Git Workflow
  // ============================================================
  p.log.step(chalk.yellow("\nGit Workflow"))

  const rcBranch = await p.text({
    message: "Release candidate branch?",
    placeholder: "dev, develop, staging",
    initialValue: "dev"
  })

  const stableBranch = await p.text({
    message: "Stable branch?",
    placeholder: "main, master",
    initialValue: "main"
  })

  const releaseNotes = await p.confirm({
    message: "Generate automated release notes?",
    initialValue: true
  })

  if (p.isCancel(rcBranch) || p.isCancel(stableBranch) || p.isCancel(releaseNotes)) {
    p.cancel("Profile setup cancelled")
    process.exit(0)
  }

  profile.git = {
    branches: {
      rc: rcBranch as string,
      stable: stableBranch as string
    },
    releaseNotes: releaseNotes as boolean
  }

  // Save profile
  setConfig("profile", profile)

  p.outro(chalk.green("✓ Profile saved! Used in all JFL projects."))
  console.log()
  console.log(chalk.gray("  View: jfl profile show"))
  console.log(chalk.gray("  Edit: jfl profile edit"))
  console.log()
}

async function editProfile() {
  const existing = getConfigValue("profile") as ProfileData | undefined

  if (!existing) {
    console.log(chalk.yellow("\n⚠️  No profile set. Running initial setup...\n"))
    return setProfile()
  }

  console.log(chalk.yellow("\n⚠️  Interactive edit not yet implemented"))
  console.log(chalk.gray("   Use: jfl profile export profile.json"))
  console.log(chalk.gray("   Edit the JSON file"))
  console.log(chalk.gray("   Use: jfl profile import profile.json\n"))
}

async function exportProfile(file?: string) {
  const profile = getConfigValue("profile") as ProfileData | undefined

  if (!profile) {
    console.log(chalk.yellow("\n⚠️  No profile set"))
    console.log(chalk.gray("   Run: jfl profile\n"))
    return
  }

  const outputFile = file || "jfl-profile.json"
  writeFileSync(outputFile, JSON.stringify(profile, null, 2))

  console.log(chalk.green(`\n✓ Profile exported to ${outputFile}\n`))
}

async function importProfile(file?: string) {
  if (!file) {
    console.log(chalk.red("\n❌ No file specified"))
    console.log(chalk.gray("   Usage: jfl profile import <file>\n"))
    return
  }

  if (!existsSync(file)) {
    console.log(chalk.red(`\n❌ File not found: ${file}\n`))
    return
  }

  try {
    const content = readFileSync(file, "utf-8")
    const profile = JSON.parse(content) as ProfileData

    setConfig("profile", profile)
    console.log(chalk.green("\n✓ Profile imported successfully\n"))
  } catch (err: any) {
    console.log(chalk.red(`\n❌ Failed to import: ${err.message}\n`))
  }
}

async function generateClaudeMd(outputFile?: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    console.log(chalk.red("\n❌ ANTHROPIC_API_KEY environment variable required"))
    console.log(chalk.gray("   Get your key from: https://console.anthropic.com/"))
    console.log(chalk.gray("   Then run: export ANTHROPIC_API_KEY=sk-...\n"))
    return
  }

  const profile = getConfigValue("profile") as ProfileData | undefined

  if (!profile) {
    console.log(chalk.yellow("\n⚠️  No profile set. Run 'jfl profile' first\n"))
    return
  }

  console.log(chalk.cyan("\n⚡ Generating CLAUDE.md using Claude API...\n"))

  try {
    const anthropic = new Anthropic({ apiKey })

    const prompt = buildClaudePrompt(profile)

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    })

    const claudeContent =
      message.content[0].type === "text" ? message.content[0].text : ""

    const output = outputFile || "CLAUDE.md"
    writeFileSync(output, claudeContent, "utf-8")

    console.log(chalk.green(`✓ CLAUDE.md generated successfully`))
    console.log(chalk.gray(`  Saved to: ${output}\n`))
  } catch (err: any) {
    console.log(chalk.red(`\n❌ Failed to generate: ${err.message}\n`))
  }
}

function buildClaudePrompt(profile: ProfileData): string {
  const parts: string[] = []

  parts.push("You are helping create a personalized CLAUDE.md file. This file will live in their project root and will tell Claude Code how to work with them effectively.")
  parts.push("\n## Their Profile:\n")

  if (profile.style) {
    parts.push(`**Communication Style:** ${profile.style.precision} and ${profile.style.jargon}`)
    parts.push(`**Comments:** ${profile.style.comments}`)
    parts.push(`**Documentation:** ${profile.style.documentation}`)
    parts.push("")
  }

  if (profile.languages?.primary) {
    parts.push(`**Primary Languages:** ${profile.languages.primary.join(", ")}`)
    parts.push("")
  }

  if (profile.frontend) {
    parts.push("**Frontend:**")
    if (profile.frontend.framework) parts.push(`- Framework: ${profile.frontend.framework}`)
    if (profile.frontend.styling) parts.push(`- Styling: ${profile.frontend.styling.join(", ")}`)
    if (profile.frontend.hosting) parts.push(`- Hosting: ${profile.frontend.hosting}`)
    parts.push("")
  }

  if (profile.backend) {
    parts.push("**Backend:**")
    if (profile.backend.databases) parts.push(`- Databases: ${profile.backend.databases.join(", ")}`)
    if (profile.backend.preferences) parts.push(`- Preferences: ${profile.backend.preferences.join(", ")}`)
    parts.push("")
  }

  if (profile.infrastructure) {
    parts.push("**Infrastructure:**")
    if (profile.infrastructure.primary) parts.push(`- Primary: ${profile.infrastructure.primary}`)
    if (profile.infrastructure.tools) parts.push(`- Tools: ${profile.infrastructure.tools.join(", ")}`)
    if (profile.infrastructure.cicd) parts.push(`- CI/CD: ${profile.infrastructure.cicd}`)
    parts.push("")
  }

  if (profile.git) {
    parts.push("**Git Workflow:**")
    if (profile.git.branches) {
      parts.push(`- RC branch: ${profile.git.branches.rc}`)
      parts.push(`- Stable branch: ${profile.git.branches.stable}`)
    }
    parts.push(`- Release notes: ${profile.git.releaseNotes ? "yes" : "no"}`)
    parts.push("")
  }

  parts.push("\n## Instructions:\n")
  parts.push("Create a comprehensive CLAUDE.md file that includes:")
  parts.push("")
  parts.push("1. **UNIX Philosophy** - Include the standard UNIX philosophy section")
  parts.push("2. **How to Work With Me** - Communication style, preferences, biases")
  parts.push("3. **Tech Stack** - Their specific stack and tools")
  parts.push("4. **Workflow Rules** - Specific behavioral rules based on their preferences")
  parts.push("5. **Git Workflow** - Branch model and release practices")
  parts.push("")
  parts.push("Make it:")
  parts.push("- **Behavioral and actionable** - Focus on HOW Claude should work with them")
  parts.push("- **Specific to their workflow** - Reference their actual tools and preferences")
  parts.push("- **Well-structured** with clear markdown sections")
  parts.push("- **Concise** - No fluff, just rules and context")
  parts.push("")
  parts.push("**CRITICAL:** This is instructions for Claude Code on how to behave when working with this person. Focus on rules, preferences, and workflow.")
  parts.push("")
  parts.push("Generate the CLAUDE.md file now. Return ONLY the markdown content, no preamble.")

  return parts.join("\n")
}

// Helper to get profile for other commands
export function getProfile(): ProfileData | undefined {
  return getConfigValue("profile") as ProfileData | undefined
}
