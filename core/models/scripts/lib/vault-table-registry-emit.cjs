/**
 * Emitters for the vault table registry (core/models/src/vault/VaultTableRegistry.ts).
 */

'use strict';

const TS_SOURCE_REL = 'core/models/src/vault/VaultTableRegistry.ts';
const GENERATOR_REL = 'core/models/scripts/generate-vault-table-registry.cjs';

/** Render a JS string array as a Rust `&["a", "b"]` slice literal. */
function rustStrSlice(values) {
  return `&[${values.map((v) => `"${v}"`).join(', ')}]`;
}

/** PascalCase/camelCase to SCREAMING_SNAKE_CASE (FieldDefinitionId to FIELD_DEFINITION_ID). */
function toScreamingSnakeCase(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

/** Basic sanity checks on the registry module before emitting anything. */
function validateRegistry(registry) {
  const tables = registry.VAULT_TABLES;
  if (!Array.isArray(tables) || tables.length === 0) {
    throw new Error(`VAULT_TABLES not found or empty in ${TS_SOURCE_REL}. Run 'npm run build' first.`);
  }
  const names = tables.map((t) => t.Name);
  if (new Set(names).size !== names.length) {
    throw new Error('VAULT_TABLES contains duplicate table names.');
  }
  if (names[0] !== 'Items') {
    throw new Error('VAULT_TABLES must list Items first: registry order is merge insert order.');
  }
  for (const table of tables) {
    for (const key of [table.LegacyMergeKey, table.CanonicalMergeKey]) {
      if (key && table.ManifestScoped && key[0] !== registry.VAULT_MANIFEST_ID_COLUMN) {
        throw new Error(`${table.Name}: merge keys of a manifest-scoped table must start with ${registry.VAULT_MANIFEST_ID_COLUMN}.`);
      }
    }
  }
  if (!Array.isArray(registry.MULTI_VALUE_FIELD_KEYS) || registry.MULTI_VALUE_FIELD_KEYS.length === 0) {
    throw new Error('MULTI_VALUE_FIELD_KEYS is empty; expected at least login.url from SystemFieldRegistry.');
  }
  const usedCategories = new Set(tables.filter((t) => t.BucketCategory).map((t) => t.BucketCategory));
  for (const table of tables) {
    if (table.BucketCategory && !registry.VAULT_BUCKET_CATEGORIES.includes(table.BucketCategory)) {
      throw new Error(`${table.Name}: bucket category '${table.BucketCategory}' is not declared in VAULT_BUCKET_CATEGORIES.`);
    }
  }
  for (const category of registry.VAULT_BUCKET_CATEGORIES) {
    if (!usedCategories.has(category)) {
      throw new Error(`VAULT_BUCKET_CATEGORIES declares '${category}' but no table uses it.`);
    }
  }
  if (!Array.isArray(registry.VAULT_COLUMN_NAMES) || registry.VAULT_COLUMN_NAMES.length === 0) {
    throw new Error('VAULT_COLUMN_NAMES not found or empty.');
  }
  const tableNames = new Set(names);
  for (const table of tables) {
    for (const ref of table.ReferencedBy || []) {
      if (!tableNames.has(ref.Table)) {
        throw new Error(`${table.Name}: ReferencedBy names unknown table '${ref.Table}'.`);
      }
    }
  }
  if (!registry.LogoKinds || !registry.LogoKinds.Favicon) {
    throw new Error('LogoKinds not found; the emitter must receive the full vault module namespace.');
  }
  const declaredCategories = Object.values(registry.VaultDataBucketCategory || {}).sort();
  const registryCategories = [...registry.VAULT_BUCKET_CATEGORIES].sort();
  if (JSON.stringify(declaredCategories) !== JSON.stringify(registryCategories)) {
    throw new Error(`VaultDataBucketCategory (${declaredCategories}) and VAULT_BUCKET_CATEGORIES (${registryCategories}) have drifted apart.`);
  }
}

/** Render one VAULT_TABLES entry as a Rust TableConfig builder chain. */
function emitRustTableEntry(table) {
  const calls = [`TableConfig::new("${table.Name}")`];
  if (table.ManifestScoped) {
    calls.push('.manifest_scoped()');
  }
  if (table.ItemChild) {
    calls.push('.item_child()');
  }
  if (table.PrimaryKey.length !== 1 || table.PrimaryKey[0] !== 'Id') {
    calls.push(`.with_primary_key(${rustStrSlice(table.PrimaryKey)})`);
  }
  if (table.LegacyMergeKey) {
    calls.push(`.with_composite_key(${rustStrSlice(table.LegacyMergeKey)})`);
  }
  if (table.CanonicalMergeKey) {
    calls.push(`.with_canonical_key(${rustStrSlice(table.CanonicalMergeKey)})`);
  }

  const singleLine = `    ${calls.join('')},`;
  if (singleLine.length <= 120) {
    return singleLine;
  }
  const lines = [`    ${calls[0]}`];
  for (let i = 1; i < calls.length; i++) {
    lines.push(`        ${calls[i]}${i === calls.length - 1 ? ',' : ''}`);
  }
  return lines.join('\n');
}

/** Emit core/rust/src/vault_model/generated.rs from the registry module. */
function emitRust(registry) {
  validateRegistry(registry);
  const tables = registry.VAULT_TABLES;
  // Bucket tuples grouped by category declaration order: that order, not table order, decides the
  // order buckets are emitted in (bucket_categories() dedups in tuple order).
  const bucketTables = registry.VAULT_BUCKET_CATEGORIES.flatMap((category) =>
    tables.filter((t) => t.BucketCategory === category).map((t) => `("${t.Name}", "${category}")`));
  const blobColumns = tables.filter((t) => t.BlobColumn).map((t) => `("${t.Name}", "${t.BlobColumn.Column}", "${t.BlobColumn.Kind}")`);

  return `//! Generated client vault datamodel registry data.
//!
//! @generated: do NOT edit this file directly. It is generated from
//! ${TS_SOURCE_REL} by ${GENERATOR_REL}.
//! Edit the TypeScript source and run 'core/models/build.sh' to regenerate.

use super::TableConfig;

/// All tables that need LWW merge, in registry order. Order is load-bearing: a merge inserts rows
/// in this order, so child tables must be listed after the table they reference (Items first).
/// Per-table rationale (merge key choices, natural keys) is documented in the TypeScript source.
pub static SYNCABLE_TABLES: &[TableConfig] = &[
${tables.map(emitRustTableEntry).join('\n')}
];

/// List of syncable table names (for clients to know which tables to read).
pub const SYNCABLE_TABLE_NAMES: &[&str] = &[
${tables.map((t) => `    "${t.Name}",`).join('\n')}
];

/// The SQLite columns whose contents are extracted into content-addressed blobs rather than
/// kept inline in the manifest. Tuple form \`(table_name, blob_column, kind_label)\`. The kind label
/// is reported to the server on upload (used for metrics / retention).
pub static BLOB_COLUMNS: &[(&str, &str, &str)] = &[
${blobColumns.map((entry) => `    ${entry},`).join('\n')}
];

/// Tables never serialized into the server-stored manifest: internal SQLite, platform, or EF bookkeeping
/// that is temporary and only used/required during runtime, and therefore should not become part of a persisted manifest.
pub static SKIP_TABLES: &[&str] = &[
${registry.VAULT_SKIP_TABLES.map((t) => `    "${t}",`).join('\n')}
];

/// Tables split out of the manifest into a data bucket, keyed by category, so each bucket syncs on its
/// own server revision without rewriting the manifest. Tuple form \`(table_name, bucket_category)\`;
/// \`category\` mirrors the server \`VaultDataBucketCategory\`. Several tables may share a category to sync together.
pub static BUCKET_TABLES: &[(&str, &str)] = &[
${bucketTables.map((entry) => `    ${entry},`).join('\n')}
];

/// Tables that belong exclusively to the user's own (personal) vault, never to a shared manifest.
/// Deliberately independent of [\`BUCKET_TABLES\`]: a bucketed table is kept out of the manifest blob,
/// which is a different question from which manifests may hold its rows at all.
pub static PERSONAL_TABLES: &[&str] = &[${registry.VAULT_PERSONAL_TABLES.map((t) => `"${t}"`).join(', ')}];

/// System field keys whose field holds multiple values, derived from SystemFieldRegistry
/// (IsMultiValue). A value of such a field owns its row id (two devices each adding a value are
/// adding two different things) and is not derived.
pub static MULTI_VALUE_FIELD_KEYS: &[&str] = ${rustStrSlice(registry.MULTI_VALUE_FIELD_KEYS)};

/// The per-manifest delivery-keypair table. Every manifest carries its own asymmetric keypair(s),
/// stamped with that manifest's id (\`ManifestId\`).
pub const ENCRYPTION_KEYS_TABLE: &str = "${registry.ENCRYPTION_KEYS_TABLE}";

/// The scope column every stamped table carries: the id of the manifest that owns the row.
pub const MANIFEST_ID_COL: &str = "${registry.VAULT_MANIFEST_ID_COLUMN}";

/// Local bookkeeping table materialize writes into the vault DB: one row per manifest this
/// vault is materialized from (\`Id\`, \`Name\`).
pub const MANIFESTS_TABLE: &str = "${registry.MANIFESTS_TABLE}";

/// Client-local SQLite table that carries the codec overflow inside the vault database itself (see
/// \`CodecOverflow\`): materialize writes a single row \`{ Id: OVERFLOW_ROW_ID, Data: <json> }\`, and
/// canonicalize / extract_bucket consume it to build the manifest.
pub const OVERFLOW_TABLE: &str = "${registry.CODEC_OVERFLOW_TABLE}";

/// Fixed sentinel primary key of the single \`OVERFLOW_TABLE\` row (deterministic on purpose:
/// materialize output must not depend on a random source).
pub const OVERFLOW_ROW_ID: &str = "${registry.CODEC_OVERFLOW_ROW_ID}";

/// All zero GUID used for default values which indicate unstamped rows.
pub const UNSTAMPED_SCOPE_SENTINEL: &str = "${registry.UNSTAMPED_SCOPE_SENTINEL}";

/// Rows referenced from inside manifest content: \`(target_table, [(referencing_table, column)])\`.
/// On a manifest split the referenced rows are reference-copied into the destination manifest.
pub static REFERENCED_TABLES: &[(&str, &[(&str, &str)])] = &[
${tables.filter((t) => t.ReferencedBy).map((t) => `    ("${t.Name}", &[${t.ReferencedBy.map((r) => `("${r.Table}", "${r.Column}")`).join(', ')}]),`).join('\n')}
];

/// Default trash retention in days: how long a trashed item survives before the pruner deletes it.
pub const TRASH_RETENTION_DEFAULT_DAYS: u32 = ${registry.TRASH_RETENTION_DEFAULT_DAYS};

/// Table, column, and logo-kind name vocabulary shared by the vault logic, so every module spells
/// them identically. The full column set of each table is deliberately not modeled here: it lives
/// in the SQL schema and is passed to the codec at runtime.
pub mod names {
${tables.map((t) => `    /// The \`${t.Name}\` table.\n    pub const ${toScreamingSnakeCase(t.Name)}_TABLE: &str = "${t.Name}";`).join('\n')}

${registry.VAULT_COLUMN_NAMES.map((c) => `    /// The \`${c}\` column.\n    pub const ${toScreamingSnakeCase(c)}_COL: &str = "${c}";`).join('\n')}

${Object.entries(registry.LogoKinds).map(([key, value]) => `    /// The \`${value}\` logo kind.\n    pub const LOGO_KIND_${toScreamingSnakeCase(key)}: &str = "${value}";`).join('\n')}
}
`;
}

/**
 * Emit the C# registry (AliasClientDb.Models.VaultTableRegistry): the table names, primary keys,
 * manifest scoping and item-child flags, so a unit test can assert the EF model matches the
 * registry. Merge keys are deliberately not emitted; they are Rust merge semantics.
 */
function emitCSharpRegistry(registry) {
  validateRegistry(registry);
  const entries = registry.VAULT_TABLES
    .map((t) => `        new("${t.Name}", new[] { ${t.PrimaryKey.map((c) => `"${c}"`).join(', ')} }, ManifestScoped: ${t.ManifestScoped}, ItemChild: ${t.ItemChild}),`)
    .join('\n');

  return `// <auto-generated />
// This file is auto-generated from ${TS_SOURCE_REL}
// Do not edit this file directly. Run 'core/models/build.sh' (or
// 'node ${GENERATOR_REL}') to regenerate.

#nullable enable

namespace AliasClientDb.Models;

using System.Collections.Generic;

/// <summary>
/// The client vault datamodel registry: one entry per syncable vault table, generated from the
/// TypeScript source of truth shared with the Rust codec. A unit test asserts the EF model
/// matches this registry, so a datamodel change that skips one of the encodings fails loudly.
/// </summary>
public static class VaultTableRegistry
{
    /// <summary>
    /// Gets all syncable client vault tables, in registry order.
    /// </summary>
    public static IReadOnlyList<VaultTableDefinition> Tables { get; } = new VaultTableDefinition[]
    {
${entries}
    };
}

/// <summary>
/// Metadata for one syncable client vault table.
/// </summary>
/// <param name="Name">Table name in the client SQLite database.</param>
/// <param name="PrimaryKey">The columns that name a row within its manifest, excluding ManifestId.</param>
/// <param name="ManifestScoped">True when the table's rows are namespaced per manifest.</param>
/// <param name="ItemChild">True when the table's rows hang off an Item row.</param>
public sealed record VaultTableDefinition(string Name, IReadOnlyList<string> PrimaryKey, bool ManifestScoped, bool ItemChild);
`;
}

const BUCKET_AUTOGEN_NOTE = 'core/models/src/vault/VaultTableRegistry.ts (VAULT_BUCKET_CATEGORIES)';
const BUCKET_REGEN_HINT = "Run 'core/models/build.sh' (or 'node core/models/scripts/generate-vault-table-registry.cjs') to regenerate.";
const BUCKET_DEFAULT_DESCRIPTION = 'A manifest-v1 data bucket category.';

/** Description for a bucket category, falling back to a generic one so a new bucket never breaks generation. */
function describeBucketCategory(registry, category) {
  return (registry.VaultDataBucketCategoryDescriptions || {})[category] || BUCKET_DEFAULT_DESCRIPTION;
}

/** Convert a PascalCase category to camelCase (Swift). */
function toCamelCase(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/**
 * Emit the C# VaultDataBucketCategory enum. Serialized as its string name (JsonStringEnumConverter)
 * and stored as a string in the database, so the numeric backing is cosmetic; ordinals follow
 * declaration order.
 */
function emitBucketCategoryCSharp(registry) {
  validateRegistry(registry);
  const members = registry.VAULT_BUCKET_CATEGORIES
    .map((category, index) => `    /// <summary>${describeBucketCategory(registry, category)}</summary>
    ${category} = ${index},`)
    .join('\n\n');

  return `// <auto-generated />
// This file is auto-generated from ${BUCKET_AUTOGEN_NOTE}.
// Do not edit this file directly. ${BUCKET_REGEN_HINT}

namespace AliasVault.Shared.Models.WebApi.V2.Vault;

using System.Text.Json.Serialization;

/// <summary>
/// Known data-bucket categories for the manifest-v1 storage format. Each value is one small, independently-versioned,
/// user-scoped category of encrypted data kept out of the main vault content manifest so it syncs cheaply.
/// Serialized as its string name on the wire (not the numeric value) and stored as a string in the database.
/// Adding a new kind requires a server-side rollout first, because the server reasons about kinds for
/// per-kind retention policies. The canonical list lives in the vault table registry (core/models).
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum VaultDataBucketCategory
{
${members}
}
`;
}

/** Emit the Swift string-constant struct (mirrors the FieldType.swift convention). */
function emitBucketCategorySwift(registry) {
  validateRegistry(registry);
  const categories = registry.VAULT_BUCKET_CATEGORIES;
  const members = categories
    .map((category) => `    /// ${describeBucketCategory(registry, category)}
    public static let ${toCamelCase(category)} = "${category}"`)
    .join('\n\n');

  return `// <auto-generated />
// This file is auto-generated from ${BUCKET_AUTOGEN_NOTE}.
// Do not edit this file directly. ${BUCKET_REGEN_HINT}

import Foundation

/// Known data-bucket categories for the manifest-v1 storage format.
/// The canonical list lives in the vault table registry (core/models).
public struct VaultDataBucketCategory {
${members}

    /// All known data bucket categories.
    public static let all = [${categories.map(toCamelCase).join(', ')}]
}
`;
}

/** Emit the Kotlin string-constant object (mirrors the FieldType.kt convention). */
function emitBucketCategoryKotlin(registry) {
  validateRegistry(registry);
  const categories = registry.VAULT_BUCKET_CATEGORIES;
  const members = categories
    .map((category) => `    /**
     * ${describeBucketCategory(registry, category)}
     */
    const val ${toScreamingSnakeCase(category)} = "${category}"`)
    .join('\n\n');

  return `// <auto-generated />
// This file is auto-generated from ${BUCKET_AUTOGEN_NOTE}.
// Do not edit this file directly. ${BUCKET_REGEN_HINT}

package net.aliasvault.app.vaultstore.models

/**
 * Known data-bucket categories for the manifest-v1 storage format.
 * The canonical list lives in the vault table registry (core/models).
 */
object VaultDataBucketCategory {
${members}

    /**
     * All known data bucket categories.
     */
    val all = listOf(${categories.map(toScreamingSnakeCase).join(', ')})
}
`;
}

module.exports = { emitRust, emitCSharpRegistry, emitBucketCategoryCSharp, emitBucketCategorySwift, emitBucketCategoryKotlin };
