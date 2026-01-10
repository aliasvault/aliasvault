#!/bin/bash

# Thin wrapper that calls the main Rust core build script
# This is called by Xcode build phases
#
# Usage:
#   ./build-rust-core.sh [--force] [--release|--debug]
#
# The main build script lives at: /core/rust/build.sh

set -e

# Ensure cargo is in PATH (for Xcode build phases)
export PATH="$HOME/.cargo/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

# Script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUST_CORE_DIR="$(cd "$SCRIPT_DIR/../../../../core/rust" && pwd)"

# Parse arguments to pass through
EXTRA_ARGS=""
FORCE_FLAG=""

# Check Xcode environment for configuration
if [ "${CONFIGURATION:-}" = "Debug" ]; then
    EXTRA_ARGS="--fast"
fi

while [[ $# -gt 0 ]]; do
    case $1 in
        --force)
            FORCE_FLAG="--force"
            shift
            ;;
        --release)
            EXTRA_ARGS=""
            shift
            ;;
        --debug)
            EXTRA_ARGS="--fast"
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# Call the main build script with incremental mode
cd "$RUST_CORE_DIR"
exec ./build.sh --ios --incremental $FORCE_FLAG $EXTRA_ARGS
