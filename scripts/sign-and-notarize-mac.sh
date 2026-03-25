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

echo "🧹 Cleaning dist directories..."
rm -rf packages/ui/dist packages/server/dist packages/contracts/dist packages/analytics/dist

echo "📦 Building (signed + notarized for macOS)..."
npx turbo build --force

echo "🔐 Signing and notarizing DMG..."
cd packages/ui && bun run build:electron:sign

# Get version from package.json
VERSION=$(node -p "require('./packages/ui/package.json').version")
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
    ARCH="x64"
elif [ "$ARCH" = "arm64" ]; then
    ARCH="arm64"
fi
echo "✅ Done. Signed DMG: packages/ui/release/Merry-$VERSION-$ARCH.dmg"
