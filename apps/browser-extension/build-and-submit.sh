#!/usr/bin/env bash
set -e

# Get the absolute path to the script's directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
REPO_ROOT="$SCRIPT_DIR/../.."
ENV_FILE="$HOME/.aliasvault/browser-extensions.env"
METADATA_PATH="$REPO_ROOT/fastlane/metadata/browser-extension"

# ------------------------------------------
# Load credentials
# ------------------------------------------

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Credentials file not found: $ENV_FILE"
  echo ""
  echo "Create the credentials file and fill in store credentials:"
  echo "  nano ~/.aliasvault/browser-extensions.env"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# ------------------------------------------
# Extract version + changelog
# ------------------------------------------

VERSION=$(node -p "require('$SCRIPT_DIR/package.json').version")
CHANGELOG_FILE="$METADATA_PATH/en-US/changelogs/${VERSION}.txt"

if [ -f "$CHANGELOG_FILE" ]; then
  CHANGELOG=$(cat "$CHANGELOG_FILE")
  echo "✅ Loaded changelog from $CHANGELOG_FILE"
else
  CHANGELOG=""
  echo "⚠️  No changelog at $CHANGELOG_FILE (continuing without release notes)"
fi

# ------------------------------------------
# Pick browsers
# ------------------------------------------

echo ""
echo "Which browser(s) do you want to publish?"
echo "  1) Chrome"
echo "  2) Firefox"
echo "  3) Edge"
echo "  4) All three"
echo ""
read -p "Enter choice (1-4): " -r BROWSER_CHOICE
echo ""

case $BROWSER_CHOICE in
  1) BROWSERS=("chrome") ;;
  2) BROWSERS=("firefox") ;;
  3) BROWSERS=("edge") ;;
  4) BROWSERS=("chrome" "firefox" "edge") ;;
  *) echo "❌ Invalid choice. Please enter 1-4."; exit 1 ;;
esac

ZIP_DIR="$SCRIPT_DIR/dist"

# ------------------------------------------
# Confirm
# ------------------------------------------

echo "================================================"
echo "Publishing browser extension(s):"
echo "  Browsers: ${BROWSERS[*]}"
echo "  Version:  $VERSION"
echo "================================================"
echo ""
read -p "Continue? (y/n): " -r
echo ""

if [[ ! $REPLY =~ ^([Yy]([Ee][Ss])?|[Yy])$ ]]; then
  echo "❌ Cancelled"
  exit 1
fi

# ------------------------------------------
# Build
# ------------------------------------------

for browser in "${BROWSERS[@]}"; do
  echo ""
  echo "🔨 Building $browser…"
  pushd "$SCRIPT_DIR" > /dev/null
  npm run zip:"$browser"
  popd > /dev/null
done

# ------------------------------------------
# Publish functions
# ------------------------------------------

publish_chrome() {
  local zip="$ZIP_DIR/aliasvault-browser-extension-${VERSION}-chrome.zip"
  if [ ! -f "$zip" ]; then
    echo "❌ Chrome zip not found: $zip"
    echo "   Run with build option, or 'npm run zip:chrome' first."
    return 1
  fi
  for v in CHROME_EXTENSION_ID CHROME_CLIENT_ID CHROME_CLIENT_SECRET CHROME_REFRESH_TOKEN; do
    if [ -z "${!v}" ]; then
      echo "❌ $v is empty in $ENV_FILE"
      return 1
    fi
  done

  echo ""
  echo "📤 Publishing to Chrome Web Store…"
  local chrome_exit=0
  npx -y chrome-webstore-upload-cli@3 upload \
    --source "$zip" \
    --extension-id "$CHROME_EXTENSION_ID" \
    --client-id "$CHROME_CLIENT_ID" \
    --client-secret "$CHROME_CLIENT_SECRET" \
    --refresh-token "$CHROME_REFRESH_TOKEN" \
    --auto-publish || chrome_exit=$?

  if [ $chrome_exit -ne 0 ]; then
    echo "❌ Chrome upload failed (chrome-webstore-upload-cli exit code $chrome_exit)"
    return $chrome_exit
  fi
  echo "✅ Chrome submitted for review"
}

publish_firefox() {
  local zip="$ZIP_DIR/aliasvault-browser-extension-${VERSION}-firefox.zip"
  local source_zip="$ZIP_DIR/aliasvault-browser-extension-${VERSION}-sources.zip"
  if [ ! -f "$zip" ]; then
    echo "❌ Firefox zip not found: $zip"
    return 1
  fi
  if [ ! -f "$source_zip" ]; then
    echo "❌ Firefox sources zip not found: $source_zip"
    echo "   AMO listed channel requires a sources zip for review."
    return 1
  fi
  for v in FIREFOX_API_KEY FIREFOX_API_SECRET; do
    if [ -z "${!v}" ]; then
      echo "❌ $v is empty in $ENV_FILE"
      return 1
    fi
  done

  # web-ext sign needs an unpacked source dir, not the built zip
  local unpacked="$ZIP_DIR/firefox-unpacked"
  rm -rf "$unpacked"
  mkdir -p "$unpacked"
  unzip -q "$zip" -d "$unpacked"

  # Build the AMO metadata JSON used by web-ext sign's --amo-metadata flag.
  # - version.approval_notes: private, shown to the AMO reviewer
  # - version.release_notes:  public, shown on the listing under "Release notes"
  local approval_notes_value="Automated submission via publish.sh."
  if [ -n "$CHANGELOG" ]; then
    approval_notes_value="Changelog for ${VERSION}:\n${CHANGELOG}"
  fi
  local metadata_file
  metadata_file=$(mktemp)
  CHANGELOG_ENV="$CHANGELOG" APPROVAL_ENV="$approval_notes_value" node -e '
    const meta = { version: { approval_notes: process.env.APPROVAL_ENV } };
    if (process.env.CHANGELOG_ENV) {
      meta.version.release_notes = { "en-US": process.env.CHANGELOG_ENV };
    }
    process.stdout.write(JSON.stringify(meta));
  ' > "$metadata_file"

  echo ""
  echo "📤 Publishing to Firefox AMO (listed)…"
  pushd "$SCRIPT_DIR" > /dev/null
  local firefox_exit=0
  # --approval-timeout 0: don't block waiting for AMO review (can take hours).
  # Listed channel doesn't return a signed XPI anyway — AMO publishes directly
  # to the store after review, and you get an email when it completes.
  npx -y web-ext sign \
    --channel listed \
    --source-dir "$unpacked" \
    --artifacts-dir "$ZIP_DIR/firefox-signed" \
    --upload-source-code "$source_zip" \
    --amo-metadata "$metadata_file" \
    --api-key "$FIREFOX_API_KEY" \
    --api-secret "$FIREFOX_API_SECRET" \
    --approval-timeout 0 || firefox_exit=$?
  popd > /dev/null
  rm -f "$metadata_file"

  if [ $firefox_exit -ne 0 ]; then
    echo "❌ Firefox upload failed (web-ext exit code $firefox_exit)"
    return $firefox_exit
  fi
  echo "✅ Firefox submitted to AMO for review"
}

publish_edge() {
  local zip="$ZIP_DIR/aliasvault-browser-extension-${VERSION}-edge.zip"
  if [ ! -f "$zip" ]; then
    echo "❌ Edge zip not found: $zip"
    return 1
  fi
  for v in EDGE_PRODUCT_ID EDGE_CLIENT_ID EDGE_API_KEY; do
    if [ -z "${!v}" ]; then
      echo "❌ $v is empty in $ENV_FILE"
      return 1
    fi
  done

  local notes="Automated submission via publish.sh."
  if [ -n "$CHANGELOG" ]; then
    notes="Changelog for ${VERSION}: ${CHANGELOG}"
  fi

  echo ""
  local edge_exit=0
  node "$SCRIPT_DIR/scripts/publish-edge.mjs" "$zip" "$notes" || edge_exit=$?
  if [ $edge_exit -ne 0 ]; then
    echo "❌ Edge upload failed (publish-edge.mjs exit code $edge_exit)"
    return $edge_exit
  fi
}

# ------------------------------------------
# Run publishes
# ------------------------------------------

EXIT_CODE=0
for browser in "${BROWSERS[@]}"; do
  case $browser in
    chrome) publish_chrome || EXIT_CODE=$? ;;
    firefox) publish_firefox || EXIT_CODE=$? ;;
    edge) publish_edge || EXIT_CODE=$? ;;
  esac
done

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ All publishes completed"
else
  echo "⚠️  One or more publishes failed (see output above)"
  exit $EXIT_CODE
fi
