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
import { getProjectHubUrl } from "../utils/context-hub-port.js";

// ============================================================
// Public Interfaces
// ============================================================

export interface ServiceConfig {
  name: string;
  type: "service" | "gtm" | "portfolio";
  service_type?: "web" | "api" | "worker" | "daemon" | "cli" | "infrastructure" | "container" | "library";
  description: string;
  gtm_parent?: string;
  portfolio_parent?: string;
  working_branch?: string;
  context_scope?: ContextScope;
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

export interface ContextScope {
  produces?: string[];
  consumes?: string[];
  denied?: string[];
}

export interface ServiceRegistration {
  name: string;
  path: string;
  type: string;
  registered_at: string;
  last_sync?: string;
  status: "active" | "inactive";
  context_scope?: ContextScope;
}

export interface GTMConfig extends ServiceConfig {
  registered_services?: ServiceRegistration[];
}

/**
 * Shared type for journal entry type counts
 */
export interface JournalTypeCounts {
  feature: number;
  fix: number;
  decision: number;
  discovery: number;
  milestone: number;
  other: number;
}

/**
 * Git commit summary for phone home payloads
 */
export interface GitCommitSummary {
  hash: string;
  message: string;
  author: string;
  timestamp: string;
  files_changed: number;
}

/**
 * Base sync payload — common fields shared by both service→GTM and GTM→portfolio syncs
 */
export interface BaseSyncPayload {
  sync_timestamp: string;
  session_branch: string;
  git: {
    commits: GitCommitSummary[];
    files_changed: number;
    lines_added: number;
    lines_removed: number;
  };
  journal: {
    entry_count: number;
    types: JournalTypeCounts;
  };
  agent_notified: boolean;
  errors: string[];
}

/**
 * Service sync payload — comprehensive session summary for GTM (service→GTM direction)
 */
export interface ServiceSyncPayload extends BaseSyncPayload {
  service_name: string;
  session: {
    duration_seconds: number;
    start_time: string;
    end_time: string;
    work_description?: string;
  };
  git: BaseSyncPayload["git"] & { branch_merged_to: string };
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
}

/**
 * GTM sync payload — journal summary for portfolio (GTM→portfolio direction)
 */
export interface GTMSyncPayload extends BaseSyncPayload {
  gtm_name: string;
  git: BaseSyncPayload["git"] & { working_branch: string };
  journal: BaseSyncPayload["journal"] & {
    since: string;
    files_aggregated: string[];
    incomplete_aggregated: string[];
    next_steps: string[];
  };
}

// ============================================================
// Internal Types
// ============================================================

/** Raw data collected by collectSyncData() — used by both phone-home functions */
interface CollectedSyncData {
  git: {
    commits: GitCommitSummary[];
    files_changed: number;
    lines_added: number;
    lines_removed: number;
  };
  journal: {
    entry_count: number;
    types: JournalTypeCounts;
    files_aggregated: string[];
    incomplete_aggregated: string[];
    next_steps: string[];
    files_processed: string[];
  };
  session: {
    duration_seconds: number;
    start_time: string;
    end_time: string;
  };
  errors: string[];
}

/** Options for writeSyncToParent() */
interface WriteSyncOptions {
  /** Prefix for copied journal files, e.g. "service-" or "gtm-" */
  filePrefix: string;
  /** Hub event type, e.g. "service:phone-home" or "portfolio:gtm-sync" */
  eventType: string;
  /** Prefix for inbox trigger filename */
  triggerPrefix: string;
  /** Data written to the trigger file */
  triggerData: Record<string, unknown>;
  /** Journal entry to append to parent — `session` field is filled in by writeSyncToParent */
  journalEntryBase: Record<string, unknown>;
}

// ============================================================
// Utility Functions (unchanged public API)
// ============================================================

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
 * Find portfolio parent path from GTM config
 */
export function findPortfolioParent(gtmPath: string): string | null {
  const configPath = path.join(gtmPath, ".jfl", "config.json");

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const config: ServiceConfig = JSON.parse(
      fs.readFileSync(configPath, "utf-8")
    );
    return config.portfolio_parent || null;
  } catch (error) {
    return null;
  }
}

/**
 * Get full parent chain: service → GTM → portfolio
 */
export function getParentChain(projectPath: string): string[] {
  const chain: string[] = [];
  const config = loadServiceConfig(projectPath);

  if (config.type === "service" && config.gtm_parent) {
    chain.push(config.gtm_parent);
    const portfolioParent = findPortfolioParent(config.gtm_parent);
    if (portfolioParent) chain.push(portfolioParent);
  } else if (config.type === "gtm" && config.portfolio_parent) {
    chain.push(config.portfolio_parent);
  }

  return chain;
}

/**
 * Validate GTM parent exists and is valid GTM workspace
 */
export function validateGTMParent(gtmPath: string): boolean {
  if (!fs.existsSync(gtmPath)) {
    return false;
  }

  const configPath = path.join(gtmPath, ".jfl", "config.json");
  if (!fs.existsSync(configPath)) {
    return false;
  }

  try {
    const config: GTMConfig = JSON.parse(
      fs.readFileSync(configPath, "utf-8")
    );
    return config.type === "gtm" || config.type === "portfolio";
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

    if (!config.registered_services) {
      config.registered_services = [];
    }

    const existing = config.registered_services.find(
      (s) => s.name === serviceConfig.name
    );

    if (existing) {
      existing.status = "active";
      existing.type = serviceConfig.service_type || "unknown";
    } else {
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

  if (!fs.existsSync(gtmJournalPath)) {
    fs.mkdirSync(gtmJournalPath, { recursive: true });
  }

  if (!fs.existsSync(serviceJournalPath)) {
    return 0;
  }

  let syncedCount = 0;

  const journalFiles = fs
    .readdirSync(serviceJournalPath)
    .filter((f) => f.endsWith(".jsonl"));

  for (const file of journalFiles) {
    const sourcePath = path.join(serviceJournalPath, file);
    const targetName = `service-${serviceName}-${file}`;
    const targetPath = path.join(gtmJournalPath, targetName);

    fs.copyFileSync(sourcePath, targetPath);
    syncedCount++;
  }

  return syncedCount;
}

// ============================================================
// Private Helpers (unchanged)
// ============================================================

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

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  for (const file of files) {
    try {
      const sourcePath = path.join(sourceDir, "..", file);
      const relativePath = file.split("/").slice(1).join("/");
      const targetPath = path.join(targetDir, relativePath);

      const targetSubdir = path.dirname(targetPath);
      if (!fs.existsSync(targetSubdir)) {
        fs.mkdirSync(targetSubdir, { recursive: true });
      }

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
      const targetPath = path.join(targetDir, path.basename(file));

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

// ============================================================
// Shared Sync Primitives
// ============================================================

/**
 * Collect git activity, journal data, and session duration from a project.
 *
 * Used by both phoneHomeToGTM (service→GTM) and phoneHomeToPortfolio (GTM→portfolio)
 * to avoid duplicating data-gathering logic.
 *
 * @param sourcePath  - Root of the project being inspected
 * @param workingBranch - Base branch for git diff stats
 * @param options.since - ISO timestamp: filter journal entries and git commits after this time.
 *                        When omitted, reads all journal entries and uses workingBranch..HEAD for commits.
 * @param options.excludeFilePrefix - Skip journal files whose filename starts with this prefix
 */
function collectSyncData(
  sourcePath: string,
  workingBranch: string,
  options?: {
    since?: string;
    excludeFilePrefix?: string;
  }
): CollectedSyncData {
  const { since, excludeFilePrefix } = options ?? {};
  const errors: string[] = [];
  const now = new Date().toISOString();

  // --- Git activity ---
  const git: CollectedSyncData["git"] = {
    commits: [],
    files_changed: 0,
    lines_added: 0,
    lines_removed: 0,
  };

  try {
    // Commits: date-filtered when `since` is provided, branch-diff otherwise
    const commitRange = since
      ? `--since="${new Date(since).toISOString()}"`
      : `${workingBranch}..HEAD`;

    const commitLog = execSync(
      `git log --format='%H|%s|%an|%ct' ${commitRange} 2>/dev/null || true`,
      { cwd: sourcePath, encoding: "utf-8" }
    ).trim();

    if (commitLog) {
      for (const line of commitLog.split("\n").filter((l) => l.length > 0)) {
        const [hash, message, author, timestamp] = line.split("|");
        git.commits.push({
          hash: hash.substring(0, 8),
          message,
          author,
          timestamp: new Date(parseInt(timestamp) * 1000).toISOString(),
          files_changed: 0,
        });
      }
    }

    // Files changed and line stats always use branch-diff for accuracy
    const filesChanged = execSync(
      `git diff --name-only ${workingBranch}..HEAD 2>/dev/null | wc -l || echo 0`,
      { cwd: sourcePath, encoding: "utf-8" }
    ).trim();
    git.files_changed = parseInt(filesChanged) || 0;

    const diffStat = execSync(
      `git diff --numstat ${workingBranch}..HEAD 2>/dev/null || true`,
      { cwd: sourcePath, encoding: "utf-8" }
    ).trim();

    if (diffStat) {
      for (const line of diffStat.split("\n")) {
        const [added, removed] = line.split("\t");
        git.lines_added += parseInt(added) || 0;
        git.lines_removed += parseInt(removed) || 0;
      }
    }
  } catch (error: any) {
    errors.push(`Failed to collect git activity: ${error.message}`);
  }

  // --- Session duration ---
  const session: CollectedSyncData["session"] = {
    duration_seconds: 0,
    start_time: now,
    end_time: now,
  };

  try {
    const startTimestamp = execSync(
      `git log --format=%ct --reverse ${workingBranch}..HEAD 2>/dev/null | head -1`,
      { cwd: sourcePath, encoding: "utf-8" }
    ).trim();

    if (startTimestamp) {
      const startTimeUnix = parseInt(startTimestamp);
      const endTimeUnix = Math.floor(Date.now() / 1000);
      session.duration_seconds = endTimeUnix - startTimeUnix;
      session.start_time = new Date(startTimeUnix * 1000).toISOString();
    }
  } catch (error: any) {
    errors.push(`Failed to calculate session duration: ${error.message}`);
  }

  // --- Journal data ---
  const journal: CollectedSyncData["journal"] = {
    entry_count: 0,
    types: { feature: 0, fix: 0, decision: 0, discovery: 0, milestone: 0, other: 0 },
    files_aggregated: [],
    incomplete_aggregated: [],
    next_steps: [],
    files_processed: [],
  };

  try {
    const journalDir = path.join(sourcePath, ".jfl", "journal");
    if (fs.existsSync(journalDir)) {
      const journalFiles = fs
        .readdirSync(journalDir)
        .filter(
          (f) =>
            f.endsWith(".jsonl") &&
            (!excludeFilePrefix || !f.startsWith(excludeFilePrefix))
        );

      journal.files_processed = journalFiles;

      for (const file of journalFiles) {
        const content = fs.readFileSync(path.join(journalDir, file), "utf-8");
        const lines = content.trim().split("\n").filter((l) => l.length > 0);

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);

            if (since && entry.ts && entry.ts < since) continue;

            journal.entry_count++;

            const type = entry.type || "other";
            if (type in journal.types) {
              journal.types[type as keyof JournalTypeCounts]++;
            } else {
              journal.types.other++;
            }

            if (Array.isArray(entry.files)) {
              for (const f of entry.files) {
                if (!journal.files_aggregated.includes(f)) {
                  journal.files_aggregated.push(f);
                }
              }
            }

            if (Array.isArray(entry.incomplete)) {
              for (const item of entry.incomplete) {
                if (!journal.incomplete_aggregated.includes(item)) {
                  journal.incomplete_aggregated.push(item);
                }
              }
            }

            if (entry.next && !journal.next_steps.includes(entry.next)) {
              journal.next_steps.push(entry.next);
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

  return { git, journal, session, errors };
}

/**
 * Write a child's sync data to a parent workspace.
 *
 * Handles the five operations common to both phone-home directions:
 * 1. Ensure parent journal directory exists
 * 2. Copy child journal files to parent with a prefix
 * 3. Append aggregated journal entry to parent's current-branch journal
 * 4. Update registered_services.last_sync in parent config
 * 5. Write inbox trigger + emit Context Hub event (both non-fatal)
 *
 * Returns true if the hub event was successfully emitted (agent_notified).
 */
async function writeSyncToParent(
  parentPath: string,
  childName: string,
  sourceJournalDir: string,
  journalFilesToCopy: string[],
  options: WriteSyncOptions,
  errors: string[],
  syncTimestamp: string
): Promise<boolean> {
  const parentJournalPath = path.join(parentPath, ".jfl", "journal");

  // 1. Ensure parent journal dir
  try {
    if (!fs.existsSync(parentJournalPath)) {
      fs.mkdirSync(parentJournalPath, { recursive: true });
    }
  } catch (error: any) {
    errors.push(`Failed to create parent journal dir: ${error.message}`);
  }

  // 2. Copy journal files with prefix
  try {
    if (fs.existsSync(sourceJournalDir) && fs.existsSync(parentJournalPath)) {
      for (const file of journalFilesToCopy) {
        const src = path.join(sourceJournalDir, file);
        const dst = path.join(parentJournalPath, `${options.filePrefix}${childName}-${file}`);
        fs.copyFileSync(src, dst);
      }
    }
  } catch (error: any) {
    errors.push(`Failed to copy journal files to parent: ${error.message}`);
  }

  // 3. Append aggregated journal entry to parent's current-branch journal
  try {
    const parentBranch = execSync(
      "git branch --show-current 2>/dev/null || echo 'main'",
      { cwd: parentPath, encoding: "utf-8" }
    ).trim() || "main";

    const parentJournalFile = path.join(parentJournalPath, `${parentBranch}.jsonl`);
    const entry = { ...options.journalEntryBase, session: parentBranch };
    fs.appendFileSync(parentJournalFile, JSON.stringify(entry) + "\n");
  } catch (error: any) {
    errors.push(`Failed to write parent journal entry: ${error.message}`);
  }

  // 4. Update registered_services.last_sync
  try {
    updateServiceSync(parentPath, childName, syncTimestamp);
  } catch (error: any) {
    errors.push(`Failed to update parent registered_services: ${error.message}`);
  }

  // 5a. Write inbox trigger
  try {
    const inboxDir = path.join(parentPath, ".jfl", "inbox");
    if (!fs.existsSync(inboxDir)) {
      fs.mkdirSync(inboxDir, { recursive: true });
    }

    const triggerFile = path.join(
      inboxDir,
      `${options.triggerPrefix}${childName}-${Date.now()}.trigger`
    );
    fs.writeFileSync(triggerFile, JSON.stringify(options.triggerData));
  } catch (error: any) {
    errors.push(`Failed to write inbox trigger: ${error.message}`);
  }

  // 5b. Emit Context Hub event (non-fatal — hub not running is the expected case)
  let agentNotified = false;
  try {
    const tokenPath = path.join(parentPath, ".jfl", "context-hub.token");
    if (fs.existsSync(tokenPath)) {
      const token = fs.readFileSync(tokenPath, "utf-8").trim();
      const { getProjectPort } = await import("../utils/context-hub-port.js");
      const port = getProjectPort(parentPath);
      await fetch(`http://localhost:${port}/api/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: options.eventType,
          source: childName,
          data: options.journalEntryBase,
        }),
        signal: AbortSignal.timeout(5000),
      });
      agentNotified = true;
    }
  } catch {
    // Non-fatal
  }

  return agentNotified;
}

// ============================================================
// Public Phone-Home Functions
// ============================================================

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

  const serviceConfig = loadServiceConfig(servicePath);
  const serviceName = serviceConfig.name;
  const workingBranch = serviceConfig.working_branch || "main";
  const syncTimestamp = new Date().toISOString();

  // --- Shared data collection ---
  const syncData = collectSyncData(servicePath, workingBranch);
  errors.push(...syncData.errors);

  // --- Health Status (service→GTM specific) ---
  const healthData: ServiceSyncPayload["health"] = {
    context_hub_connected: false,
    uncommitted_changes: false,
  };

  try {
    try {
      execSync("git diff --quiet && git diff --cached --quiet", {
        cwd: servicePath,
      });
      healthData.uncommitted_changes = false;
    } catch {
      healthData.uncommitted_changes = true;
    }

    try {
      await axios.get(`${getProjectHubUrl(servicePath)}/health`, { timeout: 1000 });
      healthData.context_hub_connected = true;
    } catch {
      healthData.context_hub_connected = false;
    }

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

  // --- Environment Metadata (service→GTM specific) ---
  const environmentData: ServiceSyncPayload["environment"] = {
    node_version: process.version,
    jfl_version: "unknown",
  };

  try {
    const jflVersion = execSync("jfl --version 2>/dev/null || echo 'unknown'", {
      encoding: "utf-8",
    }).trim();
    environmentData.jfl_version = jflVersion;

    const packageJsonPath = path.join(servicePath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      environmentData.dependencies = packageJson.dependencies || {};
    }
  } catch (error: any) {
    errors.push(`Failed to collect environment metadata: ${error.message}`);
  }

  // --- Content Sync (service→GTM specific) ---
  ensureGTMServiceDir(gtmPath, serviceName);

  const changedFiles = await detectChangedFiles(
    servicePath,
    sessionBranch,
    workingBranch
  );

  const contentSyncData: ServiceSyncPayload["content_synced"] = {
    knowledge_files: [],
    content_files: [],
    config_files: [],
    claude_md_synced: false,
    custom_files: [],
    total_bytes: 0,
  };

  if (serviceConfig.sync_to_parent?.knowledge && changedFiles.knowledge.length > 0) {
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

  if (serviceConfig.sync_to_parent?.content && changedFiles.content.length > 0) {
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

  if (changedFiles.config.length > 0) {
    try {
      const synced = await syncConfigFiles(
        servicePath,
        gtmPath,
        serviceName,
        changedFiles.config
      );
      contentSyncData.config_files = synced;

      for (const file of synced) {
        try {
          contentSyncData.total_bytes += fs.statSync(path.join(servicePath, file)).size;
        } catch {
          // Skip
        }
      }
    } catch (error: any) {
      errors.push(`Config sync failed: ${error.message}`);
    }
  }

  if (changedFiles.claude_md) {
    try {
      const synced = await syncClaudeMd(servicePath, gtmPath, serviceName);
      contentSyncData.claude_md_synced = synced;

      if (synced) {
        try {
          contentSyncData.total_bytes += fs.statSync(path.join(servicePath, "CLAUDE.md")).size;
        } catch {
          // Skip
        }
      }
    } catch (error: any) {
      errors.push(`CLAUDE.md sync failed: ${error.message}`);
    }
  }

  // --- Build payload ---
  const payload: ServiceSyncPayload = {
    service_name: serviceName,
    sync_timestamp: syncTimestamp,
    session_branch: sessionBranch,
    session: syncData.session,
    git: { ...syncData.git, branch_merged_to: workingBranch },
    journal: {
      entry_count: syncData.journal.entry_count,
      types: syncData.journal.types,
    },
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

  // --- Build GTM journal entry ---
  const detailParts: string[] = [];
  detailParts.push(`Session Duration: ${Math.floor(syncData.session.duration_seconds / 60)}min`);
  detailParts.push(
    `Git: ${syncData.git.commits.length} commits, ${syncData.git.files_changed} files, +${syncData.git.lines_added}/-${syncData.git.lines_removed} lines`
  );

  if (syncData.git.commits.length > 0) {
    detailParts.push(
      `Commits:\n  ${syncData.git.commits.map((c) => `${c.hash} ${c.message}`).join("\n  ")}`
    );
  }

  detailParts.push(`Journal: ${syncData.journal.entry_count} entries`);

  const totalContentFiles =
    contentSyncData.knowledge_files.length +
    contentSyncData.content_files.length +
    contentSyncData.config_files.length;

  if (totalContentFiles > 0 || contentSyncData.claude_md_synced) {
    const contentParts: string[] = [];
    if (contentSyncData.knowledge_files.length > 0)
      contentParts.push(`knowledge (${contentSyncData.knowledge_files.length} files)`);
    if (contentSyncData.content_files.length > 0)
      contentParts.push(`content (${contentSyncData.content_files.length} files)`);
    if (contentSyncData.config_files.length > 0)
      contentParts.push(`config (${contentSyncData.config_files.length} files)`);
    if (contentSyncData.claude_md_synced) contentParts.push("CLAUDE.md");

    const bytesStr =
      contentSyncData.total_bytes > 1024 * 1024
        ? `${(contentSyncData.total_bytes / (1024 * 1024)).toFixed(1)}MB`
        : contentSyncData.total_bytes > 1024
        ? `${(contentSyncData.total_bytes / 1024).toFixed(1)}KB`
        : `${contentSyncData.total_bytes} bytes`;

    detailParts.push(`Content Synced: ${contentParts.join(", ")} (${bytesStr})`);
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

  const journalEntryBase = {
    v: 1,
    ts: syncTimestamp,
    type: "service-sync",
    status: "complete",
    title: `Service sync: ${serviceName}`,
    summary: `${Math.floor(syncData.session.duration_seconds / 60)}min session with ${syncData.git.commits.length} commits, ${syncData.journal.entry_count} journal entries`,
    detail: detailParts.join("\n"),
    service: serviceName,
    session_branch: sessionBranch,
    sync_payload: payload,
  };

  // --- Write to GTM (journal copy + entry + last_sync + inbox + hub event) ---
  const sourceJournalDir = path.join(servicePath, ".jfl", "journal");
  const agentNotified = await writeSyncToParent(
    gtmPath,
    serviceName,
    sourceJournalDir,
    syncData.journal.files_processed,
    {
      filePrefix: "service-",
      eventType: "service:phone-home",
      triggerPrefix: "service-update-",
      triggerData: {
        service: serviceName,
        timestamp: syncTimestamp,
        message: `Service ${serviceName} completed session - agent notification ready`,
      },
      journalEntryBase,
    },
    errors,
    syncTimestamp
  );
  payload.agent_notified = agentNotified;

  // --- Sync log (GTM-specific, not shared) ---
  try {
    const syncLogDir = path.join(gtmPath, ".jfl", "service-syncs");
    if (!fs.existsSync(syncLogDir)) {
      fs.mkdirSync(syncLogDir, { recursive: true });
    }

    const syncLogEntry = {
      timestamp: syncTimestamp,
      session_branch: sessionBranch,
      commits: syncData.git.commits.length,
      files_changed: syncData.git.files_changed,
      lines_added: syncData.git.lines_added,
      lines_removed: syncData.git.lines_removed,
      journal_entries: syncData.journal.entry_count,
      duration_minutes: Math.floor(syncData.session.duration_seconds / 60),
      content_synced: contentSyncData,
      errors: errors.length > 0 ? errors : undefined,
    };

    fs.appendFileSync(
      path.join(syncLogDir, `${serviceName}.jsonl`),
      JSON.stringify(syncLogEntry) + "\n"
    );
  } catch (error: any) {
    errors.push(`Failed to create sync log: ${error.message}`);
  }

  // --- GTM agent notification (writes to service-events.jsonl, GTM-specific) ---
  try {
    const notified = await notifyGTMAgent(gtmPath, serviceName, payload);
    payload.agent_notified = payload.agent_notified || notified;
  } catch (error: any) {
    errors.push(`Agent notification failed: ${error.message}`);
  }

  return payload;
}

/**
 * Phone home to Portfolio - sync full GTM journal content up to parent portfolio
 *
 * Reads GTM journal entries since last sync, copies journal files to portfolio,
 * writes aggregated service-sync entry to portfolio journal, and emits a hub event.
 *
 * IMPORTANT: Never blocks session end. Collects all errors and returns partial success.
 */
export async function phoneHomeToPortfolio(
  gtmPath: string,
  portfolioPath: string,
  sessionBranch: string
): Promise<GTMSyncPayload> {
  const errors: string[] = [];

  // Load and validate portfolio config
  const portfolioConfigPath = path.join(portfolioPath, ".jfl", "config.json");
  if (!fs.existsSync(portfolioConfigPath)) {
    throw new Error(`Portfolio config not found: ${portfolioConfigPath}`);
  }

  let portfolioConfig: GTMConfig;
  try {
    portfolioConfig = JSON.parse(fs.readFileSync(portfolioConfigPath, "utf-8"));
  } catch (error: any) {
    throw new Error(`Failed to load portfolio config: ${error.message}`);
  }

  if (portfolioConfig.type !== "portfolio") {
    throw new Error(`Expected portfolio type, got: ${portfolioConfig.type}`);
  }

  const gtmConfig = loadServiceConfig(gtmPath);
  const gtmName = gtmConfig.name;
  const workingBranch = gtmConfig.working_branch || "main";
  const syncTimestamp = new Date().toISOString();

  // Determine `since` from portfolio's registered_services
  let since: string;
  try {
    const registeredGTM = (portfolioConfig.registered_services || []).find(
      (s) => s.name === gtmName
    );
    since = registeredGTM?.last_sync
      ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  } catch (error: any) {
    since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    errors.push(`Failed to determine last sync time: ${error.message}`);
  }

  // --- Shared data collection ---
  const syncData = collectSyncData(gtmPath, workingBranch, {
    since,
    excludeFilePrefix: "service-",
  });
  errors.push(...syncData.errors);

  // --- Build payload ---
  const payload: GTMSyncPayload = {
    gtm_name: gtmName,
    sync_timestamp: syncTimestamp,
    session_branch: sessionBranch,
    git: { ...syncData.git, working_branch: workingBranch },
    journal: {
      entry_count: syncData.journal.entry_count,
      types: syncData.journal.types,
      since,
      files_aggregated: syncData.journal.files_aggregated,
      incomplete_aggregated: syncData.journal.incomplete_aggregated,
      next_steps: syncData.journal.next_steps,
    },
    agent_notified: false,
    errors,
  };

  // --- Build portfolio journal entry ---
  const sinceDate = new Date(since);
  const sinceFmt = `${sinceDate.getFullYear()}-${String(sinceDate.getMonth() + 1).padStart(2, "0")}-${String(sinceDate.getDate()).padStart(2, "0")}`;

  const detailParts: string[] = [
    `Git: ${syncData.git.commits.length} commits, ${syncData.git.files_changed} files, +${syncData.git.lines_added}/-${syncData.git.lines_removed} lines`,
    `Journal: ${syncData.journal.entry_count} entries (${syncData.journal.types.feature} feature, ${syncData.journal.types.fix} fix, ${syncData.journal.types.decision} decision, ${syncData.journal.types.discovery} discovery)`,
  ];

  if (syncData.journal.files_aggregated.length > 0) {
    detailParts.push(`Files: ${syncData.journal.files_aggregated.join(", ")}`);
  }

  if (syncData.journal.incomplete_aggregated.length > 0) {
    detailParts.push(`Incomplete: ${syncData.journal.incomplete_aggregated.join("; ")}`);
  }

  if (errors.length > 0) {
    detailParts.push(`Errors: ${errors.join("; ")}`);
  }

  const journalEntryBase = {
    v: 1,
    ts: syncTimestamp,
    type: "service-sync",
    status: "complete",
    title: `GTM sync: ${gtmName}`,
    summary: `${gtmName} synced ${syncData.journal.entry_count} journal entries and ${syncData.git.commits.length} commits since ${sinceFmt}.`,
    detail: detailParts.join("\n"),
    service: gtmName,
    session_branch: sessionBranch,
    files: syncData.journal.files_aggregated,
    incomplete: syncData.journal.incomplete_aggregated,
    next: syncData.journal.next_steps[0] ?? undefined,
    sync_payload: payload,
  };

  // --- Write to portfolio (journal copy + entry + last_sync + inbox + hub event) ---
  const sourceJournalDir = path.join(gtmPath, ".jfl", "journal");
  const agentNotified = await writeSyncToParent(
    portfolioPath,
    gtmName,
    sourceJournalDir,
    syncData.journal.files_processed,
    {
      filePrefix: "gtm-",
      eventType: "portfolio:gtm-sync",
      triggerPrefix: "gtm-update-",
      triggerData: {
        gtm: gtmName,
        timestamp: syncTimestamp,
        entries: syncData.journal.entry_count,
        commits: syncData.git.commits.length,
        message: `GTM ${gtmName} session ended — journals synced to portfolio`,
      },
      journalEntryBase,
    },
    errors,
    syncTimestamp
  );
  payload.agent_notified = agentNotified;

  return payload;
}

// ============================================================
// Private Helpers
// ============================================================

/**
 * Load service config with error handling
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
