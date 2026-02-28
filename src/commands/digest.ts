/**
 * @purpose CLI command for jfl telemetry digest — analyze telemetry events locally
 */

import type { Command } from 'commander'
import chalk from 'chalk'
import { telemetry } from '../lib/telemetry.js'
import { loadLocalEvents, analyzeEvents, generateSuggestions, formatDigest } from '../lib/telemetry-digest.js'

export function registerDigestCommand(telemetryCmd: Command): void {
  telemetryCmd
    .command('digest')
    .description('Analyze telemetry events: costs, stats, and suggestions')
    .option('--hours <hours>', 'Analysis period in hours', '24')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--platform', 'Include platform-side data (requires network)')
    .action(async (options) => {
      const hours = parseInt(options.hours, 10) || 24
      const format = options.format === 'json' ? 'json' : 'text' as const

      const events = [
        ...loadLocalEvents(),
        ...telemetry.getSpilloverEvents(),
      ]

      const uniqueEvents = Array.from(
        new Map(events.map(e => [e.event_id, e])).values()
      )

      if (uniqueEvents.length === 0) {
        if (format === 'json') {
          console.log(JSON.stringify({ error: 'no_events', message: 'No telemetry events found' }))
        } else {
          console.log(chalk.gray('\n  No telemetry events found. Run some commands first.\n'))
        }
        return
      }

      const digest = analyzeEvents(uniqueEvents, hours)

      if (options.platform) {
        try {
          const platformUrl = process.env.JFL_PLATFORM_URL || 'https://jfl-platform.fly.dev'
          const installId = telemetry.getInstallId()
          const resp = await fetch(`${platformUrl}/api/v1/telemetry/digest`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-JFL-Install-Id': installId,
            },
            body: JSON.stringify({ hours }),
            signal: AbortSignal.timeout(5000),
          })
          if (resp.ok) {
            const platformDigest = await resp.json()
            if (format === 'json') {
              console.log(JSON.stringify({ local: digest, platform: platformDigest }, null, 2))
              return
            }
            console.log(formatDigest(digest, 'text'))
            console.log(chalk.bold('\n  Platform Digest'))
            console.log(JSON.stringify(platformDigest, null, 2))
            return
          }
        } catch {
          if (format !== 'json') {
            console.log(chalk.yellow('\n  Could not fetch platform digest (network error)\n'))
          }
        }
      }

      console.log(formatDigest(digest, format))

      if (format === 'text') {
        const suggestions = generateSuggestions(digest)
        if (suggestions.length > 0) {
          console.log(chalk.bold('  Suggestions'))
          for (const s of suggestions) {
            const severity = s.severity === 'high' ? chalk.red(`[${s.severity}]`) :
              s.severity === 'medium' ? chalk.yellow(`[${s.severity}]`) :
              chalk.gray(`[${s.severity}]`)
            console.log(`  ${severity} ${s.title}`)
            console.log(chalk.gray(`    ${s.description}`))
            console.log(chalk.cyan(`    Fix: ${s.suggestedFix}`))
            console.log()
          }
        }
      }
    })
}
