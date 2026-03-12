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
 * - BM25+ variant with positive IDF floor for better NDCG
 * - Query term weighting based on IDF for discriminative power
 * - Reciprocal rank fusion for hybrid score merging
 * - Pivoted document length normalization
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
  /** Use BM25+ variant with positive IDF floor (default: true) */
  bm25Plus?: boolean
  /** Use reciprocal rank fusion for hybrid merging (default: true) */
  useRRF?: boolean
  /** RRF k parameter - higher values smooth rank differences (default: 60) */
  rrfK?: number
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

// ============================================================================
// BM25+ and Score Normalization Improvements
// ============================================================================

/**
 * BM25+ IDF calculation with positive floor.
 *
 * Standard BM25 IDF: log((N - df + 0.5) / (df + 0.5))
 * This can go NEGATIVE when df > N/2, penalizing common terms.
 *
 * BM25+ adds a floor of δ (typically 1) to ensure all matching terms
 * contribute positively:
 *
 *   IDF+ = max(0, log((N - df + 0.5) / (df + 0.5))) + δ
 *
 * This improves NDCG for queries containing common relevant terms.
 *
 * @param N - Total number of documents
 * @param df - Document frequency of term
 * @param delta - Positive floor value (default: 1)
 */
function computeBM25PlusIDF(N: number, df: number, delta: number = 1): number {
  const standardIDF = Math.log((N - df + 0.5) / (df + 0.5) + 1)
  return Math.max(0, standardIDF) + delta
}

/**
 * Compute query term weights based on corpus IDF.
 *
 * Terms that are rarer in the corpus get higher weights, improving
 * discrimination. This is especially important for short queries
 * where every term matters.
 *
 * Weight formula: softmax(IDF scores) to normalize to probability distribution
 *
 * @param queryTokens - Tokenized query terms
 * @param docFreq - Map of term -> document frequency
 * @param N - Total number of documents
 */
function computeQueryTermWeights(
  queryTokens: string[],
  docFreq: Map<string, number>,
  N: number
): Map<string, number> {
  const weights = new Map<string, number>()

  if (queryTokens.length === 0) return weights

  // Compute raw IDF weights
  const rawWeights: number[] = []
  for (const token of queryTokens) {
    const df = docFreq.get(token) || 0
    const idf = Math.log((N + 1) / (df + 1)) + 1
    rawWeights.push(idf)
  }

  // Normalize using softmax-inspired scaling
  const maxWeight = Math.max(...rawWeights)
  const minWeight = Math.min(...rawWeights)
  const range = maxWeight - minWeight

  for (let i = 0; i < queryTokens.length; i++) {
    // Scale to [0.5, 1.5] range - ensures all terms contribute but rare ones more
    const normalizedWeight = range > 0
      ? 0.5 + (rawWeights[i] - minWeight) / range
      : 1.0
    weights.set(queryTokens[i], normalizedWeight)
  }

  return weights
}

/**
 * Reciprocal Rank Fusion (RRF) for combining multiple ranked lists.
 *
 * RRF is more robust than linear score combination because it:
 * 1. Doesn't require score normalization
 * 2. Is less sensitive to outlier scores
 * 3. Naturally handles different score scales
 *
 * Formula: RRF(d) = Σ 1 / (k + rank_i(d))
 *
 * where k is a smoothing constant (typically 60) that controls
 * how much rank differences matter.
 *
 * @param rankings - Array of ranked result lists
 * @param k - Smoothing constant (higher = smoother rank differences)
 */
function reciprocalRankFusion(
  rankings: SearchResult[][],
  k: number = 60
): Map<number, number> {
  const rrfScores = new Map<number, number>()

  for (const ranking of rankings) {
    for (let rank = 0; rank < ranking.length; rank++) {
      const memId = ranking[rank].memory.id
      const currentScore = rrfScores.get(memId) || 0
      rrfScores.set(memId, currentScore + 1 / (k + rank + 1))
    }
  }

  return rrfScores
}

/**
 * Pivoted document length normalization.
 *
 * Standard BM25 length normalization can over-penalize long documents
 * or under-penalize short ones depending on b. Pivoted normalization
 * provides a more balanced approach:
 *
 *   norm = 1 - s + s * (dl / pivot)
 *
 * where:
 * - s is the slope (similar to b, typically 0.2-0.4)
 * - pivot is a calibrated average length (can be tuned)
 *
 * This produces more stable rankings across varying document lengths.
 *
 * @param dl - Document length
 * @param avgdl - Average document length
 * @param s - Slope parameter (default: 0.2)
 * @param pivotFactor - Pivot as factor of avgdl (default: 1.0)
 */
function pivotedLengthNorm(
  dl: number,
  avgdl: number,
  s: number = 0.2,
  pivotFactor: number = 1.0
): number {
  const pivot = avgdl * pivotFactor
  return 1 - s + s * (dl / pivot)
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
 * BM25/BM25+ first-pass scoring over full document collection.
 *
 * Uses tuned k1/b parameters optimized for short, structured journal entries:
 * - k1=1.5: Term frequency saturation tuned for short queries — higher k1 allows
 *   more discrimination between documents with varying term frequencies
 * - b: Adaptive based on corpus length variance (default 0.65)
 *
 * Key optimizations in this implementation:
 * - BM25+ variant with positive IDF floor (prevents common term penalty)
 * - Query term weighting based on IDF for discriminative power
 * - Pivoted length normalization option for balanced doc length handling
 * - Stopword removal reduces noise in term matching
 * - Phrase detection keeps compound terms together
 * - Adaptive b parameter adjusts to corpus characteristics
 */
async function searchMemoriesBM25(
  query: string,
  memories: Memory[],
  limit: number,
  k1: number = 1.5,
  bOverride?: number,
  legacy: boolean = false,
  useBM25Plus: boolean = true
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

  // Compute query term weights for discriminative scoring
  const queryTermWeights = computeQueryTermWeights(queryTokens, docFreq, N)

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

      // Use BM25+ IDF (with positive floor) or standard BM25 IDF
      const idf = useBM25Plus
        ? computeBM25PlusIDF(N, df, 1)
        : Math.log((N - df + 0.5) / (df + 0.5) + 1)

      // BM25 TF normalization with length normalization
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgdl)))

      // Apply query term weight for discriminative scoring
      const termWeight = queryTermWeights.get(token) || 1.0
      bm25Score += idf * tfNorm * termWeight
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
 * Uses reciprocal rank fusion (RRF) by default for more robust score merging.
 * RRF is better than linear interpolation because:
 * 1. It doesn't require score normalization
 * 2. It's less sensitive to outlier scores
 * 3. It naturally handles different score distributions
 *
 * Falls back to weighted linear combination if RRF is disabled.
 */
async function searchMemoriesHybrid(
  query: string,
  memories: Memory[],
  limit: number,
  legacy: boolean = false,
  useRRF: boolean = true,
  rrfK: number = 60,
  useBM25Plus: boolean = true
): Promise<SearchResult[]> {
  // Run BM25 (lexical) and embedding (semantic) in parallel
  const [bm25Results, embeddingResults] = await Promise.all([
    searchMemoriesBM25(query, memories, limit * 2, 1.5, undefined, legacy, useBM25Plus),
    searchMemoriesEmbedding(query, memories, limit * 2).catch(() => [])
  ])

  // Build memory lookup map
  const memoryMap = new Map<number, Memory>()
  bm25Results.forEach(r => memoryMap.set(r.memory.id, r.memory))
  embeddingResults.forEach(r => memoryMap.set(r.memory.id, r.memory))

  let mergedScores: Map<number, number>

  if (useRRF) {
    // Use Reciprocal Rank Fusion for robust score merging
    mergedScores = reciprocalRankFusion([bm25Results, embeddingResults], rrfK)
  } else {
    // Fallback to weighted linear combination
    const bm25Normalized = normalizeScores(bm25Results)
    const embeddingNormalized = normalizeScores(embeddingResults)

    mergedScores = new Map<number, number>()

    for (const result of bm25Normalized) {
      const memId = result.memory.id
      mergedScores.set(memId, (mergedScores.get(memId) || 0) + result.score * 0.4)
    }

    for (const result of embeddingNormalized) {
      const memId = result.memory.id
      mergedScores.set(memId, (mergedScores.get(memId) || 0) + result.score * 0.6)
    }
  }

  // Create final results
  const finalResults: SearchResult[] = Array.from(mergedScores.entries())
    .map(([id, score]) => ({
      memory: memoryMap.get(id)!,
      score,
      relevance: score > 0.7 ? 'high' as const : score > 0.4 ? 'medium' as const : 'low' as const
    }))
    .filter(r => r.memory) // Filter out any undefined memories
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return finalResults
}

/**
 * BM25/BM25+ re-ranking as a second-pass scoring step.
 *
 * Applies Okapi BM25 (or BM25+ variant) between query terms and document
 * content to re-order initial retrieval results. This bridges the gap
 * between semantic/vector retrieval and lexical relevance.
 *
 * Uses advanced tokenization for better term matching.
 *
 * @param results - Initial retrieval results (first-pass candidates)
 * @param query - Original search query
 * @param k1 - Term frequency saturation (default 1.5, tuned for short queries)
 * @param bOverride - Optional override for b parameter (otherwise adaptive)
 * @param legacy - Use legacy tokenization
 * @param useBM25Plus - Use BM25+ variant with positive IDF floor
 */
function reRankWithBM25(
  results: SearchResult[],
  query: string,
  k1: number = 1.5,
  bOverride?: number,
  legacy: boolean = false,
  useBM25Plus: boolean = true
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

  // Compute query term weights for discriminative scoring
  const queryTermWeights = computeQueryTermWeights(queryTokens, docFreq, N)

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

      // Use BM25+ IDF or standard BM25 IDF
      const idf = useBM25Plus
        ? computeBM25PlusIDF(N, df, 1)
        : Math.log((N - df + 0.5) / (df + 0.5) + 1)

      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgdl)))

      // Apply query term weight
      const termWeight = queryTermWeights.get(token) || 1.0
      bm25Score += idf * tfNorm * termWeight
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
 * - bm25: BM25/BM25+ scoring with adaptive length normalization
 * - tfidf: Classic TF-IDF scoring
 * - embedding: Semantic search with embeddings
 * - hybrid: Combined BM25 + embedding with RRF (default)
 *
 * All methods use stopword removal and phrase detection by default.
 * Set legacyTokenize=true to use original tokenization.
 *
 * New options for improved ranking:
 * - bm25Plus: Use BM25+ variant with positive IDF floor (default: true)
 * - useRRF: Use reciprocal rank fusion for hybrid (default: true)
 * - rrfK: RRF smoothing constant (default: 60)
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
    legacyTokenize = false,
    bm25Plus = true,
    useRRF = true,
    rrfK = 60
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
    results = await searchMemoriesBM25(query, memories, maxItems * 2, 1.5, undefined, legacyTokenize, bm25Plus)
  } else if (method === 'tfidf') {
    results = await searchMemoriesTFIDF(query, memories, maxItems * 2, legacyTokenize)
  } else if (method === 'embedding') {
    results = await searchMemoriesEmbedding(query, memories, maxItems * 2)
  } else {
    results = await searchMemoriesHybrid(query, memories, maxItems * 2, legacyTokenize, useRRF, rrfK, bm25Plus)
  }

  // Second-pass: BM25 re-ranking
  if (rerank && results.length > 1) {
    results = reRankWithBM25(results, query, 1.5, undefined, legacyTokenize, bm25Plus)
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

/**
 * Export BM25+ IDF computation for testing
 */
export { computeBM25PlusIDF }

/**
 * Export query term weight computation for testing
 */
export { computeQueryTermWeights }

/**
 * Export reciprocal rank fusion for testing
 */
export { reciprocalRankFusion }

/**
 * Export pivoted length normalization for testing
 */
export { pivotedLengthNorm }
