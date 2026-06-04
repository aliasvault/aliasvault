#!/usr/bin/env bash

# Get the absolute path to the script's directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

BUNDLE_ID="net.aliasvault.app"

SCHEME="AliasVault"
WORKSPACE="$SCRIPT_DIR/AliasVault.xcworkspace"
CONFIG="Release"
ARCHIVE_PATH="$SCRIPT_DIR/build/${SCHEME}.xcarchive"
EXPORT_DIR="$SCRIPT_DIR/build/export"
EXPORT_PLIST="$SCRIPT_DIR/exportOptions.plist"
API_KEY_PATH="$HOME/.aliasvault/appstore-connect.json"

# ------------------------------------------
# Build core libraries if needed
# ------------------------------------------

CORE_DIR="$SCRIPT_DIR/../../../core"
MOBILE_CORE_DIST="$SCRIPT_DIR/../utils/dist/core"

if [ ! -d "$MOBILE_CORE_DIST/models" ] || [ ! -d "$MOBILE_CORE_DIST/vault" ]; then
  echo "Building core libraries..."
  pushd "$CORE_DIR" > /dev/null
  chmod +x build-and-distribute.sh
  ./build-and-distribute.sh
  popd > /dev/null
  echo "Core libraries built successfully"
fi

# ------------------------------------------

if [ ! -f "$API_KEY_PATH" ]; then
  echo "❌ API key file '$API_KEY_PATH' does not exist. Please provide the App Store Connect API key at this path."
  exit 1
fi

# ------------------------------------------
# Shared function to extract version info
# ------------------------------------------
extract_version_info() {
  local ipa_path="$1"

  # Extract Info.plist to a temporary file
  local temp_plist=$(mktemp)
  unzip -p "$ipa_path" "Payload/*.app/Info.plist" > "$temp_plist"

  # Read version and build from the plist
  VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$temp_plist")
  BUILD=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$temp_plist")

  # Clean up temp file
  rm -f "$temp_plist"
}

# ------------------------------------------
# Ask if user wants to build or use existing
# ------------------------------------------

echo ""
echo "What do you want to do?"
echo "  1) Build and submit to TestFlight"
echo "  2) Build only"
echo "  3) Submit existing IPA to TestFlight"
echo ""
read -p "Enter choice (1, 2, or 3): " -r CHOICE
echo ""

# ------------------------------------------
# Build IPA (for options 1 and 2)
# ------------------------------------------

if [[ $CHOICE == "1" || $CHOICE == "2" ]]; then
  echo "Building IPA..."

  # Clean + archive
  xcodebuild \
    -workspace "$WORKSPACE" \
    -scheme "$SCHEME" \
    -configuration "$CONFIG" \
    -archivePath "$ARCHIVE_PATH" \
    clean archive \
    -allowProvisioningUpdates

  # Export .ipa
  rm -rf "$EXPORT_DIR"
  xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportOptionsPlist "$EXPORT_PLIST" \
    -exportPath "$EXPORT_DIR" \
    -allowProvisioningUpdates

  IPA_PATH=$(ls "$EXPORT_DIR"/*.ipa)

  # Extract version info from newly built IPA
  extract_version_info "$IPA_PATH"
  echo "IPA built at: $IPA_PATH"
  echo "  Version: $VERSION"
  echo "  Build:   $BUILD"
  echo ""

  # Exit if build-only
  if [[ $CHOICE == "2" ]]; then
    echo "✅ Build complete. Exiting."
    exit 0
  fi
fi

# ------------------------------------------
# Submit to TestFlight (for options 1 and 3)
# ------------------------------------------

if [[ $CHOICE == "3" ]]; then
  # Use existing IPA
  IPA_PATH="$EXPORT_DIR/AliasVault.ipa"

  if [ ! -f "$IPA_PATH" ]; then
    echo "❌ IPA file not found at: $IPA_PATH"
    exit 1
  fi

  # Extract version info from existing IPA
  extract_version_info "$IPA_PATH"
  echo "Using existing IPA: $IPA_PATH"
  echo "  Version: $VERSION"
  echo "  Build:   $BUILD"
  echo ""
fi

if [[ $CHOICE != "1" && $CHOICE != "3" ]]; then
  echo "❌ Invalid choice. Please enter 1, 2, or 3."
  exit 1
fi

echo ""
echo "================================================"
echo "Submitting to TestFlight:"
echo "  Version: $VERSION"
echo "  Build:   $BUILD"
echo "================================================"
echo ""
read -p "Are you sure you want to push this to TestFlight? (y/n): " -r
echo ""

if [[ ! $REPLY =~ ^([Yy]([Ee][Ss])?|[Yy])$ ]]; then
    echo "❌ Submission cancelled"
    exit 1
fi

echo "Checking if build already exists on TestFlight..."

# Get the latest TestFlight build number for this version
set +e
RAW_OUTPUT=$(fastlane run latest_testflight_build_number \
  app_identifier:"$BUNDLE_ID" \
  version:"$VERSION" \
  api_key_path:"$API_KEY_PATH" \
  2>&1)
set -e

# Extract the build number from the output
LATEST=$(echo "$RAW_OUTPUT" | grep -oE "Result: [0-9]+" | grep -oE "[0-9]+" | head -n1)

# Check if we got a valid result
if [ -z "$LATEST" ]; then
  echo "❌ Failed to get TestFlight build number. Fastlane output:"
  echo "$RAW_OUTPUT"
  echo ""
  echo "This could mean:"
  echo "  - No builds exist for version $VERSION on TestFlight (first upload)"
  echo "  - API authentication failed"
  echo "  - Network/API error"
  exit 1
fi

echo "Latest TestFlight build number for version $VERSION: $LATEST"

# Numeric compare - if latest >= current, it's a duplicate
if [ "$LATEST" -ge "$BUILD" ]; then
  echo "🚫 Duplicate detected: TestFlight already has $VERSION with build $LATEST (your build: $BUILD)."
  exit 1
fi

echo "✅ No duplicate found. Proceeding with deliver..."

# Calculate path to repository root and metadata
REPO_ROOT="$SCRIPT_DIR/../../.."
METADATA_PATH="$REPO_ROOT/fastlane/metadata/ios"

# ------------------------------------------
# Prefill the App Store "What's New in This Version" release notes.
#
# We keep release notes per build at <locale>/changelogs/<build>.txt (mirroring
# the Android/supply layout), but deliver expects them at <locale>/release_notes.txt.
# So we materialize a temporary metadata dir containing only the release notes for
# this build, and point deliver at it. Everything else (name, description,
# screenshots) stays managed in App Store Connect and is left untouched.
# ------------------------------------------
TMP_METADATA_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_METADATA_DIR"' EXIT

RELEASE_NOTES_FOUND=false
for LOCALE_DIR in "$METADATA_PATH"/*/; do
  LOCALE=$(basename "$LOCALE_DIR")
  CHANGELOG_FILE="$LOCALE_DIR/changelogs/${BUILD}.txt"
  if [ -f "$CHANGELOG_FILE" ]; then
    mkdir -p "$TMP_METADATA_DIR/$LOCALE"
    cp "$CHANGELOG_FILE" "$TMP_METADATA_DIR/$LOCALE/release_notes.txt"
    RELEASE_NOTES_FOUND=true
  fi
done

if [ "$RELEASE_NOTES_FOUND" = true ]; then
  echo "📝 Prefilling 'What's New in This Version' from changelogs/${BUILD}.txt"
  DELIVER_METADATA_ARGS=(--metadata_path "$TMP_METADATA_DIR" --app_version "$VERSION" --force)
else
  echo "⚠️  No changelog found for build ${BUILD}; uploading without release notes."
  echo "    Add one at: $METADATA_PATH/en-US/changelogs/${BUILD}.txt"
  DELIVER_METADATA_ARGS=(--skip_metadata)
fi

fastlane deliver \
  --ipa "$IPA_PATH" \
  --skip_screenshots \
  "${DELIVER_METADATA_ARGS[@]}" \
  --api_key_path "$API_KEY_PATH" \
  --run_precheck_before_submit=false
