/**
 * jfl gtm process-service-update - Process service sync notifications
 *
 * Called automatically by GTM hooks when a service phones home.
 * Spawns an agent to update GTM state based on service work.
 *
 * @purpose CLI command for GTM agent spawning on service updates
 */

import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";

interface ServiceEvent {
  timestamp: string;
  service: string;
  type: string;
  payload: {
    session_branch: string;
    duration_minutes: number;
    commits: number;
    files_changed: number;
    journal_entries: number;
    content_synced: {
      knowledge_files: string[];
      content_files: string[];
      config_files: string[];
      claude_md_synced: boolean;
      total_bytes: number;
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
    message: string;
  };
}

export async function gtmProcessUpdate(eventFilePath?: string) {
  // If called without args, process latest event from service-events.jsonl
  const eventsFile = eventFilePath || path.join(process.cwd(), ".jfl", "service-events.jsonl");

  if (!fs.existsSync(eventsFile)) {
    console.error(chalk.red("No service events file found"));
    process.exit(1);
  }

  // Read latest event
  const content = fs.readFileSync(eventsFile, "utf-8");
  const lines = content.trim().split("\n").filter((l) => l.trim());

  if (lines.length === 0) {
    console.log(chalk.yellow("No events to process"));
    return;
  }

  const latestLine = lines[lines.length - 1];
  let event: ServiceEvent;

  try {
    event = JSON.parse(latestLine);
  } catch (error: any) {
    console.error(chalk.red("Failed to parse event:"), error.message);
    process.exit(1);
  }

  // Output agent prompt
  console.log(
    chalk.cyan(
      "════════════════════════════════════════════════════════════"
    )
  );
  console.log(chalk.cyan.bold("  Service Update Received"));
  console.log(
    chalk.cyan(
      "════════════════════════════════════════════════════════════"
    )
  );
  console.log("");
  console.log(chalk.bold(`Service: ${event.service}`));
  console.log(`Session: ${event.payload.session_branch}`);
  console.log(`Duration: ${event.payload.duration_minutes}min`);
  console.log("");
  console.log(chalk.bold("Activity:"));
  console.log(`  • ${event.payload.commits} commits`);
  console.log(`  • ${event.payload.files_changed} files changed`);
  console.log(`  • ${event.payload.journal_entries} journal entries`);

  // Content sync summary
  const contentFiles =
    event.payload.content_synced.knowledge_files.length +
    event.payload.content_synced.content_files.length +
    event.payload.content_synced.config_files.length;

  if (contentFiles > 0 || event.payload.content_synced.claude_md_synced) {
    console.log("");
    console.log(chalk.bold("Content Synced:"));
    if (event.payload.content_synced.knowledge_files.length > 0) {
      console.log(
        `  • Knowledge: ${event.payload.content_synced.knowledge_files.length} files`
      );
    }
    if (event.payload.content_synced.content_files.length > 0) {
      console.log(
        `  • Content: ${event.payload.content_synced.content_files.length} files`
      );
    }
    if (event.payload.content_synced.config_files.length > 0) {
      console.log(
        `  • Config: ${event.payload.content_synced.config_files.length} files`
      );
    }
    if (event.payload.content_synced.claude_md_synced) {
      console.log(`  • CLAUDE.md`);
    }

    const bytes = event.payload.content_synced.total_bytes;
    const sizeStr =
      bytes > 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(1)}MB`
        : bytes > 1024
        ? `${(bytes / 1024).toFixed(1)}KB`
        : `${bytes} bytes`;
    console.log(`  • Total: ${sizeStr}`);
  }

  console.log("");
  console.log(
    chalk.cyan(
      "════════════════════════════════════════════════════════════"
    )
  );
  console.log("");

  // Output agent instruction
  console.log(chalk.bold("GTM Agent Task:"));
  console.log("");
  console.log(
    `Process service update from ${chalk.cyan(event.service)}:`
  );
  console.log("");
  console.log("1. Read service journal entries:");
  console.log(`   cat .jfl/journal/service-${event.service}-*.jsonl`);
  console.log("");
  console.log("2. Review synced content:");
  console.log(`   ls -la services/${event.service}/`);
  console.log("");
  console.log("3. Update GTM state:");
  console.log("   • Update knowledge/ROADMAP.md with progress");
  console.log("   • Write GTM journal entry summarizing service work");
  console.log("   • Update relevant knowledge docs");
  console.log("");
  console.log("4. If you need more detail, read:");
  console.log(`   • services/${event.service}/CLAUDE.md`);
  console.log(`   • services/${event.service}/knowledge/`);
  console.log(`   • Full journal: .jfl/journal/service-${event.service}-*.jsonl`);
  console.log("");
  console.log(
    chalk.dim(
      `Event timestamp: ${new Date(event.timestamp).toLocaleString()}`
    )
  );
}
