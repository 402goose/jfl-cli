#!/bin/bash
# voice-start.sh - Start voice input with one command
# Usage: ./voice-start.sh [--daemon]

set -e

JFL_DIR="$HOME/.jfl"
MODELS_DIR="$JFL_DIR/models"
WHISPER_MODEL="$MODELS_DIR/ggml-base.bin"
VAD_MODEL="$MODELS_DIR/ggml-silero-vad.bin"
SOCKET_PATH="$JFL_DIR/voice.sock"
TOKEN_PATH="$JFL_DIR/voice-server.token"
PID_FILE="$JFL_DIR/voice-server.pid"

# Detect whisper server location
if [[ -n "$WHISPER_SERVER_PATH" ]]; then
    WHISPER_SERVER="$WHISPER_SERVER_PATH"
else
    # Auto-detect based on project structure
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || echo "")"

    # Common locations to check
    POSSIBLE_PATHS=(
        "$PROJECT_ROOT/../jfl-platform/packages/whisper-server/build/whisper-stream-server"
        "$PROJECT_ROOT/packages/whisper-server/build/whisper-stream-server"
        "$HOME/code/goose/jfl/jfl-platform/packages/whisper-server/build/whisper-stream-server"
    )

    for path in "${POSSIBLE_PATHS[@]}"; do
        if [[ -x "$path" ]]; then
            WHISPER_SERVER="$path"
            break
        fi
    done

    if [[ -z "$WHISPER_SERVER" || ! -x "$WHISPER_SERVER" ]]; then
        echo -e "${RED}✗ Whisper server not found${NC}"
        echo -e "${GRAY}  Tried locations:${NC}"
        for path in "${POSSIBLE_PATHS[@]}"; do
            echo -e "${GRAY}    - $path${NC}"
        done
        echo ""
        echo -e "${GRAY}  Set WHISPER_SERVER_PATH environment variable or ensure jfl-platform is at ../jfl-platform${NC}"
        echo -e "${GRAY}  Or build the server: cd jfl-platform/packages/whisper-server && ./build.sh${NC}"
        exit 1
    fi
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
GRAY='\033[0;90m'
NC='\033[0m'

echo -e "${GREEN}🎤 JFL Voice - Starting${NC}"
echo -e "${GRAY}Using whisper server: $WHISPER_SERVER${NC}"
echo ""

# Check if models exist
if [ ! -f "$WHISPER_MODEL" ]; then
    echo -e "${YELLOW}⚠ Whisper model not found. Downloading...${NC}"
    jfl voice model download base
fi

if [ ! -f "$VAD_MODEL" ]; then
    echo -e "${YELLOW}⚠ VAD model not found. Downloading...${NC}"
    curl -L "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin" \
        -o "$VAD_MODEL"
fi

# Generate token if needed
if [ ! -f "$TOKEN_PATH" ]; then
    TOKEN=$(openssl rand -hex 16)
    echo "$TOKEN" > "$TOKEN_PATH"
    chmod 600 "$TOKEN_PATH"
    echo -e "${GRAY}  Generated auth token${NC}"
fi

TOKEN=$(cat "$TOKEN_PATH")

# Check if server already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Server already running (PID: $OLD_PID)${NC}"
    else
        rm -f "$PID_FILE"
    fi
fi

# Start server if not running
if [ ! -f "$PID_FILE" ]; then
    echo -e "${GRAY}  Starting whisper server...${NC}"

    # Start server in background
    # Note: VAD threshold lowered to 0.05 for better sensitivity to quiet speech
    "$WHISPER_SERVER" \
        --model "$WHISPER_MODEL" \
        --vad-model "$VAD_MODEL" \
        --vad-threshold 0.05 \
        --port 9090 \
        --host 127.0.0.1 \
        --token "$TOKEN" \
        > "$JFL_DIR/voice-server.log" 2>&1 &

    SERVER_PID=$!
    echo "$SERVER_PID" > "$PID_FILE"

    # Wait for server to load models
    echo -e "${GRAY}  Loading models (takes ~8s on first run)...${NC}"
    sleep 8

    if ps -p "$SERVER_PID" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Server started (PID: $SERVER_PID)${NC}"
    else
        echo -e "${RED}✗ Server failed to start${NC}"
        echo -e "${GRAY}  Check logs: cat $JFL_DIR/voice-server.log${NC}"
        rm -f "$PID_FILE"
        exit 1
    fi
fi

# Set up Unix socket bridge (kill old one first)
pkill -f "socat.*voice.sock" 2>/dev/null || true
rm -f "$SOCKET_PATH"

socat UNIX-LISTEN:"$SOCKET_PATH",mode=600,fork TCP:127.0.0.1:9090 &
SOCAT_PID=$!
sleep 1

if [ -S "$SOCKET_PATH" ]; then
    echo -e "${GREEN}✓ Unix socket ready${NC}"
else
    echo -e "${RED}✗ Failed to create socket${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Voice input ready!${NC}"
echo ""

# If --daemon flag, start the hotkey daemon
if [ "$1" = "--daemon" ]; then
    echo -e "${GRAY}Starting hotkey daemon...${NC}"
    jfl voice daemon start
else
    echo -e "Commands:"
    echo -e "  ${GRAY}jfl voice test${NC}           Record 3s and transcribe"
    echo -e "  ${GRAY}jfl voice${NC}                Record with VAD (stops on silence)"
    echo -e "  ${GRAY}jfl voice hotkey${NC}         Start hotkey listener (Cmd+Shift+V)"
    echo -e "  ${GRAY}jfl voice daemon start${NC}   Run hotkey in background"
    echo ""
    echo -e "To stop: ${GRAY}./voice-stop.sh${NC}"
fi
