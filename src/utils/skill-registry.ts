/**
 * Skill Registry Management
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"
import https from "https"
import { createHash } from "crypto"
import type { SkillRegistry, ProjectSkills, SkillMetadata, InstalledSkill } from "../types/skills.js"

const DEFAULT_REGISTRY_URL = "https://raw.githubusercontent.com/hathbanger/jfl-skills/main/registry.json"
const SKILLS_FILE = ".jfl/skills.json"
const SKILLS_DIR = "skills"

/**
 * Fetch the skill registry from remote
 */
export async function fetchRegistry(url: string = DEFAULT_REGISTRY_URL): Promise<SkillRegistry> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = ""
      res.on("data", (chunk) => (data += chunk))
      res.on("end", () => {
        try {
          const registry = JSON.parse(data) as SkillRegistry
          resolve(registry)
        } catch (err) {
          reject(new Error(`Failed to parse registry: ${err}`))
        }
      })
    }).on("error", reject)
  })
}

/**
 * Get project skills configuration
 */
export function getProjectSkills(): ProjectSkills | null {
  const skillsPath = join(process.cwd(), SKILLS_FILE)
  if (!existsSync(skillsPath)) {
    return null
  }

  try {
    const content = readFileSync(skillsPath, "utf-8")
    return JSON.parse(content) as ProjectSkills
  } catch {
    return null
  }
}

/**
 * Save project skills configuration
 */
export function saveProjectSkills(skills: ProjectSkills): void {
  const skillsPath = join(process.cwd(), SKILLS_FILE)
  const jflDir = join(process.cwd(), ".jfl")

  if (!existsSync(jflDir)) {
    mkdirSync(jflDir, { recursive: true })
  }

  writeFileSync(skillsPath, JSON.stringify(skills, null, 2) + "\n")
}

/**
 * Initialize project skills if not exists
 */
export function initProjectSkills(): ProjectSkills {
  let skills = getProjectSkills()

  if (!skills) {
    skills = {
      installed: {},
      registryUrl: DEFAULT_REGISTRY_URL,
      lastUpdate: new Date().toISOString(),
    }
    saveProjectSkills(skills)
  }

  return skills
}

/**
 * List installed skills
 */
export function listInstalledSkills(): Record<string, InstalledSkill> {
  const skills = getProjectSkills()
  return skills?.installed || {}
}

/**
 * Check if a skill is installed
 */
export function isSkillInstalled(skillId: string): boolean {
  const skills = getProjectSkills()
  return skills?.installed?.[skillId] !== undefined
}

/**
 * Download a file from URL
 */
async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = require("fs").createWriteStream(dest)
    https.get(url, (res) => {
      res.pipe(file)
      file.on("finish", () => {
        file.close()
        resolve()
      })
    }).on("error", (err: Error) => {
      require("fs").unlinkSync(dest)
      reject(err)
    })
  })
}

/**
 * Verify file checksum
 */
function verifyChecksum(filePath: string, expectedChecksum: string): boolean {
  const content = readFileSync(filePath)
  const hash = createHash("sha256").update(content).digest("hex")
  return `sha256:${hash}` === expectedChecksum
}

/**
 * Install a skill
 */
export async function installSkill(
  skillId: string,
  metadata: SkillMetadata,
  version?: string
): Promise<void> {
  const skillsDir = join(process.cwd(), SKILLS_DIR)
  const skillDir = join(skillsDir, skillId)
  const tempFile = join(skillsDir, `${skillId}.tar.gz`)

  // Ensure skills directory exists
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true })
  }

  // Download skill tarball
  await downloadFile(metadata.url, tempFile)

  // Verify checksum
  if (!verifyChecksum(tempFile, metadata.checksum)) {
    rmSync(tempFile, { force: true })
    throw new Error(`Checksum verification failed for ${skillId}`)
  }

  // Extract tarball
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true, force: true })
  }

  execSync(`tar -xzf ${tempFile} -C ${skillsDir}`, { stdio: "pipe" })
  rmSync(tempFile, { force: true })

  // Update project skills
  const projectSkills = initProjectSkills()
  projectSkills.installed[skillId] = {
    version: version || metadata.version,
    installedAt: new Date().toISOString(),
    source: metadata.category,
  }
  projectSkills.lastUpdate = new Date().toISOString()
  saveProjectSkills(projectSkills)
}

/**
 * Remove a skill
 */
export function removeSkill(skillId: string): void {
  const skillDir = join(process.cwd(), SKILLS_DIR, skillId)

  // Remove skill directory
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true, force: true })
  }

  // Update project skills
  const projectSkills = getProjectSkills()
  if (projectSkills && projectSkills.installed[skillId]) {
    delete projectSkills.installed[skillId]
    projectSkills.lastUpdate = new Date().toISOString()
    saveProjectSkills(projectSkills)
  }
}

/**
 * Get skill updates available
 */
export async function getAvailableUpdates(
  registry: SkillRegistry
): Promise<Array<{ skillId: string; current: string; latest: string }>> {
  const installed = listInstalledSkills()
  const updates: Array<{ skillId: string; current: string; latest: string }> = []

  for (const [skillId, installedSkill] of Object.entries(installed)) {
    const registrySkill = registry.skills[skillId]
    if (registrySkill && registrySkill.version !== installedSkill.version) {
      // Simple version comparison (assumes semver format)
      if (registrySkill.version > installedSkill.version) {
        updates.push({
          skillId,
          current: installedSkill.version,
          latest: registrySkill.version,
        })
      }
    }
  }

  return updates
}

/**
 * Check if project is a JFL workspace
 */
export function isJflWorkspace(): boolean {
  return existsSync(join(process.cwd(), ".jfl")) || existsSync(join(process.cwd(), "CLAUDE.md"))
}
