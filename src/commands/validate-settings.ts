/**
 * Validate and repair .claude/settings.json
 *
 * Validates Claude Code settings files against schema requirements
 * and provides auto-fix capabilities for common issues.
 *
 * @purpose CLI command to validate and repair Claude Code settings files
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import { validateSettings, fixSettings, getValidationReport } from '../utils/settings-validator.js';

export interface ValidateSettingsOptions {
  fix?: boolean;
  json?: boolean;
}

/**
 * Validate .claude/settings.json against Claude Code schema
 *
 * Usage: jfl validate-settings [--fix] [--json]
 *
 * Checks:
 * - Schema compliance (matcher fields, type fields, etc.)
 * - Hook command validity
 * - Required hooks present (SessionStart, Stop, PreCompact)
 * - Common bugs (context-hub stop in Stop hook, etc.)
 *
 * Returns:
 * - Exit 0: Valid
 * - Exit 1: Invalid (prints errors)
 *
 * With --fix: Attempts to auto-repair common issues
 * With --json: Output in JSON format for scripting
 */
export async function validateSettingsCommand(options: ValidateSettingsOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const settingsPath = path.join(cwd, '.claude', 'settings.json');

  if (!fs.existsSync(settingsPath)) {
    if (options.json) {
      console.log(JSON.stringify({
        valid: false,
        error: '.claude/settings.json not found',
        path: settingsPath,
      }, null, 2));
    } else {
      console.error(chalk.red('Error: .claude/settings.json not found'));
      console.error(chalk.gray(`Expected at: ${settingsPath}`));
    }
    process.exit(1);
  }

  let settings: any;
  try {
    const content = fs.readFileSync(settingsPath, 'utf-8');
    settings = JSON.parse(content);
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({
        valid: false,
        error: 'Failed to parse settings.json',
        details: error instanceof Error ? error.message : String(error),
        path: settingsPath,
      }, null, 2));
    } else {
      console.error(chalk.red('Error: Failed to parse .claude/settings.json'));
      console.error(chalk.gray(error instanceof Error ? error.message : String(error)));
    }
    process.exit(1);
  }

  const errors = validateSettings(settings);

  if (errors.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({
        valid: true,
        path: settingsPath,
      }, null, 2));
    } else {
      console.log(chalk.green('✓ Settings validation passed'));
      console.log(chalk.gray(`File: ${settingsPath}`));
    }
    process.exit(0);
  }

  // Has errors
  if (options.json) {
    console.log(JSON.stringify({
      valid: false,
      errors: errors,
      path: settingsPath,
      fixable: options.fix,
    }, null, 2));
  } else {
    console.error(chalk.red('✗ Settings validation failed\n'));

    // Group errors by hook
    const grouped = errors.reduce((acc, err) => {
      if (!acc[err.hook]) {
        acc[err.hook] = [];
      }
      acc[err.hook].push(err);
      return acc;
    }, {} as Record<string, typeof errors>);

    for (const [hook, hookErrors] of Object.entries(grouped)) {
      console.error(chalk.yellow(`  ${hook}:`));
      hookErrors.forEach(err => {
        console.error(chalk.gray(`    • ${err.error}`));
        if (err.fix) {
          console.error(chalk.cyan(`      Fix: ${err.fix}`));
        }
      });
      console.error('');
    }
  }

  if (options.fix) {
    if (!options.json) {
      console.log(chalk.blue('Attempting auto-fix...\n'));
    }

    try {
      const fixed = fixSettings(settings);

      // Backup original
      const backupPath = `${settingsPath}.backup`;
      fs.copyFileSync(settingsPath, backupPath);

      // Write fixed version
      fs.writeFileSync(settingsPath, JSON.stringify(fixed, null, 2) + '\n');

      // Re-validate
      const newErrors = validateSettings(fixed);

      if (newErrors.length === 0) {
        if (options.json) {
          console.log(JSON.stringify({
            fixed: true,
            path: settingsPath,
            backup: backupPath,
          }, null, 2));
        } else {
          console.log(chalk.green('✓ Settings auto-fixed successfully'));
          console.log(chalk.gray(`  Fixed: ${settingsPath}`));
          console.log(chalk.gray(`  Backup: ${backupPath}`));
          console.log('');
          console.log(chalk.yellow('Please review the changes before committing.'));
        }
        process.exit(0);
      } else {
        if (options.json) {
          console.log(JSON.stringify({
            fixed: 'partial',
            remainingErrors: newErrors,
            path: settingsPath,
            backup: backupPath,
          }, null, 2));
        } else {
          console.log(chalk.yellow('⚠  Auto-fix applied but some issues remain:\n'));
          newErrors.forEach(err => {
            console.log(chalk.gray(`  • ${err.hook}: ${err.error}`));
          });
          console.log('');
          console.log(chalk.gray('Manual fixes required for remaining issues.'));
        }
        process.exit(1);
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({
          fixed: false,
          error: 'Auto-fix failed',
          details: error instanceof Error ? error.message : String(error),
        }, null, 2));
      } else {
        console.error(chalk.red('Error during auto-fix:'));
        console.error(chalk.gray(error instanceof Error ? error.message : String(error)));
      }
      process.exit(1);
    }
  } else {
    if (!options.json) {
      console.log(chalk.cyan('Run with --fix to attempt auto-repair'));
    }
    process.exit(1);
  }
}

/**
 * Register the validate-settings command with Commander
 */
export function registerValidateSettingsCommand(program: Command): void {
  program
    .command('validate-settings')
    .description('Validate and repair .claude/settings.json')
    .option('--fix', 'Attempt to auto-repair common issues')
    .option('--json', 'Output in JSON format')
    .action(async (options) => {
      await validateSettingsCommand(options);
    });
}
