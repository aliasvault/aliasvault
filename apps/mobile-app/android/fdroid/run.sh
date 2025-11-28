#!/bin/bash
set -e  # Exit on any error, except where explicitly ignored
trap 'echo "🛑 Interrupted. Exiting..."; exit 130' INT  # Handle Ctrl+C cleanly

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_GRADLE="${SCRIPT_DIR}/../app/build.gradle"
TEMPLATE_FILE="${SCRIPT_DIR}/net.aliasvault.app.yml.template"
OUTPUT_FILE="${SCRIPT_DIR}/net.aliasvault.app.yml"

# Check if template exists
if [ ! -f "$TEMPLATE_FILE" ]; then
  echo "❌ Error: Template file not found: $TEMPLATE_FILE"
  exit 1
fi

# Check if build.gradle exists
if [ ! -f "$BUILD_GRADLE" ]; then
  echo "❌ Error: build.gradle not found: $BUILD_GRADLE"
  exit 1
fi

# Extract version information from build.gradle
echo "📱 Extracting version information from build.gradle..."
VERSION_CODE=$(grep -E '^\s*versionCode\s+' "$BUILD_GRADLE" | sed -E 's/.*versionCode\s+([0-9]+).*/\1/')
VERSION_NAME=$(grep -E '^\s*versionName\s+' "$BUILD_GRADLE" | sed -E 's/.*versionName\s+"([^"]+)".*/\1/')

if [ -z "$VERSION_CODE" ] || [ -z "$VERSION_NAME" ]; then
  echo "❌ Error: Could not extract version information from build.gradle"
  echo "   versionCode: ${VERSION_CODE:-not found}"
  echo "   versionName: ${VERSION_NAME:-not found}"
  exit 1
fi

# Get current git branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")

echo "✅ Version information extracted:"
echo "   versionCode: $VERSION_CODE"
echo "   versionName: $VERSION_NAME"
echo "   commit: $CURRENT_BRANCH"

# Generate the F-Droid metadata file from template
echo "📝 Generating F-Droid metadata file..."
sed -e "s/__VERSION_NAME__/$VERSION_NAME/g" \
    -e "s/__VERSION_CODE__/$VERSION_CODE/g" \
    -e "s/__COMMIT__/$CURRENT_BRANCH/g" \
    "$TEMPLATE_FILE" > "$OUTPUT_FILE"

echo "✅ Generated: $OUTPUT_FILE"

# Create outputs bind dir and set correct permissions
mkdir -p outputs
sudo chown -R 1000:1000 outputs

# Build and run the Docker environment
echo "🐳 Building Docker images..."
if ! docker compose build; then
  echo "⚠️  Warning: Docker build failed, continuing..."
fi

echo "🚀 Running fdroid-buildserver..."
docker compose run --rm fdroid-buildserver

echo "✅ F-Droid build completed!"
