#!/usr/bin/env bash

# ------------------------------------------
# Build core libraries if needed
# ------------------------------------------

CORE_DIR="../../core"
MOBILE_CORE_DIST="../utils/dist/core"

if [ ! -d "$MOBILE_CORE_DIST/models" ] || [ ! -d "$MOBILE_CORE_DIST/vault" ]; then
  echo "Building core libraries..."
  pushd "$CORE_DIR" > /dev/null
  chmod +x build-and-distribute.sh
  ./build-and-distribute.sh
  popd > /dev/null
  echo "Core libraries built successfully"
fi

# ------------------------------------------
# Build Android app in release mode
# ------------------------------------------

./gradlew bundleRelease

# Open directory that should contain the .aab file if build was successful
open app/build/outputs/bundle/release
