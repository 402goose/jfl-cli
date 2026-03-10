---
name: eval
description: JFL eval system — capture, score, and improve agent quality via RL
triggers:
  - eval
  - score
  - quality check
  - run eval
  - /eval
---

# /eval - Eval System

Captures agent turn quality, scores outputs, and feeds the RL flywheel.

## Usage

```
/eval                    # Show eval summary for this session
/eval score              # Score the last agent turn
/eval history            # Show eval history
/eval report             # Full eval report with trends
```

## How Eval Works

Eval entries are captured automatically by the `eval` Pi extension:

1. After each agent turn (`agent_end`), metrics are captured:
   - Turn count, model used, tools invoked
   - Files changed, duration
   - Exit reason (success/error/cancelled)

2. Entry written to `.jfl/eval.jsonl` via `eval-store.ts`

3. `eval:submitted` event emitted to MAP bus

4. Peter Parker subscribes to `eval:scored` events and triggers review loops

## Scoring

Evals can be scored by:
- The `eval` agent (automated quality scoring via Claude haiku)
- Manual scoring via `/eval score`
- Composite scoring (correctness + quality + efficiency)

## RL Integration

Scored evals feed the Stratus prediction loop:
- Stratus bridge captures prediction before turn, resolves after
- Training tuples written to `~/.jfl/training-buffer.jsonl`
- Policy head training improves future predictions

## Eval Entry Format

```json
{
  "id": "uuid",
  "session_id": "session-branch",
  "ts": "2026-01-25T10:30:00Z",
  "model": "claude-sonnet-4-6",
  "turn_count": 12,
  "tools_used": ["Read", "Edit", "Bash"],
  "files_changed": ["src/foo.ts"],
  "duration_ms": 45000,
  "exit_reason": "success"
}
```

## Reading Eval Data

```bash
cat .jfl/eval.jsonl | tail -20    # Recent evals
jfl eval report                   # Formatted report
```
