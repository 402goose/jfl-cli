import type { ProfileData } from "../commands/profile.js"

/**
 * Generate CLAUDE.md content from user profile and project context
 */
export function generateClaudeMdFromProfile(
  profile: ProfileData,
  projectContext?: {
    name?: string
    description?: string
    customSections?: string[]
  }
): string {
  const sections: string[] = []

  // Header
  sections.push("# CLAUDE.md\n")
  sections.push("---\n")

  // ============================================================
  // SECTION 0: UNIX Philosophy (always included)
  // ============================================================
  sections.push("## 0) UNIX PHILOSOPHY (Top-Level Principle)\n")
  sections.push("Everything below should be interpreted through these lenses:\n")
  sections.push("* **Do one thing well.** Prefer small, composable tools over monoliths.")
  sections.push("* **Write programs to work together.** Clean interfaces, plain formats, and predictable behavior matter more than cleverness.")
  sections.push("* **Handle text streams when possible.** Make things inspectable, pipeable, and debuggable.")
  sections.push("* **Build minimal, transparent systems.** Favor simplicity, observability, and determinism over abstraction layers.")
  sections.push("* **Optimize for readability and maintainability first.** Performance comes after clarity unless it is the constraint.\n")
  sections.push("If a design violates these principles, call it out explicitly.\n")
  sections.push("---\n")

  // ============================================================
  // SECTION 1: How to Work With Me
  // ============================================================
  sections.push("## 1) How to Work With Me (Defaults)\n")
  sections.push("**Style & Communication**\n")

  if (profile.style) {
    const { precision, jargon, comments, documentation } = profile.style

    if (precision === "direct") {
      sections.push("* Be **precise, direct, and structured**.")
      sections.push("* Prefer clarity over verbosity, but don't omit important detail.")
    } else if (precision === "detailed") {
      sections.push("* Be **thorough and detailed** in explanations.")
      sections.push("* Don't skip steps - explain the reasoning.")
    } else {
      sections.push("* Be **conversational and natural**.")
      sections.push("* Engage in dialogue, ask clarifying questions.")
    }

    if (jargon === "technical") {
      sections.push("* Use domain-appropriate jargon when relevant.")
    } else if (jargon === "mixed") {
      sections.push("* Mix technical terms with plain explanations.")
    } else {
      sections.push("* Use plain language, avoid unnecessary jargon.")
    }

    if (comments === "never") {
      sections.push("* **Do not add comments to code** unless I explicitly ask for them.")
    } else if (comments === "when-asked") {
      sections.push("* Add comments to code only when explicitly requested.")
    } else {
      sections.push("* Add helpful comments to code where appropriate.")
    }

    if (documentation === "critical") {
      sections.push("* I care **heavily about accurate documentation**.")
      sections.push("* I am **LLM-first with respect to docs and interfaces**—treat documentation as a primary artifact.")
    } else if (documentation === "important") {
      sections.push("* Keep documentation updated and accurate.")
    }

    sections.push("* Expect iteration; deliver something concrete rather than asking too many questions up front.")
  }

  sections.push("\n**Biases & Preferences**\n")
  sections.push("* Prefer **simpler solutions** over complex abstractions unless necessary.")
  sections.push("* Prefer Markdown for durable context and handoffs.")

  if (profile.git?.branches) {
    sections.push(`* Avoid committing directly to \`${profile.git.branches.stable}\`; use \`${profile.git.branches.rc}\` as the RC branch.`)
  }

  sections.push("\n---\n")

  // ============================================================
  // SECTION 2: Tech Stack
  // ============================================================
  sections.push("## 2) Tech Stack & Systems Assumptions\n")

  if (profile.languages?.primary) {
    sections.push("**Languages (defaults when relevant):**\n")
    profile.languages.primary.forEach(lang => {
      sections.push(`* ${lang}`)
    })
    sections.push("")
  }

  if (profile.frontend) {
    sections.push("**Frontend:**\n")

    const frameworkMap: { [key: string]: string } = {
      "react-nextjs": "React + Next.js (App Router unless specified)",
      "react": "React",
      "vue": "Vue",
      "svelte": "Svelte",
      "solid": "Solid"
    }

    if (profile.frontend.framework) {
      sections.push(`* ${frameworkMap[profile.frontend.framework] || profile.frontend.framework}`)
    }

    if (profile.frontend.styling?.length) {
      const stylingStr = profile.frontend.styling
        .map(s => s === "tailwind" ? "**TailwindCSS**" : s.replace(/-/g, " "))
        .join(" + ")
      sections.push(`* Styling: ${stylingStr}`)
    }

    if (profile.frontend.hosting) {
      const hostingMap: { [key: string]: string } = {
        "vercel": "Vercel",
        "netlify": "Netlify",
        "cloudflare": "Cloudflare Pages",
        "fly": "Fly.io"
      }
      sections.push(`* ${hostingMap[profile.frontend.hosting] || profile.frontend.hosting} is the default for frontend hosting.`)
    }
    sections.push("")
  }

  if (profile.backend) {
    sections.push("**Backend / Data:**\n")

    if (profile.backend.databases?.length) {
      const dbStr = profile.backend.databases
        .map(db => {
          if (db === "postgresql") return "**PostgreSQL (preferred)**"
          return db.charAt(0).toUpperCase() + db.slice(1)
        })
        .join(", ")
      sections.push(`* ${dbStr}`)
    }

    if (profile.backend.preferences?.includes("cost-conscious")) {
      sections.push("* Cost-conscious infrastructure choices preferred.")
    }

    sections.push("")
  }

  if (profile.infrastructure) {
    sections.push("**Infra / Platform:**\n")

    const infraMap: { [key: string]: string } = {
      "fly": "**Fly.io — primary default** for deployments and databases.",
      "aws": "AWS",
      "gcp": "Google Cloud",
      "kubernetes": "Kubernetes"
    }

    if (profile.infrastructure.primary) {
      sections.push(`* ${infraMap[profile.infrastructure.primary] || profile.infrastructure.primary}`)
    }

    if (profile.infrastructure.tools?.length) {
      profile.infrastructure.tools.forEach(tool => {
        if (tool === "docker") {
          sections.push("* Docker (multi-stage builds, compose, runtime tuning).")
        } else if (tool === "kubernetes") {
          sections.push("* Kubernetes when it is clearly justified, not as a default.")
        } else {
          sections.push(`* ${tool.charAt(0).toUpperCase() + tool.slice(1)}`)
        }
      })
    }

    if (profile.infrastructure.cicd) {
      const cicdMap: { [key: string]: string } = {
        "github-actions": "**GitHub Actions** as the default CI/CD.",
        "gitlab-ci": "GitLab CI as the default CI/CD.",
        "circleci": "CircleCI as the default CI/CD."
      }
      sections.push(`* ${cicdMap[profile.infrastructure.cicd] || profile.infrastructure.cicd}`)
    }

    sections.push("")
  }

  sections.push("---\n")

  // ============================================================
  // SECTION 3: Design & UX (if applicable)
  // ============================================================
  if (profile.design && profile.design.taste !== "flexible") {
    sections.push("## 3) Design & UX Preferences\n")

    if (profile.design.taste === "strong") {
      sections.push("* Strong visual taste; I iterate heavily on design")
      if (profile.design.preferences?.includes("minimal")) {
        sections.push("* Prefer minimal clutter and clear hierarchy.")
      }
    } else if (profile.design.taste === "moderate") {
      sections.push("* Moderate design involvement - care about aesthetics but follow best practices.")
    }

    sections.push("\n---\n")
  }

  // ============================================================
  // SECTION 4: Git Workflow
  // ============================================================
  if (profile.git) {
    sections.push("## 4) Release & Git Workflow\n")

    if (profile.git.branches) {
      sections.push("* Branch model:")
      sections.push(`  * \`${profile.git.branches.rc}\` = release candidate (RC)`)
      sections.push(`  * \`${profile.git.branches.stable}\` = stable`)
    }

    if (profile.git.releaseNotes) {
      sections.push("* Prefer automated release notes via GitHub Actions.")
      sections.push("* Avoid `set-output` (deprecated).")
    }

    sections.push("\n---\n")
  }

  // ============================================================
  // Project-specific context
  // ============================================================
  if (projectContext?.description) {
    sections.push("## 5) Project Context\n")
    sections.push(`${projectContext.description}\n`)
    sections.push("---\n")
  }

  // ============================================================
  // Footer
  // ============================================================
  sections.push("## If You're Unsure\n")
  sections.push("If context is ambiguous:\n")
  sections.push("* Make a reasonable assumption, state it briefly, and proceed.")
  sections.push("* Provide a concrete proposal rather than asking too many questions up front.\n")

  return sections.join("\n")
}
