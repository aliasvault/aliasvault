#!/bin/bash

set -e  # Stop on error
set -u  # Treat unset variables as errors

# Define output targets for vault-types
TARGETS=(
  "../../apps/browser-extension/src/utils/dist/shared/vault-types"
)

# Build and distribute vault-types
package_name="vault-types"
package_path="."

echo "Building $package_name..."
pnpm install && pnpm run lint && pnpm run test && pnpm run build

dist_path="dist"

for target in "${TARGETS[@]}"; do
  echo "Copying $package_name to $target"

  # Remove any existing files in the target directory
  rm -rf "$target"

  # (Re)create the target directory
  mkdir -p "$target"

  # Copy all build outputs (excluding .map files)
  find "$dist_path" -type f ! -name "*.map" -exec sh -c 'mkdir -p "$1/$(dirname ${2#'"$dist_path"'/})" && cp "$2" "$1/${2#'"$dist_path"'/}"' sh "$target" {} \;

  # Write README
  cat > "$target/README.md" <<EOF
# Auto-Generated Files

This folder contains the output of the shared \`$package_name\` module from the \`/shared\` directory in the AliasVault project.

**Do not edit any of these files manually.**

To make changes:
1. Update the source files in the \`/shared/vault-types/src\` directory
2. Run the \`build.sh\` script in the module directory to regenerate the outputs and copy them here.
EOF
done

echo "vault-types build and copy completed."
