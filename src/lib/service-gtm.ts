/**
 * Service-GTM Coordination Library
 *
 * Provides functions for coordinating between service projects and parent GTM workspaces.
 *
 * @purpose Service-GTM coordination helpers for sync and validation
 * @spec Service /end Skill Deployment & GTM Sync Implementation Plan
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import axios from "axios";

export interface ServiceConfig {
  name: string;
  type: "service" | "gtm";
  service_type?: "web" | "api" | "worker" | "daemon" | "cli" | "infrastructure" | "container";
  description: string;
  gtm_parent?: string;
  working_branch?: string;
  sync_to_parent?: {
    journal: boolean;
    knowledge: boolean;
    content: boolean;
  };
  environments?: {
    [key: string]: {
      code_path: string;
      start_command: string;
      port: number | null;
      env: Record<string, string>;
      health_check: {
        enabled: boolean;
        url: string;
        interval: number;
        timeout: number;
      } | null;
    };
  };
}

export interface ServiceRegistration {
  name: string;
  path: string;
  type: string;
  registered_at: string;
  last_sync?: string;
  status: "active" | "inactive";
}

export interface GTMConfig extends ServiceConfig {
  registered_services?: ServiceRegistration[];
}

/**
 * Find parent GTM path from service config
 */
export function findGTMParent(servicePath: string): string | null {
  const configPath = path.join(servicePath, ".jfl", "config.json");

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const config: ServiceConfig = JSON.parse(
      fs.readFileSync(configPath, "utf-8")
    );
    return config.gtm_parent || null;
  } catch (error) {
    return null;
  }
}

/**
 * Validate GTM parent exists and is valid GTM workspace
 */
export function validateGTMParent(gtmPath: string): boolean {
  // Check directory exists
  if (!fs.existsSync(gtmPath)) {
    return false;
  }

  // Check .jfl/config.json exists
  const configPath = path.join(gtmPath, ".jfl", "config.json");
  if (!fs.existsSync(configPath)) {
    return false;
  }

  // Check it's actually a GTM
  try {
    const config: GTMConfig = JSON.parse(
      fs.readFileSync(configPath, "utf-8")
    );
    return config.type === "gtm";
  } catch (error) {
    return false;
  }
}

/**
 * Get registered services from GTM config
 */
export function getRegisteredServices(
  gtmPath: string
): ServiceRegistration[] {
  const configPath = path.join(gtmPath, ".jfl", "config.json");

  if (!fs.existsSync(configPath)) {
    return [];
  }

  try {
    const config: GTMConfig = JSON.parse(
      fs.readFileSync(configPath, "utf-8")
    );
    return config.registered_services || [];
  } catch (error) {
    return [];
  }
}

/**
 * Add service to GTM's registered_services array
 */
export function addServiceToGTM(
  gtmPath: string,
  serviceConfig: ServiceConfig
): void {
  const configPath = path.join(gtmPath, ".jfl", "config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(`GTM config not found: ${configPath}`);
  }

  try {
    const config: GTMConfig = JSON.parse(
      fs.readFileSync(configPath, "utf-8")
    );

    // Initialize registered_services if needed
    if (!config.registered_services) {
      config.registered_services = [];
    }

    // Check if already registered
    const existing = config.registered_services.find(
      (s) => s.name === serviceConfig.name
    );

    if (existing) {
      // Update existing
      existing.status = "active";
      existing.type = serviceConfig.service_type || "unknown";
    } else {
      // Add new
      const relativePath = path.relative(gtmPath, serviceConfig.gtm_parent || "");
      config.registered_services.push({
        name: serviceConfig.name,
        path: relativePath || ".",
        type: serviceConfig.service_type || "unknown",
        registered_at: new Date().toISOString(),
        status: "active",
      });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error: any) {
    throw new Error(`Failed to add service to GTM: ${error.message}`);
  }
}

/**
 * Update service sync timestamp in GTM config
 */
export function updateServiceSync(
  gtmPath: string,
  serviceName: string,
  timestamp: string
): void {
  const configPath = path.join(gtmPath, ".jfl", "config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(`GTM config not found: ${configPath}`);
  }

  try {
    const config: GTMConfig = JSON.parse(
      fs.readFileSync(configPath, "utf-8")
    );

    if (!config.registered_services) {
      config.registered_services = [];
    }

    const service = config.registered_services.find(
      (s) => s.name === serviceName
    );

    if (service) {
      service.last_sync = timestamp;
    } else {
      // Service not registered, add it
      config.registered_services.push({
        name: serviceName,
        path: ".",
        type: "unknown",
        registered_at: timestamp,
        last_sync: timestamp,
        status: "active",
      });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error: any) {
    throw new Error(`Failed to update service sync: ${error.message}`);
  }
}

/**
 * Sync journal entries from service to GTM
 */
export function syncJournalsToGTM(
  servicePath: string,
  gtmPath: string,
  serviceName: string
): number {
  const serviceJournalPath = path.join(servicePath, ".jfl", "journal");
  const gtmJournalPath = path.join(gtmPath, ".jfl", "journal");

  // Ensure GTM journal directory exists
  if (!fs.existsSync(gtmJournalPath)) {
    fs.mkdirSync(gtmJournalPath, { recursive: true });
  }

  // Check if service journal directory exists
  if (!fs.existsSync(serviceJournalPath)) {
    return 0;
  }

  let syncedCount = 0;

  // Get all journal files
  const journalFiles = fs
    .readdirSync(serviceJournalPath)
    .filter((f) => f.endsWith(".jsonl"));

  for (const file of journalFiles) {
    const sourcePath = path.join(serviceJournalPath, file);
    const targetName = `service-${serviceName}-${file}`;
    const targetPath = path.join(gtmJournalPath, targetName);

    // Copy journal file
    fs.copyFileSync(sourcePath, targetPath);
    syncedCount++;
  }

  return syncedCount;
}

/**
 * Git commit summary for phone home payload
 */
export interface GitCommitSummary {
  hash: string;
  message: string;
  author: string;
  timestamp: string;
  files_changed: number;
}

/**
 * Service sync payload - comprehensive session summary for GTM
 */
export interface ServiceSyncPayload {
  service_name: string;
  sync_timestamp: string;
  session_branch: string;
  session: {
    duration_seconds: number;
    start_time: string;
    end_time: string;
    work_description?: string;
  };
  git: {
    commits: GitCommitSummary[];
    files_changed: number;
    lines_added: number;
    lines_removed: number;
    branch_merged_to: string;
  };
  journal: {
    entry_count: number;
    types: {
      feature: number;
      fix: number;
      decision: number;
      discovery: number;
      milestone: number;
      other: number;
    };
  };
  health: {
    validation_results?: {
      errors: number;
      warnings: number;
      passed: number;
    };
    context_hub_connected: boolean;
    uncommitted_changes: boolean;
  };
  environment: {
    node_version: string;
    jfl_version: string;
    dependencies?: Record<string, string>;
  };
  content_synced: {
    knowledge_files: string[];
    content_files: string[];
    config_files: string[];
    claude_md_synced: boolean;
    custom_files: string[];
    total_bytes: number;
  };
  sync_config: {
    knowledge_enabled: boolean;
    content_enabled: boolean;
    config_enabled: boolean;
    detection_method: "git-diff" | "full-scan";
  };
  agent_notified: boolean;
  errors: string[];
}

/**
 * Detect files changed in current session using git diff
 */
async function detectChangedFiles(
  servicePath: string,
  sessionBranch: string,
  workingBranch: string
): Promise<{
  knowledge: string[];
  content: string[];
  config: string[];
  claude_md: boolean;
}> {
  
  const result = {
    knowledge: [] as string[],
    content: [] as string[],
    config: [] as string[],
    claude_md: false,
  };

  try {
    // Get all files changed between working branch and session branch
    const changedFiles = execSync(
      `git diff --name-only ${workingBranch}..HEAD`,
      { cwd: servicePath, encoding: "utf-8" }
    )
      .trim()
      .split("\n")
      .filter((f: string) => f.length > 0);

    for (const file of changedFiles) {
      if (file.startsWith("knowledge/")) {
        result.knowledge.push(file);
      } else if (file.startsWith("content/")) {
        result.content.push(file);
      } else if (
        file === ".jfl/config.json" ||
        file === "service.json" ||
        file === ".mcp.json"
      ) {
        result.config.push(file);
      } else if (file === "CLAUDE.md") {
        result.claude_md = true;
      }
    }
  } catch (error: any) {
    // If git diff fails, return empty (session has no commits yet)
  }

  return result;
}

/**
 * Ensure GTM service directory exists with all subdirectories
 */
function ensureGTMServiceDir(gtmPath: string, serviceName: string): void {
  const serviceDir = path.join(gtmPath, "services", serviceName);

  const dirs = [
    serviceDir,
    path.join(serviceDir, "knowledge"),
    path.join(serviceDir, "content"),
    path.join(serviceDir, "config"),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Sync directory from service to GTM
 */
async function syncDirectory(
  sourceDir: string,
  targetDir: string,
  files: string[]
): Promise<{
  synced: string[];
  failed: string[];
  bytes: number;
}> {
  const result = {
    synced: [] as string[],
    failed: [] as string[],
    bytes: 0,
  };

  // Ensure target directory exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  for (const file of files) {
    try {
      const sourcePath = path.join(sourceDir, "..", file); // file includes "knowledge/" prefix
      const relativePath = file.split("/").slice(1).join("/"); // Remove "knowledge/" prefix
      const targetPath = path.join(targetDir, relativePath);

      // Create subdirectories if needed
      const targetSubdir = path.dirname(targetPath);
      if (!fs.existsSync(targetSubdir)) {
        fs.mkdirSync(targetSubdir, { recursive: true });
      }

      // Copy file
      if (fs.existsSync(sourcePath)) {
        const content = fs.readFileSync(sourcePath);
        fs.writeFileSync(targetPath, content);
        result.synced.push(file);
        result.bytes += content.length;
      }
    } catch (error: any) {
      result.failed.push(file);
    }
  }

  return result;
}

/**
 * Sync config files to GTM's services/{name}/config/
 */
async function syncConfigFiles(
  servicePath: string,
  gtmPath: string,
  serviceName: string,
  configFiles: string[]
): Promise<string[]> {
  const targetDir = path.join(gtmPath, "services", serviceName, "config");
  const synced: string[] = [];

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  for (const file of configFiles) {
    try {
      const sourcePath = path.join(servicePath, file);
      const targetPath = path.join(
        targetDir,
        path.basename(file)
      );

      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, targetPath);
        synced.push(file);
      }
    } catch (error: any) {
      // Skip failed files
    }
  }

  return synced;
}

/**
 * Sync service's CLAUDE.md to GTM
 */
async function syncClaudeMd(
  servicePath: string,
  gtmPath: string,
  serviceName: string
): Promise<boolean> {
  const source = path.join(servicePath, "CLAUDE.md");
  const target = path.join(gtmPath, "services", serviceName, "CLAUDE.md");

  if (!fs.existsSync(source)) {
    return false;
  }

  try {
    fs.copyFileSync(source, target);
    return true;
  } catch (error: any) {
    return false;
  }
}

/**
 * Notify GTM agent about service sync
 * Appends event to .jfl/service-events.jsonl for agent to process
 */
async function notifyGTMAgent(
  gtmPath: string,
  serviceName: string,
  payload: ServiceSyncPayload
): Promise<boolean> {
  try {
    const eventsFile = path.join(gtmPath, ".jfl", "service-events.jsonl");

    // Ensure .jfl directory exists
    const jflDir = path.join(gtmPath, ".jfl");
    if (!fs.existsSync(jflDir)) {
      fs.mkdirSync(jflDir, { recursive: true });
    }

    const event = {
      timestamp: new Date().toISOString(),
      service: serviceName,
      type: "sync-complete",
      payload: {
        session_branch: payload.session_branch,
        duration_minutes: Math.floor(payload.session.duration_seconds / 60),
        commits: payload.git.commits.length,
        files_changed: payload.git.files_changed,
        journal_entries: payload.journal.entry_count,
        content_synced: payload.content_synced,
        health: payload.health,
        message: `Service ${serviceName} completed session - see services/${serviceName}/ for content`,
      },
    };

    fs.appendFileSync(eventsFile, JSON.stringify(event) + "\n");
    return true;
  } catch (error: any) {
    return false;
  }
}

/**
 * Phone home to GTM - comprehensive sync with full session metadata
 *
 * Collects everything the GTM needs to understand what happened in the service session:
 * - Session summary (duration, when it started/ended)
 * - Git activity (commits, files changed, lines added/removed)
 * - Journal data (entry count, types of work)
 * - Health status (validation, context hub, uncommitted changes)
 * - Environment metadata (versions, dependencies)
 * - Content sync (knowledge, content, config files)
 *
 * IMPORTANT: Never blocks session end. Collects all errors and returns partial success.
 */
export async function phoneHomeToGTM(
  servicePath: string,
  gtmPath: string,
  sessionBranch: string
): Promise<ServiceSyncPayload> {
  const errors: string[] = [];

  // Load service config
  const serviceConfig = loadServiceConfig(servicePath);
  const serviceName = serviceConfig.name;
  const workingBranch = serviceConfig.working_branch || "main";

  const syncTimestamp = new Date().toISOString();
  const endTime = new Date().toISOString();

  // ============================================================
  // Data Collection (parallel execution, never throws)
  // ============================================================

  // 1. Session Summary
  let sessionData: ServiceSyncPayload["session"] = {
    duration_seconds: 0,
    start_time: endTime,
    end_time: endTime,
  };

  try {
    

    // Get first commit timestamp in session
    const startTimestamp = execSync(
      `git log --format=%ct --reverse ${workingBranch}..HEAD 2>/dev/null | head -1`,
      { cwd: servicePath, encoding: "utf-8" }
    ).trim();

    if (startTimestamp) {
      const startTimeUnix = parseInt(startTimestamp);
      const endTimeUnix = Math.floor(Date.now() / 1000);
      sessionData.duration_seconds = endTimeUnix - startTimeUnix;
      sessionData.start_time = new Date(startTimeUnix * 1000).toISOString();
    }
  } catch (error: any) {
    errors.push(`Failed to calculate session duration: ${error.message}`);
  }

  // 2. Git Activity
  const gitData: ServiceSyncPayload["git"] = {
    commits: [],
    files_changed: 0,
    lines_added: 0,
    lines_removed: 0,
    branch_merged_to: workingBranch,
  };

  try {
    

    // Get commits
    const commitLog = execSync(
      `git log --format='%H|%s|%an|%ct' ${workingBranch}..HEAD`,
      { cwd: servicePath, encoding: "utf-8" }
    ).trim();

    if (commitLog) {
      const commitLines = commitLog.split("\n");
      for (const line of commitLines) {
        const [hash, message, author, timestamp] = line.split("|");
        gitData.commits.push({
          hash: hash.substring(0, 8),
          message,
          author,
          timestamp: new Date(parseInt(timestamp) * 1000).toISOString(),
          files_changed: 0, // Will be calculated if needed
        });
      }
    }

    // Get files changed
    const filesChanged = execSync(
      `git diff --name-only ${workingBranch}..HEAD | wc -l`,
      { cwd: servicePath, encoding: "utf-8" }
    ).trim();
    gitData.files_changed = parseInt(filesChanged) || 0;

    // Get lines changed
    const diffStat = execSync(
      `git diff --numstat ${workingBranch}..HEAD`,
      { cwd: servicePath, encoding: "utf-8" }
    ).trim();

    if (diffStat) {
      const lines = diffStat.split("\n");
      for (const line of lines) {
        const [added, removed] = line.split("\t");
        gitData.lines_added += parseInt(added) || 0;
        gitData.lines_removed += parseInt(removed) || 0;
      }
    }
  } catch (error: any) {
    errors.push(`Failed to collect git activity: ${error.message}`);
  }

  // 3. Journal Data
  const journalData: ServiceSyncPayload["journal"] = {
    entry_count: 0,
    types: {
      feature: 0,
      fix: 0,
      decision: 0,
      discovery: 0,
      milestone: 0,
      other: 0,
    },
  };

  try {
    const journalPath = path.join(servicePath, ".jfl", "journal");
    if (fs.existsSync(journalPath)) {
      const journalFiles = fs
        .readdirSync(journalPath)
        .filter((f) => f.endsWith(".jsonl"));

      for (const file of journalFiles) {
        const filePath = path.join(journalPath, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.trim().split("\n").filter((l) => l.length > 0);

        journalData.entry_count += lines.length;

        // Count by type
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            const type = entry.type || "other";
            if (type in journalData.types) {
              journalData.types[type as keyof typeof journalData.types]++;
            } else {
              journalData.types.other++;
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
    }
  } catch (error: any) {
    errors.push(`Failed to collect journal data: ${error.message}`);
  }

  // 4. Health Status
  const healthData: ServiceSyncPayload["health"] = {
    context_hub_connected: false,
    uncommitted_changes: false,
  };

  try {
    

    // Check uncommitted changes
    try {
      execSync("git diff --quiet && git diff --cached --quiet", {
        cwd: servicePath,
      });
      healthData.uncommitted_changes = false;
    } catch {
      healthData.uncommitted_changes = true;
    }

    // Check Context Hub connectivity
    try {
      
      await axios.get("http://localhost:4242/health", { timeout: 1000 });
      healthData.context_hub_connected = true;
    } catch {
      healthData.context_hub_connected = false;
    }

    // Run validation if available
    try {
      const validationResult = execSync(
        "jfl services validate --json 2>/dev/null || echo '{}'",
        { cwd: servicePath, encoding: "utf-8" }
      ).trim();

      const validation = JSON.parse(validationResult);
      if (validation.summary) {
        healthData.validation_results = {
          errors: validation.summary.errors || 0,
          warnings: validation.summary.warnings || 0,
          passed: validation.summary.passed || 0,
        };
      }
    } catch {
      // Validation not available or failed
    }
  } catch (error: any) {
    errors.push(`Failed to collect health status: ${error.message}`);
  }

  // 5. Environment Metadata
  const environmentData: ServiceSyncPayload["environment"] = {
    node_version: process.version,
    jfl_version: "unknown",
  };

  try {
    // Try to get JFL version
    
    const jflVersion = execSync("jfl --version 2>/dev/null || echo 'unknown'", {
      encoding: "utf-8",
    }).trim();
    environmentData.jfl_version = jflVersion;

    // Get key dependencies from package.json
    const packageJsonPath = path.join(servicePath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      environmentData.dependencies = packageJson.dependencies || {};
    }
  } catch (error: any) {
    errors.push(`Failed to collect environment metadata: ${error.message}`);
  }

  // ============================================================
  // Content Sync (knowledge, content, config files)
  // ============================================================

  // Ensure GTM service directory structure exists
  ensureGTMServiceDir(gtmPath, serviceName);

  // Detect changed files
  const changedFiles = await detectChangedFiles(
    servicePath,
    sessionBranch,
    workingBranch
  );

  // Initialize content sync tracking
  const contentSyncData: ServiceSyncPayload["content_synced"] = {
    knowledge_files: [],
    content_files: [],
    config_files: [],
    claude_md_synced: false,
    custom_files: [],
    total_bytes: 0,
  };

  // Sync knowledge directory (if enabled)
  if (
    serviceConfig.sync_to_parent?.knowledge &&
    changedFiles.knowledge.length > 0
  ) {
    try {
      const result = await syncDirectory(
        path.join(servicePath, "knowledge"),
        path.join(gtmPath, "services", serviceName, "knowledge"),
        changedFiles.knowledge
      );
      contentSyncData.knowledge_files = result.synced;
      contentSyncData.total_bytes += result.bytes;

      if (result.failed.length > 0) {
        errors.push(
          `Failed to sync ${result.failed.length} knowledge files: ${result.failed.join(", ")}`
        );
      }
    } catch (error: any) {
      errors.push(`Knowledge sync failed: ${error.message}`);
    }
  }

  // Sync content directory (if enabled)
  if (
    serviceConfig.sync_to_parent?.content &&
    changedFiles.content.length > 0
  ) {
    try {
      const result = await syncDirectory(
        path.join(servicePath, "content"),
        path.join(gtmPath, "services", serviceName, "content"),
        changedFiles.content
      );
      contentSyncData.content_files = result.synced;
      contentSyncData.total_bytes += result.bytes;

      if (result.failed.length > 0) {
        errors.push(
          `Failed to sync ${result.failed.length} content files: ${result.failed.join(", ")}`
        );
      }
    } catch (error: any) {
      errors.push(`Content sync failed: ${error.message}`);
    }
  }

  // Sync config files (always enabled)
  if (changedFiles.config.length > 0) {
    try {
      const synced = await syncConfigFiles(
        servicePath,
        gtmPath,
        serviceName,
        changedFiles.config
      );
      contentSyncData.config_files = synced;

      // Calculate bytes for config files
      for (const file of synced) {
        try {
          const filePath = path.join(servicePath, file);
          const stats = fs.statSync(filePath);
          contentSyncData.total_bytes += stats.size;
        } catch {
          // Skip if can't stat
        }
      }
    } catch (error: any) {
      errors.push(`Config sync failed: ${error.message}`);
    }
  }

  // Sync CLAUDE.md (if changed)
  if (changedFiles.claude_md) {
    try {
      const synced = await syncClaudeMd(servicePath, gtmPath, serviceName);
      contentSyncData.claude_md_synced = synced;

      if (synced) {
        try {
          const stats = fs.statSync(path.join(servicePath, "CLAUDE.md"));
          contentSyncData.total_bytes += stats.size;
        } catch {
          // Skip if can't stat
        }
      }
    } catch (error: any) {
      errors.push(`CLAUDE.md sync failed: ${error.message}`);
    }
  }

  // ============================================================
  // Build Final Payload (before using it in journal entry)
  // ============================================================

  const payload: ServiceSyncPayload = {
    service_name: serviceName,
    sync_timestamp: syncTimestamp,
    session_branch: sessionBranch,
    session: sessionData,
    git: gitData,
    journal: journalData,
    health: healthData,
    environment: environmentData,
    content_synced: contentSyncData,
    sync_config: {
      knowledge_enabled: serviceConfig.sync_to_parent?.knowledge || false,
      content_enabled: serviceConfig.sync_to_parent?.content || false,
      config_enabled: true,
      detection_method: "git-diff",
    },
    agent_notified: false,
    errors,
  };

  // ============================================================
  // Sync Operations (never blocks session end)
  // ============================================================

  // 1. Copy journal files (reuse existing function)
  try {
    syncJournalsToGTM(servicePath, gtmPath, serviceName);
  } catch (error: any) {
    errors.push(`Failed to sync journal files: ${error.message}`);
  }

  // 2. Write comprehensive journal entry to GTM
  try {
    const gtmSession = execSync("git branch --show-current 2>/dev/null || echo 'main'", {
        cwd: gtmPath,
        encoding: "utf-8",
      })
      .trim();

    const gtmJournalPath = path.join(
      gtmPath,
      ".jfl",
      "journal",
      `${gtmSession}.jsonl`
    );

    // Build detail string with content sync info
    let detailParts: string[] = [];
    detailParts.push(`Session Duration: ${Math.floor(sessionData.duration_seconds / 60)}min`);
    detailParts.push(
      `Git: ${gitData.commits.length} commits, ${gitData.files_changed} files, +${gitData.lines_added}/-${gitData.lines_removed} lines`
    );

    if (gitData.commits.length > 0) {
      detailParts.push(
        `Commits:\n  ${gitData.commits.map((c) => `${c.hash} ${c.message}`).join("\n  ")}`
      );
    }

    detailParts.push(`Journal: ${journalData.entry_count} entries`);

    // Add content sync details
    const totalContentFiles =
      contentSyncData.knowledge_files.length +
      contentSyncData.content_files.length +
      contentSyncData.config_files.length;

    if (totalContentFiles > 0 || contentSyncData.claude_md_synced) {
      let contentParts: string[] = [];
      if (contentSyncData.knowledge_files.length > 0) {
        contentParts.push(
          `knowledge (${contentSyncData.knowledge_files.length} files)`
        );
      }
      if (contentSyncData.content_files.length > 0) {
        contentParts.push(
          `content (${contentSyncData.content_files.length} files)`
        );
      }
      if (contentSyncData.config_files.length > 0) {
        contentParts.push(
          `config (${contentSyncData.config_files.length} files)`
        );
      }
      if (contentSyncData.claude_md_synced) {
        contentParts.push("CLAUDE.md");
      }

      const bytesStr =
        contentSyncData.total_bytes > 1024 * 1024
          ? `${(contentSyncData.total_bytes / (1024 * 1024)).toFixed(1)}MB`
          : contentSyncData.total_bytes > 1024
          ? `${(contentSyncData.total_bytes / 1024).toFixed(1)}KB`
          : `${contentSyncData.total_bytes} bytes`;

      detailParts.push(
        `Content Synced: ${contentParts.join(", ")} (${bytesStr})`
      );
    }

    if (healthData.validation_results) {
      detailParts.push(
        `Health: ${healthData.validation_results.passed} passed, ${healthData.validation_results.warnings} warnings, ${healthData.validation_results.errors} errors`
      );
    }

    detailParts.push(
      `Environment: Node ${environmentData.node_version}, JFL ${environmentData.jfl_version}`
    );

    if (errors.length > 0) {
      detailParts.push(`Errors: ${errors.join("; ")}`);
    }

    const comprehensiveEntry = {
      v: 1,
      ts: syncTimestamp,
      session: gtmSession,
      type: "service-sync",
      status: "complete",
      title: `Service sync: ${serviceName}`,
      summary: `${Math.floor(sessionData.duration_seconds / 60)}min session with ${gitData.commits.length} commits, ${journalData.entry_count} journal entries`,
      detail: detailParts.join("\n"),
      service: serviceName,
      session_branch: sessionBranch,
      sync_payload: payload,
    };

    fs.appendFileSync(gtmJournalPath, JSON.stringify(comprehensiveEntry) + "\n");
  } catch (error: any) {
    errors.push(`Failed to write GTM journal entry: ${error.message}`);
  }

  // 3. Update GTM's registered_services with enhanced metadata
  try {
    updateServiceSync(gtmPath, serviceName, syncTimestamp);
  } catch (error: any) {
    errors.push(`Failed to update GTM registered_services: ${error.message}`);
  }

  // 4. Create dedicated sync log
  try {
    const syncLogDir = path.join(gtmPath, ".jfl", "service-syncs");
    if (!fs.existsSync(syncLogDir)) {
      fs.mkdirSync(syncLogDir, { recursive: true });
    }

    const syncLogPath = path.join(syncLogDir, `${serviceName}.jsonl`);
    const syncLogEntry = {
      timestamp: syncTimestamp,
      session_branch: sessionBranch,
      commits: gitData.commits.length,
      files_changed: gitData.files_changed,
      lines_added: gitData.lines_added,
      lines_removed: gitData.lines_removed,
      journal_entries: journalData.entry_count,
      duration_minutes: Math.floor(sessionData.duration_seconds / 60),
      content_synced: contentSyncData,
      errors: errors.length > 0 ? errors : undefined,
    };

    fs.appendFileSync(syncLogPath, JSON.stringify(syncLogEntry) + "\n");
  } catch (error: any) {
    errors.push(`Failed to create sync log: ${error.message}`);
  }

  // 5. Notify GTM agent
  try {
    const notified = await notifyGTMAgent(gtmPath, serviceName, payload);
    payload.agent_notified = notified;

    // Write trigger file for GTM hooks to detect
    if (notified) {
      const inboxDir = path.join(gtmPath, ".jfl", "inbox");
      if (!fs.existsSync(inboxDir)) {
        fs.mkdirSync(inboxDir, { recursive: true });
      }

      const triggerFile = path.join(inboxDir, `service-update-${serviceName}-${Date.now()}.trigger`);
      fs.writeFileSync(triggerFile, JSON.stringify({
        service: serviceName,
        timestamp: syncTimestamp,
        message: `Service ${serviceName} completed session - agent notification ready`
      }));
    }
  } catch (error: any) {
    errors.push(`Agent notification failed: ${error.message}`);
    payload.agent_notified = false;
  }

  // ============================================================
  // Return Acknowledgment
  // ============================================================

  return payload;
}

/**
 * Helper: Load service config with error handling
 */
function loadServiceConfig(servicePath: string): ServiceConfig {
  const configPath = path.join(servicePath, ".jfl", "config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(`Service config not found: ${configPath}`);
  }

  try {
    const config: ServiceConfig = JSON.parse(
      fs.readFileSync(configPath, "utf-8")
    );
    return config;
  } catch (error: any) {
    throw new Error(`Failed to load service config: ${error.message}`);
  }
}
