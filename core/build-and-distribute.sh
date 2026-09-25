#!/bin/bash

set -e  # Stop on error
set -u  # Treat unset variables as errors

# Build mode selection
BUILD_ALL=false
BROWSER_TARGET=""  # "web" or "browser-extension": both write core/client/wasm, so one per run
BUILD_IOS=false
BUILD_ANDROID=false
BUILD_COMMON=true  # Always build TypeScript utils, models, and vault

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --web|--browser-extension)
            if [ -n "$BROWSER_TARGET" ] && [ "$BROWSER_TARGET" != "${1#--}" ]; then
                echo "Error: --web and --browser-extension share one output directory, build one at a time"
                exit 1
            fi
            BROWSER_TARGET="${1#--}"
            shift
            ;;
        --browser)
            echo "Error: --browser was split into --web (size-optimized) and --browser-extension (speed-optimized)"
            exit 1
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
            BROWSER_TARGET="${BROWSER_TARGET:-web}"
            BUILD_ANDROID=true
            # Note: iOS excluded from --all as it requires macOS/Xcode (use --ios explicitly)
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Target options:"
            echo "  --web                Build WASM for the web app and Blazor client (size-optimized)"
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
if [ -z "$BROWSER_TARGET" ] && ! $BUILD_IOS && ! $BUILD_ANDROID; then
    echo "No target specified, building cross-platform targets..."
    BROWSER_TARGET="web"
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
if [ -n "$BROWSER_TARGET" ] || $BUILD_IOS || $BUILD_ANDROID; then
    cd ./rust

    if ! command -v rustc &> /dev/null; then
        echo "❌ ERROR: Rust toolchain is required but not installed"
        echo "   Install Rust from https://rustup.rs"
        echo ""
        echo "   Requested targets require Rust:"
        [ -n "$BROWSER_TARGET" ] && echo "     - Browser/WASM ($BROWSER_TARGET)"
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

    if [ -n "$BROWSER_TARGET" ]; then
        echo "  → Building for Browser/WASM ($BROWSER_TARGET)..."
        ./build.sh --"$BROWSER_TARGET"
    fi

    echo "✅ Rust core built"

    cd ..
fi

echo ""
echo "✅ All builds completed successfully."
