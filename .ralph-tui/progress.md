# Ralph Progress Log

This file tracks progress across iterations. It's automatically updated
after each iteration and included in agent prompts for context.

## Codebase Patterns (Study These First)

- **Test pattern**: Mock `fs` module at top of test file with `jest.mock('fs', () => ({...}))`. Mock telemetry with `jest.mock('../telemetry.js', () => ({ telemetry: { track: jest.fn() } }))`. Use factory functions (`makeEntry`, `makeState`, etc.) for test data.
- **JSONL pattern**: All persistent stores (eval, training-buffer, predictions) use JSONL format — one JSON object per line, read with `split('\n')` + `JSON.parse`, write with `appendFileSync`.
- **Project root detection**: Multiple modules have their own `findProjectRoot()` that walks up looking for `.jfl/config.json` or `.jfl/`. Not DRY but each module is self-contained.
- **Eval improvement at 1.0**: When test_pass_rate is already 1.0000, "improvement" means adding more passing tests (tests_passed increases while rate stays at 1.0).

---

## 2026-03-10 - US-001
- Added 90 new tests across 5 previously untested core modules
- Files created:
  - `src/lib/__tests__/eval-store.test.ts` (17 tests)
  - `src/lib/__tests__/training-buffer.test.ts` (20 tests)
  - `src/lib/__tests__/policy-head.test.ts` (14 tests)
  - `src/lib/__tests__/hook-transformer.test.ts` (18 tests)
  - `src/utils/__tests__/jfl-paths.test.ts` (21 tests)
- **Learnings:**
  - test_pass_rate at 1.0 means improvement = more tests, not higher rate
  - eval-store, training-buffer, policy-head, hook-transformer, jfl-paths all had zero test coverage
  - Policy head forward pass needs embedding API (Stratus), so only error paths and formatting are unit-testable without mocking fetch
  - Hook transformer depends on telemetry module which must be mocked
---

## ✓ Iteration 1 - US-001: Improve test_pass_rate score (currently 1.0000)
*2026-03-10T20:43:33.990Z (373s)*

**Status:** Completed

**Notes:**
covered |\n|--------|-------|----------------|\n| `eval-store` | 17 | read/write JSONL, trajectory queries, latest eval, agent listing |\n| `training-buffer` | 20 | hash determinism, append/read, stats aggregation, export formatting |\n| `policy-head` | 14 | weight loading, stats, state/action text formatting, error paths |\n| `hook-transformer` | 18 | event mapping, input sanitization, telemetry tracking |\n| `jfl-paths` | 21 | XDG path compliance, migration detection, directory creation |\n\n

---
