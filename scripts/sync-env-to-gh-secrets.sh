#!/bin/bash
# Push allowlisted env vars from .env or .env.production to GitHub Actions repository secrets.
# Requires: gh CLI installed and authenticated (gh auth login).
#
# Usage:
#   ./scripts/sync-env-to-gh-secrets.sh [env-file]
# Default env file: .env.production

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${1:-$PROJECT_DIR/.env.production}"

# Map local env var name -> GitHub secret name (release-mac.yml). Add more as needed.
gh_secret_name() {
  case "$1" in
    APPLE_ID) echo "APPLE_ID" ;;
    APPLE_PASSWORD) echo "APPLE_APP_SPECIFIC_PASSWORD" ;;
    APPLE_TEAM_ID) echo "APPLE_TEAM_ID" ;;
    CSC_LINK_BASE64) echo "CSC_LINK_BASE64" ;;
    CSC_KEY_PASSWORD) echo "CSC_KEY_PASSWORD" ;;
    *) echo "" ;;
  esac
}

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Env file not found: $ENV_FILE"
  exit 1
fi

if ! command -v gh &>/dev/null; then
  echo "❌ GitHub CLI (gh) not found. Install: brew install gh && gh auth login"
  exit 1
fi

echo "📤 Syncing secrets from $ENV_FILE to GitHub repository secrets..."
echo ""

tmp=""
cleanup() { [ -n "$tmp" ] && rm -f "$tmp"; }
trap cleanup EXIT

while IFS= read -r line; do
  # Skip comments and empty lines
  [[ "$line" =~ ^#.*$ ]] && continue
  [[ -z "${line// }" ]] && continue
  # Parse KEY=VALUE (first = separates key and value)
  key="${line%%=*}"
  key="${key// /}"
  value="${line#*=}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  value="$(printf '%s' "$value" | tr -d '\r\n')"
  gh_name="$(gh_secret_name "$key")"
  if [ -n "$gh_name" ] && [ -n "$value" ]; then
    tmp="$(mktemp)"
    printf '%s' "$value" > "$tmp"
    gh secret set "$gh_name" < "$tmp" && echo "  ✓ $gh_name"
    rm -f "$tmp"
    tmp=""
  fi
done < "$ENV_FILE"

echo ""
echo "✅ Done. Run: gh secret list"
