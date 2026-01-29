#!/bin/bash

set -e  # Stop on error
set -u  # Treat unset variables as errors

# Define output targets for vault
TARGETS=(
  "../../apps/browser-extension/src/utils/dist/core/vault"
  "../../apps/mobile-app/utils/dist/core/vault"
  "../../apps/server/AliasVault.Client/wwwroot/js/dist/core/vault"
)

# Build and distribute vault
package_name="vault"
package_path="."

echo "📦 Building $package_name..."
npm install && npm run lint && npm run test && npm run build

echo ""
echo "🔄 Generating platform-specific vault SQL (Swift, Kotlin)..."
node scripts/generate-vault-sql.cjs

dist_path="dist"

for target in "${TARGETS[@]}"; do
  echo "📂 Copying $package_name → $target"

  # Remove any existing files in the target directory
  rm -rf "$target"

  # (Re)create the target directory
  mkdir -p "$target"

  # Copy all build outputs (excluding .map files)
  find "$dist_path" -type f ! -name "*.map" -exec sh -c 'mkdir -p "$1/$(dirname ${2#'"$dist_path"'/})" && cp "$2" "$1/${2#'"$dist_path"'/}"' sh "$target" {} \;

  # Write README
  cat > "$target/README.md" <<EOF
# ⚠️ Auto-Generated Files

This folder contains the output of the core \`$package_name\` module from the \`/core\` directory in the AliasVault project.

**Do not edit any of these files manually.**

To make changes:
1. Update the source files in the \`/core/vault/src\` directory
2. Run the \`build.sh\` script in the module directory to regenerate the outputs and copy them here.
EOF
done

echo "✅ Vault build and copy completed."
