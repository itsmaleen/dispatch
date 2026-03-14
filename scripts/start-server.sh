#!/bin/bash
# Start the ACC server in the background
# The Electron app connects to this server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVER_DIR="$PROJECT_DIR/packages/server"
LOG_FILE="/tmp/acc-server.log"
PID_FILE="/tmp/acc-server.pid"

# Check if already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "⚠️  Server already running (PID $OLD_PID)"
        echo "   Stop with: kill $OLD_PID"
        exit 0
    fi
fi

# Start server
echo "🚀 Starting ACC server..."
cd "$SERVER_DIR"
nohup bun run src/run.ts > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

sleep 2

# Check if started successfully
if curl -s http://localhost:3333/health > /dev/null 2>&1; then
    echo "✅ Server running on http://localhost:3333"
    echo "   PID: $(cat $PID_FILE)"
    echo "   Logs: $LOG_FILE"
else
    echo "❌ Server failed to start"
    echo "   Check logs: cat $LOG_FILE"
    exit 1
fi
