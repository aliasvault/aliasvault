#!/usr/bin/env bash

# Get the absolute path to the script's directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

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
# Build Android app in release mode
# ------------------------------------------

pushd "$SCRIPT_DIR" > /dev/null
./gradlew bundleRelease
popd > /dev/null

# Open directory that should contain the .aab file if build was successful
open "$SCRIPT_DIR/app/build/outputs/bundle/release"
