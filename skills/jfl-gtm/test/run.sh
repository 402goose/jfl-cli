#!/bin/bash
# Tests for jfl-gtm skill bin/ scripts
# Usage: ./skills/jfl-gtm/test/run.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/../bin"
TMPDIR_BASE=$(mktemp -d)
PASS=0
FAIL=0

cleanup() {
  rm -rf "$TMPDIR_BASE"
}
trap cleanup EXIT

pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1: $2"; }

# --- config ---

echo ""
echo "▸ bin/config"

# config: creates config file if missing
test_dir="$TMPDIR_BASE/config-create"
mkdir -p "$test_dir"
HOME="$test_dir" "$BIN_DIR/config" list >/dev/null 2>&1 || true
if [[ -f "$test_dir/.openclaw/openclaw.json" ]]; then
  pass "creates config file if missing"
else
  fail "creates config file if missing" "file not created"
fi

# config: create a valid workspace for add/remove tests
fake_ws="$TMPDIR_BASE/fake-ws"
mkdir -p "$fake_ws/.jfl"
touch "$fake_ws/CLAUDE.md"

# config: add workspace
HOME="$test_dir" "$BIN_DIR/config" add "$fake_ws" >/dev/null 2>&1
result=$(jq -r '.skills.entries["jfl-gtm"].config.workspace_paths[0]' "$test_dir/.openclaw/openclaw.json" 2>/dev/null)
if [[ "$result" == "$fake_ws" ]]; then
  pass "add workspace to config"
else
  fail "add workspace to config" "got: $result"
fi

# config: list shows workspaces
output=$(HOME="$test_dir" "$BIN_DIR/config" list 2>&1)
if echo "$output" | grep -q "fake-ws"; then
  pass "list shows added workspace"
else
  fail "list shows added workspace" "not found in output"
fi

# config: remove workspace
HOME="$test_dir" "$BIN_DIR/config" remove "$fake_ws" >/dev/null 2>&1
count=$(jq '.skills.entries["jfl-gtm"].config.workspace_paths | length' "$test_dir/.openclaw/openclaw.json" 2>/dev/null)
if [[ "$count" == "0" ]]; then
  pass "remove workspace from config"
else
  fail "remove workspace from config" "count: $count"
fi

# config: set-default (also needs a valid workspace)
HOME="$test_dir" "$BIN_DIR/config" default "$fake_ws" >/dev/null 2>&1
default=$(jq -r '.skills.entries["jfl-gtm"].config.default_workspace' "$test_dir/.openclaw/openclaw.json" 2>/dev/null)
if [[ "$default" == "$fake_ws" ]]; then
  pass "set-default workspace"
else
  fail "set-default workspace" "got: $default"
fi

# config: usage on no args
output=$("$BIN_DIR/config" 2>&1 || true)
if echo "$output" | grep -qi "usage\|config"; then
  pass "shows usage on no args"
else
  fail "shows usage on no args" "no usage text"
fi

# --- journal ---

echo ""
echo "▸ bin/journal"

# journal: setup workspace
ws="$TMPDIR_BASE/journal-ws"
mkdir -p "$ws/.jfl/journal"
(cd "$ws" && git init -q && git commit --allow-empty -m "init" -q)

# journal: write entry
WORKSPACE="$ws" "$BIN_DIR/journal" write feature "Test feature" "Summary here" "Detail text" '["file.ts"]' complete >/dev/null 2>&1
branch=$(git -C "$ws" branch --show-current)
journal_file="$ws/.jfl/journal/${branch}.jsonl"
if [[ -f "$journal_file" ]] && [[ -s "$journal_file" ]]; then
  pass "write creates journal entry"
else
  fail "write creates journal entry" "file missing or empty"
fi

# journal: entry has correct type
entry_type=$(head -1 "$journal_file" | jq -r '.type')
if [[ "$entry_type" == "feature" ]]; then
  pass "entry has correct type"
else
  fail "entry has correct type" "got: $entry_type"
fi

# journal: entry has correct title
entry_title=$(head -1 "$journal_file" | jq -r '.title')
if [[ "$entry_title" == "Test feature" ]]; then
  pass "entry has correct title"
else
  fail "entry has correct title" "got: $entry_title"
fi

# journal: entry has files array
entry_files=$(head -1 "$journal_file" | jq -r '.files[0]')
if [[ "$entry_files" == "file.ts" ]]; then
  pass "entry has files array"
else
  fail "entry has files array" "got: $entry_files"
fi

# journal: quick feature shortcut
WORKSPACE="$ws" "$BIN_DIR/journal" feature "Quick feat" "Quick summary" >/dev/null 2>&1
count=$(wc -l < "$journal_file" | tr -d ' ')
if [[ "$count" -ge 2 ]]; then
  pass "feature shortcut appends entry"
else
  fail "feature shortcut appends entry" "count: $count"
fi

# journal: quick decision shortcut
WORKSPACE="$ws" "$BIN_DIR/journal" decision "Use Postgres" "Over SQLite" >/dev/null 2>&1
last_type=$(tail -1 "$journal_file" | jq -r '.type')
if [[ "$last_type" == "decision" ]]; then
  pass "decision shortcut writes correct type"
else
  fail "decision shortcut writes correct type" "got: $last_type"
fi

# journal: verify passes when entries exist
output=$(WORKSPACE="$ws" "$BIN_DIR/journal" verify 2>&1)
if echo "$output" | grep -q "✅"; then
  pass "verify passes with entries"
else
  fail "verify passes with entries" "no checkmark"
fi

# journal: verify fails on empty workspace
empty_ws="$TMPDIR_BASE/empty-ws"
mkdir -p "$empty_ws/.jfl/journal"
(cd "$empty_ws" && git init -q && git commit --allow-empty -m "init" -q)
if WORKSPACE="$empty_ws" "$BIN_DIR/journal" verify 2>&1; then
  fail "verify fails on empty journal" "should have exited non-zero"
else
  pass "verify fails on empty journal"
fi

# journal: list shows entries
output=$(WORKSPACE="$ws" "$BIN_DIR/journal" list 2>&1)
if echo "$output" | grep -q "Test feature"; then
  pass "list shows entries"
else
  fail "list shows entries" "entry not found"
fi

# journal: file shows path
output=$(WORKSPACE="$ws" "$BIN_DIR/journal" file 2>&1)
if echo "$output" | grep -q ".jfl/journal/"; then
  pass "file prints journal path"
else
  fail "file prints journal path" "got: $output"
fi

# journal: invalid files JSON falls back to []
WORKSPACE="$ws" "$BIN_DIR/journal" write fix "Bad files" "Test" "" "not-json" >/dev/null 2>&1
last_files=$(tail -1 "$journal_file" | jq -r '.files')
if [[ "$last_files" == "[]" ]]; then
  pass "invalid files JSON falls back to []"
else
  fail "invalid files JSON falls back to []" "got: $last_files"
fi

# journal: rejects missing required args
if WORKSPACE="$ws" "$BIN_DIR/journal" write 2>&1 | grep -q "Usage"; then
  pass "write shows usage on missing args"
else
  fail "write shows usage on missing args" "no usage text"
fi

# journal: not in workspace
if WORKSPACE="/tmp" "$BIN_DIR/journal" list 2>&1 | grep -q "❌"; then
  pass "rejects non-workspace directory"
else
  fail "rejects non-workspace directory" "no error"
fi

# --- discover ---

echo ""
echo "▸ bin/discover"

# discover: usage on bad format
output=$("$BIN_DIR/discover" badformat 2>&1 || true)
if echo "$output" | grep -qi "usage"; then
  pass "shows usage on bad format arg"
else
  fail "shows usage on bad format arg" "no usage text"
fi

# discover: finds workspace in search path
disc_base="$TMPDIR_BASE/disc-home"
disc_ws="$disc_base/code/my-project"
mkdir -p "$disc_ws/.jfl" "$disc_ws/knowledge"
echo '{"name":"test-proj"}' > "$disc_ws/.jfl/config.json"
touch "$disc_ws/CLAUDE.md"
(cd "$disc_ws" && git init -q && git commit --allow-empty -m "init" -q)

output=$(HOME="$disc_base" "$BIN_DIR/discover" simple 2>&1 || true)
if echo "$output" | grep -q "my-project"; then
  pass "finds workspace in ~/code"
else
  fail "finds workspace in ~/code" "not found in: $output"
fi

# discover: detailed format includes name
output=$(HOME="$disc_base" "$BIN_DIR/discover" detailed 2>&1 || true)
if echo "$output" | grep -q "test-proj"; then
  pass "detailed format shows project name"
else
  fail "detailed format shows project name" "not in output"
fi

# --- session ---

echo ""
echo "▸ bin/session"

# session: usage on bad command
output=$("$BIN_DIR/session" badcmd 2>&1 || true)
if echo "$output" | grep -qi "usage\|session"; then
  pass "shows usage on bad command"
else
  fail "shows usage on bad command" "no usage text"
fi

# session: verify rejects non-workspace
output=$("$BIN_DIR/session" start /tmp/nonexistent 2>&1 || true)
if echo "$output" | grep -q "❌"; then
  pass "rejects nonexistent workspace"
else
  fail "rejects nonexistent workspace" "no error"
fi

# session: verify rejects directory without .jfl
plain_dir="$TMPDIR_BASE/plain-dir"
mkdir -p "$plain_dir"
output=$("$BIN_DIR/session" start "$plain_dir" 2>&1 || true)
if echo "$output" | grep -q "❌"; then
  pass "rejects directory without .jfl"
else
  fail "rejects directory without .jfl" "no error"
fi

# session: verify rejects directory without CLAUDE.md
no_claude="$TMPDIR_BASE/no-claude"
mkdir -p "$no_claude/.jfl"
output=$("$BIN_DIR/session" start "$no_claude" 2>&1 || true)
if echo "$output" | grep -q "❌"; then
  pass "rejects directory without CLAUDE.md"
else
  fail "rejects directory without CLAUDE.md" "no error"
fi

# --- summary ---

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL=$((PASS + FAIL))
echo "  $PASS/$TOTAL passed"
if [[ $FAIL -gt 0 ]]; then
  echo "  $FAIL failed"
  exit 1
else
  echo "  All tests passed ✅"
  exit 0
fi
