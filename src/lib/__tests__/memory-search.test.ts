/**
 * Memory Search Tests
 *
 * @purpose Verify BM25 scoring, TF-IDF computation, and search functionality
 */

import { computeTFIDF, computeAdaptiveB } from '../memory-search.js'

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
})
