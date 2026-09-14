#!/bin/bash

# Thin wrapper that calls the main Rust core build script
# This is called by Gradle build phases
#
# Usage:
#   ./build-rust-core.sh [--force]
#
# The main build script lives at: /core/rust/build.sh

set -e

# Ensure cargo is in PATH (for Gradle build phases)
export PATH="$HOME/.cargo/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

# Script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUST_CORE_DIR="$(cd "$SCRIPT_DIR/../../../../core/rust" && pwd)"
JNILIBS_DIR="$SCRIPT_DIR/../app/src/main/jniLibs"

# Parse arguments to pass through
FORCE_FLAG=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --force)
            FORCE_FLAG="--force"
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# Call the main build script with incremental mode
cd "$RUST_CORE_DIR"
exec ./build.sh --android --incremental $FORCE_FLAG
