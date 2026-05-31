#!/usr/bin/env bash
set -e

# Get the absolute path to the script's directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
REPO_ROOT="$SCRIPT_DIR/../../.."
MOBILE_APP_DIR="$SCRIPT_DIR/.."
METADATA_PATH="$REPO_ROOT/fastlane/metadata/android"

PACKAGE_NAME="net.aliasvault.app"
TRACK="internal"
# Play Console service account key location (kept outside the repo for safety)
JSON_KEY_PATH="$HOME/.aliasvault/playstore.json"

AAB_OUTPUT_DIR="$SCRIPT_DIR/app/build/outputs/bundle/release"
AAB_RAW="$AAB_OUTPUT_DIR/app-release.aab"

# ------------------------------------------
# Build core libraries if needed
# ------------------------------------------

CORE_DIR="$REPO_ROOT/core"
MOBILE_CORE_DIST="$MOBILE_APP_DIR/utils/dist/core"

if [ ! -d "$MOBILE_CORE_DIST/models" ] || [ ! -d "$MOBILE_CORE_DIST/vault" ]; then
  echo "Building core libraries..."
  pushd "$CORE_DIR" > /dev/null
  chmod +x build-and-distribute.sh
  ./build-and-distribute.sh
  popd > /dev/null
  echo "Core libraries built successfully"
fi

# ------------------------------------------
# Extract version + versionCode
# ------------------------------------------

VERSION=$(node -p "require('$MOBILE_APP_DIR/app.json').expo.version")
VERSION_CODE=$(grep -E "^\s*versionCode " "$SCRIPT_DIR/app/build.gradle" | head -1 | awk '{print $2}')
AAB_RENAMED="$AAB_OUTPUT_DIR/aliasvault-${VERSION}-android.aab"

# ------------------------------------------
# Ask what to do
# ------------------------------------------

echo ""
echo "What do you want to do?"
echo "  1) Build AAB and submit to Play Console ($TRACK track)"
echo "  2) Build AAB only (no submit)"
echo "  3) Build APK only (for direct install / sideload)"
echo ""
read -p "Enter choice (1, 2, or 3): " -r CHOICE
echo ""

if [[ $CHOICE != "1" && $CHOICE != "2" && $CHOICE != "3" ]]; then
  echo "❌ Invalid choice. Please enter 1, 2, or 3."
  exit 1
fi

# ------------------------------------------
# Verify submit prerequisites (option 1 only)
# ------------------------------------------

if [[ $CHOICE == "1" ]]; then
  if ! command -v fastlane > /dev/null 2>&1; then
    echo "❌ fastlane not found. Install with: brew install fastlane"
    exit 1
  fi
  if [ ! -f "$JSON_KEY_PATH" ]; then
    echo "❌ Google Play service account JSON not found at '$JSON_KEY_PATH'"
    echo ""
    echo "Place the JSON key in the proper location and try again."
    exit 1
  fi
fi

# ------------------------------------------
# Pick build target: AAB (options 1, 2) or APK (option 3)
# ------------------------------------------

if [[ $CHOICE == "3" ]]; then
  GRADLE_TASK="assembleRelease"
  OUTPUT_DIR="$SCRIPT_DIR/app/build/outputs/apk/release"
  RAW_OUTPUT="$OUTPUT_DIR/app-release.apk"
  RENAMED_OUTPUT="$OUTPUT_DIR/aliasvault-${VERSION}-android.apk"
  ARTIFACT="APK"
else
  GRADLE_TASK="bundleRelease"
  OUTPUT_DIR="$AAB_OUTPUT_DIR"
  RAW_OUTPUT="$AAB_RAW"
  RENAMED_OUTPUT="$AAB_RENAMED"
  ARTIFACT="AAB"
fi

# ------------------------------------------
# Build
# ------------------------------------------

echo "Building $ARTIFACT..."

# Expo JS bundle export (mirrors CI step)
pushd "$MOBILE_APP_DIR" > /dev/null
mkdir -p build
npx expo export --dev --output-dir ./build --platform android
popd > /dev/null

# Gradle build (signed via local gradle.properties)
pushd "$SCRIPT_DIR" > /dev/null
./gradlew "$GRADLE_TASK"
popd > /dev/null

if [ ! -f "$RAW_OUTPUT" ]; then
  echo "❌ $ARTIFACT not found at $RAW_OUTPUT after build"
  exit 1
fi

mv "$RAW_OUTPUT" "$RENAMED_OUTPUT"

echo ""
echo "$ARTIFACT built at: $RENAMED_OUTPUT"
echo "  Version:     $VERSION"
echo "  VersionCode: $VERSION_CODE"
echo ""

# Build-only options: open output dir and exit
if [[ $CHOICE == "2" || $CHOICE == "3" ]]; then
  echo "✅ Build complete."
  open "$OUTPUT_DIR" 2>/dev/null || true
  exit 0
fi

# ------------------------------------------
# Confirm + check changelog presence
# ------------------------------------------

CHANGELOG_FILE="$METADATA_PATH/en-US/changelogs/${VERSION_CODE}.txt"
if [ ! -f "$CHANGELOG_FILE" ]; then
  echo "⚠️  No changelog file found at:"
  echo "    $CHANGELOG_FILE"
  echo "    Play Console will reuse the previous release's notes."
fi

echo ""
echo "================================================"
echo "Submitting to Play Console:"
echo "  Track:       $TRACK"
echo "  Package:     $PACKAGE_NAME"
echo "  Version:     $VERSION"
echo "  VersionCode: $VERSION_CODE"
echo "================================================"
echo ""
read -p "Are you sure you want to push this to Play Console ($TRACK track)? (y/n): " -r
echo ""

if [[ ! $REPLY =~ ^([Yy]([Ee][Ss])?|[Yy])$ ]]; then
    echo "❌ Submission cancelled"
    exit 1
fi

# ------------------------------------------
# Upload via fastlane supply
# ------------------------------------------
#
# - --skip_upload_metadata: don't overwrite listing title/description (managed in console)
# - --skip_upload_images / --skip_upload_screenshots: don't touch store visuals
# - Changelogs are still uploaded automatically from {versionCode}.txt files

fastlane supply \
  --package_name "$PACKAGE_NAME" \
  --aab "$AAB_RENAMED" \
  --track "$TRACK" \
  --metadata_path "$METADATA_PATH" \
  --json_key "$JSON_KEY_PATH" \
  --skip_upload_apk true \
  --skip_upload_metadata true \
  --skip_upload_images true \
  --skip_upload_screenshots true

echo ""
echo "✅ Uploaded to Play Console ($TRACK track)"
echo "   Promote to production at: https://play.google.com/console"
