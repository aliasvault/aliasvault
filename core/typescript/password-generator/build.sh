#!/bin/bash

set -e  # Stop on error
set -u  # Treat unset variables as errors

# Define output targets for password-generator
TARGETS=(
  "../../../apps/browser-extension/src/utils/dist/core/password-generator"
  "../../../apps/mobile-app/utils/dist/core/password-generator"
  "../../../apps/server/AliasVault.Client/wwwroot/js/dist/core/password-generator"
)

# Build and distribute password-generator
package_name="password-generator"
package_path="."

echo "📦 Building $package_name..."
npm install && npm run lint && npm run test && npm run build

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
    cp "$dist_path/$file" "$target/"
  done

  # Write README
  cat > "$target/README.md" <<EOF
# ⚠️ Auto-Generated Files

This folder contains the output of the core \`$package_name\` module from the \`/core\` directory in the AliasVault project.

**Do not edit any of these files manually.**

To make changes:
1. Update the source files in the \`/core/typescript/password-generator/src\` directory
2. Run the \`build.sh\` script in the module directory to regenerate the outputs and copy them here.
EOF
done

echo "✅ Password generator build and copy completed."