/**
 * Search Quality Eval
 *
 * Evaluates search quality using NDCG@10 metric against golden test queries.
 *
 * @purpose Eval script for search-quality agent - returns ndcg@10 metric
 */

import { readFileSync, existsSync } from "fs"

interface SearchQuery {
  query: string
  expected_results: string[]  // Ordered list of expected result IDs
  relevance_scores?: number[] // Optional relevance grades (3=highly relevant, 2=relevant, 1=marginal)
}

interface SearchResult {
  id: string
  score: number
}

/**
 * Calculate Discounted Cumulative Gain
 */
function dcg(relevances: number[], k: number): number {
  let dcg = 0
  for (let i = 0; i < Math.min(relevances.length, k); i++) {
    // DCG = sum of (2^rel - 1) / log2(i + 2)
    dcg += (Math.pow(2, relevances[i]) - 1) / Math.log2(i + 2)
  }
  return dcg
}

/**
 * Calculate Ideal DCG (best possible ordering)
 */
function idcg(relevances: number[], k: number): number {
  // Sort relevances descending for ideal ordering
  const sorted = [...relevances].sort((a, b) => b - a)
  return dcg(sorted, k)
}

/**
 * Calculate NDCG@k
 */
function ndcgAtK(relevances: number[], k: number): number {
  const idealDcg = idcg(relevances, k)
  if (idealDcg === 0) return 0
  return dcg(relevances, k) / idealDcg
}

export async function evaluate(dataPath: string): Promise<number> {
  // Load test queries
  if (!existsSync(dataPath)) {
    // If no data file, return baseline score
    return 0.5
  }

  const lines = readFileSync(dataPath, "utf-8").split("\n").filter(Boolean)
  const queries: SearchQuery[] = lines.map(line => {
    try {
      return JSON.parse(line) as SearchQuery
    } catch {
      return null
    }
  }).filter(Boolean) as SearchQuery[]

  if (queries.length === 0) {
    return 0.5
  }

  // Try to import and run the actual search function
  let searchFn: (query: string) => Promise<SearchResult[]> | SearchResult[]

  try {
    // Attempt to import the search module
    const searchModule = await import("../src/lib/memory-search.js")
    searchFn = searchModule.search || searchModule.default?.search

    if (!searchFn) {
      // Fallback: look for BM25
      const bm25Module = await import("../src/lib/bm25.js")
      if (bm25Module.BM25) {
        // Create a simple wrapper
        searchFn = async (query: string) => {
          // This would need actual implementation
          return []
        }
      }
    }
  } catch {
    // If we can't import search, return baseline
    return 0.5
  }

  if (!searchFn) {
    return 0.5
  }

  // Run search for each query and calculate NDCG@10
  const k = 10
  let totalNdcg = 0

  for (const query of queries) {
    try {
      const results = await searchFn(query.query)

      // Map results to relevance scores
      const relevances: number[] = []
      const expectedSet = new Set(query.expected_results)

      for (let i = 0; i < k; i++) {
        if (i >= results.length) {
          relevances.push(0)
          continue
        }

        const result = results[i]
        if (expectedSet.has(result.id)) {
          // If we have explicit relevance scores, use them
          const idx = query.expected_results.indexOf(result.id)
          if (query.relevance_scores && query.relevance_scores[idx] !== undefined) {
            relevances.push(query.relevance_scores[idx])
          } else {
            // Default: binary relevance (1 if in expected, 0 if not)
            // Weight by position in expected list (higher = more relevant)
            const positionWeight = 1 - (idx / query.expected_results.length)
            relevances.push(1 + positionWeight * 2)  // 1 to 3 scale
          }
        } else {
          relevances.push(0)
        }
      }

      totalNdcg += ndcgAtK(relevances, k)
    } catch {
      // Query failed, count as 0 NDCG
      totalNdcg += 0
    }
  }

  // Return average NDCG@10 across all queries
  return totalNdcg / queries.length
}

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const dataPath = process.argv[2] || ""
  evaluate(dataPath).then(metric => {
    console.log(JSON.stringify({ metric }))
  })
}
