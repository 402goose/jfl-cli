/**
 * Memory Command Handlers
 *
 * CLI commands for memory system management:
 * - init: Initialize memory database
 * - status: Show memory statistics
 * - search: Search memories from CLI
 * - index: Force reindex of journal entries
 *
 * @purpose CLI interface for memory system
 */

import chalk from 'chalk'
import ora from 'ora'
import {
  initializeDatabase,
  getMemoryStats,
  getAllMemories
} from '../lib/memory-db.js'
import { indexJournalEntries } from '../lib/memory-indexer.js'
import { searchMemories, SearchResult } from '../lib/memory-search.js'

/**
 * Initialize memory database
 */
export async function memoryInitCommand(): Promise<void> {
  const spinner = ora('Initializing memory database...').start()

  try {
    await initializeDatabase()
    spinner.succeed('Created .jfl/memory.db')

    // Run initial indexing
    spinner.start('Indexing journal entries...')
    const stats = await indexJournalEntries()

    spinner.succeed(`Indexed ${stats.added} journal entries`)

    console.log(chalk.green('\n✓ Memory system ready'))

    if (stats.errors > 0) {
      console.log(chalk.yellow(`\n⚠ ${stats.errors} errors during indexing`))
    }
  } catch (error) {
    spinner.fail('Failed to initialize memory database')
    console.error(error)
    process.exit(1)
  }
}

/**
 * Show memory statistics
 */
export async function memoryStatusCommand(): Promise<void> {
  try {
    const stats = await getMemoryStats()

    console.log(chalk.bold('\nMemory System Status'))
    console.log('─'.repeat(60))

    // Database info
    const dbPath = '.jfl/memory.db'
    console.log(`Database: ${dbPath}`)

    // Total memories
    console.log(`\nTotal memories: ${chalk.bold(stats.total_memories)}`)

    // By type
    if (Object.keys(stats.by_type).length > 0) {
      console.log('\nBy type:')
      Object.entries(stats.by_type)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => {
          console.log(`  ${type.padEnd(12)}: ${count} entries`)
        })
    }

    // Date range
    if (stats.date_range.earliest && stats.date_range.latest) {
      const earliest = new Date(stats.date_range.earliest)
      const latest = new Date(stats.date_range.latest)
      const daysAgo = Math.floor((Date.now() - earliest.getTime()) / (1000 * 60 * 60 * 24))

      console.log('\nDate range:')
      console.log(`  Earliest: ${earliest.toISOString().split('T')[0]} (${daysAgo} days ago)`)
      console.log(`  Latest:   ${latest.toISOString().split('T')[0]} (today)`)
    }

    // Embeddings
    console.log('\nEmbeddings:', stats.embeddings.available
      ? chalk.green(`✓ Available (${stats.embeddings.count}/${stats.total_memories} indexed)`)
      : chalk.yellow('✗ Not available (set OPENAI_API_KEY to enable)')
    )

    if (stats.embeddings.model) {
      console.log(`Model: ${stats.embeddings.model}`)
    }

    // Last index
    if (stats.last_index) {
      const lastIndexDate = new Date(stats.last_index)
      const minutesAgo = Math.floor((Date.now() - lastIndexDate.getTime()) / (1000 * 60))
      console.log(`\nLast index: ${lastIndexDate.toISOString().split('T')[0]} ${lastIndexDate.toISOString().split('T')[1].split('.')[0]} (${minutesAgo} minutes ago)`)
    }

    console.log('')
  } catch (error) {
    const err = error as any
    if (err.message?.includes('no such table')) {
      console.log(chalk.yellow('\n⚠ Memory system not initialized'))
      console.log(chalk.dim('Run: jfl memory init'))
    } else {
      console.error(chalk.red('Failed to get memory status:'), error)
      process.exit(1)
    }
  }
}

/**
 * Search memories from CLI
 */
export async function memorySearchCommand(
  query: string,
  options: { type?: string; max?: string }
): Promise<void> {
  const spinner = ora(`Searching for "${query}"...`).start()

  try {
    const results = await searchMemories(query, {
      maxItems: options.max ? parseInt(options.max) : 10,
      type: options.type
    })

    spinner.stop()

    if (results.length === 0) {
      console.log(chalk.yellow(`\nNo results found for "${query}"`))
      return
    }

    console.log(chalk.bold(`\nResults for "${query}"`))
    console.log('─'.repeat(60))

    results.forEach((result: SearchResult, index: number) => {
      const { memory, score, relevance } = result

      // Format relevance badge
      let relevanceBadge = ''
      if (relevance === 'high') {
        relevanceBadge = chalk.green('●')
      } else if (relevance === 'medium') {
        relevanceBadge = chalk.yellow('●')
      } else {
        relevanceBadge = chalk.gray('●')
      }

      // Format type badge
      const typeBadge = memory.type
        ? chalk.dim(`[${memory.type}]`)
        : ''

      // Format date
      const date = new Date(memory.created_at).toISOString().split('T')[0]

      console.log(`\n${index + 1}. ${typeBadge} ${chalk.bold(memory.title)}`)
      console.log(`   ${date} | ${relevanceBadge} Relevance: ${score.toFixed(2)}`)

      if (memory.summary) {
        console.log(`\n   ${memory.summary}`)
      }

      // Show files if present
      if (memory.metadata) {
        try {
          const metadata = JSON.parse(memory.metadata)
          if (metadata.files && metadata.files.length > 0) {
            console.log(`\n   Files: ${chalk.dim(metadata.files.join(', '))}`)
          }
        } catch {
          // Ignore parse errors
        }
      }
    })

    console.log('')
  } catch (error: any) {
    spinner.fail('Search failed')

    if (error.message?.includes('no such table')) {
      console.log(chalk.yellow('\n⚠ Memory system not initialized'))
      console.log(chalk.dim('Run: jfl memory init'))
    } else {
      console.error(error)
      process.exit(1)
    }
  }
}

/**
 * Force reindex of journal entries
 */
export async function memoryIndexCommand(options: { force?: boolean }): Promise<void> {
  const spinner = ora('Indexing journal entries...').start()

  try {
    const stats = await indexJournalEntries(options.force || false)

    spinner.succeed('Indexing complete')

    console.log(chalk.bold('\nIndex Statistics'))
    console.log('─'.repeat(60))
    console.log(`  Added:   ${chalk.green(stats.added)} new entries`)
    console.log(`  Skipped: ${chalk.dim(stats.skipped)} entries (already indexed)`)

    if (stats.errors > 0) {
      console.log(`  Errors:  ${chalk.red(stats.errors)} entries`)
    }

    // Show updated stats
    const memStats = await getMemoryStats()
    console.log(`\nTotal memories in database: ${chalk.bold(memStats.total_memories)}`)

    console.log(chalk.green('\n✓ Memory index updated'))
  } catch (error: any) {
    spinner.fail('Indexing failed')

    if (error.message?.includes('no such table')) {
      console.log(chalk.yellow('\n⚠ Memory system not initialized'))
      console.log(chalk.dim('Run: jfl memory init'))
    } else {
      console.error(error)
      process.exit(1)
    }
  }
}

/**
 * Format search results for display
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No results found.'
  }

  let output = ''

  results.forEach((result, index) => {
    const { memory, score, relevance } = result

    output += `${index + 1}. [${memory.type || 'unknown'}] ${memory.title}\n`
    output += `   Date: ${new Date(memory.created_at).toISOString().split('T')[0]}\n`
    output += `   Relevance: ${relevance} (${score.toFixed(2)})\n`

    if (memory.summary) {
      output += `\n   ${memory.summary}\n`
    }

    if (memory.metadata) {
      try {
        const metadata = JSON.parse(memory.metadata)
        if (metadata.files && metadata.files.length > 0) {
          output += `   Files: ${metadata.files.join(', ')}\n`
        }
      } catch {
        // Ignore
      }
    }

    output += '\n'
  })

  return output
}
