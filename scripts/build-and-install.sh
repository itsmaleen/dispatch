#!/bin/bash
# Build and install Merry to /Applications
# Run from project root: ./scripts/build-and-install.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RELEASE_DIR="$PROJECT_DIR/packages/ui/release"
APP_NAME="Merry"
DMG_NAME="$APP_NAME-0.1.0-arm64.dmg"

echo "📦 Installing from $RELEASE_DIR/$DMG_NAME..."
cd "$RELEASE_DIR"

# Mount DMG
VOLUME_NAME=$(hdiutil attach "$DMG_NAME" -nobrowse 2>/dev/null | grep "Volumes" | awk -F'\t' '{print $NF}')

if [ -z "$VOLUME_NAME" ]; then
    echo "❌ Failed to mount DMG"
    exit 1
fi

echo "   Mounted: $VOLUME_NAME"

# Remove old app if exists
if [ -d "/Applications/$APP_NAME.app" ]; then
    echo "   Removing old version..."
    rm -rf "/Applications/$APP_NAME.app"
fi

# Copy new app
echo "   Copying to /Applications..."
cp -R "$VOLUME_NAME/$APP_NAME.app" /Applications/

# Unmount
hdiutil detach "$VOLUME_NAME" -quiet

echo "✅ Installed to /Applications/$APP_NAME.app"
echo ""
echo "To run: open '/Applications/$APP_NAME.app'"
echo "Or use Spotlight: Cmd+Space → 'Merry'"
