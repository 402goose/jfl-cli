/**
 * Memory Database Module
 *
 * SQLite database for indexed journal entries and memories.
 * Provides schema initialization, CRUD operations, and query builders.
 *
 * @purpose Memory persistence and querying via SQLite
 */

import * as fs from 'fs'
import * as path from 'path'
import initSqlJs, { Database } from 'sql.js'

export interface Memory {
  id: number
  source: 'journal' | 'file' | 'manual'
  source_id: string | null
  type: string | null
  title: string
  content: string
  summary: string | null
  metadata: string | null
  created_at: string
  indexed_at: string
  embedding: Buffer | null
  embedding_model: string | null
  tf_idf_tokens: string | null
}

export interface MemoryInsert {
  source: 'journal' | 'file' | 'manual'
  source_id?: string
  type?: string
  title: string
  content: string
  summary?: string
  metadata?: Record<string, any>
  created_at: string
  embedding?: Float32Array
  embedding_model?: string
  tf_idf_tokens?: Record<string, number>
}

export interface MemoryStats {
  total_memories: number
  by_type: Record<string, number>
  date_range: {
    earliest: string | null
    latest: string | null
  }
  embeddings: {
    available: boolean
    count: number
    model: string | null
  }
  last_index: string | null
}

export interface Tag {
  id: number
  memory_id: number
  tag: string
}

export interface Link {
  id: number
  from_memory_id: number
  to_memory_id: number
  link_type: string | null
}

let SQL: any = null
let dbInstance: Database | null = null
let dbPath: string | null = null

/**
 * Initialize sql.js library
 */
async function initSQL(): Promise<void> {
  if (SQL) return
  SQL = await initSqlJs()
}

/**
 * Get database path for current project
 */
function getDbPath(): string {
  return path.join(process.cwd(), '.jfl', 'memory.db')
}

/**
 * Load or create database
 */
async function loadDb(): Promise<Database> {
  await initSQL()

  const currentPath = getDbPath()

  // If db instance exists and path matches, reuse it
  if (dbInstance && dbPath === currentPath) {
    return dbInstance
  }

  // Check if database file exists
  if (fs.existsSync(currentPath)) {
    const buffer = fs.readFileSync(currentPath)
    dbInstance = new SQL.Database(buffer)
  } else {
    // Create new database
    dbInstance = new SQL.Database()
  }

  dbPath = currentPath

  if (!dbInstance) {
    throw new Error('Failed to create database instance')
  }

  return dbInstance
}

/**
 * Save database to disk
 */
async function saveDb(db: Database): Promise<void> {
  const currentPath = getDbPath()
  const data = db.export()
  const buffer = Buffer.from(data)

  // Ensure .jfl directory exists
  const dir = path.dirname(currentPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(currentPath, buffer)
}

/**
 * Initialize database schema
 */
export async function initializeDatabase(): Promise<void> {
  const db = await loadDb()

  // Create memories table
  db.run(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_id TEXT,
      type TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      embedding BLOB,
      embedding_model TEXT,
      tf_idf_tokens TEXT
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_source_id ON memories(source_id)`)

  // Create tags table
  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_tags_memory ON tags(memory_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag)`)

  // Create links table
  db.run(`
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_memory_id INTEGER NOT NULL,
      to_memory_id INTEGER NOT NULL,
      link_type TEXT,
      FOREIGN KEY (from_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (to_memory_id) REFERENCES memories(id) ON DELETE CASCADE
    )
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_memory_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_memory_id)`)

  // Create meta table
  db.run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  // Insert default meta values if not exists
  const versionExists = db.exec(`SELECT value FROM meta WHERE key = 'version'`)
  if (versionExists.length === 0) {
    db.run(`INSERT INTO meta (key, value) VALUES ('version', '1')`)
    db.run(`INSERT INTO meta (key, value) VALUES ('last_index', '${new Date().toISOString()}')`)
    db.run(`INSERT INTO meta (key, value) VALUES ('embedding_model', 'text-embedding-3-small')`)
  }

  await saveDb(db)
}

/**
 * Check if memory is already indexed
 */
export async function isMemoryIndexed(sourceId: string, timestamp: string): Promise<boolean> {
  const db = await loadDb()

  const result = db.exec(`
    SELECT id FROM memories
    WHERE source_id = ? AND created_at = ?
  `, [sourceId, timestamp])

  return result.length > 0 && result[0].values.length > 0
}

/**
 * Insert a memory
 */
export async function insertMemory(memory: MemoryInsert): Promise<number> {
  const db = await loadDb()

  const now = new Date().toISOString()

  // Serialize embedding if present
  let embeddingBlob = null
  if (memory.embedding) {
    embeddingBlob = Buffer.from(memory.embedding.buffer)
  }

  db.run(`
    INSERT INTO memories (
      source, source_id, type, title, content, summary,
      metadata, created_at, indexed_at, embedding,
      embedding_model, tf_idf_tokens
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    memory.source,
    memory.source_id || null,
    memory.type || null,
    memory.title,
    memory.content,
    memory.summary || null,
    memory.metadata ? JSON.stringify(memory.metadata) : null,
    memory.created_at,
    now,
    embeddingBlob,
    memory.embedding_model || null,
    memory.tf_idf_tokens ? JSON.stringify(memory.tf_idf_tokens) : null
  ])

  // Get last insert ID
  const result = db.exec(`SELECT last_insert_rowid() as id`)
  const id = result[0].values[0][0] as number

  await saveDb(db)

  return id
}

/**
 * Get all memories
 */
export async function getAllMemories(): Promise<Memory[]> {
  const db = await loadDb()

  const result = db.exec(`SELECT * FROM memories ORDER BY created_at DESC`)

  if (result.length === 0 || result[0].values.length === 0) {
    return []
  }

  const columns = result[0].columns
  const rows = result[0].values

  return rows.map((row: any) => {
    const memory: any = {}
    columns.forEach((col: string, i: number) => {
      memory[col] = row[i]
    })
    return memory as Memory
  })
}

/**
 * Get memories by IDs
 */
export async function getMemoriesByIds(ids: number[]): Promise<Memory[]> {
  if (ids.length === 0) return []

  const db = await loadDb()
  const placeholders = ids.map(() => '?').join(',')

  const result = db.exec(`SELECT * FROM memories WHERE id IN (${placeholders})`, ids)

  if (result.length === 0 || result[0].values.length === 0) {
    return []
  }

  const columns = result[0].columns
  const rows = result[0].values

  return rows.map((row: any) => {
    const memory: any = {}
    columns.forEach((col: string, i: number) => {
      memory[col] = row[i]
    })
    return memory as Memory
  })
}

/**
 * Get memory statistics
 */
export async function getMemoryStats(): Promise<MemoryStats> {
  const db = await loadDb()

  // Total count
  const totalResult = db.exec(`SELECT COUNT(*) as total FROM memories`)
  const total = totalResult[0].values[0][0] as number

  // By type
  const typeResult = db.exec(`SELECT type, COUNT(*) as count FROM memories GROUP BY type`)
  const byType: Record<string, number> = {}
  if (typeResult.length > 0) {
    typeResult[0].values.forEach((row: any) => {
      const type = row[0] as string || 'unknown'
      const count = row[1] as number
      byType[type] = count
    })
  }

  // Date range
  const dateResult = db.exec(`
    SELECT MIN(created_at) as earliest, MAX(created_at) as latest
    FROM memories
  `)
  const earliest = dateResult[0].values[0][0] as string || null
  const latest = dateResult[0].values[0][1] as string || null

  // Embeddings
  const embeddingResult = db.exec(`
    SELECT COUNT(*) as count, embedding_model
    FROM memories
    WHERE embedding IS NOT NULL
  `)
  const embeddingCount = embeddingResult.length > 0 ? embeddingResult[0].values[0][0] as number : 0
  const embeddingModel = embeddingResult.length > 0 ? embeddingResult[0].values[0][1] as string : null

  // Last index
  const metaResult = db.exec(`SELECT value FROM meta WHERE key = 'last_index'`)
  const lastIndex = metaResult.length > 0 ? metaResult[0].values[0][0] as string : null

  return {
    total_memories: total,
    by_type: byType,
    date_range: {
      earliest,
      latest
    },
    embeddings: {
      available: embeddingCount > 0,
      count: embeddingCount,
      model: embeddingModel
    },
    last_index: lastIndex
  }
}

/**
 * Update last index timestamp
 */
export async function setLastIndexTimestamp(timestamp: string): Promise<void> {
  const db = await loadDb()

  db.run(`
    INSERT OR REPLACE INTO meta (key, value)
    VALUES ('last_index', ?)
  `, [timestamp])

  await saveDb(db)
}

/**
 * Get last index timestamp
 */
export async function getLastIndexTimestamp(): Promise<string | null> {
  const db = await loadDb()

  const result = db.exec(`SELECT value FROM meta WHERE key = 'last_index'`)

  if (result.length === 0 || result[0].values.length === 0) {
    return null
  }

  return result[0].values[0][0] as string
}

/**
 * Deserialize embedding from buffer
 */
export function deserializeEmbedding(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
    dbPath = null
  }
}
