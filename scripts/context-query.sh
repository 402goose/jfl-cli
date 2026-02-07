#!/bin/bash
#
# Helper script to query Context Hub
#
# Usage:
#   ./scripts/context-query.sh                    # Get all context
#   ./scripts/context-query.sh search "session"   # Search for term
#   ./scripts/context-query.sh status             # Show status
#

ACTION="${1:-all}"
QUERY="$2"
TOKEN=$(cat .jfl/context-hub.token 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "Error: No token found. Is Context Hub running?"
  echo "Run: jfl context-hub start"
  exit 1
fi

case "$ACTION" in
  status)
    curl -s -H "Authorization: Bearer $TOKEN" \
      http://localhost:4242/api/context/status | python3 -m json.tool
    ;;

  search)
    if [ -z "$QUERY" ]; then
      echo "Usage: $0 search <query>"
      exit 1
    fi
    curl -s -X POST \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"query\": \"$QUERY\", \"maxItems\": 10}" \
      http://localhost:4242/api/context/search | python3 -m json.tool
    ;;

  all|*)
    curl -s -X POST \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      http://localhost:4242/api/context | python3 -m json.tool
    ;;
esac
