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
          // Health check for specific service
          console.log(`Checking health of ${serviceName}...`);
          // This would require service-specific health endpoints
          // For now, just use the global validation
          console.log("Health check for specific services not yet implemented");
          console.log("Use 'jfl services health' (without service name) to check all core services");
        } else {
          // Validate all core services
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
        break;

      default:
        console.log("Usage: jfl services <action> [service-name]");
        console.log("");
        console.log("Actions:");
        console.log("  list              List all services");
        console.log("  status            Show service status summary");
        console.log("  start <service>   Start a service");
        console.log("  stop <service>    Stop a service");
        console.log("  restart [service] Restart a service (or all core services)");
        console.log("  health [service]  Check service health");
        break;
    }
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
