/**
 * Memory Indexer Module
 *
 * Indexes journal entries into the memory database.
 * Runs periodically and on-demand to keep memory system up-to-date.
 *
 * @purpose Automatic indexing of journal entries
 */

import * as fs from 'fs'
import * as path from 'path'
import {
  insertMemory,
  isMemoryIndexed,
  setLastIndexTimestamp,
  getAllMemories
} from './memory-db.js'
import { computeTFIDF, computeEmbedding } from './memory-search.js'

export interface JournalEntry {
  v: number
  ts: string
  session: string
  type?: string
  status?: string
  title: string
  summary?: string
  detail?: string
  files?: string[]
  decision?: string
  incomplete?: string[]
  next?: string
  learned?: string[]
}

export interface IndexStats {
  added: number
  updated: number
  skipped: number
  errors: number
}

/**
 * Parse a single journal file (JSONL format)
 */
async function parseJournalFile(filePath: string): Promise<JournalEntry[]> {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').filter(line => line.trim())

  const entries: JournalEntry[] = []

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as JournalEntry
      entries.push(entry)
    } catch (error) {
      console.error(`Failed to parse line in ${filePath}:`, error)
    }
  }

  return entries
}

/**
 * Get all journal files
 */
async function getJournalFiles(): Promise<string[]> {
  const journalDir = path.join(process.cwd(), '.jfl', 'journal')

  if (!fs.existsSync(journalDir)) {
    return []
  }

  const files = fs.readdirSync(journalDir)
    .filter(file => file.endsWith('.jsonl'))
    .map(file => path.join(journalDir, file))

  return files
}

/**
 * Extract full text content from journal entry
 */
function extractContent(entry: JournalEntry): string {
  const parts = [
    entry.title,
    entry.summary || '',
    entry.detail || '',
    (entry.files || []).join(' '),
    (entry.learned || []).join(' '),
    entry.next || ''
  ]

  return parts.filter(p => p).join('\n\n')
}

/**
 * Index a single journal entry
 */
async function indexEntry(entry: JournalEntry, allTexts: string[]): Promise<boolean> {
  // Check if already indexed
  if (await isMemoryIndexed(entry.session, entry.ts)) {
    return false
  }

  // Extract content
  const content = extractContent(entry)

  // Compute TF-IDF tokens
  const tfIdfTokens = computeTFIDF(content, allTexts)

  // Try to compute embedding (optional)
  let embedding: Float32Array | undefined
  let embeddingModel: string | undefined

  try {
    const result = await computeEmbedding(content)
    if (result) {
      embedding = result.embedding
      embeddingModel = result.model
    }
  } catch (error) {
    // Embeddings are optional - continue without them
  }

  // Prepare metadata
  const metadata = {
    files: entry.files || [],
    learned: entry.learned || [],
    decision: entry.decision || null,
    incomplete: entry.incomplete || [],
    next: entry.next || null,
    status: entry.status || null
  }

  // Insert into database
  await insertMemory({
    source: 'journal',
    source_id: entry.session,
    type: entry.type,
    title: entry.title,
    content,
    summary: entry.summary,
    metadata,
    created_at: entry.ts,
    embedding,
    embedding_model: embeddingModel,
    tf_idf_tokens: tfIdfTokens
  })

  return true
}

/**
 * Index all journal entries
 */
export async function indexJournalEntries(force: boolean = false): Promise<IndexStats> {
  const stats: IndexStats = {
    added: 0,
    updated: 0,
    skipped: 0,
    errors: 0
  }

  try {
    // Get all journal files
    const journalFiles = await getJournalFiles()

    if (journalFiles.length === 0) {
      return stats
    }

    // Parse all entries
    const allEntries: JournalEntry[] = []
    for (const file of journalFiles) {
      try {
        const entries = await parseJournalFile(file)
        allEntries.push(...entries)
      } catch (error) {
        console.error(`Failed to parse ${file}:`, error)
        stats.errors++
      }
    }

    // Get all content for TF-IDF computation
    const allTexts = allEntries.map(entry => extractContent(entry))

    // Index each entry
    for (const entry of allEntries) {
      try {
        const added = await indexEntry(entry, allTexts)
        if (added) {
          stats.added++
        } else {
          stats.skipped++
        }
      } catch (error) {
        console.error(`Failed to index entry ${entry.title}:`, error)
        stats.errors++
      }
    }

    // Update last index timestamp
    await setLastIndexTimestamp(new Date().toISOString())

  } catch (error) {
    console.error('Failed to index journal entries:', error)
    stats.errors++
  }

  return stats
}

/**
 * Recompute TF-IDF for all memories
 * Used when corpus changes significantly
 */
export async function recomputeTFIDF(): Promise<number> {
  const memories = await getAllMemories()

  if (memories.length === 0) {
    return 0
  }

  const allTexts = memories.map((m: any) => m.content)
  let updated = 0

  for (const memory of memories) {
    try {
      const tfIdfTokens = computeTFIDF(memory.content, allTexts)

      // Update memory with new TF-IDF tokens
      // Note: This would require an update function in memory-db
      // For now, this is a placeholder
      updated++
    } catch (error) {
      console.error(`Failed to recompute TF-IDF for memory ${memory.id}:`, error)
    }
  }

  return updated
}

// Periodic indexing state
let indexingInterval: NodeJS.Timeout | null = null

/**
 * Start periodic indexing
 */
export function startPeriodicIndexing(intervalMs: number = 60000): void {
  if (indexingInterval) {
    return
  }

  indexingInterval = setInterval(async () => {
    try {
      await indexJournalEntries()
    } catch (error) {
      console.error('Periodic indexing failed:', error)
    }
  }, intervalMs)
}

/**
 * Stop periodic indexing
 */
export function stopPeriodicIndexing(): void {
  if (indexingInterval) {
    clearInterval(indexingInterval)
    indexingInterval = null
  }
}
