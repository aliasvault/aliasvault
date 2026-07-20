#!/bin/bash

set -e  # Stop on error
set -u  # Treat unset variables as errors

# Define output targets for models
TARGETS=(
  "../../apps/browser-extension/src/utils/dist/core/models"
  "../../apps/mobile-app/utils/dist/core/models"
)

# Build and distribute models
package_name="models"
package_path="."

echo "📦 Building $package_name..."
npm install

echo ""
echo "🔄 Generating vault data bucket categories (C#, TS, Swift, Kotlin) from Rust source..."
# Run before the build so the generated TS lands in src/ and is compiled into dist/ (and linted).
node scripts/generate-bucket-categories.cjs

npm run lint && npm run test && npm run build

echo ""
echo "🔄 Generating platform-specific models (C#, Swift, Kotlin)..."
node scripts/generate-field-keys.cjs

echo "🔄 Generating password-generator defaults (Rust, C#)..."
node scripts/generate-password-defaults.cjs

echo "🔄 Generating language reference (C#)..."
node scripts/generate-languages.cjs

dist_path="dist"
files_to_copy=("webapi" "vault" "defaults" "metadata" "icons")

for target in "${TARGETS[@]}"; do
  echo "📂 Copying $package_name → $target"

  # Remove any existing files in the target directory
  rm -rf "$target"

  # (Re)create the target directory
  mkdir -p "$target"

  # Copy specific build outputs (files and folders)
  for file in "${files_to_copy[@]}"; do
    cp -R "$dist_path/$file" "$target/"
  done

  # Write README
  cat > "$target/README.md" <<EOF
# ⚠️ Auto-Generated Files

This folder contains the output of the core \`$package_name\` module from the \`/core\` directory in the AliasVault project.

**Do not edit any of these files manually.**

To make changes:
1. Update the source files in the \`/core/models/src\` directory
2. Run the \`build.sh\` script in the module directory to regenerate the outputs and copy them here.
EOF
done

echo "✅ Models build and copy completed."