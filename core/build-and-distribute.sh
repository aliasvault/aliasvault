#!/bin/bash

set -e  # Stop on error
set -u  # Treat unset variables as errors

# Build mode selection
BUILD_ALL=false
BUILD_BROWSER=false
BUILD_DOTNET=false
BUILD_ANDROID=false
BUILD_COMMON=true  # Always build TypeScript utils, models, and vault

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --browser)
            BUILD_BROWSER=true
            shift
            ;;
        --dotnet)
            BUILD_DOTNET=true
            shift
            ;;
        --android)
            BUILD_ANDROID=true
            shift
            ;;
        --all)
            BUILD_BROWSER=true
            BUILD_DOTNET=true
            BUILD_ANDROID=true
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Target options:"
            echo "  --browser     Build WASM for browser extension and Blazor WASM client"
            echo "  --dotnet      Build native library for .NET server-side use"
            echo "  --android     Build for Android with Kotlin bindings"
            echo "  --all         Build all targets (browser, dotnet, android)"
            echo ""
            echo "Notes:"
            echo "  - TypeScript utilities, models, and vault are always built"
            echo "  - iOS builds are handled by Xcode build phases, not this script"
            echo "  - If no target is specified, all targets are built"
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

# If no targets specified, build all
if ! $BUILD_BROWSER && ! $BUILD_DOTNET && ! $BUILD_ANDROID; then
    echo "No target specified, building all targets..."
    BUILD_BROWSER=true
    BUILD_DOTNET=true
    BUILD_ANDROID=true
fi

# Make all build scripts executable
chmod +x ./typescript/identity-generator/build.sh
chmod +x ./typescript/password-generator/build.sh
chmod +x ./models/build.sh
chmod +x ./vault/build.sh
chmod +x ./rust/build.sh

echo "🚀 Starting build process for selected modules..."
echo ""

# Always build common components (TypeScript utilities, models, vault)
if $BUILD_COMMON; then
    echo "📦 Building common components..."

    # TypeScript packages (legacy - to be migrated to Rust)
    cd ./typescript/identity-generator
    ./build.sh

    cd ../password-generator
    ./build.sh

    # Models (TypeScript source of truth -> generates C#, Swift, Kotlin)
    cd ../../models
    ./build.sh

    # Vault database schema & SQL utilities
    cd ../vault
    ./build.sh

    cd ..
    echo "✅ Common components built"
    echo ""
fi

# Rust core build (optional - requires Rust toolchain)
if $BUILD_BROWSER || $BUILD_DOTNET || $BUILD_ANDROID; then
    cd ./rust

    if command -v rustc &> /dev/null; then
        echo "📦 Building Rust core..."

        if $BUILD_ANDROID; then
            echo "  → Building for Android..."
            ./build.sh --android
        fi

        if $BUILD_BROWSER; then
            echo "  → Building for Browser/WASM..."
            ./build.sh --browser
        fi

        if $BUILD_DOTNET; then
            echo "  → Building for .NET..."
            ./build.sh --dotnet
        fi

        echo "✅ Rust core built"
    else
        echo "⚠️  Skipping Rust core build (Rust not installed)"
        echo "   Install Rust from https://rustup.rs to enable Rust core builds"
    fi

    cd ..
fi

echo ""
echo "✅ All builds completed successfully."
