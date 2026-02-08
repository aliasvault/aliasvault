#!/bin/bash

set -e  # Stop on error
set -u  # Treat unset variables as errors

# Define output targets for vault-sync
TARGETS=(
  "../../apps/browser-extension/src/utils/dist/shared/vault-sync"
)

# Build and distribute vault-sync
package_name="vault-sync"
package_path="."

echo "📦 Building $package_name..."
pnpm install && pnpm run lint && pnpm run test && pnpm run build

dist_path="dist"
files_to_copy=("index.js" "index.mjs" "index.d.ts")

for target in "${TARGETS[@]}"; do
  echo "📂 Copying $package_name → $target"

  # Remove any existing files in the target directory
  rm -rf "$target"

  # (Re)create the target directory
  mkdir -p "$target"

  # Copy specific build outputs
  for file in "${files_to_copy[@]}"; do
    if [ -f "$dist_path/$file" ]; then
      cp "$dist_path/$file" "$target/"
    fi
  done

  # Write README
  cat > "$target/README.md" <<EOF
# ⚠️ Auto-Generated Files

This folder contains the output of the shared \`$package_name\` module from the \`/shared\` directory in the AliasVault project.

**Do not edit any of these files manually.**

To make changes:
1. Update the source files in the \`/shared/vault-sync/src\` directory
2. Run the \`build.sh\` script in the module directory to regenerate the outputs and copy them here.
EOF
done

echo "✅ Vault sync build and copy completed."
