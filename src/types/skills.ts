/**
 * Skill Registry Types
 */

export interface SkillMetadata {
  id: string
  name: string
  description: string
  category: "core" | "catalog"
  version: string
  size: number
  tags: string[]
  url: string
  checksum: string
  dependencies?: string[]
}

export interface SkillRegistry {
  version: string
  updated: string
  skills: Record<string, SkillMetadata>
}

export interface InstalledSkill {
  version: string
  installedAt: string
  source: "core" | "catalog"
}

export interface ProjectSkills {
  installed: Record<string, InstalledSkill>
  registryUrl: string
  lastUpdate: string
}

export interface SkillManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  license: string
  category: "core" | "catalog"
  tags: string[]
  files: string[]
  dependencies: string[]
  minJflVersion: string
}
