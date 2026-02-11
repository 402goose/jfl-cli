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
