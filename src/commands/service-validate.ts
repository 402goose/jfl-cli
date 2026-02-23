/**
 * Service Validation Command
 *
 * Validates that a JFL service is properly configured and compliant with GTM standards.
 *
 * @purpose Ensure GTM services are properly configured and can integrate with parent GTM
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { getProjectPort, getProjectHubUrl } from '../utils/context-hub-port.js';

interface ValidationCheck {
  category: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: string[];
  fixable: boolean;
  fix?: () => Promise<void>;
}

interface ValidationResult {
  checks: ValidationCheck[];
  summary: {
    passed: number;
    warnings: number;
    errors: number;
    fixable: number;
  };
}

interface ServiceConfig {
  name: string;
  service?: boolean;
  gtm_parent?: string;
  type?: string;
  description?: string;
}

interface SettingsJson {
  hooks?: Record<string, any>;
}

const CONFIG_PATH = '.jfl/config.json';
const SETTINGS_PATH = '.claude/settings.json';
const JOURNAL_DIR = '.jfl/journal';
const MCP_CONFIG_PATH = '.mcp.json';
const SKILLS_DIR = '.claude/skills';

export async function serviceValidate(options: { fix?: boolean; json?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();

  // Check if we're in a JFL project
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(chalk.red('Error: Not a JFL project (no .jfl/config.json found)'));
    console.error(chalk.gray('Run this command from a JFL service directory.'));
    process.exit(1);
  }

  const config: ServiceConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

  // Check if this is a service
  if (!config.service) {
    console.error(chalk.red('Error: Not a JFL service (service: true not set in config)'));
    console.error(chalk.gray('This command is for validating GTM services.'));
    process.exit(1);
  }

  if (!options.json) {
    console.log(chalk.cyan.bold(`\n🔍 SERVICE VALIDATION: ${config.name}`));
    console.log(chalk.cyan('━'.repeat(60)) + '\n');
  }

  // Run all validation checks
  const result = await runValidationChecks(cwd, config);

  // Apply fixes if requested
  if (options.fix && result.summary.fixable > 0) {
    await applyFixes(result.checks);

    // Re-run validation to show updated status
    console.log(chalk.cyan('\n━'.repeat(60)));
    console.log(chalk.cyan.bold('VALIDATION AFTER AUTO-FIX:'));
    console.log(chalk.cyan('━'.repeat(60)) + '\n');

    const updatedResult = await runValidationChecks(cwd, config);
    displayResults(updatedResult, options.json);
  } else {
    displayResults(result, options.json);
  }

  // Exit with error code if there are failures
  if (result.summary.errors > 0) {
    process.exit(1);
  }
}

async function runValidationChecks(cwd: string, config: ServiceConfig): Promise<ValidationResult> {
  const checks: ValidationCheck[] = [];

  // 1. Service Identity
  checks.push(await checkServiceIdentity(cwd, config));

  // 2. GTM Integration
  checks.push(...await checkGtmIntegration(cwd, config));

  // 3. Hooks & Session Management
  checks.push(...await checkHooksAndSession(cwd));

  // 4. Context & Journal
  checks.push(...await checkContextAndJournal(cwd, config));

  // 5. Skills
  checks.push(...await checkSkills(cwd));

  // 6. Health
  checks.push(...await checkHealth(cwd));

  // Calculate summary
  const summary = {
    passed: checks.filter(c => c.status === 'pass').length,
    warnings: checks.filter(c => c.status === 'warn').length,
    errors: checks.filter(c => c.status === 'fail').length,
    fixable: checks.filter(c => c.fixable && c.status !== 'pass').length
  };

  return { checks, summary };
}

// ============================================================================
// VALIDATION CHECK IMPLEMENTATIONS
// ============================================================================

async function checkServiceIdentity(cwd: string, config: ServiceConfig): Promise<ValidationCheck> {
  const issues: string[] = [];

  if (!config.name) issues.push('Missing "name" field');
  if (!config.type) issues.push('Missing "type" field');
  if (!config.description) issues.push('Missing "description" field');
  if (!config.gtm_parent) issues.push('Missing "gtm_parent" field');

  if (issues.length > 0) {
    return {
      category: 'Service Configuration',
      status: 'fail',
      message: 'Service configuration incomplete',
      details: issues,
      fixable: false
    };
  }

  return {
    category: 'Service Configuration',
    status: 'pass',
    message: `Type: ${config.type}${config.gtm_parent ? `\n    GTM Parent: ${config.gtm_parent}` : ''}`,
    fixable: false
  };
}

async function checkGtmIntegration(cwd: string, config: ServiceConfig): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];

  if (!config.gtm_parent) {
    checks.push({
      category: 'GTM Integration',
      status: 'fail',
      message: 'No GTM parent configured',
      details: ['Set "gtm_parent" in .jfl/config.json'],
      fixable: false
    });
    return checks;
  }

  // Check if GTM parent exists
  const gtmParentPath = config.gtm_parent.startsWith('/')
    ? config.gtm_parent
    : path.resolve(cwd, config.gtm_parent);

  if (!fs.existsSync(gtmParentPath)) {
    checks.push({
      category: 'GTM Integration',
      status: 'fail',
      message: 'GTM parent directory not found',
      details: [`Path: ${gtmParentPath}`],
      fixable: false
    });
    return checks;
  }

  const gtmConfigPath = path.join(gtmParentPath, '.jfl/config.json');
  if (!fs.existsSync(gtmConfigPath)) {
    checks.push({
      category: 'GTM Integration',
      status: 'fail',
      message: 'GTM parent is not a valid JFL workspace',
      details: [`No .jfl/config.json at ${gtmParentPath}`],
      fixable: false
    });
    return checks;
  }

  // Check if registered in GTM's registered_services
  const gtmConfig = JSON.parse(fs.readFileSync(gtmConfigPath, 'utf-8'));
  const registeredServices = gtmConfig.registered_services || [];
  const isRegistered = registeredServices.some((s: any) =>
    s.name === config.name || s.path === cwd
  );

  if (!isRegistered) {
    checks.push({
      category: 'GTM Integration',
      status: 'warn',
      message: 'Not registered in parent GTM',
      details: ['Service should be in registered_services array'],
      fixable: true,
      fix: async () => {
        const services = gtmConfig.registered_services || [];
        services.push({
          name: config.name,
          path: cwd,
          type: config.type,
          registered_at: new Date().toISOString()
        });
        gtmConfig.registered_services = services;
        fs.writeFileSync(gtmConfigPath, JSON.stringify(gtmConfig, null, 2));
        console.log(chalk.green(`  ✓ Registered service in ${gtmParentPath}/.jfl/config.json`));
      }
    });
  } else {
    checks.push({
      category: 'GTM Integration',
      status: 'pass',
      message: 'Registered in parent GTM\n    Bidirectional link verified',
      fixable: false
    });
  }

  return checks;
}

async function checkHooksAndSession(cwd: string): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];

  if (!fs.existsSync(SETTINGS_PATH)) {
    checks.push({
      category: 'Hooks Configuration',
      status: 'warn',
      message: 'No .claude/settings.json found',
      details: ['Session hooks not configured'],
      fixable: true,
      fix: async () => {
        const defaultSettings = {
          hooks: {
            SessionStart: [
              {
                matcher: "",
                hooks: [
                  {
                    type: "command",
                    command: "./scripts/session/session-init.sh"
                  },
                  {
                    type: "command",
                    command: "jfl context-hub ensure >> .jfl/logs/context-hub.log 2>&1 &",
                    async: true
                  }
                ]
              }
            ],
            Stop: [
              {
                matcher: "",
                hooks: [
                  {
                    type: "command",
                    command: "BRANCH=$(cat .jfl/current-session-branch.txt 2>/dev/null || git branch --show-current); JOURNAL=\".jfl/journal/${BRANCH}.jsonl\"; if [ ! -s \"$JOURNAL\" ] 2>/dev/null; then echo '⚠️  No journal entry for session'; else echo '✓ Journal exists'; fi; exit 0"
                  },
                  {
                    type: "command",
                    command: "./scripts/session/session-cleanup.sh >> .jfl/logs/session-cleanup.log 2>&1 || echo 'Cleanup skipped'; exit 0"
                  }
                ]
              }
            ],
            PreCompact: [
              {
                matcher: "",
                hooks: [
                  {
                    type: "command",
                    command: "BRANCH=$(cat .jfl/current-session-branch.txt 2>/dev/null || git branch --show-current); JOURNAL=\".jfl/journal/${BRANCH}.jsonl\"; if [ ! -s \"$JOURNAL\" ] 2>/dev/null; then echo ''; echo '🚨 CONTEXT COMPACTING - WRITE JOURNAL NOW'; echo \"File: .jfl/journal/${BRANCH}.jsonl\"; fi"
                  },
                  {
                    type: "command",
                    command: "nohup sh -c 'git add -A && git diff --cached --quiet || git commit -m \"auto: pre-compact save\"' > /dev/null 2>&1 & disown; exit 0"
                  }
                ]
              }
            ]
          }
        };
        fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(defaultSettings, null, 2));
        console.log(chalk.green('  ✓ Created .claude/settings.json with default hooks'));
      }
    });
    return checks;
  }

  const settings: SettingsJson = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));

  if (!settings.hooks) {
    checks.push({
      category: 'Hooks Configuration',
      status: 'warn',
      message: 'No hooks configured',
      fixable: false
    });
    return checks;
  }

  // Check for invalid hook names (like SessionStart:service)
  const invalidHooks: string[] = [];
  const validHookNames = ['SessionStart', 'Stop', 'PreCompact', 'UserPromptSubmit'];

  for (const hookName of Object.keys(settings.hooks)) {
    if (!validHookNames.includes(hookName)) {
      invalidHooks.push(hookName);
    }
  }

  if (invalidHooks.length > 0) {
    checks.push({
      category: 'Hooks Configuration',
      status: 'fail',
      message: 'Invalid hook names found',
      details: invalidHooks.map(h => {
        const suggested = h.split(':')[0];
        return `${h} → should be: ${suggested}`;
      }),
      fixable: true,
      fix: async () => {
        const fixed = { ...settings };

        for (const invalidHook of invalidHooks) {
          const validName = invalidHook.split(':')[0];
          if (validHookNames.includes(validName)) {
            // Move the hook config to the valid name
            fixed.hooks![validName] = fixed.hooks![invalidHook];
            delete fixed.hooks![invalidHook];
            console.log(chalk.green(`  ✓ Renamed hook: ${invalidHook} → ${validName}`));
          } else {
            console.log(chalk.yellow(`  ⚠ Removed invalid hook: ${invalidHook}`));
            delete fixed.hooks![invalidHook];
          }
        }

        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(fixed, null, 2));
      }
    });
  } else {
    checks.push({
      category: 'Hooks Configuration',
      status: 'pass',
      message: 'Valid hook names',
      fixable: false
    });
  }

  return checks;
}

async function checkContextAndJournal(cwd: string, config: ServiceConfig): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];

  // Check journal directory
  if (!fs.existsSync(JOURNAL_DIR)) {
    checks.push({
      category: 'Journal',
      status: 'warn',
      message: 'Journal directory missing',
      details: ['No .jfl/journal/ directory'],
      fixable: true,
      fix: async () => {
        fs.mkdirSync(JOURNAL_DIR, { recursive: true });
        console.log(chalk.green('  ✓ Created .jfl/journal/ directory'));
      }
    });
  } else {
    // Check if there's a journal entry for current session
    const journalFiles = fs.readdirSync(JOURNAL_DIR).filter(f => f.endsWith('.jsonl'));

    if (journalFiles.length === 0) {
      checks.push({
        category: 'Journal',
        status: 'warn',
        message: 'No journal entry for current session',
        details: ['Run /end to document your work before ending session'],
        fixable: false
      });
    } else {
      checks.push({
        category: 'Journal',
        status: 'pass',
        message: `${journalFiles.length} journal file(s) found`,
        fixable: false
      });
    }
  }

  // Check Context Hub connectivity
  try {
    const hubUrl = getProjectHubUrl(cwd);
    const response = await fetch(`${hubUrl}/health`);
    if (response.ok) {
      checks.push({
        category: 'Context Hub',
        status: 'pass',
        message: `Reachable at ${hubUrl}`,
        fixable: false
      });
    } else {
      checks.push({
        category: 'Context Hub',
        status: 'warn',
        message: 'Context Hub responding with errors',
        details: [`Status: ${response.status}`],
        fixable: false
      });
    }
  } catch (error) {
    checks.push({
      category: 'Context Hub',
      status: 'warn',
      message: 'Context Hub not reachable',
      details: ['Run: jfl context-hub ensure'],
      fixable: false
    });
  }

  // Check MCP config
  if (!fs.existsSync(MCP_CONFIG_PATH)) {
    checks.push({
      category: 'MCP Configuration',
      status: 'warn',
      message: 'No .mcp.json found',
      details: ['jfl-context MCP server will not be available'],
      fixable: true,
      fix: async () => {
        const defaultMcpConfig = {
          mcpServers: {
            'jfl-context': {
              command: 'jfl-context-hub-mcp',
              args: [],
              env: {
                CONTEXT_HUB_URL: getProjectHubUrl(cwd)
              }
            }
          }
        };
        fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(defaultMcpConfig, null, 2));
        console.log(chalk.green('  ✓ Created .mcp.json with jfl-context server'));
      }
    });
  } else {
    checks.push({
      category: 'MCP Configuration',
      status: 'pass',
      message: 'MCP config present',
      fixable: false
    });
  }

  return checks;
}

async function checkSkills(cwd: string): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];

  if (!fs.existsSync(SKILLS_DIR)) {
    checks.push({
      category: 'Skills',
      status: 'warn',
      message: 'Skills directory missing',
      details: ['No .claude/skills/ directory'],
      fixable: true,
      fix: async () => {
        fs.mkdirSync(SKILLS_DIR, { recursive: true });
        console.log(chalk.green('  ✓ Created .claude/skills/ directory'));
      }
    });
    return checks;
  }

  // Check for required skills
  const requiredSkills = ['end'];
  const missingSkills: string[] = [];

  for (const skill of requiredSkills) {
    const skillPath = path.join(SKILLS_DIR, skill);
    if (!fs.existsSync(skillPath)) {
      missingSkills.push(skill);
    }
  }

  if (missingSkills.length > 0) {
    checks.push({
      category: 'Skills',
      status: 'warn',
      message: 'Missing required skills',
      details: missingSkills.map(s => `/${s} skill not deployed`),
      fixable: false // jfl services deploy-skill handles this
    });
  } else {
    // Check YAML frontmatter
    const endSkillMd = path.join(SKILLS_DIR, 'end/SKILL.md');
    if (fs.existsSync(endSkillMd)) {
      const content = fs.readFileSync(endSkillMd, 'utf-8');
      const hasYaml = content.startsWith('---\n');

      if (!hasYaml) {
        checks.push({
          category: 'Skills',
          status: 'warn',
          message: '/end skill missing YAML frontmatter',
          details: ['Skill may not be recognized by Claude Code'],
          fixable: false
        });
      } else {
        checks.push({
          category: 'Skills',
          status: 'pass',
          message: '/end skill deployed\n    YAML frontmatter valid',
          fixable: false
        });
      }
    }
  }

  return checks;
}

async function checkHealth(cwd: string): Promise<ValidationCheck[]> {
  const checks: ValidationCheck[] = [];

  // Check for stale worktrees
  try {
    const worktreeList = execSync('git worktree list --porcelain', { cwd, encoding: 'utf-8' });
    const worktrees = worktreeList.split('\n\n').filter(Boolean);

    if (worktrees.length > 1) {
      checks.push({
        category: 'Health',
        status: 'warn',
        message: `${worktrees.length - 1} worktree(s) active`,
        details: ['May indicate multiple concurrent sessions'],
        fixable: false
      });
    } else {
      checks.push({
        category: 'Health',
        status: 'pass',
        message: 'No stale worktrees',
        fixable: false
      });
    }
  } catch (error) {
    // Not a git repo or no worktrees - that's fine
  }

  // Check git state
  try {
    const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8' });

    if (status.trim()) {
      checks.push({
        category: 'Health',
        status: 'warn',
        message: 'Uncommitted changes detected',
        details: ['Consider committing or documenting in journal'],
        fixable: false
      });
    } else {
      checks.push({
        category: 'Health',
        status: 'pass',
        message: 'Git state clean',
        fixable: false
      });
    }
  } catch (error) {
    // Not a git repo - skip this check
  }

  // Check journal write permissions
  try {
    const testFile = path.join(JOURNAL_DIR, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);

    checks.push({
      category: 'Health',
      status: 'pass',
      message: 'Journal directory writable',
      fixable: false
    });
  } catch (error) {
    checks.push({
      category: 'Health',
      status: 'fail',
      message: 'Cannot write to journal directory',
      details: ['Check permissions on .jfl/journal/'],
      fixable: false
    });
  }

  return checks;
}

// ============================================================================
// FIX APPLICATION
// ============================================================================

async function applyFixes(checks: ValidationCheck[]): Promise<void> {
  console.log(chalk.cyan('\n━'.repeat(60)));
  console.log(chalk.cyan.bold('APPLYING AUTO-FIXES:'));
  console.log(chalk.cyan('━'.repeat(60)) + '\n');

  const fixableChecks = checks.filter(c => c.fixable && c.fix && c.status !== 'pass');

  if (fixableChecks.length === 0) {
    console.log(chalk.gray('No auto-fixable issues found.\n'));
    return;
  }

  for (const check of fixableChecks) {
    console.log(chalk.yellow(`Fixing: ${check.category} - ${check.message}`));
    try {
      await check.fix!();
    } catch (error) {
      console.log(chalk.red(`  ✗ Fix failed: ${error}`));
    }
  }

  console.log();
}

// ============================================================================
// DISPLAY
// ============================================================================

function displayResults(result: ValidationResult, json: boolean = false): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Group checks by category
  const categories = new Map<string, ValidationCheck[]>();

  for (const check of result.checks) {
    if (!categories.has(check.category)) {
      categories.set(check.category, []);
    }
    categories.get(check.category)!.push(check);
  }

  // Display each category
  for (const [category, checks] of categories) {
    const firstCheck = checks[0];
    const icon = firstCheck.status === 'pass' ? '✓' : firstCheck.status === 'warn' ? '⚠' : '✗';
    const color = firstCheck.status === 'pass' ? chalk.green : firstCheck.status === 'warn' ? chalk.yellow : chalk.red;

    console.log(color(`[${icon}] ${category}`));

    for (const check of checks) {
      console.log(chalk.gray(`    ${check.message}`));

      if (check.details) {
        for (const detail of check.details) {
          console.log(chalk.gray(`    → ${detail}`));
        }
      }
    }

    console.log();
  }

  // Summary
  console.log(chalk.cyan('━'.repeat(60)));
  console.log(chalk.cyan.bold('\nSummary:'));
  console.log(chalk.green(`  ${result.summary.passed} passed`));
  if (result.summary.warnings > 0) {
    console.log(chalk.yellow(`  ${result.summary.warnings} warning(s)`));
  }
  if (result.summary.errors > 0) {
    console.log(chalk.red(`  ${result.summary.errors} error(s)`));
  }

  if (result.summary.fixable > 0) {
    console.log(chalk.cyan(`\nRun ${chalk.bold('jfl services validate --fix')} to auto-repair ${result.summary.fixable} issue(s).`));
  }

  console.log();
}
