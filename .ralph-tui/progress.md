# Ralph Progress Log

This file tracks progress across iterations. It's automatically updated
after each iteration and included in agent prompts for context.

## Codebase Patterns (Study These First)

- **Search pipeline** lives in `src/lib/memory-search.ts`. Three methods: `tfidf`, `embedding`, `hybrid` (default). Main entry: `searchMemories()`. Results are `SearchResult[]` with `memory`, `score`, `relevance` fields.
- **Two-pass search**: First pass retrieves 2x candidates, second pass (BM25) re-ranks and trims to `maxItems`. Controlled via `rerank` option in `SearchOptions` (default `true`).
- **Tokenization**: Shared `tokenize()` fn — lowercase, alphanumeric, min length 3 chars.
- **Score normalization**: `normalizeScores()` maps to 0-1 range using min-max. Called after re-ranking to keep relevance thresholds consistent.

---

## 2026-03-10 - US-001
- Implemented BM25 (Okapi BM25) re-ranking as a second-pass scoring step in `src/lib/memory-search.ts`
- `reRankWithBM25()` function applies BM25 between query terms and document content (title + content + summary)
- Integrated into `searchMemories()`: first pass retrieves 2x candidates, BM25 re-ranks, then trims to maxItems
- Added `rerank?: boolean` option to `SearchOptions` (default `true`, opt-out with `false`)
- BM25 score is blended with first-pass score (40% original, 60% BM25) then normalized
- Standard BM25 params: k1=1.5 (term saturation), b=0.75 (length normalization)
- Files changed: `src/lib/memory-search.ts`
- **Learnings:**
  - The existing TF-IDF tokens stored on Memory objects (`tf_idf_tokens` JSON field) are precomputed during indexing, but BM25 re-ranking works on the raw text for accuracy since it needs corpus-level stats (avgdl, df) computed over the candidate set, not the full corpus
  - TypeScript compiles with `npx tsc --noEmit --pretty`
  - No existing tests for memory search module
---

