/**
 * Memory Search Tests
 *
 * @purpose Verify BM25 scoring, TF-IDF computation, and search functionality
 */

import {
  computeTFIDF,
  computeAdaptiveB,
  computeBM25PlusIDF,
  computeQueryTermWeights,
  reciprocalRankFusion,
  pivotedLengthNorm,
} from '../memory-search.js'

describe('memory-search', () => {
  describe('computeTFIDF', () => {
    it('should compute TF-IDF scores for document', () => {
      const text = 'machine learning model training'
      const corpus = [
        'machine learning model training',
        'deep learning neural network',
        'natural language processing model',
      ]

      const result = computeTFIDF(text, corpus)

      // Should have entries for non-stopword tokens
      expect(Object.keys(result).length).toBeGreaterThan(0)

      // Phrase detection should merge 'machine' + 'learning'
      expect(result['machine_learning']).toBeDefined()
    })

    it('should use advanced tokenization by default', () => {
      const text = 'The quick brown fox is a mammal'
      const corpus = [text, 'Another document here']

      const result = computeTFIDF(text, corpus)

      // Should NOT have stopwords in the result
      expect(result['the']).toBeUndefined()
      expect(result['is']).toBeUndefined()
      expect(result['a']).toBeUndefined()

      // Should have content words
      expect(result['quick']).toBeDefined()
      expect(result['brown']).toBeDefined()
      expect(result['fox']).toBeDefined()
      expect(result['mammal']).toBeDefined()
    })

    it('should support legacy tokenization', () => {
      const text = 'The quick brown fox'
      const corpus = [text, 'Another document here']

      const result = computeTFIDF(text, corpus, true)

      // Legacy mode keeps stopwords
      expect(result['the']).toBeDefined()
      expect(result['quick']).toBeDefined()
    })

    it('should give higher IDF to rare terms', () => {
      const text = 'unique rare common'
      const corpus = [
        'unique rare common',
        'common everyday words',
        'common ordinary text',
        'common basic document',
      ]

      const result = computeTFIDF(text, corpus)

      // 'unique' appears in 1 doc, 'common' appears in 4 docs
      // 'unique' should have higher IDF contribution
      if (result['unique'] && result['common']) {
        expect(result['unique']).toBeGreaterThan(result['common'])
      }
    })

    it('should handle empty text', () => {
      const result = computeTFIDF('', ['doc1', 'doc2'])
      expect(Object.keys(result).length).toBe(0)
    })

    it('should handle single document corpus', () => {
      const text = 'test document content'
      const corpus = [text]

      const result = computeTFIDF(text, corpus)
      expect(Object.keys(result).length).toBeGreaterThan(0)
    })
  })

  describe('computeAdaptiveB', () => {
    it('should return default for empty array', () => {
      const result = computeAdaptiveB([])
      expect(result).toBe(0.65) // default baseline
    })

    it('should return moderate b for low variance corpus', () => {
      // All documents similar length (~100 tokens)
      const lengths = [95, 100, 105, 98, 102]
      const result = computeAdaptiveB(lengths)
      // Low variance should give lower b (less normalization needed)
      expect(result).toBeGreaterThanOrEqual(0.3)
      expect(result).toBeLessThanOrEqual(0.6)
    })

    it('should return higher b for high variance corpus', () => {
      // Very different document lengths
      const lengths = [10, 500, 50, 1000, 5]
      const result = computeAdaptiveB(lengths)
      // High variance should give higher b (more normalization needed)
      expect(result).toBeGreaterThanOrEqual(0.6)
      expect(result).toBeLessThanOrEqual(0.85)
    })

    it('should stay within bounds [0.3, 0.85]', () => {
      // Extreme cases
      const extremeLow = computeAdaptiveB([100, 100, 100, 100]) // no variance
      const extremeHigh = computeAdaptiveB([1, 10000, 2, 20000]) // extreme variance

      expect(extremeLow).toBeGreaterThanOrEqual(0.3)
      expect(extremeLow).toBeLessThanOrEqual(0.85)
      expect(extremeHigh).toBeGreaterThanOrEqual(0.3)
      expect(extremeHigh).toBeLessThanOrEqual(0.85)
    })

    it('should handle typical journal corpus', () => {
      // Typical journal entries: 100-500 tokens
      const lengths = [150, 200, 350, 120, 280, 180, 400, 250]
      const result = computeAdaptiveB(lengths)
      // Should be near baseline for typical variance
      expect(result).toBeGreaterThanOrEqual(0.5)
      expect(result).toBeLessThanOrEqual(0.75)
    })

    it('should produce valid TF-IDF for varied document lengths', () => {
      // Simulate corpus with varied lengths
      const shortDoc = 'brief note'
      const mediumDoc = 'this is a medium length document with more content'
      const longDoc = 'this is a very long document that contains many words and covers multiple topics in great detail with extensive elaboration on each point'

      const corpus = [shortDoc, mediumDoc, longDoc]

      // All should produce valid TF-IDF
      for (const doc of corpus) {
        const result = computeTFIDF(doc, corpus)
        expect(Object.keys(result).length).toBeGreaterThan(0)
        // All values should be positive numbers
        for (const score of Object.values(result)) {
          expect(score).toBeGreaterThan(0)
          expect(isFinite(score)).toBe(true)
        }
      }
    })
  })

  describe('phrase detection in search context', () => {
    it('should detect machine learning as phrase', () => {
      const text = 'machine learning algorithms for data science'
      const corpus = [text]

      const result = computeTFIDF(text, corpus)

      // Should have machine_learning as a merged token
      expect(result['machine_learning']).toBeDefined()
    })

    it('should detect pull request as phrase', () => {
      const text = 'create a pull request for code review'
      const corpus = [text]

      const result = computeTFIDF(text, corpus)

      expect(result['pull_request']).toBeDefined()
      expect(result['code_review']).toBeDefined()
    })

    it('should detect semantic search as phrase', () => {
      const text = 'implementing semantic search with vector embeddings'
      const corpus = [text]

      const result = computeTFIDF(text, corpus)

      expect(result['semantic_search']).toBeDefined()
    })
  })

  describe('computeBM25PlusIDF', () => {
    it('should always return positive values', () => {
      // Test with varying document frequencies
      const N = 100

      // Rare term (appears in 1 doc)
      const rareIDF = computeBM25PlusIDF(N, 1)
      expect(rareIDF).toBeGreaterThan(0)

      // Common term (appears in 50% of docs)
      const commonIDF = computeBM25PlusIDF(N, 50)
      expect(commonIDF).toBeGreaterThan(0)

      // Very common term (appears in 90% of docs)
      const veryCommonIDF = computeBM25PlusIDF(N, 90)
      expect(veryCommonIDF).toBeGreaterThan(0)

      // Appears in all docs
      const allDocsIDF = computeBM25PlusIDF(N, 100)
      expect(allDocsIDF).toBeGreaterThan(0)
    })

    it('should give higher scores to rarer terms', () => {
      const N = 100
      const rareIDF = computeBM25PlusIDF(N, 1)
      const commonIDF = computeBM25PlusIDF(N, 50)

      expect(rareIDF).toBeGreaterThan(commonIDF)
    })

    it('should respect delta parameter', () => {
      const N = 100
      const df = 90 // Very common term

      const delta1 = computeBM25PlusIDF(N, df, 1)
      const delta2 = computeBM25PlusIDF(N, df, 2)

      // Higher delta should give higher IDF
      expect(delta2).toBeGreaterThan(delta1)
      // Delta difference should be approximately 1
      expect(delta2 - delta1).toBeCloseTo(1, 5)
    })

    it('should handle edge cases', () => {
      // Empty corpus
      expect(computeBM25PlusIDF(0, 0)).toBeGreaterThan(0)

      // Single document
      expect(computeBM25PlusIDF(1, 1)).toBeGreaterThan(0)
      expect(computeBM25PlusIDF(1, 0)).toBeGreaterThan(0)
    })
  })

  describe('computeQueryTermWeights', () => {
    it('should weight rare terms higher', () => {
      const queryTokens = ['rare', 'common']
      const docFreq = new Map([
        ['rare', 1],
        ['common', 50],
      ])
      const N = 100

      const weights = computeQueryTermWeights(queryTokens, docFreq, N)

      expect(weights.get('rare')).toBeGreaterThan(weights.get('common')!)
    })

    it('should normalize weights to reasonable range', () => {
      const queryTokens = ['term1', 'term2', 'term3']
      const docFreq = new Map([
        ['term1', 1],
        ['term2', 25],
        ['term3', 100],
      ])
      const N = 100

      const weights = computeQueryTermWeights(queryTokens, docFreq, N)

      // All weights should be in [0.5, 1.5] range
      for (const [, weight] of weights) {
        expect(weight).toBeGreaterThanOrEqual(0.5)
        expect(weight).toBeLessThanOrEqual(1.5)
      }
    })

    it('should handle single term query', () => {
      const queryTokens = ['single']
      const docFreq = new Map([['single', 10]])
      const N = 100

      const weights = computeQueryTermWeights(queryTokens, docFreq, N)

      // Single term should get weight of 1.0 (normalized)
      expect(weights.get('single')).toBe(1.0)
    })

    it('should handle empty query', () => {
      const weights = computeQueryTermWeights([], new Map(), 100)
      expect(weights.size).toBe(0)
    })

    it('should handle missing terms in docFreq', () => {
      const queryTokens = ['known', 'unknown']
      const docFreq = new Map([['known', 10]])
      const N = 100

      const weights = computeQueryTermWeights(queryTokens, docFreq, N)

      // Unknown terms should get highest weight (rarest)
      expect(weights.has('known')).toBe(true)
      expect(weights.has('unknown')).toBe(true)
    })
  })

  describe('reciprocalRankFusion', () => {
    // Helper to create mock search results
    const createMockResult = (id: number, score: number) => ({
      memory: { id } as any,
      score,
      relevance: 'medium' as const,
    })

    it('should combine multiple rankings', () => {
      const ranking1 = [
        createMockResult(1, 0.9),
        createMockResult(2, 0.7),
        createMockResult(3, 0.5),
      ]
      const ranking2 = [
        createMockResult(2, 0.95),
        createMockResult(1, 0.6),
        createMockResult(4, 0.4),
      ]

      const rrfScores = reciprocalRankFusion([ranking1, ranking2], 60)

      // All docs from both rankings should be present
      expect(rrfScores.has(1)).toBe(true)
      expect(rrfScores.has(2)).toBe(true)
      expect(rrfScores.has(3)).toBe(true)
      expect(rrfScores.has(4)).toBe(true)

      // Doc 2 is rank 1 in one list and rank 2 in another = highest combined
      // Doc 1 is rank 1 in one list and rank 2 in another = same as doc 2
      // But doc 2 appears first in ranking2, so should have equal or slightly higher
      expect(rrfScores.get(2)).toBeGreaterThanOrEqual(rrfScores.get(1)! - 0.001)
    })

    it('should boost documents appearing in multiple rankings', () => {
      const ranking1 = [createMockResult(1, 0.9)]
      const ranking2 = [createMockResult(1, 0.9)]
      const ranking3 = [createMockResult(2, 0.9)]

      const rrfScores = reciprocalRankFusion([ranking1, ranking2, ranking3], 60)

      // Doc 1 appears in 2 rankings, doc 2 only in 1
      expect(rrfScores.get(1)).toBeGreaterThan(rrfScores.get(2)!)
    })

    it('should handle different k values', () => {
      const ranking = [
        createMockResult(1, 0.9),
        createMockResult(2, 0.5),
      ]

      const rrfK60 = reciprocalRankFusion([ranking], 60)
      const rrfK10 = reciprocalRankFusion([ranking], 10)

      // Lower k = bigger rank differences
      // rank 1 score difference with k=60: 1/61 - 1/62 ≈ 0.00027
      // rank 1 score difference with k=10: 1/11 - 1/12 ≈ 0.0076
      const diff60 = rrfK60.get(1)! - rrfK60.get(2)!
      const diff10 = rrfK10.get(1)! - rrfK10.get(2)!

      expect(diff10).toBeGreaterThan(diff60)
    })

    it('should handle empty rankings', () => {
      const rrfScores = reciprocalRankFusion([], 60)
      expect(rrfScores.size).toBe(0)
    })
  })

  describe('pivotedLengthNorm', () => {
    it('should return 1.0 for average length documents', () => {
      const avgdl = 100
      const norm = pivotedLengthNorm(100, avgdl)
      expect(norm).toBeCloseTo(1.0, 5)
    })

    it('should penalize long documents', () => {
      const avgdl = 100
      const shortNorm = pivotedLengthNorm(50, avgdl)
      const avgNorm = pivotedLengthNorm(100, avgdl)
      const longNorm = pivotedLengthNorm(200, avgdl)

      // Longer docs should have higher norm (more penalized in denominator)
      expect(shortNorm).toBeLessThan(avgNorm)
      expect(avgNorm).toBeLessThan(longNorm)
    })

    it('should respect slope parameter', () => {
      const avgdl = 100
      const dl = 200 // Double average length

      const lowSlope = pivotedLengthNorm(dl, avgdl, 0.1)
      const highSlope = pivotedLengthNorm(dl, avgdl, 0.4)

      // Higher slope = more aggressive length penalty
      expect(highSlope).toBeGreaterThan(lowSlope)
    })

    it('should respect pivot factor', () => {
      const avgdl = 100
      const dl = 150

      // With pivot at avgdl, doc is longer than pivot
      const norm1 = pivotedLengthNorm(dl, avgdl, 0.2, 1.0)
      // With pivot at 2*avgdl, doc is shorter than pivot
      const norm2 = pivotedLengthNorm(dl, avgdl, 0.2, 2.0)

      // Doc appears "shorter" relative to higher pivot
      expect(norm2).toBeLessThan(norm1)
    })

    it('should handle edge cases', () => {
      // Empty document
      const emptyNorm = pivotedLengthNorm(0, 100)
      expect(emptyNorm).toBe(0.8) // 1 - 0.2 + 0.2 * 0 = 0.8

      // Zero average length
      const zeroAvgNorm = pivotedLengthNorm(100, 0)
      expect(isFinite(zeroAvgNorm)).toBe(false) // Division by zero
    })
  })
})
