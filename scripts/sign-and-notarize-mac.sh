#!/bin/bash
# Sign and notarize the macOS app. Loads APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID from .env.production.
# Run from repo root: bun run sign:mac

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

if [ ! -f ".env.production" ]; then
  echo "❌ Missing .env.production (expected: APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID)"
  exit 1
fi

# Load env and export what notarization needs (electron-builder uses APPLE_APP_SPECIFIC_PASSWORD)
set -a
source .env.production
set +a
export APPLE_APP_SPECIFIC_PASSWORD="$APPLE_PASSWORD"
unset APPLE_PASSWORD

echo "🧹 Cleaning ALL caches and build artifacts..."
rm -rf packages/ui/dist packages/server/dist packages/contracts/dist packages/analytics/dist
rm -rf .turbo packages/ui/.turbo packages/server/.turbo packages/contracts/.turbo packages/analytics/.turbo
rm -rf node_modules/.cache packages/ui/node_modules/.cache packages/server/node_modules/.cache
rm -rf packages/ui/.vite

echo "📦 Building (signed + notarized for macOS)..."
npx turbo build --force

echo "🔐 Signing and notarizing DMG..."
cd packages/ui && bun run build:electron:sign

# Get version from package.json (we're already in packages/ui directory)
VERSION=$(node -p "require('./package.json').version")
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
    ARCH="x64"
elif [ "$ARCH" = "arm64" ]; then
    ARCH="arm64"
fi
echo "✅ Done. Signed DMG: packages/ui/release/Merry-$VERSION-$ARCH.dmg"
