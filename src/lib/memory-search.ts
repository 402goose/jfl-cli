/**
 * Memory Search Module
 *
 * Hybrid search combining TF-IDF (fast, always available) and
 * embeddings (semantic, optional). Provides relevance scoring
 * and result ranking.
 *
 * @purpose Fast and semantic search across indexed memories
 */

import OpenAI from 'openai'
import { Memory, getAllMemories, deserializeEmbedding } from './memory-db.js'

export interface SearchResult {
  memory: Memory
  score: number
  relevance: 'high' | 'medium' | 'low'
}

export interface SearchOptions {
  maxItems?: number
  type?: string
  since?: string
  method?: 'tfidf' | 'embedding' | 'hybrid'
}

/**
 * Tokenize text for TF-IDF
 * Reused from Context Hub implementation
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2)
}

/**
 * Compute TF-IDF scores for text
 */
export function computeTFIDF(text: string, allTexts: string[]): Record<string, number> {
  const tokens = tokenize(text)
  const tokenCounts: Record<string, number> = {}

  // Term frequency
  tokens.forEach(token => {
    tokenCounts[token] = (tokenCounts[token] || 0) + 1
  })

  const totalTokens = tokens.length
  const tf: Record<string, number> = {}

  Object.keys(tokenCounts).forEach(token => {
    tf[token] = tokenCounts[token] / totalTokens
  })

  // Inverse document frequency
  const idf: Record<string, number> = {}
  const totalDocs = allTexts.length

  Object.keys(tf).forEach(token => {
    const docsWithToken = allTexts.filter(doc =>
      tokenize(doc).includes(token)
    ).length

    idf[token] = Math.log(totalDocs / (docsWithToken + 1))
  })

  // TF-IDF
  const tfidf: Record<string, number> = {}
  Object.keys(tf).forEach(token => {
    tfidf[token] = tf[token] * idf[token]
  })

  return tfidf
}

/**
 * Search memories using TF-IDF
 */
async function searchMemoriesTFIDF(
  query: string,
  memories: Memory[],
  limit: number
): Promise<SearchResult[]> {
  const queryTokens = tokenize(query)
  const scored: SearchResult[] = []

  for (const memory of memories) {
    if (!memory.tf_idf_tokens) continue

    const tfIdfTokens = JSON.parse(memory.tf_idf_tokens) as Record<string, number>
    let score = 0

    for (const token of queryTokens) {
      score += tfIdfTokens[token] || 0
    }

    // Boost recent entries (1.3x if within 7 days)
    const daysSinceCreated = daysBetween(memory.created_at, new Date().toISOString())
    if (daysSinceCreated < 7) {
      score *= 1.3
    }

    // Boost by type
    if (memory.type === 'decision') score *= 1.4
    if (memory.type === 'feature') score *= 1.2

    if (score > 0) {
      scored.push({
        memory,
        score,
        relevance: score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low'
      })
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, limit)
}

/**
 * Compute embedding for text using OpenAI
 */
async function computeEmbedding(text: string): Promise<{
  embedding: Float32Array
  model: string
} | null> {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return null
  }

  try {
    const openai = new OpenAI({ apiKey })

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      encoding_format: 'float'
    })

    return {
      embedding: new Float32Array(response.data[0].embedding),
      model: 'text-embedding-3-small'
    }
  } catch (error) {
    console.error('Failed to compute embedding:', error)
    return null
  }
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Search memories using embeddings
 */
async function searchMemoriesEmbedding(
  query: string,
  memories: Memory[],
  limit: number
): Promise<SearchResult[]> {
  // Compute query embedding
  const queryEmbedding = await computeEmbedding(query)

  if (!queryEmbedding) {
    return []
  }

  const scored: SearchResult[] = []

  for (const memory of memories) {
    if (!memory.embedding) continue

    const memoryEmbedding = deserializeEmbedding(memory.embedding as Buffer)
    const similarity = cosineSimilarity(queryEmbedding.embedding, memoryEmbedding)

    if (similarity > 0.5) {
      scored.push({
        memory,
        score: similarity,
        relevance: similarity > 0.8 ? 'high' : similarity > 0.65 ? 'medium' : 'low'
      })
    }
  }

  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, limit * 2) // Get more for merging
}

/**
 * Normalize scores to 0-1 range
 */
function normalizeScores(results: SearchResult[]): SearchResult[] {
  if (results.length === 0) return []

  const maxScore = Math.max(...results.map(r => r.score))
  const minScore = Math.min(...results.map(r => r.score))
  const range = maxScore - minScore

  if (range === 0) return results

  return results.map(r => ({
    ...r,
    score: (r.score - minScore) / range
  }))
}

/**
 * Hybrid search combining TF-IDF and embeddings
 */
async function searchMemoriesHybrid(
  query: string,
  memories: Memory[],
  limit: number
): Promise<SearchResult[]> {
  // Run both searches in parallel
  const [tfIdfResults, embeddingResults] = await Promise.all([
    searchMemoriesTFIDF(query, memories, limit * 2),
    searchMemoriesEmbedding(query, memories, limit * 2).catch(() => [])
  ])

  // Normalize scores
  const tfIdfNormalized = normalizeScores(tfIdfResults)
  const embeddingNormalized = normalizeScores(embeddingResults)

  // Merge with weights (TF-IDF: 0.4, Embedding: 0.6)
  const mergedScores = new Map<number, number>()

  for (const result of tfIdfNormalized) {
    const memId = result.memory.id
    mergedScores.set(memId, (mergedScores.get(memId) || 0) + result.score * 0.4)
  }

  for (const result of embeddingNormalized) {
    const memId = result.memory.id
    mergedScores.set(memId, (mergedScores.get(memId) || 0) + result.score * 0.6)
  }

  // Create final results
  const memoryMap = new Map<number, Memory>()
  tfIdfResults.forEach(r => memoryMap.set(r.memory.id, r.memory))
  embeddingResults.forEach(r => memoryMap.set(r.memory.id, r.memory))

  const finalResults: SearchResult[] = Array.from(mergedScores.entries())
    .map(([id, score]) => ({
      memory: memoryMap.get(id)!,
      score,
      relevance: score > 0.7 ? 'high' as const : score > 0.4 ? 'medium' as const : 'low' as const
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return finalResults
}

/**
 * Main search function
 */
export async function searchMemories(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const {
    maxItems = 10,
    type,
    since,
    method = 'hybrid'
  } = options

  // Get all memories
  let memories = await getAllMemories()

  // Apply filters
  if (type && type !== 'all') {
    memories = memories.filter(m => m.type === type)
  }

  if (since) {
    memories = memories.filter(m => m.created_at >= since)
  }

  // Search based on method
  if (method === 'tfidf') {
    return searchMemoriesTFIDF(query, memories, maxItems)
  } else if (method === 'embedding') {
    return searchMemoriesEmbedding(query, memories, maxItems)
  } else {
    return searchMemoriesHybrid(query, memories, maxItems)
  }
}

/**
 * Calculate days between two dates
 */
function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1)
  const d2 = new Date(date2)
  const diff = Math.abs(d2.getTime() - d1.getTime())
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

/**
 * Export compute embedding for use in indexer
 */
export { computeEmbedding }
