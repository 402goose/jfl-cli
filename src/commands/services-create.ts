/**
 * Services Create Command
 *
 * Create new service with AI assistance and automatic GTM integration
 *
 * @purpose Create new services with wizard, templates, and AI assistance
 */

import * as p from "@clack/prompts"
import chalk from "chalk"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import { join, basename } from "path"
import { spawn } from "child_process"
import { getCodeDirectory } from "../utils/jfl-config.js"
import { onboardCommand } from "./onboard.js"
import { execSync } from "child_process"

// ============================================================================
// Types
// ============================================================================

export interface CreateOptions {
  name?: string
  type?: string
  description?: string
  skipAI?: boolean
}

interface ServiceTemplate {
  files: Array<{
    path: string
    content: string
  }>
  instructions: string
}

type ServiceType = "api" | "web" | "worker" | "cli" | "infrastructure" | "container"

// ============================================================================
// Main Command
// ============================================================================

export async function servicesCreateCommand(options: CreateOptions = {}): Promise<void> {
  console.log()
  p.intro(chalk.cyan("JFL - Create Service"))

  try {
    // Step 1: Collect service metadata
    const metadata = await collectServiceMetadata(options)

    if (!metadata) {
      p.cancel("Service creation cancelled")
      process.exit(0)
    }

    const { name, type, description, location } = metadata

    // Step 2: Check if directory exists
    if (existsSync(location)) {
      const overwrite = await p.confirm({
        message: `Directory ${location} already exists. Overwrite?`,
        initialValue: false,
      })

      if (p.isCancel(overwrite) || !overwrite) {
        p.cancel("Service creation cancelled")
        process.exit(0)
      }
    }

    // Step 3: Choose AI tool (unless --skip-ai)
    let aiTool: string | null = null

    if (!options.skipAI) {
      const tools = getAvailableAITools()

      if (tools.length === 0) {
        console.log(chalk.yellow("\n⚠️  No AI tools detected"))
        console.log(chalk.gray("  Install Claude Code: npm install -g @anthropic-ai/claude-code"))
        console.log(chalk.gray("  Install Ralph: bun install -g ralph-tui\n"))
      } else {
        aiTool = await p.select({
          message: "Build with AI assistance?",
          options: [
            ...tools.map(tool => ({
              value: tool,
              label: getToolLabel(tool),
              hint: getToolHint(tool),
            })),
            {
              value: "skip",
              label: "Skip (just scaffold, I'll build manually)",
            },
          ],
        }) as string

        if (p.isCancel(aiTool)) {
          p.cancel("Service creation cancelled")
          process.exit(0)
        }

        if (aiTool === "skip") {
          aiTool = null
        }
      }
    }

    // Step 4: Confirm creation
    const confirmed = await confirmCreation(name, type, description, location, aiTool)

    if (!confirmed) {
      p.cancel("Service creation cancelled")
      process.exit(0)
    }

    // Step 5: Scaffold service
    const spinner = p.spinner()
    spinner.start("Creating service...")

    await scaffoldService(location, name, type as ServiceType, description)
    spinner.stop("✓ Service scaffolded")

    // Step 6: Launch AI tool if selected
    if (aiTool) {
      await launchAITool(aiTool, location, name, type as ServiceType, description)
    } else {
      showManualNextSteps(location, name)
    }

    p.outro(chalk.green("Service created successfully! 🚀"))
  } catch (error: any) {
    p.cancel(chalk.red(`Error: ${error.message}`))
    process.exit(1)
  }
}

// ============================================================================
// Metadata Collection
// ============================================================================

async function collectServiceMetadata(options: CreateOptions) {
  // Service name
  let name = options.name

  if (!name) {
    name = await p.text({
      message: "Service name?",
      placeholder: "my-new-service",
      validate: (value) => {
        const error = validateServiceName(value)
        return error || undefined
      },
    }) as string

    if (p.isCancel(name)) {
      return null
    }
  } else {
    const error = validateServiceName(name)
    if (error) {
      throw new Error(error)
    }
  }

  // Service type
  let type = options.type

  if (!type) {
    type = await p.select({
      message: "Service type?",
      options: [
        { value: "api", label: "API - REST/GraphQL service" },
        { value: "web", label: "Web - Frontend application" },
        { value: "worker", label: "Worker - Background jobs/queue" },
        { value: "cli", label: "CLI - Command-line tool" },
        { value: "infrastructure", label: "Infrastructure - Database, cache, etc." },
        { value: "container", label: "Container - Docker service" },
      ],
    }) as string

    if (p.isCancel(type)) {
      return null
    }
  }

  // Description
  let description = options.description

  if (!description) {
    description = await p.text({
      message: "Description?",
      placeholder: "What does this service do?",
      validate: (value) => {
        if (!value.trim()) {
          return "Description required"
        }
      },
    }) as string

    if (p.isCancel(description)) {
      return null
    }
  }

  // Location
  const codeDir = await getCodeDirectory()
  const defaultLocation = join(codeDir, name)

  const location = await p.text({
    message: "Where to create?",
    placeholder: defaultLocation,
    initialValue: defaultLocation,
  }) as string

  if (p.isCancel(location)) {
    return null
  }

  return { name, type, description, location }
}

// ============================================================================
// Validation
// ============================================================================

function validateServiceName(name: string): string | undefined {
  if (!name || !name.trim()) {
    return "Service name required"
  }

  // Must be lowercase with hyphens
  if (!/^[a-z0-9-]+$/.test(name)) {
    return "Service name must be lowercase letters, numbers, and hyphens only"
  }

  // Can't start or end with hyphen
  if (name.startsWith("-") || name.endsWith("-")) {
    return "Service name can't start or end with hyphen"
  }

  // No consecutive hyphens
  if (name.includes("--")) {
    return "Service name can't have consecutive hyphens"
  }

  return undefined
}

// ============================================================================
// AI Tool Detection
// ============================================================================

function getAvailableAITools(): string[] {
  const tools: string[] = []

  if (hasClaudeCLI()) {
    tools.push("claude")
  }

  if (hasRalphTui()) {
    tools.push("ralph")
  }

  return tools
}

function hasClaudeCLI(): boolean {
  try {
    execSync("which claude", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function hasRalphTui(): boolean {
  try {
    execSync("which ralph-tui", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function getToolLabel(tool: string): string {
  switch (tool) {
    case "claude":
      return "Claude Code (collaborative, recommended)"
    case "ralph":
      return "Ralph (autonomous agent loop)"
    default:
      return tool
  }
}

function getToolHint(tool: string): string {
  switch (tool) {
    case "claude":
      return "Interactive AI pair programming"
    case "ralph":
      return "Autonomous loop until complete"
    default:
      return ""
  }
}

// ============================================================================
// Confirmation
// ============================================================================

async function confirmCreation(
  name: string,
  type: string,
  description: string,
  location: string,
  aiTool: string | null
): Promise<boolean> {
  console.log()
  console.log(chalk.cyan("Ready to create:"))
  console.log(chalk.gray(`  Name:        ${name}`))
  console.log(chalk.gray(`  Type:        ${type}`))
  console.log(chalk.gray(`  Description: ${description}`))
  console.log(chalk.gray(`  Location:    ${location}`))
  console.log(chalk.gray(`  AI Tool:     ${aiTool || "None (manual)"}`))
  console.log()

  const confirmed = await p.confirm({
    message: "Create this service?",
    initialValue: true,
  })

  return !p.isCancel(confirmed) && confirmed
}

// ============================================================================
// Service Scaffolding
// ============================================================================

async function scaffoldService(
  servicePath: string,
  serviceName: string,
  serviceType: ServiceType,
  description: string
): Promise<void> {
  // Create base directories
  mkdirSync(servicePath, { recursive: true })
  mkdirSync(join(servicePath, ".jfl", "journal"), { recursive: true })
  mkdirSync(join(servicePath, ".jfl", "logs"), { recursive: true })
  mkdirSync(join(servicePath, ".claude", "agents"), { recursive: true })
  mkdirSync(join(servicePath, ".claude", "skills"), { recursive: true })
  mkdirSync(join(servicePath, "knowledge"), { recursive: true })

  // Get template for service type
  const template = getServiceTemplate(serviceType, serviceName, description)

  // Write all template files
  for (const file of template.files) {
    const filePath = join(servicePath, file.path)
    const fileDir = join(filePath, "..")

    mkdirSync(fileDir, { recursive: true })
    writeFileSync(filePath, file.content)
  }

  // Write CLAUDE.md with service-specific instructions
  const claudeMd = generateClaudeMd(serviceName, serviceType, description, template.instructions)
  writeFileSync(join(servicePath, "CLAUDE.md"), claudeMd)

  // Write base .gitignore
  const gitignore = generateGitignore(serviceType)
  writeFileSync(join(servicePath, ".gitignore"), gitignore)

  // Initialize git
  try {
    execSync("git init", { cwd: servicePath, stdio: "ignore" })
    execSync("git add .", { cwd: servicePath, stdio: "ignore" })
    execSync(`git commit -m "Initial commit: scaffolded ${serviceType} service"`, {
      cwd: servicePath,
      stdio: "ignore",
    })
  } catch (error) {
    // Git init failed - not critical
    console.log(chalk.yellow("⚠️  Git initialization failed (not critical)"))
  }
}

// ============================================================================
// Service Templates
// ============================================================================

function getServiceTemplate(
  type: ServiceType,
  name: string,
  description: string
): ServiceTemplate {
  switch (type) {
    case "api":
      return getAPITemplate(name, description)
    case "web":
      return getWebTemplate(name, description)
    case "worker":
      return getWorkerTemplate(name, description)
    case "cli":
      return getCLITemplate(name, description)
    case "infrastructure":
      return getInfrastructureTemplate(name, description)
    case "container":
      return getContainerTemplate(name, description)
    default:
      throw new Error(`Unknown service type: ${type}`)
  }
}

function getAPITemplate(name: string, description: string): ServiceTemplate {
  return {
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name,
          version: "0.1.0",
          description,
          type: "module",
          scripts: {
            dev: "tsx watch src/index.ts",
            build: "tsc",
            start: "node dist/index.js",
            test: "vitest",
          },
          dependencies: {
            fastify: "^4.26.0",
            "@fastify/cors": "^9.0.1",
            pino: "^8.19.0",
          },
          devDependencies: {
            typescript: "^5.3.3",
            tsx: "^4.7.1",
            vitest: "^1.3.1",
            "@types/node": "^20.11.17",
          },
        }, null, 2),
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "ES2022",
            moduleResolution: "node",
            outDir: "./dist",
            rootDir: "./src",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
          },
          include: ["src/**/*"],
          exclude: ["node_modules", "dist"],
        }, null, 2),
      },
      {
        path: "src/index.ts",
        content: `import Fastify from 'fastify'
import cors from '@fastify/cors'
import { healthRoutes } from './routes/health.js'

const fastify = Fastify({
  logger: true
})

fastify.register(cors)
fastify.register(healthRoutes)

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10)
    await fastify.listen({ port, host: '0.0.0.0' })
    console.log(\`Server running on http://localhost:\${port}\`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
`,
      },
      {
        path: "src/routes/health.ts",
        content: `import { FastifyInstance } from 'fastify'

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })
}
`,
      },
      {
        path: ".env.example",
        content: `PORT=3000
NODE_ENV=development
`,
      },
      {
        path: "README.md",
        content: `# ${name}

${description}

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

## API Endpoints

- \`GET /health\` - Health check

## Environment Variables

See \`.env.example\` for required environment variables.
`,
      },
      {
        path: "knowledge/SERVICE_SPEC.md",
        content: `# ${name} - Service Specification

## Overview

${description}

## Responsibilities

- [ ] TODO: Define what this service is responsible for

## API Endpoints

- \`GET /health\` - Health check endpoint

## Dependencies

- None (update as you add dependencies)

## Environment Variables

- \`PORT\` - Server port (default: 3000)
- \`NODE_ENV\` - Environment (development/production)
`,
      },
    ],
    instructions: `This is a REST API service using Fastify and TypeScript.

## Core Features to Implement
- [ ] Define API routes and endpoints
- [ ] Add request validation
- [ ] Implement business logic
- [ ] Add error handling
- [ ] Write unit tests

## Technical Stack
- **Framework:** Fastify (fast, low-overhead web framework)
- **Language:** TypeScript
- **Testing:** Vitest

## Key Patterns
- Keep routes thin, move logic to separate modules
- Use Fastify plugins for reusable functionality
- Validate all inputs
- Return consistent error responses
`,
  }
}

function getWebTemplate(name: string, description: string): ServiceTemplate {
  return {
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name,
          version: "0.1.0",
          description,
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
            lint: "next lint",
          },
          dependencies: {
            react: "^18.2.0",
            "react-dom": "^18.2.0",
            next: "^14.1.0",
          },
          devDependencies: {
            typescript: "^5.3.3",
            "@types/node": "^20.11.17",
            "@types/react": "^18.2.55",
            "@types/react-dom": "^18.2.19",
          },
        }, null, 2),
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            lib: ["dom", "dom.iterable", "esnext"],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            forceConsistentCasingInFileNames: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "preserve",
            incremental: true,
            plugins: [{ name: "next" }],
            paths: {
              "@/*": ["./src/*"],
            },
          },
          include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
          exclude: ["node_modules"],
        }, null, 2),
      },
      {
        path: "next.config.js",
        content: `/** @type {import('next').NextConfig} */
const nextConfig = {}

module.exports = nextConfig
`,
      },
      {
        path: "src/app/layout.tsx",
        content: `export const metadata = {
  title: '${name}',
  description: '${description}',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`,
      },
      {
        path: "src/app/page.tsx",
        content: `export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-4xl font-bold">${name}</h1>
      <p className="mt-4 text-lg">${description}</p>
    </main>
  )
}
`,
      },
      {
        path: "README.md",
        content: `# ${name}

${description}

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) with your browser.
`,
      },
      {
        path: "knowledge/SERVICE_SPEC.md",
        content: `# ${name} - Service Specification

## Overview

${description}

## Responsibilities

- [ ] TODO: Define what this frontend does

## Pages/Routes

- \`/\` - Home page

## Components

- None yet (add as you build)

## Styling

- TailwindCSS (recommended - add if needed)
- Or CSS modules

## API Integration

- None yet (define API endpoints to connect to)
`,
      },
    ],
    instructions: `This is a Next.js web application with TypeScript.

## Core Features to Implement
- [ ] Design page layouts
- [ ] Build reusable components
- [ ] Connect to backend APIs
- [ ] Add styling (TailwindCSS recommended)
- [ ] Implement client-side routing

## Technical Stack
- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **UI:** React

## Key Patterns
- Use Server Components by default
- Use Client Components only when needed (interactivity, hooks)
- Keep components small and focused
- Co-locate related files
`,
  }
}

function getWorkerTemplate(name: string, description: string): ServiceTemplate {
  return {
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name,
          version: "0.1.0",
          description,
          type: "module",
          scripts: {
            dev: "tsx watch src/index.ts",
            build: "tsc",
            start: "node dist/index.js",
          },
          dependencies: {
            bullmq: "^5.3.0",
            ioredis: "^5.3.2",
          },
          devDependencies: {
            typescript: "^5.3.3",
            tsx: "^4.7.1",
            "@types/node": "^20.11.17",
          },
        }, null, 2),
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "ES2022",
            moduleResolution: "node",
            outDir: "./dist",
            rootDir: "./src",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
          },
          include: ["src/**/*"],
          exclude: ["node_modules", "dist"],
        }, null, 2),
      },
      {
        path: "src/index.ts",
        content: `import { Worker } from 'bullmq'

const worker = new Worker('${name}', async job => {
  console.log(\`Processing job \${job.id}:\`, job.data)

  // Add job processing logic here
  // Example: await processTask(job.data)

  return { processed: true, timestamp: new Date().toISOString() }
}, {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  }
})

worker.on('completed', job => {
  console.log(\`Job \${job.id} completed\`)
})

worker.on('failed', (job, err) => {
  console.error(\`Job \${job?.id} failed:\`, err)
})

console.log('Worker started, waiting for jobs...')
`,
      },
      {
        path: "src/jobs/example.ts",
        content: `export async function processExampleJob(data: any) {
  // Implement job logic here
  console.log('Processing example job:', data)

  return { success: true }
}
`,
      },
      {
        path: ".env.example",
        content: `REDIS_HOST=localhost
REDIS_PORT=6379
NODE_ENV=development
`,
      },
      {
        path: "README.md",
        content: `# ${name}

${description}

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

## Requirements

- Redis server running on localhost:6379

## Job Types

- Add job types as you implement them

## Environment Variables

See \`.env.example\` for required environment variables.
`,
      },
      {
        path: "knowledge/SERVICE_SPEC.md",
        content: `# ${name} - Service Specification

## Overview

${description}

## Responsibilities

- [ ] TODO: Define what jobs this worker processes

## Job Types

- None yet (add as you implement)

## Dependencies

- **Redis** - Job queue backend (required)

## Environment Variables

- \`REDIS_HOST\` - Redis host (default: localhost)
- \`REDIS_PORT\` - Redis port (default: 6379)
`,
      },
    ],
    instructions: `This is a background job worker using BullMQ and TypeScript.

## Core Features to Implement
- [ ] Define job types and handlers
- [ ] Add error handling and retries
- [ ] Implement job prioritization
- [ ] Add monitoring/logging
- [ ] Write job tests

## Technical Stack
- **Queue:** BullMQ (Redis-based job queue)
- **Language:** TypeScript

## Key Patterns
- Keep job handlers focused and testable
- Use job data validation
- Implement proper error handling
- Add retry logic for transient failures
- Log job progress for debugging
`,
  }
}

function getCLITemplate(name: string, description: string): ServiceTemplate {
  return {
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name,
          version: "0.1.0",
          description,
          type: "module",
          bin: {
            [name]: "./bin/cli.js",
          },
          scripts: {
            dev: "tsx watch src/cli.ts",
            build: "tsc && chmod +x bin/cli.js",
            start: "node bin/cli.js",
          },
          dependencies: {
            commander: "^11.1.0",
            chalk: "^5.3.0",
          },
          devDependencies: {
            typescript: "^5.3.3",
            tsx: "^4.7.1",
            "@types/node": "^20.11.17",
          },
        }, null, 2),
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "ES2022",
            moduleResolution: "node",
            outDir: "./bin",
            rootDir: "./src",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
          },
          include: ["src/**/*"],
          exclude: ["node_modules", "bin"],
        }, null, 2),
      },
      {
        path: "src/cli.ts",
        content: `#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import { helloCommand } from './commands/hello.js'

const program = new Command()

program
  .name('${name}')
  .description('${description}')
  .version('0.1.0')

program
  .command('hello')
  .description('Say hello')
  .argument('[name]', 'Name to greet')
  .action(helloCommand)

program.parse()
`,
      },
      {
        path: "src/commands/hello.ts",
        content: `import chalk from 'chalk'

export function helloCommand(name?: string) {
  const greeting = name ? \`Hello, \${name}!\` : 'Hello!'
  console.log(chalk.cyan(greeting))
}
`,
      },
      {
        path: "README.md",
        content: `# ${name}

${description}

## Installation

\`\`\`bash
npm install -g ${name}
\`\`\`

## Usage

\`\`\`bash
${name} hello
${name} hello World
\`\`\`

## Commands

- \`hello [name]\` - Say hello
`,
      },
      {
        path: "knowledge/SERVICE_SPEC.md",
        content: `# ${name} - Service Specification

## Overview

${description}

## Commands

- \`hello [name]\` - Example command

## Installation

Installable globally via npm.

## Usage Patterns

Define expected CLI usage patterns here.
`,
      },
    ],
    instructions: `This is a CLI tool using Commander and TypeScript.

## Core Features to Implement
- [ ] Define CLI commands
- [ ] Add command arguments and options
- [ ] Implement command logic
- [ ] Add help text and examples
- [ ] Write command tests

## Technical Stack
- **CLI Framework:** Commander
- **Styling:** Chalk
- **Language:** TypeScript

## Key Patterns
- Keep commands focused (one command = one responsibility)
- Provide clear help text
- Validate inputs early
- Give helpful error messages
- Support --help and --version
`,
  }
}

function getInfrastructureTemplate(name: string, description: string): ServiceTemplate {
  return {
    files: [
      {
        path: "docker-compose.yml",
        content: `version: '3.8'

services:
  ${name}:
    image: ${name}:latest
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=development
    volumes:
      - ./data:/data
`,
      },
      {
        path: "Dockerfile",
        content: `FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 8080

CMD ["npm", "start"]
`,
      },
      {
        path: "README.md",
        content: `# ${name}

${description}

## Getting Started

\`\`\`bash
docker-compose up
\`\`\`

## Configuration

Update \`docker-compose.yml\` with your configuration.
`,
      },
      {
        path: "knowledge/SERVICE_SPEC.md",
        content: `# ${name} - Service Specification

## Overview

${description}

## Infrastructure Components

- [ ] TODO: Define what infrastructure this service provides

## Configuration

Document configuration options here.

## Deployment

Define deployment strategy here.
`,
      },
    ],
    instructions: `This is an infrastructure service with Docker configuration.

## Core Features to Implement
- [ ] Define infrastructure components
- [ ] Configure networking
- [ ] Set up volumes and persistence
- [ ] Add health checks
- [ ] Document deployment process

## Technical Stack
- **Containerization:** Docker
- **Orchestration:** Docker Compose (or Kubernetes if needed)

## Key Patterns
- Use multi-stage builds for production
- Keep images small (Alpine-based)
- Externalize configuration via env vars
- Set up proper health checks
- Document all ports and volumes
`,
  }
}

function getContainerTemplate(name: string, description: string): ServiceTemplate {
  return {
    files: [
      {
        path: "Dockerfile",
        content: `FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
`,
      },
      {
        path: "package.json",
        content: JSON.stringify({
          name,
          version: "0.1.0",
          description,
          scripts: {
            start: "node index.js",
          },
        }, null, 2),
      },
      {
        path: "index.js",
        content: `console.log('Container service started')

// Add your service logic here
`,
      },
      {
        path: "README.md",
        content: `# ${name}

${description}

## Build

\`\`\`bash
docker build -t ${name} .
\`\`\`

## Run

\`\`\`bash
docker run -p 3000:3000 ${name}
\`\`\`
`,
      },
      {
        path: "knowledge/SERVICE_SPEC.md",
        content: `# ${name} - Service Specification

## Overview

${description}

## Container Configuration

- **Base Image:** node:20-alpine
- **Exposed Ports:** 3000

## Environment Variables

- None yet (add as needed)

## Volumes

- None yet (add for persistence)
`,
      },
    ],
    instructions: `This is a containerized service with Docker.

## Core Features to Implement
- [ ] Define service functionality
- [ ] Configure container properly
- [ ] Add health checks
- [ ] Set up logging
- [ ] Document deployment

## Technical Stack
- **Containerization:** Docker

## Key Patterns
- Keep container small and focused
- Use .dockerignore to exclude unnecessary files
- Run as non-root user
- Add health checks
- Log to stdout/stderr
`,
  }
}

// ============================================================================
// CLAUDE.md Generation
// ============================================================================

function generateClaudeMd(
  name: string,
  type: ServiceType,
  description: string,
  instructions: string
): string {
  return `# ${name} - Service Agent

Your context layer for building this service.

## What You're Building

**Type:** ${type}
**Description:** ${description}

## Requirements

${instructions}

## Development Guidelines

### Testing Strategy
- Write tests as you build
- Test happy paths and error cases
- Keep tests focused and fast

### Code Organization
- Keep files small and focused
- Group related code together
- Use clear, descriptive names

## Integration with GTM

This service will be part of a GTM (Go-To-Market) workspace:
- Will have autonomous service agent (you!)
- Can @-mention peer services
- Journal entries sync to GTM parent
- Coordinates with other services via Service Manager

## Getting Started

1. Implement core features (see checklist above)
2. Add tests
3. Update knowledge docs as you build
4. Test locally
5. Ready to onboard to GTM: \`jfl onboard .\`

## Questions to Answer

As you build, consider:
- What data models are needed?
- What external APIs or services to integrate?
- What environment variables are required?
- What are the deployment requirements?
- How will this be tested?
- How will this be monitored?

Update this file as you answer these questions.
`
}

// ============================================================================
// .gitignore Generation
// ============================================================================

function generateGitignore(type: ServiceType): string {
  const base = `# Dependencies
node_modules/
.pnpm-store/

# Build output
dist/
bin/
build/
.next/

# Environment
.env
.env.local
.env.*.local

# Logs
*.log
.jfl/logs/
logs/

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo
`

  if (type === "web") {
    return base + `
# Next.js
.next/
out/
`
  }

  if (type === "infrastructure" || type === "container") {
    return base + `
# Docker
*.tar
`
  }

  return base
}

// ============================================================================
// AI Tool Launching
// ============================================================================

async function launchAITool(
  toolName: string,
  servicePath: string,
  serviceName: string,
  serviceType: ServiceType,
  description: string
): Promise<void> {
  switch (toolName) {
    case "claude":
      await launchClaudeCode(servicePath, serviceName)
      break
    case "ralph":
      await launchRalph(servicePath, serviceName, serviceType, description)
      break
    default:
      throw new Error(`Unknown AI tool: ${toolName}`)
  }
}

async function launchClaudeCode(
  servicePath: string,
  serviceName: string
): Promise<void> {
  console.log(chalk.cyan(`\n🤖 Launching Claude Code...\n`))
  console.log(chalk.gray(`Read CLAUDE.md for service requirements\n`))

  // Spawn Claude in service directory
  const child = spawn("claude", [], {
    cwd: servicePath,
    stdio: "inherit",
    shell: true,
  })

  // Wait for Claude to close
  await new Promise<void>((resolve) => {
    child.on("exit", () => resolve())
  })

  // Offer to onboard automatically
  console.log()
  const shouldOnboard = await p.confirm({
    message: "Onboard this service to GTM now?",
    initialValue: true,
  })

  if (!p.isCancel(shouldOnboard) && shouldOnboard) {
    try {
      await onboardCommand(servicePath, { skipGit: true })
    } catch (error: any) {
      console.log(chalk.yellow(`\n⚠️  Onboard failed: ${error.message}`))
      console.log(chalk.gray(`You can onboard manually later: jfl onboard ${servicePath}\n`))
    }
  } else {
    console.log(chalk.gray(`\nOnboard later: jfl onboard ${servicePath}\n`))
  }
}

async function launchRalph(
  servicePath: string,
  serviceName: string,
  serviceType: ServiceType,
  description: string
): Promise<void> {
  // Generate PRD file for Ralph
  const prdPath = join(servicePath, "PRD.json")
  const prd = {
    title: `Build ${serviceName}`,
    description,
    requirements: getTypeSpecificRequirements(serviceType),
    techStack: getTypeSpecificStack(serviceType),
    acceptance_criteria: getTypeSpecificCriteria(serviceType),
  }

  writeFileSync(prdPath, JSON.stringify(prd, null, 2))

  console.log(chalk.cyan(`\n🤖 Launching Ralph autonomous loop...\n`))
  console.log(chalk.gray(`PRD generated at ${prdPath}\n`))

  // Spawn Ralph with PRD
  const child = spawn("ralph-tui", ["run", "--prd", prdPath], {
    cwd: servicePath,
    stdio: "inherit",
    shell: true,
  })

  await new Promise<void>((resolve) => {
    child.on("exit", () => resolve())
  })

  // Offer to onboard
  console.log()
  const shouldOnboard = await p.confirm({
    message: "Onboard this service to GTM now?",
    initialValue: true,
  })

  if (!p.isCancel(shouldOnboard) && shouldOnboard) {
    try {
      await onboardCommand(servicePath, { skipGit: true })
    } catch (error: any) {
      console.log(chalk.yellow(`\n⚠️  Onboard failed: ${error.message}`))
      console.log(chalk.gray(`You can onboard manually later: jfl onboard ${servicePath}\n`))
    }
  } else {
    console.log(chalk.gray(`\nOnboard later: jfl onboard ${servicePath}\n`))
  }
}

function getTypeSpecificRequirements(type: ServiceType): string[] {
  switch (type) {
    case "api":
      return [
        "Implement health check endpoint",
        "Add request validation",
        "Implement core API routes",
        "Add error handling",
        "Write API tests",
      ]
    case "web":
      return [
        "Set up page layouts",
        "Build reusable components",
        "Add styling",
        "Connect to backend APIs",
        "Implement routing",
      ]
    case "worker":
      return [
        "Define job types",
        "Implement job handlers",
        "Add error handling and retries",
        "Set up job monitoring",
        "Write job tests",
      ]
    case "cli":
      return [
        "Define CLI commands",
        "Add command arguments/options",
        "Implement command logic",
        "Add help text",
        "Write command tests",
      ]
    default:
      return ["Implement core functionality", "Add tests", "Document usage"]
  }
}

function getTypeSpecificStack(type: ServiceType): string[] {
  switch (type) {
    case "api":
      return ["Fastify", "TypeScript", "Vitest"]
    case "web":
      return ["Next.js", "React", "TypeScript"]
    case "worker":
      return ["BullMQ", "TypeScript", "Redis"]
    case "cli":
      return ["Commander", "TypeScript", "Chalk"]
    default:
      return ["TypeScript", "Node.js"]
  }
}

function getTypeSpecificCriteria(type: ServiceType): string[] {
  switch (type) {
    case "api":
      return [
        "All endpoints return correct status codes",
        "Request validation works",
        "Error responses are consistent",
        "Health check returns 200",
        "Tests pass",
      ]
    case "web":
      return [
        "Pages render correctly",
        "Components are reusable",
        "Styling is consistent",
        "API calls work",
        "Build succeeds",
      ]
    case "worker":
      return [
        "Jobs process successfully",
        "Failed jobs retry correctly",
        "Worker handles shutdown gracefully",
        "Tests pass",
      ]
    case "cli":
      return [
        "Commands execute correctly",
        "Help text is clear",
        "Error messages are helpful",
        "Tests pass",
      ]
    default:
      return ["Core functionality works", "Tests pass", "Documentation is complete"]
  }
}

// ============================================================================
// Manual Next Steps
// ============================================================================

function showManualNextSteps(location: string, name: string): void {
  console.log(chalk.cyan("\n✓ Service scaffolded!\n"))
  console.log(chalk.gray("Next steps:"))
  console.log(chalk.gray(`  1. cd ${location}`))
  console.log(chalk.gray(`  2. npm install`))
  console.log(chalk.gray(`  3. npm run dev`))
  console.log(chalk.gray(`  4. Build your service`))
  console.log(chalk.gray(`  5. jfl onboard ${location}\n`))
}
