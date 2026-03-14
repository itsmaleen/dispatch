#!/bin/bash
# Kill any stale ACC server processes before starting dev
# This ensures `bun run dev` starts fresh

echo "🧹 Cleaning up stale processes..."

# Kill processes on ports 3333-3340 (ACC server range)
for port in 3333 3334 3335 3336 3337 3338 3339 3340; do
  pid=$(lsof -ti:$port 2>/dev/null)
  if [ -n "$pid" ]; then
    echo "  Killing process on port $port (PID: $pid)"
    kill $pid 2>/dev/null || true
  fi
done

# Kill any tsx watch processes for run.ts
pkill -f "tsx.*run\.ts" 2>/dev/null || true

# Kill any stale Electron processes
pkill -f "Dispatch" 2>/dev/null || true

echo "✅ Cleanup complete"
