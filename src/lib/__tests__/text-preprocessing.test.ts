/**
 * Text Preprocessing Tests
 *
 * @purpose Verify stopword removal, phrase detection, and tokenization
 */

import {
  tokenize,
  tokenizeQuery,
  tokenizeDocument,
  basicTokenize,
  detectPhrases,
  removeStopwords,
  extractTerms,
  countTermFrequencies,
  isStopword,
  STOPWORDS,
  PROTECTED_TERMS,
} from '../text-preprocessing.js'

describe('text-preprocessing', () => {
  describe('basicTokenize', () => {
    it('should lowercase and split text', () => {
      const result = basicTokenize('Hello World Test')
      expect(result).toContain('hello')
      expect(result).toContain('world')
      expect(result).toContain('test')
    })

    it('should remove punctuation', () => {
      const result = basicTokenize('Hello, World! How are you?')
      expect(result.some(t => t.includes(','))).toBe(false)
      expect(result.some(t => t.includes('!'))).toBe(false)
      expect(result.some(t => t.includes('?'))).toBe(false)
    })

    it('should filter tokens by minimum length', () => {
      const result = basicTokenize('a an the cat', { minLength: 3 })
      expect(result).not.toContain('a')
      expect(result).not.toContain('an')
      expect(result).toContain('the')
      expect(result).toContain('cat')
    })

    it('should preserve numbers when option is set', () => {
      const result = basicTokenize('version 2 build 123', { preserveNumbers: true })
      expect(result).toContain('version')
      expect(result).toContain('123')
    })

    it('should preserve underscores for snake_case', () => {
      const result = basicTokenize('user_profile get_data')
      expect(result).toContain('user_profile')
      expect(result).toContain('get_data')
    })
  })

  describe('removeStopwords', () => {
    it('should remove common stopwords', () => {
      const tokens = ['the', 'quick', 'brown', 'fox', 'is', 'a', 'mammal']
      const result = removeStopwords(tokens)
      expect(result).not.toContain('the')
      expect(result).not.toContain('is')
      expect(result).not.toContain('a')
      expect(result).toContain('quick')
      expect(result).toContain('brown')
      expect(result).toContain('fox')
      expect(result).toContain('mammal')
    })

    it('should preserve protected terms', () => {
      const tokens = ['null', 'void', 'true', 'false', 'not', 'and', 'or']
      const result = removeStopwords(tokens)
      // These are programming terms that should be preserved
      expect(result).toContain('null')
      expect(result).toContain('void')
      expect(result).toContain('true')
      expect(result).toContain('false')
      expect(result).toContain('not')
    })

    it('should preserve technical terms', () => {
      const tokens = ['api', 'cli', 'sql', 'new', 'class', 'function']
      const result = removeStopwords(tokens)
      expect(result).toContain('api')
      expect(result).toContain('cli')
      expect(result).toContain('new')
      expect(result).toContain('class')
      expect(result).toContain('function')
    })
  })

  describe('detectPhrases', () => {
    it('should detect and merge known phrases', () => {
      const tokens = ['machine', 'learning', 'model']
      const result = detectPhrases(tokens)
      expect(result).toContain('machine_learning')
      expect(result).toContain('model')
      expect(result).not.toContain('machine')
      expect(result).not.toContain('learning')
    })

    it('should detect multiple phrases in sequence', () => {
      const tokens = ['deep', 'learning', 'natural', 'language', 'model']
      const result = detectPhrases(tokens)
      expect(result).toContain('deep_learning')
      expect(result).toContain('natural_language')
      expect(result).toContain('model')
    })

    it('should handle pull request phrase', () => {
      const tokens = ['create', 'pull', 'request']
      const result = detectPhrases(tokens)
      expect(result).toContain('pull_request')
      expect(result).toContain('create')
    })

    it('should handle smoke test phrase', () => {
      const tokens = ['run', 'smoke', 'test']
      const result = detectPhrases(tokens)
      expect(result).toContain('smoke_test')
      expect(result).toContain('run')
    })

    it('should return unchanged tokens when no phrases found', () => {
      const tokens = ['hello', 'world', 'test']
      const result = detectPhrases(tokens)
      expect(result).toEqual(['hello', 'world', 'test'])
    })

    it('should handle single token', () => {
      const tokens = ['hello']
      const result = detectPhrases(tokens)
      expect(result).toEqual(['hello'])
    })

    it('should handle empty array', () => {
      const result = detectPhrases([])
      expect(result).toEqual([])
    })
  })

  describe('tokenize (full pipeline)', () => {
    it('should apply all preprocessing steps', () => {
      const text = 'The machine learning model is a neural network'
      const result = tokenize(text)

      // Should have removed stopwords
      expect(result).not.toContain('the')
      expect(result).not.toContain('is')
      expect(result).not.toContain('a')

      // Should have detected phrases
      expect(result).toContain('machine_learning')
      expect(result).toContain('neural_network')
      expect(result).toContain('model')
    })

    it('should handle code-related content', () => {
      const text = 'Add new API endpoint for user interface'
      const result = tokenize(text)

      // Should preserve technical terms
      expect(result).toContain('add')
      expect(result).toContain('new')
      expect(result).toContain('api')
      expect(result).toContain('user_interface')
    })

    it('should handle query about precision recall', () => {
      const text = 'what is the precision recall tradeoff?'
      const result = tokenize(text)

      // Should detect phrase
      expect(result).toContain('precision_recall')
      expect(result).toContain('tradeoff')
    })

    it('should work with legacy mode', () => {
      const text = 'The machine learning model'
      const result = tokenize(text, { removeStopwords: false, detectPhrases: false })

      // Should keep stopwords
      expect(result).toContain('the')
      // Should not merge phrases
      expect(result).toContain('machine')
      expect(result).toContain('learning')
    })
  })

  describe('tokenizeQuery', () => {
    it('should tokenize search queries', () => {
      const result = tokenizeQuery('what is machine learning?')
      expect(result).toContain('machine_learning')
      expect(result).not.toContain('what')
      expect(result).not.toContain('is')
    })
  })

  describe('tokenizeDocument', () => {
    it('should tokenize documents for indexing', () => {
      const result = tokenizeDocument('This document is about deep learning models')
      expect(result).toContain('deep_learning')
      expect(result).toContain('document')
      expect(result).toContain('models')
      expect(result).not.toContain('this')
      expect(result).not.toContain('is')
      expect(result).not.toContain('about')
    })
  })

  describe('extractTerms', () => {
    it('should return unique terms', () => {
      const text = 'machine learning machine learning model'
      const result = extractTerms(text)
      // Should be deduped
      expect(result.filter(t => t === 'machine_learning').length).toBe(1)
      expect(result.filter(t => t === 'model').length).toBe(1)
    })
  })

  describe('countTermFrequencies', () => {
    it('should count term occurrences', () => {
      const text = 'test test test model model'
      const result = countTermFrequencies(text)
      expect(result.get('test')).toBe(3)
      expect(result.get('model')).toBe(2)
    })
  })

  describe('isStopword', () => {
    it('should identify stopwords', () => {
      expect(isStopword('the')).toBe(true)
      expect(isStopword('is')).toBe(true)
      expect(isStopword('a')).toBe(true)
      expect(isStopword('model')).toBe(false)
      expect(isStopword('learning')).toBe(false)
    })

    it('should not flag protected terms as stopwords', () => {
      expect(isStopword('null')).toBe(false)
      expect(isStopword('void')).toBe(false)
      expect(isStopword('new')).toBe(false)
      expect(isStopword('api')).toBe(false)
    })
  })

  describe('STOPWORDS constant', () => {
    it('should contain common English stopwords', () => {
      expect(STOPWORDS.has('the')).toBe(true)
      expect(STOPWORDS.has('a')).toBe(true)
      expect(STOPWORDS.has('an')).toBe(true)
      expect(STOPWORDS.has('is')).toBe(true)
      expect(STOPWORDS.has('are')).toBe(true)
      expect(STOPWORDS.has('was')).toBe(true)
      expect(STOPWORDS.has('were')).toBe(true)
    })
  })

  describe('PROTECTED_TERMS constant', () => {
    it('should contain programming keywords', () => {
      expect(PROTECTED_TERMS.has('null')).toBe(true)
      expect(PROTECTED_TERMS.has('void')).toBe(true)
      expect(PROTECTED_TERMS.has('function')).toBe(true)
      expect(PROTECTED_TERMS.has('class')).toBe(true)
      expect(PROTECTED_TERMS.has('api')).toBe(true)
    })
  })
})
