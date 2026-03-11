# Ralph Progress Log

This file tracks progress across iterations. It's automatically updated
after each iteration and included in agent prompts for context.

## Codebase Patterns (Study These First)

- **Search architecture**: `src/lib/memory-search.ts` uses a two-pass approach: first-pass scoring (BM25/TF-IDF/embedding/hybrid) → second-pass BM25 re-ranking. Hybrid combines lexical (0.4 weight) + semantic (0.6 weight).
- **Score normalization**: `normalizeScores()` maps to 0-1 range using min-max. Applied before merging different score types.
- **Type/recency boosts**: Applied as multipliers after base scoring — decisions 1.4x, features 1.2x, recent (<7d) 1.3x.

---

## 2026-03-10 - US-001
- Implemented BM25 first-pass scorer (`searchMemoriesBM25`) with tuned k1=1.2, b=0.65
- Replaced TF-IDF with BM25 as lexical component in hybrid search
- Tuned re-ranking defaults from k1=1.5/b=0.75 → k1=1.2/b=0.65
- Added `bm25` as standalone search method in `SearchOptions`
- Files changed: `src/lib/memory-search.ts`
- **Learnings:**
  - k1=1.2 suits short journal entries where TF doesn't vary much — saturates faster
  - b=0.65 avoids over-penalizing slightly longer entries in a collection with moderate length variance
  - The `daysBetween` helper is defined at the bottom of the file but referenced in BM25 scorer above — hoisting works due to function declarations but worth noting for readability
---

## ✓ Iteration 1 - US-001: Implement BM25 scoring with tuned k1 and b parameters to replace or augment the 
*2026-03-11T00:18:30.320Z (209s)*

**Status:** Completed

**Notes:**
nent (still 0.4 weight lexical / 0.6 weight semantic)\n3. **Re-ranking defaults tuned** from k1=1.5/b=0.75 → k1=1.2/b=0.65\n4. **`bm25` added as standalone search method** in `SearchOptions`\n\n**Parameter rationale:**\n- **k1=1.2**: More aggressive TF saturation for short journal entries (100-500 tokens) where 2-3 occurrences already signals high relevance\n- **b=0.65**: Moderate length normalization — journal entries have moderate length variance, so we avoid over-penalizing longer entries\n\n

---
