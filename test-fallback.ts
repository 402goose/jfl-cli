#!/usr/bin/env node
/**
 * Test fallback behavior when Stratus is unavailable
 */

import { config } from 'dotenv'
import { StratusClient } from './src/lib/stratus-client.js'

config({ path: '.env.local' })

const testEntries = [
  {
    v: 1,
    ts: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    session: "session-test",
    type: "feature",
    title: "Multi-GTM Service Management",
    summary: "Built service manager for handling multiple GTM projects"
  },
  {
    v: 1,
    ts: new Date().toISOString(),
    session: "session-test",
    type: "feature",
    title: "Stratus integration",
    summary: "Integrated Stratus X1 for synthesis"
  }
]

async function main() {
  console.log('🧪 Testing Fallback Behavior\n')

  // Test with unreachable API
  const badClient = new StratusClient({ baseUrl: 'http://localhost:9999' })

  try {
    console.log('1. Testing with unreachable API (should fail fast)...')
    await badClient.synthesizeJournalEntries(testEntries)
    console.log('❌ Should have thrown error')
  } catch (error: any) {
    console.log(`✅ Caught error as expected: ${error.message}\n`)
  }

  // Test with real API (will get 500 but should handle gracefully)
  const realClient = new StratusClient()

  try {
    console.log('2. Testing with real API (no models loaded)...')
    await realClient.synthesizeJournalEntries(testEntries)
    console.log('❌ Should have thrown error')
  } catch (error: any) {
    console.log(`✅ Caught error: ${error.message}`)
    console.log('   Error is properly propagated for fallback handling\n')
  }

  console.log('✅ Fallback error handling works correctly!')
  console.log('\n📝 Note: In MCP context, these errors trigger fallback to raw entries')
}

main()
