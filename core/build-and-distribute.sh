#!/bin/bash

set -e  # Stop on error
set -u  # Treat unset variables as errors

# Make all build scripts executable
chmod +x ./typescript/identity-generator/build.sh
chmod +x ./typescript/password-generator/build.sh
chmod +x ./models/build.sh
chmod +x ./vault/build.sh
chmod +x ./rust/build.sh

# Run all build scripts
echo "🚀 Starting build process for all modules..."

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

# Rust core build (optional - requires Rust toolchain)
cd ../rust
if command -v rustc &> /dev/null; then
    echo "📦 Building rust core (Rust toolchain detected)..."
    ./build.sh --browser
else
    echo "⚠️  Skipping rust core build (Rust not installed)"
    echo "   Install Rust from https://rustup.rs to enable Rust core builds"
fi

echo "✅ All builds completed successfully."
