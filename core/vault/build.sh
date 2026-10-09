#!/bin/bash

set -e  # Stop on error
set -u  # Treat unset variables as errors

# Build vault
package_name="vault"

echo "📦 Building $package_name..."
npm install && npm run lint && npm run test && npm run build

echo ""
echo "🔄 Generating the vault schema for the Rust core..."
node scripts/generate-vault-sql.cjs

echo "✅ Vault build completed."
