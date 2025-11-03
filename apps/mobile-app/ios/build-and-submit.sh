#!/usr/bin/env bash

BUNDLE_ID="net.aliasvault.app"

# Put the fastlane API key in the home directory
API_KEY_PATH="$HOME/APPSTORE_CONNECT_FASTLANE.json"

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

SCHEME="AliasVault"
WORKSPACE="AliasVault.xcworkspace"
CONFIG="Release"
ARCHIVE_PATH="$PWD/build/${SCHEME}.xcarchive"
EXPORT_DIR="$PWD/build/export"
EXPORT_PLIST="$PWD/exportOptions.plist"

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

fastlane deliver \
  --ipa "$IPA_PATH" \
  --skip_screenshots \
  --skip_metadata \
  --api_key_path "$API_KEY_PATH" \
  --run_precheck_before_submit=false
