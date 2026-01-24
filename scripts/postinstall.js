#!/usr/bin/env node
/**
 * JFL CLI Postinstall Script
 *
 * Installs bundled tools that enhance the JFL experience:
 * - ralph-tui: AI agent loop orchestrator for autonomous task execution
 *
 * These tools require Bun runtime. If Bun is not installed,
 * we'll show instructions but continue (tools are optional).
 */

import { execSync, spawnSync } from "child_process";
import { platform } from "os";

const TOOLS = [
  {
    name: "ralph-tui",
    package: "ralph-tui",
    description: "AI agent loop orchestrator",
    requiresBun: true,
  },
];

function hasBun() {
  try {
    execSync("bun --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasCommand(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function installWithBun(pkg) {
  try {
    console.log(`  Installing ${pkg}...`);
    execSync(`bun install -g ${pkg}`, { stdio: "inherit" });
    return true;
  } catch (error) {
    console.error(`  Failed to install ${pkg}: ${error.message}`);
    return false;
  }
}

function main() {
  console.log("\n🚀 JFL CLI - Setting up bundled tools...\n");

  const bunInstalled = hasBun();

  if (!bunInstalled) {
    console.log("⚠️  Bun runtime not found.");
    console.log("   Some JFL tools (like ralph-tui) require Bun.");
    console.log("");
    console.log("   Install Bun:");
    if (platform() === "win32") {
      console.log('   powershell -c "irm bun.sh/install.ps1 | iex"');
    } else {
      console.log("   curl -fsSL https://bun.sh/install | bash");
    }
    console.log("");
    console.log("   Then run: jfl update");
    console.log("");
    return;
  }

  console.log("✅ Bun runtime detected\n");

  for (const tool of TOOLS) {
    if (tool.requiresBun && !bunInstalled) {
      console.log(`⏭️  Skipping ${tool.name} (requires Bun)`);
      continue;
    }

    // Check if already installed
    if (hasCommand(tool.name)) {
      console.log(`✅ ${tool.name} already installed`);
      continue;
    }

    console.log(`📦 Installing ${tool.name} - ${tool.description}`);
    const success = installWithBun(tool.package);

    if (success) {
      console.log(`✅ ${tool.name} installed successfully\n`);
    } else {
      console.log(`⚠️  ${tool.name} installation failed (optional)\n`);
    }
  }

  console.log("🎉 JFL CLI setup complete!\n");
  console.log("Available tools:");
  console.log("  jfl          - Main CLI");
  if (hasCommand("ralph-tui")) {
    console.log("  ralph-tui    - AI agent loop orchestrator");
  }
  console.log("");
}

main();
