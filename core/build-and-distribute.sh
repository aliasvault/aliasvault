#!/bin/bash

set -e  # Stop on error
set -u  # Treat unset variables as errors

# Build mode selection
BUILD_ALL=false
BROWSER_TARGETS=""  # "web" and/or "browser-extension"
BUILD_IOS=false
BUILD_ANDROID=false
BUILD_COMMON=true  # Always build TypeScript utils, models, and vault

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --web|--browser-extension)
            [[ " $BROWSER_TARGETS " == *" ${1#--} "* ]] || BROWSER_TARGETS="$BROWSER_TARGETS ${1#--}"
            shift
            ;;
        --ios)
            BUILD_IOS=true
            shift
            ;;
        --android)
            BUILD_ANDROID=true
            shift
            ;;
        --all)
            BROWSER_TARGETS="${BROWSER_TARGETS:-web}"
            BUILD_ANDROID=true
            # Note: iOS excluded from --all as it requires macOS/Xcode (use --ios explicitly)
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Target options:"
            echo "  --web                Build WASM for the web app (size-optimized)"
            echo "  --browser-extension  Build WASM for the browser extension (speed-optimized)"
            echo "  --ios                Build for iOS with Swift bindings"
            echo "  --android            Build for Android with Kotlin bindings"
            echo "  --all                Build cross-platform targets (web, android)"
            echo ""
            echo "Notes:"
            echo "  - iOS requires macOS/Xcode, use --ios explicitly (not included in --all)"
            echo "  - If no target is specified, cross-platform targets are built"
            echo ""
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# If no targets specified, build cross-platform targets (iOS excluded - requires macOS)
if [ -z "$BROWSER_TARGETS" ] && ! $BUILD_IOS && ! $BUILD_ANDROID; then
    echo "No target specified, building cross-platform targets..."
    BROWSER_TARGETS="web"
    BUILD_ANDROID=true
fi

# Make all build scripts executable
chmod +x ./models/build.sh
chmod +x ./vault/build.sh
chmod +x ./rust/build.sh

echo "🚀 Starting build process for selected modules..."
echo ""

# Always build common components (TypeScript models, vault)
if $BUILD_COMMON; then
    echo "📦 Building common components..."

    # Models (TypeScript source of truth -> generates C#, Swift, Kotlin)
    cd ./models
    ./build.sh

    # Vault database schema & SQL utilities
    cd ../vault
    ./build.sh

    cd ..
    echo "✅ Common components built"
    echo ""
fi

# Rust core build (required when any platform target is specified)
if [ -n "$BROWSER_TARGETS" ] || $BUILD_IOS || $BUILD_ANDROID; then
    cd ./rust

    if ! command -v rustc &> /dev/null; then
        echo "❌ ERROR: Rust toolchain is required but not installed"
        echo "   Install Rust from https://rustup.rs"
        echo ""
        echo "   Requested targets require Rust:"
        [ -n "$BROWSER_TARGETS" ] && echo "     - Browser/WASM ($(echo $BROWSER_TARGETS))"
        $BUILD_IOS && echo "     - iOS"
        $BUILD_ANDROID && echo "     - Android"
        exit 1
    fi

    echo "📦 Building Rust core..."

    if $BUILD_ANDROID; then
        echo "  → Building for Android..."
        ./build.sh --android
    fi

    if $BUILD_IOS; then
        echo "  → Building for iOS..."
        ./build.sh --ios
    fi

    for browser_target in $BROWSER_TARGETS; do
        echo "  → Building for Browser/WASM ($browser_target)..."
        ./build.sh --"$browser_target"
    done

    echo "✅ Rust core built"

    cd ..
fi

echo ""
echo "✅ All builds completed successfully."
