#!/usr/bin/env node
/**
 * Post-install script: Detects Clawdbot and offers skill installation
 */

const { execSync } = require('child_process');
const chalk = require('chalk');

try {
  // Check if clawdbot is installed
  execSync('which clawdbot', { stdio: 'pipe' });

  // Clawdbot detected! Offer integration
  console.log();
  console.log(chalk.hex('#F6C453')('🦞 Clawdbot detected!'));
  console.log();
  console.log('Add JFL to Telegram/Slack/Discord:');
  console.log(chalk.cyan('  jfl clawdbot install'));
  console.log();
  console.log(chalk.dim('Use JFL from any chat platform with full GTM access.'));
  console.log();
} catch (error) {
  // Clawdbot not installed - skip silently
}
