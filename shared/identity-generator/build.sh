#!/bin/bash

set -e  # Stop on error
set -u  # Treat unset variables as errors

# Define output targets for identity-generator
TARGETS=(
  "../../apps/browser-extension/src/utils/dist/shared/identity-generator"
  "../../apps/mobile-app/utils/dist/shared/identity-generator"
  "../../apps/server/AliasVault.Client/wwwroot/js/dist/shared/identity-generator"
)

# Build and distribute identity-generator
package_name="identity-generator"
package_path="."

echo "📦 Building $package_name..."
npm install && npm run lint && npm run test && npm run build

dist_path="dist"
files_to_copy=("index.js" "index.mjs" "index.d.ts" "index.js.map" "index.mjs" "index.mjs.map")

for target in "${TARGETS[@]}"; do
  echo "📂 Copying $package_name → $target"
  mkdir -p "$target"

  # Remove any existing files in the target directory
  rm -rf "$target/*"

  # Copy specific build outputs
  for file in "${files_to_copy[@]}"; do
    cp "$dist_path/$file" "$target/"
  done

  # Write README
  cat > "$target/README.md" <<EOF
# ⚠️ Auto-Generated Files

This folder contains the output of the shared \`$package_name\` module from the \`/shared\` directory in the AliasVault project.

**Do not edit any of these files manually.**

To make changes:
1. Update the source files in the \`/shared/identity-generator/src\` directory
2. Run the \`build.sh\` script in the module directory to regenerate the outputs and copy them here.
EOF
done

echo "✅ Identity generator build and copy completed."