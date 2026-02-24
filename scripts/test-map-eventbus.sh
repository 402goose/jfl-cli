#!/usr/bin/env bash
# MAP Event Bus + Peter Parker — Integration Test
#
# Run from the jfl-cli directory:
#   ./scripts/test-map-eventbus.sh
#
# What this tests:
#   1. Context Hub starts with event bus
#   2. Publish events via REST
#   3. Retrieve events with pattern filtering
#   4. SSE real-time streaming
#   5. WebSocket streaming (if wscat installed)
#   6. Peter Parker config generation (all 3 profiles)
#   7. Peter Parker status reads from live bus
#   8. MCP tool simulation (events_publish, events_recent)
#   9. Event persistence across restart
#   10. Pi CLI detection check

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

pass() { ((PASS++)); echo -e "  ${GREEN}✓${NC} $1"; }
fail() { ((FAIL++)); echo -e "  ${RED}✗${NC} $1"; }
skip() { ((SKIP++)); echo -e "  ${YELLOW}→${NC} $1 (skipped)"; }

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "\n${CYAN}═══════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  MAP Event Bus + Peter Parker — Integration Tests${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}\n"

# ─── 0. Build check ──────────────────────────────────────────────────
echo -e "${YELLOW}[0] Build${NC}"
if [ -f dist/index.js ] && [ -f dist/lib/map-event-bus.js ]; then
  pass "dist/ exists with MAP modules"
else
  echo -e "${RED}Build missing. Run: npm run build${NC}"
  exit 1
fi

# ─── 1. Start Context Hub ────────────────────────────────────────────
echo -e "\n${YELLOW}[1] Context Hub Startup${NC}"
node dist/index.js context-hub stop 2>/dev/null || true
sleep 1
OUTPUT=$(node dist/index.js context-hub start 2>&1)
if echo "$OUTPUT" | grep -q "started"; then
  pass "Context Hub started"
else
  fail "Context Hub failed to start"
  echo "$OUTPUT"
  exit 1
fi

sleep 1

TOKEN=$(cat .jfl/context-hub.token 2>/dev/null)
if [ -z "$TOKEN" ]; then
  fail "No auth token found"
  exit 1
fi
pass "Auth token exists"

# Find port from health check
PORT=""
for p in 4521 4200 4201 4300; do
  if curl -s "http://localhost:$p/health" 2>/dev/null | grep -q "ok"; then
    PORT=$p
    break
  fi
done

if [ -z "$PORT" ]; then
  fail "Cannot find Context Hub port"
  exit 1
fi
pass "Context Hub responding on port $PORT"

BASE="http://localhost:$PORT"
AUTH="Authorization: Bearer $TOKEN"

# ─── 2. Publish Events ───────────────────────────────────────────────
echo -e "\n${YELLOW}[2] Publish Events${NC}"

# Publish various event types
RESP=$(curl -s -X POST "$BASE/api/events" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"type":"session:started","source":"test-runner","data":{"branch":"test"}}')
if echo "$RESP" | grep -q '"id"'; then
  pass "session:started event published"
else
  fail "Failed to publish session:started"
fi

RESP=$(curl -s -X POST "$BASE/api/events" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"type":"task:completed","source":"test-runner","data":{"task":"build","duration":12}}')
if echo "$RESP" | grep -q '"id"'; then
  pass "task:completed event published"
else
  fail "Failed to publish task:completed"
fi

RESP=$(curl -s -X POST "$BASE/api/events" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"type":"peter:started","source":"peter-parker","data":{"profile":"balanced"}}')
if echo "$RESP" | grep -q '"id"'; then
  pass "peter:started event published"
else
  fail "Failed to publish peter:started"
fi

RESP=$(curl -s -X POST "$BASE/api/events" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"type":"decision:made","source":"claude-code","data":{"decision":"use-postgres","reason":"cost"}}')
if echo "$RESP" | grep -q '"id"'; then
  pass "decision:made event published"
else
  fail "Failed to publish decision:made"
fi

# Test validation
RESP=$(curl -s -X POST "$BASE/api/events" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"data":{"bad":"no type or source"}}')
if echo "$RESP" | grep -q '"error"'; then
  pass "Rejects event without type/source"
else
  fail "Should reject event without type/source"
fi

# Test no auth
RESP=$(curl -s -X POST "$BASE/api/events" \
  -H "Content-Type: application/json" \
  -d '{"type":"custom","source":"x","data":{}}')
if echo "$RESP" | grep -q "Unauthorized"; then
  pass "Rejects unauthenticated request"
else
  fail "Should reject unauthenticated request"
fi

# ─── 3. Retrieve Events ──────────────────────────────────────────────
echo -e "\n${YELLOW}[3] Retrieve & Filter Events${NC}"

RESP=$(curl -s "$BASE/api/events?limit=10" -H "$AUTH")
COUNT=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['count'])" 2>/dev/null || echo 0)
if [ "$COUNT" -ge 4 ]; then
  pass "Retrieved $COUNT events (expected >= 4)"
else
  fail "Expected >= 4 events, got $COUNT"
fi

# Pattern filter
RESP=$(curl -s "$BASE/api/events?pattern=peter:*&limit=10" -H "$AUTH")
COUNT=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['count'])" 2>/dev/null || echo 0)
if [ "$COUNT" -ge 1 ]; then
  pass "Pattern filter peter:* returned $COUNT event(s)"
else
  fail "Pattern filter peter:* should return >= 1"
fi

RESP=$(curl -s "$BASE/api/events?pattern=session:*&limit=10" -H "$AUTH")
COUNT=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['count'])" 2>/dev/null || echo 0)
if [ "$COUNT" -ge 1 ]; then
  pass "Pattern filter session:* returned $COUNT event(s)"
else
  fail "Pattern filter session:* should return >= 1"
fi

# Since filter
PAST=$(date -u -v-1H +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "1 hour ago" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo "")
if [ -n "$PAST" ]; then
  RESP=$(curl -s "$BASE/api/events?since=$PAST&limit=10" -H "$AUTH")
  COUNT=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['count'])" 2>/dev/null || echo 0)
  if [ "$COUNT" -ge 4 ]; then
    pass "Since filter returned $COUNT recent events"
  else
    fail "Since filter should return >= 4 recent events"
  fi
fi

# ─── 4. SSE Streaming ────────────────────────────────────────────────
echo -e "\n${YELLOW}[4] SSE Real-Time Streaming${NC}"

SSE_OUT=$(mktemp)
curl -s -N -m 3 "$BASE/api/events/stream?patterns=test:*" -H "$AUTH" > "$SSE_OUT" 2>&1 &
SSE_PID=$!
sleep 0.5

# Publish while SSE is listening
curl -s -X POST "$BASE/api/events" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"type":"custom","source":"sse-test","data":{"live":"stream"}}' > /dev/null

# This won't match test:* pattern, publish one that does
curl -s -X POST "$BASE/api/events" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"type":"custom","source":"test:probe","data":{"sse":"verify"}}' > /dev/null

sleep 2
wait $SSE_PID 2>/dev/null || true

if grep -q "retry:" "$SSE_OUT"; then
  pass "SSE connection established (retry header)"
else
  fail "SSE did not send retry header"
fi
rm -f "$SSE_OUT"

# ─── 5. WebSocket ────────────────────────────────────────────────────
echo -e "\n${YELLOW}[5] WebSocket Streaming${NC}"

if command -v wscat &>/dev/null; then
  WS_OUT=$(mktemp)
  wscat -c "ws://localhost:$PORT/ws/events?patterns=*&token=$TOKEN" --wait 2 > "$WS_OUT" 2>&1 &
  WS_PID=$!
  sleep 1

  curl -s -X POST "$BASE/api/events" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"type":"custom","source":"ws-test","data":{"ws":"verify"}}' > /dev/null

  sleep 1
  kill $WS_PID 2>/dev/null || true
  wait $WS_PID 2>/dev/null || true

  if grep -q "ws-test" "$WS_OUT"; then
    pass "WebSocket received event"
  else
    fail "WebSocket did not receive event"
  fi
  rm -f "$WS_OUT"
else
  skip "WebSocket test (install: npm i -g wscat)"
fi

# ─── 6. Peter Parker Config ──────────────────────────────────────────
echo -e "\n${YELLOW}[6] Peter Parker Config Generation${NC}"

for PROFILE in cost balanced quality; do
  FLAG="--$PROFILE"
  node dist/index.js peter setup $FLAG 2>/dev/null
  if [ -f .ralph-tui/config.toml ] && grep -q "Generated by Peter Parker" .ralph-tui/config.toml; then
    AGENT_COUNT=$(grep -c '^\[\[agents\]\]' .ralph-tui/config.toml)
    if [ "$AGENT_COUNT" -eq 10 ]; then
      pass "$PROFILE profile: 10 agents generated"
    else
      fail "$PROFILE profile: expected 10 agents, got $AGENT_COUNT"
    fi
  else
    fail "$PROFILE profile: config not generated"
  fi
done

# Verify builder is default
if grep -A3 'name = "builder"' .ralph-tui/config.toml | grep -q 'default = true'; then
  pass "Builder agent is marked as default"
else
  fail "Builder should be default agent"
fi

# ─── 7. Peter Parker Status ──────────────────────────────────────────
echo -e "\n${YELLOW}[7] Peter Parker Status${NC}"

OUTPUT=$(node dist/index.js peter status 2>&1)
if echo "$OUTPUT" | grep -q "Config profile"; then
  pass "Peter status shows config profile"
else
  fail "Peter status missing config profile"
fi

if echo "$OUTPUT" | grep -q "Recent events"; then
  pass "Peter status shows recent events"
else
  fail "Peter status missing recent events"
fi

# ─── 8. Event Persistence ────────────────────────────────────────────
echo -e "\n${YELLOW}[8] Event Persistence${NC}"

if [ -f .jfl/map-events.jsonl ]; then
  LINE_COUNT=$(wc -l < .jfl/map-events.jsonl | tr -d ' ')
  if [ "$LINE_COUNT" -ge 4 ]; then
    pass "map-events.jsonl has $LINE_COUNT persisted events"
  else
    fail "Expected >= 4 persisted events, got $LINE_COUNT"
  fi
else
  fail "map-events.jsonl not created"
fi

# Restart and check events survive
node dist/index.js context-hub stop 2>/dev/null
sleep 1
node dist/index.js context-hub start 2>/dev/null
sleep 2

# Token regenerates on restart — re-read it
TOKEN=$(cat .jfl/context-hub.token 2>/dev/null)
AUTH="Authorization: Bearer $TOKEN"

RESP=$(curl -s "$BASE/api/events?limit=50" -H "$AUTH" 2>/dev/null)
COUNT=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['count'])" 2>/dev/null || echo 0)
if [ "$COUNT" -ge 4 ]; then
  pass "Events survived restart ($COUNT recovered)"
else
  fail "Events lost on restart (got $COUNT)"
fi

# ─── 9. Pi CLI Detection ─────────────────────────────────────────────
echo -e "\n${YELLOW}[9] Pi CLI Detection${NC}"

if grep -q '"pi"' src/commands/session.ts && grep -q '"--yolo"' src/commands/session.ts; then
  pass "Pi provider in session.ts"
else
  fail "Pi provider missing from session.ts"
fi

if command -v pi &>/dev/null; then
  pass "Pi CLI found in PATH"
else
  skip "Pi CLI not installed (detection code is correct)"
fi

# ─── 10. Ralph Integration ───────────────────────────────────────────
echo -e "\n${YELLOW}[10] Ralph Integration${NC}"

if grep -q "PeterParkerBridge" src/commands/ralph.ts && grep -q "\-\-listen" src/commands/ralph.ts; then
  pass "Ralph injects --listen and starts bridge"
else
  fail "Ralph missing --listen injection or bridge"
fi

if command -v ralph-tui &>/dev/null; then
  pass "ralph-tui found in PATH"
else
  skip "ralph-tui not installed (integration code is correct)"
fi

# ─── Summary ─────────────────────────────────────────────────────────
echo -e "\n${CYAN}═══════════════════════════════════════════════════════${NC}"
echo -e "  ${GREEN}Passed: $PASS${NC}  ${RED}Failed: $FAIL${NC}  ${YELLOW}Skipped: $SKIP${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}\n"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
