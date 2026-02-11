/**
 * Global Service Management
 *
 * Manages services across all GTM projects with port allocation.
 *
 * @purpose Global service management with dynamic port allocation
 * @spec Multi-GTM Service Management Plan - Phase 2
 */

import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { JFL_PATHS } from "../utils/jfl-paths.js";
import { checkServiceHealth, restartCoreServices, validateCoreServices } from "../lib/service-utils.js";
import {
  findGTMParent,
  validateGTMParent,
  getRegisteredServices,
  updateServiceSync,
  syncJournalsToGTM,
  type ServiceRegistration,
} from "../lib/service-gtm.js";
import chalk from "chalk";

const execAsync = promisify(exec);

const GLOBAL_SERVICES_FILE = path.join(JFL_PATHS.data, "services.json");
const PORT_REGISTRY_FILE = path.join(JFL_PATHS.data, "service-ports.json");

interface Service {
  type: "daemon" | "server" | "process";
  description: string;
  port?: number;
  ports?: number[];
  start_command: string;
  stop_command: string;
  detection_command: string;
  pid_file?: string;
  log_file?: string;
  token_file?: string;
}

interface Services {
  version: string;
  services: Record<string, Service>;
}

interface PortRegistry {
  version: string;
  allocated_ports: Record<
    string,
    {
      service: string;
      project: string;
      allocated_at: string;
    }
  >;
}

interface ProjectService extends Service {
  base_port?: number;
}

interface ProjectServices {
  version: string;
  services: Record<string, ProjectService>;
}

/**
 * Load global services configuration
 */
function loadGlobalServices(): Services {
  if (!fs.existsSync(GLOBAL_SERVICES_FILE)) {
    return { version: "1.0", services: {} };
  }

  const content = fs.readFileSync(GLOBAL_SERVICES_FILE, "utf-8");
  return JSON.parse(content);
}

/**
 * Load project services configuration
 */
function loadProjectServices(projectRoot: string): ProjectServices {
  const projectServicesFile = path.join(projectRoot, ".jfl", "services.json");

  if (!fs.existsSync(projectServicesFile)) {
    return { version: "1.0", services: {} };
  }

  const content = fs.readFileSync(projectServicesFile, "utf-8");
  return JSON.parse(content);
}

/**
 * Load port registry
 */
function loadPortRegistry(): PortRegistry {
  if (!fs.existsSync(PORT_REGISTRY_FILE)) {
    return { version: "1.0", allocated_ports: {} };
  }

  const content = fs.readFileSync(PORT_REGISTRY_FILE, "utf-8");
  return JSON.parse(content);
}

/**
 * Save port registry
 */
function savePortRegistry(registry: PortRegistry): void {
  const dir = path.dirname(PORT_REGISTRY_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PORT_REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`lsof -ti:${port}`);
    return stdout.trim().length === 0;
  } catch (error) {
    // lsof returns non-zero if no process found (port is available)
    return true;
  }
}

/**
 * Allocate a port for a service
 */
async function allocatePort(
  serviceName: string,
  projectPath: string,
  basePort?: number
): Promise<number> {
  const registry = loadPortRegistry();

  // Check if already allocated
  for (const [port, allocation] of Object.entries(registry.allocated_ports)) {
    if (
      allocation.service === serviceName &&
      allocation.project === projectPath
    ) {
      const portNum = parseInt(port);
      if (await isPortAvailable(portNum)) {
        return portNum;
      }
    }
  }

  // Find next available port
  const startPort = basePort || 3000;
  for (let port = startPort; port < startPort + 100; port++) {
    // Skip if port is already in registry
    if (registry.allocated_ports[port.toString()]) {
      continue;
    }

    // Check if port is actually available
    if (await isPortAvailable(port)) {
      // Allocate port
      registry.allocated_ports[port.toString()] = {
        service: serviceName,
        project: projectPath,
        allocated_at: new Date().toISOString(),
      };
      savePortRegistry(registry);
      return port;
    }
  }

  throw new Error(
    `Failed to allocate port for ${serviceName} (tried ${startPort}-${startPort + 99})`
  );
}

/**
 * Release a port allocation
 */
function releasePort(port: number): void {
  const registry = loadPortRegistry();
  delete registry.allocated_ports[port.toString()];
  savePortRegistry(registry);
}

/**
 * Substitute variables in a string
 */
function substituteVariables(
  str: string,
  vars: Record<string, string>
): string {
  let result = str;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\$\\{${key}\\}`, "g"), value);
  }
  return result;
}

/**
 * Check if service is running
 */
async function isServiceRunning(service: Service, port?: number): Promise<boolean> {
  try {
    const vars: Record<string, string> = {
      PORT: port?.toString() || service.port?.toString() || "",
      HOME: homedir(),
    };

    const detectionCmd = substituteVariables(service.detection_command, vars);
    const { stdout } = await execAsync(detectionCmd);
    return stdout.trim().length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Start a service
 */
async function startService(
  serviceName: string,
  service: Service,
  projectRoot?: string,
  allocatedPort?: number
): Promise<void> {
  const port = allocatedPort || service.port;
  const vars: Record<string, string> = {
    PORT: port?.toString() || "",
    HOME: homedir(),
    WORKSPACE: projectRoot || process.cwd(),
  };

  const startCmd = substituteVariables(service.start_command, vars);

  console.log(`Starting ${serviceName}...`);
  console.log(`Command: ${startCmd}`);

  try {
    await execAsync(startCmd, { cwd: projectRoot || process.cwd() });
    console.log(`✓ ${serviceName} started successfully`);
    if (port) {
      console.log(`  Port: ${port}`);
    }
  } catch (error: any) {
    throw new Error(`Failed to start ${serviceName}: ${error.message}`);
  }
}

/**
 * Stop a service
 */
async function stopService(
  serviceName: string,
  service: Service,
  port?: number
): Promise<void> {
  const vars: Record<string, string> = {
    PORT: port?.toString() || service.port?.toString() || "",
    HOME: homedir(),
  };

  const stopCmd = substituteVariables(service.stop_command, vars);

  console.log(`Stopping ${serviceName}...`);

  try {
    await execAsync(stopCmd);
    console.log(`✓ ${serviceName} stopped`);

    // Release port if allocated
    if (port) {
      releasePort(port);
    }
  } catch (error: any) {
    throw new Error(`Failed to stop ${serviceName}: ${error.message}`);
  }
}

/**
 * List all services
 */
async function listServices(): Promise<void> {
  const globalServices = loadGlobalServices();
  const projectRoot = process.cwd();
  const projectServices = loadProjectServices(projectRoot);
  const registry = loadPortRegistry();

  console.log("Global Services:");
  console.log("================");

  if (globalServices?.services) {
    for (const [name, service] of Object.entries(globalServices.services)) {
      const running = await isServiceRunning(service);
      const status = running ? "✓ Running" : "✗ Stopped";
      const port = service.port || "N/A";
      console.log(`  ${name}: ${status} (port: ${port})`);
      console.log(`    ${service.description}`);
    }
  }

  console.log("");
  console.log("Project Services:");
  console.log("=================");

  if (projectServices?.services) {
    for (const [name, service] of Object.entries(projectServices.services)) {
      // Find allocated port
      let allocatedPort: number | undefined;
      if (registry?.allocated_ports) {
        for (const [port, allocation] of Object.entries(registry.allocated_ports)) {
        if (
          allocation.service === name &&
          allocation.project === projectRoot
        ) {
          allocatedPort = parseInt(port);
          break;
        }
      }
      }

      const running = await isServiceRunning(service, allocatedPort);
      const status = running ? "✓ Running" : "✗ Stopped";
      const port = allocatedPort || service.base_port || "Not allocated";
      console.log(`  ${name}: ${status} (port: ${port})`);
      console.log(`    ${service.description}`);
    }
  }
}

/**
 * Show service status
 */
async function showStatus(): Promise<void> {
  const globalServices = loadGlobalServices();
  const projectRoot = process.cwd();
  const projectServices = loadProjectServices(projectRoot);
  const registry = loadPortRegistry();

  let runningCount = 0;
  let totalCount = 0;

  // Check global services
  if (globalServices?.services) {
    for (const [name, service] of Object.entries(globalServices.services)) {
      totalCount++;
      if (await isServiceRunning(service)) {
        runningCount++;
      }
    }
  }

  // Check project services
  if (projectServices?.services) {
    for (const [name, service] of Object.entries(projectServices.services)) {
      totalCount++;

    // Find allocated port
    let allocatedPort: number | undefined;
    for (const [port, allocation] of Object.entries(registry.allocated_ports)) {
      if (
        allocation.service === name &&
        allocation.project === projectRoot
      ) {
        allocatedPort = parseInt(port);
        break;
      }
    }

    if (await isServiceRunning(service, allocatedPort)) {
      runningCount++;
    }
    }
  }

  console.log(`Services: ${runningCount}/${totalCount} running`);
  console.log(
    `Allocated ports: ${Object.keys(registry?.allocated_ports || {}).length}`
  );
}

/**
 * Start a specific service
 */
async function startSpecificService(serviceName: string): Promise<void> {
  const globalServices = loadGlobalServices();
  const projectRoot = process.cwd();
  const projectServices = loadProjectServices(projectRoot);

  // Check global services first
  if (globalServices.services[serviceName]) {
    const service = globalServices.services[serviceName];
    await startService(serviceName, service);
    return;
  }

  // Check project services
  if (projectServices.services[serviceName]) {
    const service = projectServices.services[serviceName];

    // Allocate port if needed
    let port: number | undefined;
    if (service.base_port) {
      port = await allocatePort(serviceName, projectRoot, service.base_port);
    }

    await startService(serviceName, service, projectRoot, port);
    return;
  }

  throw new Error(`Service not found: ${serviceName}`);
}

/**
 * Stop a specific service
 */
async function stopSpecificService(serviceName: string): Promise<void> {
  const globalServices = loadGlobalServices();
  const projectRoot = process.cwd();
  const projectServices = loadProjectServices(projectRoot);
  const registry = loadPortRegistry();

  // Check global services first
  if (globalServices.services[serviceName]) {
    const service = globalServices.services[serviceName];
    await stopService(serviceName, service);
    return;
  }

  // Check project services
  if (projectServices.services[serviceName]) {
    const service = projectServices.services[serviceName];

    // Find allocated port
    let allocatedPort: number | undefined;
    for (const [port, allocation] of Object.entries(registry.allocated_ports)) {
      if (
        allocation.service === serviceName &&
        allocation.project === projectRoot
      ) {
        allocatedPort = parseInt(port);
        break;
      }
    }

    await stopService(serviceName, service, allocatedPort);
    return;
  }

  throw new Error(`Service not found: ${serviceName}`);
}

/**
 * Deploy skill to registered services
 */
async function deploySkillToServices(
  skillName: string,
  targetService?: string,
  dryRun = false
): Promise<void> {
  const projectRoot = process.cwd();
  const configPath = path.join(projectRoot, ".jfl", "config.json");

  if (!fs.existsSync(configPath)) {
    console.error("Error: Not in a JFL project (no .jfl/config.json)");
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  if (config.type !== "gtm") {
    console.error("Error: This command only works in GTM workspaces");
    process.exit(1);
  }

  const services = getRegisteredServices(projectRoot);

  if (services.length === 0) {
    console.log("No services registered. Use 'jfl services register' to add services.");
    return;
  }

  const skillSourcePath = path.join(projectRoot, ".claude", "skills", skillName);

  if (!fs.existsSync(skillSourcePath)) {
    console.error(`Error: Skill not found: ${skillSourcePath}`);
    console.log("\nAvailable skills:");
    const skillsDir = path.join(projectRoot, ".claude", "skills");
    if (fs.existsSync(skillsDir)) {
      const skills = fs.readdirSync(skillsDir).filter((f) =>
        fs.statSync(path.join(skillsDir, f)).isDirectory()
      );
      skills.forEach((s) => console.log(`  - ${s}`));
    }
    process.exit(1);
  }

  const servicesToDeploy = targetService
    ? services.filter((s) => s.name === targetService)
    : services;

  if (servicesToDeploy.length === 0) {
    console.error(`Error: Service not found: ${targetService}`);
    process.exit(1);
  }

  console.log(chalk.cyan(`\n📦 Deploying skill: ${skillName}\n`));

  for (const service of servicesToDeploy) {
    const servicePath = path.isAbsolute(service.path)
      ? service.path
      : path.join(projectRoot, service.path);
    const skillDestPath = path.join(servicePath, ".claude", "skills", skillName);

    if (dryRun) {
      console.log(`Would deploy to: ${servicePath}`);
      continue;
    }

    try {
      // Create destination directory
      fs.mkdirSync(path.dirname(skillDestPath), { recursive: true });

      // Copy skill directory
      copyDirectory(skillSourcePath, skillDestPath);

      console.log(chalk.green(`  ✓ ${service.name}`));
    } catch (error: any) {
      console.log(chalk.red(`  ✗ ${service.name}: ${error.message}`));
    }
  }

  console.log("");
}

/**
 * Copy directory recursively
 */
function copyDirectory(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Sync service to GTM manually
 */
async function syncServiceToGTM(
  serviceName?: string,
  dryRun = false
): Promise<void> {
  const projectRoot = process.cwd();
  const configPath = path.join(projectRoot, ".jfl", "config.json");

  if (!fs.existsSync(configPath)) {
    console.error("Error: Not in a JFL project (no .jfl/config.json)");
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  if (config.type !== "gtm") {
    console.error("Error: This command only works in GTM workspaces");
    process.exit(1);
  }

  const services = getRegisteredServices(projectRoot);

  if (services.length === 0) {
    console.log("No services registered.");
    return;
  }

  const servicesToSync = serviceName
    ? services.filter((s) => s.name === serviceName)
    : services;

  if (servicesToSync.length === 0) {
    console.error(`Error: Service not found: ${serviceName}`);
    process.exit(1);
  }

  console.log(chalk.cyan(`\n📡 Syncing services to GTM...\n`));

  for (const service of servicesToSync) {
    const servicePath = path.isAbsolute(service.path)
      ? service.path
      : path.join(projectRoot, service.path);

    if (dryRun) {
      console.log(`Would sync: ${service.name}`);
      const journalPath = path.join(servicePath, ".jfl", "journal");
      if (fs.existsSync(journalPath)) {
        const files = fs.readdirSync(journalPath).filter((f) => f.endsWith(".jsonl"));
        console.log(`  ${files.length} journal file(s)`);
      }
      continue;
    }

    try {
      // Sync journals
      const syncedCount = syncJournalsToGTM(servicePath, projectRoot, service.name);

      // Update timestamp
      const timestamp = new Date().toISOString();
      updateServiceSync(projectRoot, service.name, timestamp);

      // Create sync entry in GTM journal
      const gtmBranch = config.working_branch || "main";
      const gtmJournalFile = path.join(
        projectRoot,
        ".jfl",
        "journal",
        `${gtmBranch}.jsonl`
      );

      const syncEntry = {
        v: 1,
        ts: timestamp,
        session: gtmBranch,
        type: "sync",
        title: `Service sync: ${service.name}`,
        summary: `Synced ${syncedCount} journal file(s) from ${service.name}`,
        service: service.name,
        files_synced: syncedCount,
      };

      fs.appendFileSync(gtmJournalFile, JSON.stringify(syncEntry) + "\n");

      console.log(chalk.green(`  ✓ ${service.name}`));
      console.log(chalk.gray(`    Synced ${syncedCount} journal file(s)`));
    } catch (error: any) {
      console.log(chalk.red(`  ✗ ${service.name}: ${error.message}`));
    }
  }

  console.log("");
}

/**
 * Enhanced health check with GTM connectivity
 */
async function checkServiceGTMHealth(serviceName?: string): Promise<void> {
  const projectRoot = process.cwd();
  const configPath = path.join(projectRoot, ".jfl", "config.json");

  if (!fs.existsSync(configPath)) {
    console.error("Error: Not in a JFL project (no .jfl/config.json)");
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  if (config.type !== "gtm") {
    console.error("Error: This command only works in GTM workspaces");
    process.exit(1);
  }

  const services = getRegisteredServices(projectRoot);

  if (services.length === 0) {
    console.log("No services registered.");
    return;
  }

  const servicesToCheck = serviceName
    ? services.filter((s) => s.name === serviceName)
    : services;

  if (servicesToCheck.length === 0) {
    console.error(`Error: Service not found: ${serviceName}`);
    process.exit(1);
  }

  console.log(chalk.cyan(`\n🔍 Service Health Check\n`));

  for (const service of servicesToCheck) {
    console.log(chalk.bold(`Service: ${service.name}`));

    const servicePath = path.isAbsolute(service.path)
      ? service.path
      : path.join(projectRoot, service.path);

    // Check directory exists
    if (!fs.existsSync(servicePath)) {
      console.log(chalk.red(`  ✗ Directory not found: ${servicePath}`));
      console.log("");
      continue;
    }
    console.log(chalk.green(`  ✓ Directory exists`));

    // Check GTM parent configured
    const gtmParent = findGTMParent(servicePath);
    if (!gtmParent) {
      console.log(chalk.yellow(`  ⚠  GTM parent not configured`));
    } else {
      console.log(chalk.green(`  ✓ GTM parent configured: ${gtmParent}`));

      // Validate GTM parent
      if (!validateGTMParent(gtmParent)) {
        console.log(chalk.red(`  ✗ GTM parent is invalid or not accessible`));
      } else {
        console.log(chalk.green(`  ✓ GTM parent is valid`));
      }
    }

    // Check /end skill deployed
    const endSkillPath = path.join(servicePath, ".claude", "skills", "end");
    if (!fs.existsSync(endSkillPath)) {
      console.log(chalk.red(`  ✗ /end skill NOT deployed`));
      console.log(chalk.gray(`    Run: jfl services deploy-skill end ${service.name}`));
    } else {
      console.log(chalk.green(`  ✓ /end skill deployed`));
    }

    // Check last sync
    if (service.last_sync) {
      const lastSync = new Date(service.last_sync);
      const now = new Date();
      const daysSince = (now.getTime() - lastSync.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSince > 7) {
        console.log(
          chalk.yellow(
            `  ⚠  Last sync: ${Math.floor(daysSince)} days ago (consider syncing)`
          )
        );
      } else if (daysSince > 1) {
        console.log(
          chalk.green(`  ✓ Last sync: ${Math.floor(daysSince)} days ago`)
        );
      } else {
        const hoursSince = Math.floor(daysSince * 24);
        console.log(chalk.green(`  ✓ Last sync: ${hoursSince} hours ago`));
      }
    } else {
      console.log(chalk.yellow(`  ⚠  Never synced`));
    }

    console.log("");
  }
}

/**
 * Main services command
 */
export async function servicesCommand(
  action?: string,
  serviceName?: string
): Promise<void> {
  try {
    switch (action) {
      case "list":
        await listServices();
        break;

      case "status":
        await showStatus();
        break;

      case "start":
        if (!serviceName) {
          console.error("Error: Service name required for start");
          process.exit(1);
        }
        await startSpecificService(serviceName);
        break;

      case "stop":
        if (!serviceName) {
          console.error("Error: Service name required for stop");
          process.exit(1);
        }
        await stopSpecificService(serviceName);
        break;

      case "restart":
        if (serviceName) {
          // Restart specific service
          console.log(`Restarting ${serviceName}...`);
          await stopSpecificService(serviceName);
          await new Promise(resolve => setTimeout(resolve, 500));
          await startSpecificService(serviceName);
        } else {
          // Restart all core services (Context Hub + Service Manager)
          const results = await restartCoreServices();
          if (results.contextHub && results.serviceManager) {
            console.log(chalk.green("\n✓ All core services restarted\n"));
          } else {
            console.log(chalk.yellow("\n⚠️  Some services failed to restart\n"));
          }
        }
        break;

      case "health":
        if (serviceName) {
          // Health check for specific service with GTM connectivity
          await checkServiceGTMHealth(serviceName);
        } else {
          // Check if we're in a GTM with registered services
          const projectRoot = process.cwd();
          const configPath = path.join(projectRoot, ".jfl", "config.json");

          if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            if (config.type === "gtm" && config.registered_services?.length > 0) {
              // GTM with services - check GTM health
              await checkServiceGTMHealth();
            } else {
              // Regular core services health check
              console.log(chalk.cyan("\n🔍 Checking service health...\n"));
              const validation = await validateCoreServices();

              if (validation.healthy) {
                console.log(chalk.green("✓ All core services are healthy\n"));
              } else {
                console.log(chalk.yellow("⚠️  Service health issues detected:\n"));
                for (const issue of validation.issues) {
                  console.log(chalk.yellow(`  • ${issue.service}: ${issue.message}`));
                  console.log(chalk.gray(`    Fix: ${issue.remedy}\n`));
                }
              }
            }
          } else {
            // Fallback to core services check
            console.log(chalk.cyan("\n🔍 Checking service health...\n"));
            const validation = await validateCoreServices();

            if (validation.healthy) {
              console.log(chalk.green("✓ All core services are healthy\n"));
            } else {
              console.log(chalk.yellow("⚠️  Service health issues detected:\n"));
              for (const issue of validation.issues) {
                console.log(chalk.yellow(`  • ${issue.service}: ${issue.message}`));
                console.log(chalk.gray(`    Fix: ${issue.remedy}\n`));
              }
            }
          }
        }
        break;

      case "deploy-skill":
        if (!serviceName) {
          console.error("Error: Skill name required");
          console.log("Usage: jfl services deploy-skill <skill-name> [service-name]");
          process.exit(1);
        }
        // serviceName is actually the skill name in this case
        // The third argument would be the target service
        await deploySkillToServices(serviceName);
        break;

      case "sync":
        await syncServiceToGTM(serviceName);
        break;

      default:
        console.log("Usage: jfl services <action> [service-name]");
        console.log("");
        console.log("Actions:");
        console.log("  list                         List all services");
        console.log("  status                       Show service status summary");
        console.log("  start <service>              Start a service");
        console.log("  stop <service>               Stop a service");
        console.log("  restart [service]            Restart a service (or all core services)");
        console.log("  health [service]             Check service health (GTM-aware)");
        console.log("  deploy-skill <skill> [svc]   Deploy skill to registered services");
        console.log("  sync [service]               Sync service to GTM manually");
        break;
    }
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
