#!/usr/bin/env node
/**
 * Migrate services from references/ to service manager
 *
 * @purpose Migrate GTM workspaces from references-based services to service manager
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as readline from 'readline';
import chalk from 'chalk';

interface Service {
  name: string;
  path: string;
  gitUrl?: string;
}

export async function migrateServices(gtmPath?: string) {
  const cwd = gtmPath || process.cwd();
  const referencesDir = path.join(cwd, 'references');

  console.log(chalk.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('  JFL Service Migration'));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  // Check if references/ exists
  if (!fs.existsSync(referencesDir)) {
    console.log(chalk.yellow('⚠  No references/ directory found'));
    return;
  }

  // Find service repos (directories with .git)
  const services: Service[] = [];
  const entries = fs.readdirSync(referencesDir);

  for (const entry of entries) {
    const entryPath = path.join(referencesDir, entry);
    const stat = fs.statSync(entryPath);

    if (stat.isDirectory() && fs.existsSync(path.join(entryPath, '.git'))) {
      // Get git remote URL
      let gitUrl: string | undefined;
      try {
        gitUrl = execSync('git remote get-url origin', {
          cwd: entryPath,
          encoding: 'utf-8',
        }).trim();
      } catch (e) {
        // No remote
      }

      services.push({
        name: entry,
        path: entryPath,
        gitUrl,
      });
    }
  }

  if (services.length === 0) {
    console.log(chalk.green('✓ No services found in references/'));
    console.log(chalk.dim('  references/ is ready for reference material only\n'));
    return;
  }

  console.log(chalk.yellow(`Found ${services.length} service(s) to migrate:\n`));

  for (const service of services) {
    console.log(chalk.dim(`  • ${service.name}`));
    if (service.gitUrl) {
      console.log(chalk.dim(`    ${service.gitUrl}`));
    }
  }

  console.log('');

  // Ask for confirmation
  console.log(chalk.yellow('This will:'));
  console.log(chalk.dim('  1. Register each service with the service manager'));
  console.log(chalk.dim('  2. Remove service from references/'));
  console.log(chalk.dim('  3. Update CLAUDE.md with service manager instructions'));
  console.log(chalk.dim('  4. Add references/ to .gitignore\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(chalk.cyan('Proceed? [y/N]: '), resolve);
  });
  rl.close();

  if (!answer.match(/^[Yy]/)) {
    console.log(chalk.dim('\nMigration cancelled\n'));
    return;
  }

  console.log('');

  // Migrate each service
  for (const service of services) {
    console.log(chalk.cyan(`→ Migrating ${service.name}...`));

    // 1. Register with service manager
    if (service.gitUrl) {
      try {
        execSync(`jfl service add ${service.name} ${service.gitUrl}`, {
          cwd,
          stdio: 'inherit',
        });
        console.log(chalk.green(`  ✓ Registered with service manager`));
      } catch (e) {
        console.log(chalk.yellow(`  ⚠ Failed to register (may need manual setup)`));
      }
    }

    // 2. Remove from references/
    try {
      execSync(`rm -rf "${service.path}"`, { cwd });
      console.log(chalk.green(`  ✓ Removed from references/`));
    } catch (e) {
      console.log(chalk.red(`  ✗ Failed to remove`));
    }

    console.log('');
  }

  // 3. Update CLAUDE.md
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    console.log(chalk.cyan('→ Updating CLAUDE.md...'));

    let claudeMd = fs.readFileSync(claudeMdPath, 'utf-8');

    // Add service manager section if not present
    if (!claudeMd.includes('## Service Manager')) {
      const serviceManagerSection = `
## Service Manager

Services are managed via the JFL service manager, not as submodules in references/.

### Available Services

List services:
\`\`\`bash
jfl service list
\`\`\`

Get service code:
\`\`\`bash
jfl service get <service-name>
# Code is cloned to .jfl/services/<service-name>/
\`\`\`

Update service:
\`\`\`bash
jfl service update <service-name>
\`\`\`

### References Directory

The \`references/\` directory is for reference material only (docs, examples, inspiration).
**DO NOT** put service code or dependencies in references/.

`;

      // Insert before "## Remember" or at the end
      if (claudeMd.includes('## Remember')) {
        claudeMd = claudeMd.replace('## Remember', serviceManagerSection + '## Remember');
      } else {
        claudeMd += serviceManagerSection;
      }

      fs.writeFileSync(claudeMdPath, claudeMd);
      console.log(chalk.green('  ✓ Added service manager section'));
    } else {
      console.log(chalk.dim('  • Service manager section already exists'));
    }

    console.log('');
  }

  // 4. Update .gitignore
  const gitignorePath = path.join(cwd, '.gitignore');
  console.log(chalk.cyan('→ Updating .gitignore...'));

  let gitignore = '';
  if (fs.existsSync(gitignorePath)) {
    gitignore = fs.readFileSync(gitignorePath, 'utf-8');
  }

  if (!gitignore.includes('references/')) {
    gitignore += '\n# Reference material (local only)\nreferences/\n';
    fs.writeFileSync(gitignorePath, gitignore);
    console.log(chalk.green('  ✓ Added references/ to .gitignore'));
  } else {
    console.log(chalk.dim('  • references/ already in .gitignore'));
  }

  console.log('');
  console.log(chalk.green('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.green('✓ Migration complete\n'));
  console.log(chalk.dim('Next steps:'));
  console.log(chalk.dim('  1. Review CLAUDE.md updates'));
  console.log(chalk.dim('  2. Test service access: jfl service list'));
  console.log(chalk.dim('  3. Commit changes'));
  console.log(chalk.dim('  4. Use references/ for reference material only\n'));
}

// Exported for CLI use - no standalone entry point needed (called via commander)
