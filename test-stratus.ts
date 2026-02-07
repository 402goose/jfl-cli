#!/usr/bin/env node
/**
 * Test script for Stratus integration
 */

import { config } from 'dotenv'
import { StratusClient } from './src/lib/stratus-client.js'

// Load environment variables
config({ path: '.env.local' })

// Sample journal entries
const testEntries = [
  {
    v: 1,
    ts: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    session: "session-test",
    type: "feature",
    title: "Multi-GTM Service Management Implementation Complete",
    summary: "Built service manager for handling multiple GTM projects with dynamic port allocation",
    detail: "Implemented ServiceManager class with port allocation, conflict detection, and status tracking"
  },
  {
    v: 1,
    ts: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    session: "session-test",
    type: "fix",
    title: "Fixed port collision issues",
    summary: "Resolved conflicts when multiple Context Hubs tried to use same port",
    detail: "Added dynamic port allocation with retry logic"
  },
  {
    v: 1,
    ts: new Date().toISOString(),
    session: "session-test",
    type: "feature",
    title: "Stratus reasoning integration with Context Hub",
    summary: "Integrated Stratus X1 for intelligent journal synthesis",
    detail: "Added context_synthesize MCP tool with caching and fallback"
  }
]

async function main() {
  console.log('🧪 Testing Stratus Integration\n')

  const client = new StratusClient()

  console.log('📊 Test entries:')
  testEntries.forEach(e => console.log(`  - ${e.title}`))
  console.log()

  try {
    console.log('🔄 Calling Stratus API...')
    const synthesis = await client.synthesizeJournalEntries(testEntries, {
      focus: 'all'
    })

    console.log('✅ Synthesis successful!\n')
    console.log(client.formatSynthesis(synthesis))

    if (synthesis.confidence) {
      console.log(`\n📈 Confidence: ${(synthesis.confidence * 100).toFixed(1)}%`)
    }
    if (synthesis.executionTime) {
      console.log(`⏱️  Execution time: ${(synthesis.executionTime / 1000).toFixed(2)}s`)
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message)
    if (error.stack) {
      console.error('\nStack trace:', error.stack)
    }
    process.exit(1)
  }
}

main()
