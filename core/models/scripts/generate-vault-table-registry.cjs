#!/usr/bin/env node
/**
 * Generates the vault datamodel registry outputs from the TypeScript source of truth.
 *
 * Input: core/models/src/vault/VaultTableRegistry.ts (compiled to dist/vault/index.js)
 * Outputs:
 *   - core/rust/src/vault_model/generated.rs (Rust registry data)
 *   - apps/server/Shared/AliasVault.Shared/Models/WebApi/V2/Vault/VaultDataBucketCategory.cs
 *   - apps/mobile-app/ios/VaultModels/VaultDataBucketCategory.swift
 *   - apps/mobile-app/android/.../vaultstore/models/VaultDataBucketCategory.kt
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { emitRust, emitCSharpRegistry, emitBucketCategoryCSharp, emitBucketCategorySwift, emitBucketCategoryKotlin } = require('./lib/vault-table-registry-emit.cjs');

const REPO_ROOT = path.join(__dirname, '../../..');
const DIST_ENTRY = path.join(__dirname, '../dist/vault/index.js');
const RUST_OUTPUT = path.join(REPO_ROOT, 'core/rust/src/vault_model/generated.rs');
const CS_REGISTRY_OUTPUT = path.join(REPO_ROOT, 'apps/server/Databases/AliasClientDb/Models/VaultTableRegistry.cs');
const BUCKET_CS_OUTPUT = path.join(REPO_ROOT, 'apps/server/Shared/AliasVault.Shared/Models/WebApi/V2/Vault/VaultDataBucketCategory.cs');
const BUCKET_SWIFT_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/ios/VaultModels/VaultDataBucketCategory.swift');
const BUCKET_KOTLIN_OUTPUT = path.join(REPO_ROOT, 'apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/models/VaultDataBucketCategory.kt');

function writeIfChanged(filePath, contents) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  if (existing === contents) {
    console.log(`  ✓ up to date: ${path.relative(REPO_ROOT, filePath)}`);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  console.log(`  ✎ wrote:      ${path.relative(REPO_ROOT, filePath)}`);
}

async function main() {
  // The dist bundle is ESM, so load it via dynamic import.
  const registry = await import(pathToFileURL(DIST_ENTRY).href);

  console.log('Generating vault table registry:');
  console.log(`  tables: ${registry.VAULT_TABLES.map((t) => t.Name).join(', ')}`);
  console.log(`  multi-value field keys: ${registry.MULTI_VALUE_FIELD_KEYS.join(', ')}`);

  writeIfChanged(RUST_OUTPUT, emitRust(registry));
  writeIfChanged(CS_REGISTRY_OUTPUT, emitCSharpRegistry(registry));
  writeIfChanged(BUCKET_CS_OUTPUT, emitBucketCategoryCSharp(registry));
  writeIfChanged(BUCKET_SWIFT_OUTPUT, emitBucketCategorySwift(registry));
  writeIfChanged(BUCKET_KOTLIN_OUTPUT, emitBucketCategoryKotlin(registry));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
