#!/bin/bash
# Rebuild native modules and install Merry
# Handles Node.js version requirements for @electron/rebuild

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🔧 Rebuilding native modules for Electron..."

# Use Node 22 via nvm if available (required for @electron/rebuild)
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    source "$NVM_DIR/nvm.sh"
    nvm use 22 2>/dev/null || nvm use 20 2>/dev/null || echo "Using system Node"
fi

cd "$PROJECT_DIR/packages/ui"

# Rebuild node-pty for Electron
echo "  → Rebuilding node-pty..."
npx @electron/rebuild -m node_modules/node-pty

cd "$PROJECT_DIR"

echo "📦 Building application (force rebuild)..."
npx turbo build --force

echo "💿 Installing to /Applications..."
./scripts/build-and-install.sh
