#!/bin/bash
# voice-stop.sh - Stop voice input services

JFL_DIR="$HOME/.jfl"
PID_FILE="$JFL_DIR/voice-server.pid"

GREEN='\033[0;32m'
GRAY='\033[0;90m'
NC='\033[0m'

echo -e "${GRAY}Stopping voice services...${NC}"

# Stop daemon if running
jfl voice daemon stop 2>/dev/null || true

# Stop socat bridge
pkill -f "socat.*voice.sock" 2>/dev/null || true
rm -f "$JFL_DIR/voice.sock"

# Stop whisper server
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        kill "$PID" 2>/dev/null || true
        echo -e "${GREEN}✓ Stopped whisper server${NC}"
    fi
    rm -f "$PID_FILE"
fi

# Also kill any orphaned processes
pkill -f whisper-stream-server 2>/dev/null || true

echo -e "${GREEN}✓ Voice services stopped${NC}"
