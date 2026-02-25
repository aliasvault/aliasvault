#!/usr/bin/env bash

# Get the absolute path to the script's directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

BUNDLE_ID="net.aliasvault.safari.extension"

# Build settings
SCHEME="AliasVault"
PROJECT="$SCRIPT_DIR/AliasVault.xcodeproj"
CONFIG="Release"
ARCHIVE_PATH="$SCRIPT_DIR/build/${SCHEME}.xcarchive"
EXPORT_DIR="$SCRIPT_DIR/build/export"
EXPORT_PLIST="$SCRIPT_DIR/exportOptions.plist"

# Put the fastlane API key in the home directory
API_KEY_PATH="$HOME/APPSTORE_CONNECT_FASTLANE.json"

# ------------------------------------------

if [ ! -f "$API_KEY_PATH" ]; then
  echo "❌ API key file '$API_KEY_PATH' does not exist. Please provide the App Store Connect API key at this path."
  exit 1
fi

# ------------------------------------------
# Shared function to extract version info
# ------------------------------------------
extract_version_info() {
  local pkg_path="$1"

  # For .pkg files, we need to expand and find the Info.plist
  local temp_dir=$(mktemp -d -t aliasvault-pkg-extract)
  trap "rm -rf '$temp_dir'" EXIT

  # Expand the pkg to find the app bundle
  pkgutil --expand "$pkg_path" "$temp_dir/expanded" 2>/dev/null

  # Find the payload and extract it
  local payload=$(find "$temp_dir/expanded" -name "Payload" | head -n 1)

  if [ -n "$payload" ]; then
    mkdir -p "$temp_dir/contents"
    cd "$temp_dir/contents"
    cat "$payload" | gunzip -dc | cpio -i 2>/dev/null

    # Find Info.plist in the extracted contents
    local info_plist=$(find "$temp_dir/contents" -name "Info.plist" -path "*/Contents/Info.plist" | head -n 1)

    if [ -n "$info_plist" ]; then
      # Read version and build from the plist
      VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$info_plist" 2>/dev/null)
      BUILD=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$info_plist" 2>/dev/null)

      if [ -n "$VERSION" ] && [ -n "$BUILD" ]; then
        return 0
      fi
    fi
  fi

  # Fallback: try to read from the archive directly if it's in a known location
  local archive_plist="$ARCHIVE_PATH/Info.plist"
  if [ -f "$archive_plist" ]; then
    VERSION=$(/usr/libexec/PlistBuddy -c "Print :ApplicationProperties:CFBundleShortVersionString" "$archive_plist" 2>/dev/null)
    BUILD=$(/usr/libexec/PlistBuddy -c "Print :ApplicationProperties:CFBundleVersion" "$archive_plist" 2>/dev/null)

    if [ -n "$VERSION" ] && [ -n "$BUILD" ]; then
      return 0
    fi
  fi

  echo "❌ Could not extract version info from package"
  exit 1
}

# ------------------------------------------
# Ask if user wants to build or use existing
# ------------------------------------------

echo ""
echo "What do you want to do?"
echo "  1) Build and submit to App Store"
echo "  2) Build only"
echo "  3) Submit existing PKG to App Store"
echo ""
read -p "Enter choice (1, 2, or 3): " -r CHOICE
echo ""

# ------------------------------------------
# Build PKG (for options 1 and 2)
# ------------------------------------------

if [[ $CHOICE == "1" || $CHOICE == "2" ]]; then
  echo "Building browser extension..."
  pushd "$SCRIPT_DIR/.." > /dev/null
  npm run build:safari
  popd > /dev/null

  echo "Building PKG..."

  # Clean + archive
  xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$CONFIG" \
    -archivePath "$ARCHIVE_PATH" \
    clean archive \
    -allowProvisioningUpdates

  # Export .pkg
  rm -rf "$EXPORT_DIR"
  if ! xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportOptionsPlist "$EXPORT_PLIST" \
    -exportPath "$EXPORT_DIR" \
    -allowProvisioningUpdates; then
    echo "❌ Failed to export archive to PKG"
    exit 1
  fi

  PKG_PATH=$(ls "$EXPORT_DIR"/*.pkg 2>/dev/null)

  if [ -z "$PKG_PATH" ]; then
    echo "❌ No PKG file found in $EXPORT_DIR after export"
    echo "Contents of export directory:"
    ls -la "$EXPORT_DIR"
    exit 1
  fi

  # Extract version info from newly built PKG
  extract_version_info "$PKG_PATH"
  echo "PKG built at: $PKG_PATH"
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
# Submit to App Store (for options 1 and 3)
# ------------------------------------------

if [[ $CHOICE == "3" ]]; then
  # Use existing PKG
  PKG_PATH="$EXPORT_DIR/AliasVault.pkg"

  if [ ! -f "$PKG_PATH" ]; then
    echo "❌ PKG file not found at: $PKG_PATH"
    exit 1
  fi

  # Extract version info from existing PKG
  extract_version_info "$PKG_PATH"
  echo "Using existing PKG: $PKG_PATH"
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
echo "Submitting to App Store:"
echo "  PKG Path: $PKG_PATH"
echo "  Version: $VERSION"
echo "  Build:   $BUILD"
echo "================================================"
echo ""

# Validate PKG_PATH is set and file exists
if [ -z "$PKG_PATH" ] || [ ! -f "$PKG_PATH" ]; then
    echo "❌ Error: PKG file not found at: $PKG_PATH"
    exit 1
fi

read -p "Are you sure you want to push this to App Store? (y/n): " -r
echo ""

if [[ ! $REPLY =~ ^([Yy]([Ee][Ss])?|[Yy])$ ]]; then
    echo "❌ Submission cancelled"
    exit 1
fi

echo "✅ Proceeding with upload..."

# Calculate path to repository root and metadata
REPO_ROOT="$SCRIPT_DIR/../../.."
METADATA_PATH="$REPO_ROOT/fastlane/metadata/browser-extension"

fastlane deliver \
  --pkg "$PKG_PATH" \
  --skip_screenshots \
  --skip_metadata \
  --metadata_path "$METADATA_PATH" \
  --api_key_path "$API_KEY_PATH" \
  --run_precheck_before_submit false
