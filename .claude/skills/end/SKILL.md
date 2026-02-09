# /end - End Current Session

Ends the current JFL session gracefully.

## What It Does

1. Commits any uncommitted changes
2. Merges session to working branch
3. Cleans up session worktree
4. Pushes to remote
5. Returns to working branch

## When to Use

User says any of:
- "done"
- "that's it"
- "I'm finished"
- "end session"
- "/end"

Claude should invoke this skill to properly end the session.

## Usage

```
User: "done"
Claude: *invokes /end skill*
```

## Implementation

Calls: `./scripts/session/session-cleanup.sh`

This script handles all cleanup operations:
- Commits uncommitted work
- Merges session branch to working branch
- Removes session worktree
- Pushes changes to remote
- Switches back to working branch

## Notes

- Always invoked as a skill, not run directly by user
- Stop hook serves as automatic backup if not called
- Auto-commit runs throughout session as final safety net
