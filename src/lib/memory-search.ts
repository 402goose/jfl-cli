/**
 * Memory Search Module
 *
 * Hybrid search combining TF-IDF (fast, always available) and
 * embeddings (semantic, optional). Provides relevance scoring
 * and result ranking.
 *
 * Key optimizations:
 * - Stopword removal for cleaner term matching
 * - Phrase detection for multi-word queries
 * - Adaptive BM25 b parameter based on corpus statistics
 *
 * @purpose Fast and semantic search across indexed memories
 */

import OpenAI from 'openai'
import { Memory, getAllMemories, deserializeEmbedding } from './memory-db.js'
import {
  tokenize as advancedTokenize,
  tokenizeQuery,
  tokenizeDocument,
} from './text-preprocessing.js'

export interface SearchResult {
  memory: Memory
  score: number
  relevance: 'high' | 'medium' | 'low'
}

export interface SearchOptions {
  maxItems?: number
  type?: string
  since?: string
  method?: 'tfidf' | 'embedding' | 'hybrid' | 'bm25'
  rerank?: boolean
  /** Use legacy tokenization (no stopwords/phrases) */
  legacyTokenize?: boolean
}

/**
 * Tokenize text for search.
 * Uses advanced preprocessing by default (stopword removal, phrase detection).
 * Falls back to legacy mode if specified.
 */
function tokenize(text: string, legacy: boolean = false): string[] {
  if (legacy) {
    // Legacy tokenization (no stopwords, no phrases)
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2)
  }
  return advancedTokenize(text)
}

/**
 * Compute TF-IDF scores for text.
 *
 * Uses advanced tokenization with stopword removal and phrase detection
 * for cleaner term matching.
 *
 * @param text - Text to compute TF-IDF for
 * @param allTexts - Corpus of all documents (for IDF calculation)
 * @param legacy - Use legacy tokenization (no preprocessing)
 */
export function computeTFIDF(
  text: string,
  allTexts: string[],
  legacy: boolean = false
): Record<string, number> {
  const tokens = legacy ? tokenize(text, true) : tokenizeDocument(text)
  const tokenCounts: Record<string, number> = {}

  // Term frequency
  tokens.forEach(token => {
    tokenCounts[token] = (tokenCounts[token] || 0) + 1
  })

  const totalTokens = tokens.length
  if (totalTokens === 0) return {}

  const tf: Record<string, number> = {}

  Object.keys(tokenCounts).forEach(token => {
    tf[token] = tokenCounts[token] / totalTokens
  })

  // Inverse document frequency
  // Pre-tokenize all docs once for efficiency
  const tokenizedDocs = allTexts.map(doc =>
    legacy ? tokenize(doc, true) : tokenizeDocument(doc)
  )
  const idf: Record<string, number> = {}
  const totalDocs = allTexts.length

  Object.keys(tf).forEach(token => {
    const docsWithToken = tokenizedDocs.filter(docTokens =>
      docTokens.includes(token)
    ).length

    // Smooth IDF to handle rare terms
    idf[token] = Math.log((totalDocs + 1) / (docsWithToken + 1)) + 1
  })

  // TF-IDF
  const tfidf: Record<string, number> = {}
  Object.keys(tf).forEach(token => {
    tfidf[token] = tf[token] * idf[token]
  })

  return tfidf
}

/**
 * Search memories using TF-IDF.
 *
 * Uses advanced query tokenization for better term matching.
 */
async function searchMemoriesTFIDF(
  query: string,
  memories: Memory[],
  limit: number,
  legacy: boolean = false
): Promise<SearchResult[]> {
  const queryTokens = legacy ? tokenize(query, true) : tokenizeQuery(query)
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
 * Compute adaptive BM25 b parameter based on corpus statistics.
 *
 * The b parameter controls length normalization:
 * - b=0: No length normalization (favor longer docs with more term matches)
 * - b=1: Full length normalization (treat all docs equally regardless of length)
 *
 * Adaptive tuning based on corpus variance:
 * - High variance in doc lengths → higher b (need more normalization)
 * - Low variance → lower b (docs are similar length, less normalization needed)
 *
 * For journal entries (typically 100-500 tokens), we start with b=0.65 as baseline
 * and adjust based on actual corpus statistics.
 */
function computeAdaptiveB(docLengths: number[]): number {
  if (docLengths.length === 0) return 0.65

  const avgLength = docLengths.reduce((a, b) => a + b, 0) / docLengths.length
  if (avgLength === 0) return 0.65

  // Compute coefficient of variation (CV) = stddev / mean
  const variance = docLengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / docLengths.length
  const stddev = Math.sqrt(variance)
  const cv = stddev / avgLength

  // Map CV to b parameter:
  // - CV < 0.3: Low variance, use b=0.4 (less normalization)
  // - CV 0.3-0.7: Moderate variance, use b=0.5-0.7
  // - CV > 0.7: High variance, use b=0.75-0.85
  // Clamp to [0.3, 0.85] range
  const baseB = 0.65
  const adjustedB = baseB + (cv - 0.5) * 0.4

  return Math.max(0.3, Math.min(0.85, adjustedB))
}

/**
 * BM25 first-pass scoring over full document collection.
 *
 * Uses tuned k1/b parameters optimized for short, structured journal entries:
 * - k1=1.2: Aggressive term frequency saturation — in short docs (100-500 tokens),
 *   a term appearing 2-3 times is already highly relevant
 * - b: Adaptive based on corpus length variance (default 0.65)
 *
 * Key optimizations in this implementation:
 * - Stopword removal reduces noise in term matching
 * - Phrase detection keeps compound terms together
 * - Adaptive b parameter adjusts to corpus characteristics
 */
async function searchMemoriesBM25(
  query: string,
  memories: Memory[],
  limit: number,
  k1: number = 1.2,
  bOverride?: number,
  legacy: boolean = false
): Promise<SearchResult[]> {
  // Use query-specific tokenization
  const queryTokens = legacy ? tokenize(query, true) : tokenizeQuery(query)
  if (queryTokens.length === 0) return []

  // Tokenize all documents
  const docs = memories.map(m => {
    const text = [m.title, m.content, m.summary]
      .filter(Boolean)
      .join(' ')
    return legacy ? tokenize(text, true) : tokenizeDocument(text)
  })

  const N = docs.length
  if (N === 0) return []

  // Compute corpus statistics for adaptive b
  const docLengths = docs.map(d => d.length)
  const avgdl = docLengths.reduce((sum, len) => sum + len, 0) / N
  const b = bOverride ?? computeAdaptiveB(docLengths)

  // Pre-compute document frequencies for query terms
  const docFreq = new Map<string, number>()
  for (const token of queryTokens) {
    let count = 0
    for (const doc of docs) {
      if (doc.includes(token)) count++
    }
    docFreq.set(token, count)
  }

  const scored: SearchResult[] = []

  for (let i = 0; i < memories.length; i++) {
    const doc = docs[i]
    const dl = doc.length
    if (dl === 0) continue

    // Build term frequency map for this document
    const termCounts = new Map<string, number>()
    for (const token of doc) {
      termCounts.set(token, (termCounts.get(token) || 0) + 1)
    }

    let bm25Score = 0
    for (const token of queryTokens) {
      const tf = termCounts.get(token) || 0
      if (tf === 0) continue

      const df = docFreq.get(token) || 0
      // BM25 IDF: log((N - df + 0.5) / (df + 0.5) + 1)
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)
      // BM25 TF normalization with length normalization
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgdl)))
      bm25Score += idf * tfNorm
    }

    if (bm25Score > 0) {
      const memory = memories[i]

      // Apply temporal and type boosts
      const daysSinceCreated = daysBetween(memory.created_at, new Date().toISOString())
      if (daysSinceCreated < 7) bm25Score *= 1.3
      if (memory.type === 'decision') bm25Score *= 1.4
      if (memory.type === 'feature') bm25Score *= 1.2

      scored.push({
        memory,
        score: bm25Score,
        relevance: bm25Score > 0.7 ? 'high' : bm25Score > 0.4 ? 'medium' : 'low'
      })
    }
  }

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
  const openaiKey = process.env.OPENAI_API_KEY
  const openrouterKey = process.env.OPENROUTER_API_KEY

  if (!openaiKey && !openrouterKey) {
    return null
  }

  // Try OpenAI first, fall back to OpenRouter
  if (openaiKey) {
    try {
      const openai = new OpenAI({ apiKey: openaiKey })
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        encoding_format: 'float'
      })
      return {
        embedding: new Float32Array(response.data[0].embedding),
        model: 'text-embedding-3-small'
      }
    } catch (error: any) {
      if (error?.status === 429 || error?.code === 'insufficient_quota') {
        // OpenAI quota exceeded — fall through to OpenRouter
      } else {
        console.error('OpenAI embedding failed:', error?.message || error)
        return null
      }
    }
  }

  if (openrouterKey) {
    try {
      const openai = new OpenAI({
        apiKey: openrouterKey,
        baseURL: 'https://openrouter.ai/api/v1',
      })
      const response = await openai.embeddings.create({
        model: 'openai/text-embedding-3-small',
        input: text,
        encoding_format: 'float'
      })
      return {
        embedding: new Float32Array(response.data[0].embedding),
        model: 'openrouter/text-embedding-3-small'
      }
    } catch (error: any) {
      console.error('OpenRouter embedding failed:', error?.message || error)
    }
  }

  return null
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
 * Hybrid search combining BM25 and embeddings.
 *
 * Uses advanced tokenization for BM25 component.
 */
async function searchMemoriesHybrid(
  query: string,
  memories: Memory[],
  limit: number,
  legacy: boolean = false
): Promise<SearchResult[]> {
  // Run BM25 (lexical) and embedding (semantic) in parallel
  const [bm25Results, embeddingResults] = await Promise.all([
    searchMemoriesBM25(query, memories, limit * 2, 1.2, undefined, legacy),
    searchMemoriesEmbedding(query, memories, limit * 2).catch(() => [])
  ])

  // Normalize scores
  const bm25Normalized = normalizeScores(bm25Results)
  const embeddingNormalized = normalizeScores(embeddingResults)

  // Merge with weights (BM25: 0.4, Embedding: 0.6)
  const mergedScores = new Map<number, number>()

  for (const result of bm25Normalized) {
    const memId = result.memory.id
    mergedScores.set(memId, (mergedScores.get(memId) || 0) + result.score * 0.4)
  }

  for (const result of embeddingNormalized) {
    const memId = result.memory.id
    mergedScores.set(memId, (mergedScores.get(memId) || 0) + result.score * 0.6)
  }

  // Create final results
  const memoryMap = new Map<number, Memory>()
  bm25Results.forEach(r => memoryMap.set(r.memory.id, r.memory))
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
 * BM25 re-ranking as a second-pass scoring step.
 *
 * Applies Okapi BM25 between query terms and document content to
 * re-order initial retrieval results. This bridges the gap between
 * semantic/vector retrieval and lexical relevance.
 *
 * Uses advanced tokenization for better term matching.
 *
 * @param results - Initial retrieval results (first-pass candidates)
 * @param query - Original search query
 * @param k1 - Term frequency saturation (default 1.2, tuned for short journal docs)
 * @param bOverride - Optional override for b parameter (otherwise adaptive)
 * @param legacy - Use legacy tokenization
 */
function reRankWithBM25(
  results: SearchResult[],
  query: string,
  k1: number = 1.2,
  bOverride?: number,
  legacy: boolean = false
): SearchResult[] {
  if (results.length === 0) return results

  const queryTokens = legacy ? tokenize(query, true) : tokenizeQuery(query)
  if (queryTokens.length === 0) return results

  const docs = results.map(r => {
    const text = [r.memory.title, r.memory.content, r.memory.summary]
      .filter(Boolean)
      .join(' ')
    return legacy ? tokenize(text, true) : tokenizeDocument(text)
  })

  const N = docs.length
  const docLengths = docs.map(d => d.length)
  const avgdl = docLengths.reduce((sum, len) => sum + len, 0) / N
  const b = bOverride ?? computeAdaptiveB(docLengths)

  const docFreq = new Map<string, number>()
  for (const token of queryTokens) {
    let count = 0
    for (const doc of docs) {
      if (doc.includes(token)) count++
    }
    docFreq.set(token, count)
  }

  const reranked: SearchResult[] = results.map((result, i) => {
    const doc = docs[i]
    const dl = doc.length
    if (dl === 0) return { ...result, score: 0 }

    const termCounts = new Map<string, number>()
    for (const token of doc) {
      termCounts.set(token, (termCounts.get(token) || 0) + 1)
    }

    let bm25Score = 0
    for (const token of queryTokens) {
      const tf = termCounts.get(token) || 0
      const df = docFreq.get(token) || 0

      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1)
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgdl)))
      bm25Score += idf * tfNorm
    }

    const originalWeight = 0.4
    const bm25Weight = 0.6
    const combinedScore = result.score * originalWeight + bm25Score * bm25Weight

    return {
      ...result,
      score: combinedScore,
      relevance: combinedScore > 0.7 ? 'high' as const : combinedScore > 0.4 ? 'medium' as const : 'low' as const
    }
  })

  reranked.sort((a, b) => b.score - a.score)

  const normalized = normalizeScores(reranked)
  return normalized.map(r => ({
    ...r,
    relevance: r.score > 0.7 ? 'high' as const : r.score > 0.4 ? 'medium' as const : 'low' as const
  }))
}

/**
 * Main search function.
 *
 * Supports multiple search methods with advanced preprocessing:
 * - bm25: BM25 scoring with adaptive length normalization
 * - tfidf: Classic TF-IDF scoring
 * - embedding: Semantic search with embeddings
 * - hybrid: Combined BM25 + embedding (default)
 *
 * All methods use stopword removal and phrase detection by default.
 * Set legacyTokenize=true to use original tokenization.
 */
export async function searchMemories(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const {
    maxItems = 10,
    type,
    since,
    method = 'hybrid',
    rerank = true,
    legacyTokenize = false
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
  let results: SearchResult[]
  if (method === 'bm25') {
    results = await searchMemoriesBM25(query, memories, maxItems * 2, 1.2, undefined, legacyTokenize)
  } else if (method === 'tfidf') {
    results = await searchMemoriesTFIDF(query, memories, maxItems * 2, legacyTokenize)
  } else if (method === 'embedding') {
    results = await searchMemoriesEmbedding(query, memories, maxItems * 2)
  } else {
    results = await searchMemoriesHybrid(query, memories, maxItems * 2, legacyTokenize)
  }

  // Second-pass: BM25 re-ranking
  if (rerank && results.length > 1) {
    results = reRankWithBM25(results, query, 1.2, undefined, legacyTokenize)
  }

  return results.slice(0, maxItems)
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

/**
 * Export adaptive B parameter computation for testing and external use
 */
export { computeAdaptiveB }
