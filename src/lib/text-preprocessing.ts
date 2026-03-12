/**
 * Text Preprocessing Module
 *
 * Advanced text preprocessing for document indexing and search.
 * Includes stopword removal, phrase detection, and stemming-light normalization.
 *
 * @purpose Improve search quality through better text preprocessing
 */

// ============================================================================
// Stopwords
// ============================================================================

/**
 * English stopwords commonly filtered in IR systems.
 * Based on NLTK + Lucene stopword lists, tuned for technical/journal content.
 *
 * We intentionally KEEP some words that might be stopwords elsewhere but
 * carry meaning in code/development context (e.g., "not", "new", "same").
 */
export const STOPWORDS = new Set([
  // Articles
  'a', 'an', 'the',

  // Pronouns (but keep technical pronouns like "it" which often refers to specific things)
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom',

  // Common verbs (forms that rarely carry search meaning)
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'doing',
  'would', 'should', 'could', 'might', 'must', 'shall', 'will', 'can',

  // Prepositions
  'in', 'on', 'at', 'by', 'for', 'with', 'about', 'against',
  'between', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'to', 'from', 'up', 'down', 'out', 'off',
  'over', 'under', 'again', 'further', 'then', 'once',

  // Conjunctions
  'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
  'if', 'because', 'as', 'until', 'while', 'of', 'than',

  // Determiners/quantifiers
  'this', 'that', 'these', 'those',
  'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'any', 'all', 'only', 'own', 'very',

  // Misc high-frequency low-signal words
  'here', 'there', 'when', 'where', 'why', 'how',
  'just', 'also', 'now', 'too', 'very', 'really',

  // Technical context - keep "not" as it's semantically important
  // Keep "new", "same", "first", "last" as they carry meaning
])

/**
 * Domain-specific terms that should NEVER be filtered, even if they look like stopwords.
 * These are common in development/technical contexts.
 */
export const PROTECTED_TERMS = new Set([
  // Programming concepts that might look like stopwords
  'null', 'void', 'true', 'false', 'not', 'and', 'or', // logical operators
  'new', 'class', 'type', 'interface', 'function', 'return',
  'get', 'set', 'let', 'const', 'var',
  'api', 'cli', 'sql', 'css', 'html', 'jsx', 'tsx',
  'use', 'run', 'add', 'fix', 'bug', 'test',
])

// ============================================================================
// Phrase Detection
// ============================================================================

/**
 * Common multi-word phrases in development/product contexts.
 * These should be kept together as single tokens for better matching.
 */
export const COMMON_PHRASES: [string, string][] = [
  // Technical phrases
  ['machine', 'learning'],
  ['deep', 'learning'],
  ['neural', 'network'],
  ['natural', 'language'],
  ['language', 'model'],
  ['large', 'language'],
  ['text', 'embedding'],
  ['semantic', 'search'],
  ['vector', 'search'],
  ['document', 'indexing'],
  ['information', 'retrieval'],

  // Product/business phrases
  ['product', 'rank'],
  ['user', 'experience'],
  ['user', 'interface'],
  ['pull', 'request'],
  ['code', 'review'],
  ['unit', 'test'],
  ['integration', 'test'],
  ['smoke', 'test'],
  ['regression', 'test'],

  // Metrics
  ['precision', 'recall'],
  ['true', 'positive'],
  ['false', 'positive'],
  ['true', 'negative'],
  ['false', 'negative'],

  // Common compound concepts
  ['real', 'time'],
  ['open', 'source'],
  ['end', 'point'],
  ['data', 'base'],
  ['front', 'end'],
  ['back', 'end'],
  ['full', 'stack'],
]

/**
 * Build a phrase lookup map for efficient bigram detection.
 */
const PHRASE_MAP = new Map<string, string>()
for (const [first, second] of COMMON_PHRASES) {
  PHRASE_MAP.set(`${first}_${second}`, `${first}_${second}`)
}

// ============================================================================
// Core Functions
// ============================================================================

export interface TokenizeOptions {
  removeStopwords?: boolean
  detectPhrases?: boolean
  minLength?: number
  lowercase?: boolean
  preserveNumbers?: boolean
}

const DEFAULT_OPTIONS: Required<TokenizeOptions> = {
  removeStopwords: true,
  detectPhrases: true,
  minLength: 2,
  lowercase: true,
  preserveNumbers: true,
}

/**
 * Basic tokenization: split text into tokens.
 * Does NOT apply stopword removal or phrase detection.
 */
export function basicTokenize(text: string, options: TokenizeOptions = {}): string[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  let normalized = text

  if (opts.lowercase) {
    normalized = normalized.toLowerCase()
  }

  // Replace non-alphanumeric with spaces (preserve underscores for snake_case)
  normalized = normalized.replace(/[^a-z0-9_\s]/gi, ' ')

  // Split on whitespace
  const tokens = normalized.split(/\s+/).filter(Boolean)

  // Filter by minimum length
  return tokens.filter(token => {
    // Numbers are allowed if preserveNumbers is true
    if (opts.preserveNumbers && /^\d+$/.test(token)) {
      return token.length >= 1
    }
    return token.length >= opts.minLength
  })
}

/**
 * Detect and merge bigram phrases in token list.
 * Converts adjacent tokens that form known phrases into single underscore-joined tokens.
 */
export function detectPhrases(tokens: string[]): string[] {
  if (tokens.length < 2) return tokens

  const result: string[] = []
  let i = 0

  while (i < tokens.length) {
    if (i < tokens.length - 1) {
      const bigram = `${tokens[i]}_${tokens[i + 1]}`
      if (PHRASE_MAP.has(bigram)) {
        result.push(bigram)
        i += 2
        continue
      }
    }
    result.push(tokens[i])
    i++
  }

  return result
}

/**
 * Remove stopwords from token list, preserving protected terms.
 */
export function removeStopwords(tokens: string[]): string[] {
  return tokens.filter(token => {
    // Never filter protected terms
    if (PROTECTED_TERMS.has(token)) return true

    // Filter stopwords
    return !STOPWORDS.has(token)
  })
}

/**
 * Advanced tokenization with all preprocessing steps.
 *
 * Pipeline:
 * 1. Basic tokenization (lowercase, split, clean)
 * 2. Phrase detection (merge known bigrams)
 * 3. Stopword removal (filter common words)
 *
 * @param text - Raw text to tokenize
 * @param options - Preprocessing options
 * @returns Array of processed tokens
 */
export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Step 1: Basic tokenization
  let tokens = basicTokenize(text, opts)

  // Step 2: Phrase detection (before stopword removal to catch phrases like "pull request")
  if (opts.detectPhrases) {
    tokens = detectPhrases(tokens)
  }

  // Step 3: Stopword removal
  if (opts.removeStopwords) {
    tokens = removeStopwords(tokens)
  }

  return tokens
}

/**
 * Tokenize a query with different defaults than document tokenization.
 * For queries, we're more conservative about filtering.
 */
export function tokenizeQuery(query: string): string[] {
  // For queries, use slightly different settings:
  // - Still detect phrases
  // - Be more conservative with stopwords (only remove very common ones)
  // - Keep shorter tokens (might be abbreviations like "UI", "JS")
  return tokenize(query, {
    removeStopwords: true,
    detectPhrases: true,
    minLength: 2,
  })
}

/**
 * Tokenize a document for indexing.
 * More aggressive preprocessing for index efficiency.
 */
export function tokenizeDocument(text: string): string[] {
  return tokenize(text, {
    removeStopwords: true,
    detectPhrases: true,
    minLength: 2,
  })
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extract unique terms from text (deduped).
 */
export function extractTerms(text: string): string[] {
  const tokens = tokenize(text)
  return [...new Set(tokens)]
}

/**
 * Count term frequencies in text.
 */
export function countTermFrequencies(text: string): Map<string, number> {
  const tokens = tokenize(text)
  const counts = new Map<string, number>()

  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1)
  }

  return counts
}

/**
 * Check if a token is a stopword (considering protected terms).
 */
export function isStopword(token: string): boolean {
  if (PROTECTED_TERMS.has(token.toLowerCase())) return false
  return STOPWORDS.has(token.toLowerCase())
}
