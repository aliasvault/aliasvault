#!/bin/bash

set -e  # Stop on error
set -u  # Treat unset variables as errors

# Build and distribute models
package_name="models"
package_path="."

echo "- Building $package_name..."
npm install

echo ""
echo "- Generating vault key vocabulary (C#, TS, Swift, Kotlin)..."
node scripts/generate-key-vocabulary.cjs

npm run lint && npm run build

echo ""
echo "- Generating vault table registry (Rust) and bucket categories (C#, Swift, Kotlin)..."
node scripts/generate-vault-table-registry.cjs

npm run test

echo ""
echo "- Generating platform-specific models (Swift, Kotlin)..."
node scripts/generate-field-keys.cjs

echo "- Generating icon catalogs (TS, C#, Swift, Kotlin, React Native)..."
node scripts/generate-icons.cjs

echo "- Generating color palette (TS, Tailwind, Swift, Android)..."
node scripts/generate-colors.cjs

echo "- Generating password-generator defaults (Rust)..."
node scripts/generate-password-defaults.cjs

echo "- Generating app defaults (Swift, Kotlin)..."
node scripts/generate-app-defaults.cjs

echo "Models build completed. TypeScript clients link this package as source (@aliasvault/models)."
