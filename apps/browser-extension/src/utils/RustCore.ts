/**
 * Typed wrapper around the AliasVault Rust core (shared with iOS, Android,
 * and the Blazor client). The browser ships the core as WebAssembly; that
 * detail is encapsulated here so callers can think in terms of plain
 * TypeScript functions.
 *
 * Algorithms (URL matching, credential filtering, domain extraction) live in
 * `core/rust/src/credential_matcher`. This file only handles init and
 * adapts inputs/outputs to TypeScript types.
 */
import { browser } from 'wxt/browser';

import { resolveDefaultLanguage } from '@/utils/dist/core/models/defaults';
import type { Item, PasswordSettings } from '@/utils/dist/core/models/vault';
import { FieldKey } from '@/utils/dist/core/models/vault';
import initWasm, * as core from '@/utils/dist/core/rust/aliasvault_core.js';

export enum AutofillMatchingMode {
  DEFAULT = 'default',
  URL_EXACT = 'url_exact',
  URL_SUBDOMAIN = 'url_subdomain'
}

let initPromise: Promise<void> | null = null;

/**
 * Initialize the Rust core. Safe to call multiple times — subsequent calls
 * return the same in-flight promise. Callers that want to pay the WASM load
 * cost up front (e.g. background startup) can `await initRustCore()` once;
 * everything else lazily inits on first use.
 */
export function initRustCore(): Promise<void> {
  if (!initPromise) {
    initPromise = (async (): Promise<void> => {
      const wasmUrl = (browser.runtime.getURL as (path: string) => string)('src/aliasvault_core_bg.wasm');
      const wasmBytes = await (await fetch(wasmUrl)).arrayBuffer();
      await initWasm({ module_or_path: wasmBytes });
    })();
  }
  return initPromise;
}

/**
 * Extract the host (subdomain + domain) from a URL.
 * Example: `https://www.example.com/path` > `example.com`.
 * Returns empty string for inputs the Rust extractor rejects, e.g.
 * reversed-TLD app bundle identifiers like `com.example.app`.
 */
export async function extractDomain(url: string): Promise<string> {
  await initRustCore();
  return core.extractDomain(url);
}

/**
 * Extract the root domain.
 * Example: `sub.example.co.uk` > `example.co.uk`.
 */
export async function extractRootDomain(domain: string): Promise<string> {
  await initRustCore();
  return core.extractRootDomain(domain);
}

/**
 * Generate a password or passphrase from the given settings.
 *
 * The `Type` field selects the generator: `'basic'` (character-set password)
 * or `'diceware'` (wordlist passphrase). Generation runs in the Rust core.
 *
 * Seed is an optional 64-character hex string (32 bytes) that seeds the RNG for deterministic generation
 * primarily for UI comparison purposes. All normal password generation is non-deterministic.
 */
export async function generatePassword(settings: PasswordSettings, seed?: string): Promise<string> {
  await initRustCore();
  const effective = await applyEffectiveDicewareLanguage(settings);
  const payload = seed ? { ...effective, Seed: seed } : effective;
  return core.generatePassword(JSON.stringify(payload));
}

/**
 * Resolve the effective Diceware passphrase language when none is explicitly chosen.
 *
 * The passphrase language is left empty by default ("auto").
 */
async function applyEffectiveDicewareLanguage(settings: PasswordSettings): Promise<PasswordSettings> {
  if (settings.Type !== 'diceware' || (settings.Language && settings.Language.trim().length > 0)) {
    return settings;
  }
  const codes = await getDicewareLanguages();
  return { ...settings, Language: resolveDefaultLanguage(navigator.language, codes) };
}

/**
 * Get the list of bundled Diceware wordlist language ISO codes (first is the default, 'en').
 * The set is owned by the Rust core; unknown codes fall back to English during generation.
 */
export async function getDicewareLanguages(): Promise<string[]> {
  await initRustCore();
  const languages = core.getDicewareLanguages() as string[];
  return languages.length > 0 ? languages : ['en'];
}

/**
 * Generate a random 32-byte seed as a 64-character hex string, suitable for the
 * `seed` argument of {@link generatePassword}.
 */
export function generateSeed(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Filter items by URL/title for autofill. Returns at most 3 matches.
 */
export async function filterItems(
  items: Item[],
  currentUrl: string,
  pageTitle: string,
  matchingMode: AutofillMatchingMode = AutofillMatchingMode.DEFAULT
): Promise<Item[]> {
  await initRustCore();

  const credentials = items.map(item => ({
    Id: item.Id,
    ItemName: item.Name ?? '',
    ItemUrls: getFieldValues(item, FieldKey.LoginUrl)
  }));

  const result = core.filterCredentials({
    credentials,
    current_url: currentUrl,
    page_title: pageTitle,
    matching_mode: matchingMode
  }) as { matched_ids: string[] };

  return result.matched_ids
    .map(id => items.find(item => item.Id === id))
    .filter((item): item is Item => item !== undefined);
}

/**
 * True if `newUrl` is already represented in `existingUrls` under
 * host-only comparison (scheme, `www.`, path, query, fragment, trailing
 * slash all ignored). Falls back to lowercased exact-match when the Rust
 * extractor returns no domain (app bundle identifiers).
 *
 * Performs one async init, then a synchronous loop — Rust core calls are
 * sync once WASM is loaded.
 */
export async function isUrlAlreadyLinked(existingUrls: string[], newUrl: string): Promise<boolean> {
  await initRustCore();
  const newKey = urlComparisonKey(newUrl);
  if (!newKey) {
    return false;
  }
  return existingUrls.some(existing => urlComparisonKey(existing) === newKey);
}

/**
 * Synchronous host-only comparison key. Caller must ensure `initRustCore()`
 * has resolved before calling. Exposed as a sync helper for tight loops
 * (see `isUrlAlreadyLinked`); async callers should use `extractDomain`.
 */
function urlComparisonKey(url: string): string {
  const trimmed = url.trim().toLowerCase();
  if (!trimmed) {
    return trimmed;
  }
  const domain = core.extractDomain(trimmed);
  return domain.length > 0 ? domain : trimmed;
}

/*
 * Vault codec (manifest-v1 storage format).
 *
 * The format logic (canonicalize/materialize, canonical hash + integrity envelope, gzip pack/unpack,
 * structural validation, blob diff) lives in `core/rust/src/vault_codec`. These wrappers adapt the
 * WASM exports to TypeScript types.
 */

/** A single table's rows (byte columns rendered as `{ __b64 }`). */
export type CodecTableData = { name: string; records: Array<Record<string, unknown>> };

/** Manifest-v1 manifest. Forward-compat: unknown keys are preserved on round-trip. */
export type CodecManifest = {
  schemaVersion: number;
  migrationId: string;
  version: string;
  userSalt: string;
  canonicalizedAt: string;
  /** Set on a shared-folder manifest: the Folders.Id this manifest carries. Absent on a root manifest. */
  sharedFolderId?: string | null;
  tables: Record<string, Array<Record<string, unknown>>>;
  [key: string]: unknown;
};

/** One shared folder to split out during canonicalize: the folder id + that manifest's own blob salt. */
export type CodecSharedFolderSpec = { folderId: string; userSalt: string };

/** One shared-folder manifest produced by the canonicalize split, with its own blob map. */
export type CodecSharedVault = { folderId: string; manifest: CodecManifest; blobs: Record<string, CodecBlobEntry> };

/**
 * A manifest-v1 data bucket.
 */
export type CodecDataBucket = {
  schemaVersion: number;
  category: string;
  tables: Record<string, Array<Record<string, unknown>>>;
  [key: string]: unknown;
};

/** A decoded blob entry: kind + plaintext bytes (base64). */
export type CodecBlobEntry = { kind: string; bytesBase64: string };

/** Result of canonicalize: root manifest + data buckets + blob map + optional shared vaults. */
export type CodecCanonicalized = {
  manifest: CodecManifest;
  dataBuckets: CodecDataBucket[];
  blobs: Record<string, CodecBlobEntry>;
  sharedVaults?: CodecSharedVault[];
};

/**
 * Data a newer writer put in the manifest that this client's local SQLite schema cannot hold:
 * whole unknown manifest tables, whole unknown bucket tables (per category), and unknown columns
 * keyed by table > row primary-key value. Materialize carries it INSIDE the vault DB as a regular
 * `CodecOverflows` table row, and canonicalize/extractBucket consume that row from the ordinary
 * table read — so a push never drops the data and no separate persistence is needed. This type only
 * describes the diagnostics copy on `CodecMaterialized` (used for logging).
 */
export type CodecOverflow = {
  tables: Record<string, Array<Record<string, unknown>>>;
  bucketTables: Record<string, Record<string, Array<Record<string, unknown>>>>;
  columns: Record<string, Record<string, Record<string, unknown>>>;
};

/** Input for canonicalize. */
export type CodecCanonicalizeInput = {
  tables: CodecTableData[];
  userSalt: string;
  migrationId: string;
  version: string;
  sharedFolders?: CodecSharedFolderSpec[];
  canonicalizedAt: string;
};

/** Materialized tables the platform inserts into a fresh SQLite DB (`overflow` is a diagnostics copy). */
export type CodecMaterialized = { tables: CodecTableData[]; migrationId: string; overflow: CodecOverflow };

/** One entry in the bucket layout: a category and the tables it owns. */
export type CodecBucketLayoutEntry = { category: string; tables: string[] };

/** Structural validation outcome. */
export type CodecValidation = { ok: boolean; failedRules: string[]; message: string };

/**
 * Canonicalize normalized tables into manifest + data buckets + blob map.
 */
export async function vaultCodecCanonicalizeFromSqlite(input: CodecCanonicalizeInput): Promise<CodecCanonicalized> {
  await initRustCore();
  return core.vaultCodecCanonicalizeFromSqlite(input) as CodecCanonicalized;
}

/**
 * Materialize the manifest + its data buckets into the table set the platform inserts.
 * `schemaColumns` (table > column names of the local schema) makes Rust split anything the schema
 * can't hold into the `CodecOverflows` carrier row (included in the returned tables) instead of
 * emitting it, so unknown newer-client data survives the round trip inside the vault DB itself.
 */
export async function vaultCodecMaterializeAsSqlite(manifest: CodecManifest, dataBuckets: CodecDataBucket[], schemaColumns?: Record<string, string[]>, sharedManifests?: CodecManifest[]): Promise<CodecMaterialized> {
  await initRustCore();
  return core.vaultCodecMaterializeAsSqlite({ manifest, dataBuckets, schemaColumns, sharedManifests }) as CodecMaterialized;
}

/**
 * Extract the primary encryption-key row (the user's asymmetric keypair) from the decrypted
 * `EncryptionKeys` data bucket — the small, independently-decryptable bucket the keypair now lives in.
 * Used to unwrap shared-folder VEKs during pull without materializing the full root manifest.
 * Returns null when the bucket carries no primary key.
 */
export async function vaultCodecExtractPrimaryEncryptionKeyFromBucket(bucket: CodecDataBucket): Promise<Record<string, unknown> | null> {
  await initRustCore();
  return (core.vaultCodecExtractPrimaryEncryptionKeyFromBucket(bucket) ?? null) as Record<string, unknown> | null;
}

/**
 * Build a single data bucket for `category` from its tables (bucket-only push path). Include the
 * `CodecOverflows` table (see {@link vaultCodecOverflowTable}) in `tables` so a newer writer's
 * columns/tables re-merge and survive; it is consumed and never emitted into the bucket.
 */
export async function vaultCodecExtractBucket(category: string, tables: Record<string, Array<Record<string, unknown>>>): Promise<CodecDataBucket> {
  await initRustCore();
  return core.vaultCodecExtractBucket({ category, tables }) as CodecDataBucket;
}

/**
 * The name of the client-local SQLite table that carries the codec overflow inside the vault DB.
 */
export async function vaultCodecOverflowTable(): Promise<string> {
  await initRustCore();
  return core.vaultCodecOverflowTable();
}

/**
 * The bucket layout: every category and the tables it owns.
 */
export async function vaultCodecBucketLayout(): Promise<CodecBucketLayoutEntry[]> {
  await initRustCore();
  return core.vaultCodecBucketLayout() as CodecBucketLayoutEntry[];
}

/**
 * Generate a fresh 32-byte per-user salt (lowercase hex).
 */
export async function vaultCodecGenerateUserSalt(): Promise<string> {
  await initRustCore();
  return core.vaultCodecGenerateUserSalt();
}

/**
 * Pack a payload JSON string into gzip(envelope{contentHash, payload}). The caller encrypts the result.
 */
export async function vaultCodecPackPayload(payloadJson: string): Promise<Uint8Array> {
  await initRustCore();
  return core.vaultCodecPackPayload(payloadJson);
}

/**
 * Unpack a (decrypted) payload: gunzip > verify content hash > return the payload JSON string.
 */
export async function vaultCodecUnpackPayload(plainBytes: Uint8Array): Promise<string> {
  await initRustCore();
  return core.vaultCodecUnpackPayload(plainBytes);
}

/**
 * Structurally validate a manifest before upload.
 */
export async function vaultCodecValidateManifest(manifest: CodecManifest): Promise<CodecValidation> {
  await initRustCore();
  return core.vaultCodecValidateManifest(manifest) as CodecValidation;
}

/**
 * Validate a data bucket before upload.
 */
export async function vaultCodecValidateDataBucket(bucket: CodecDataBucket): Promise<CodecValidation> {
  await initRustCore();
  return core.vaultCodecValidateDataBucket(bucket) as CodecValidation;
}

/**
 * SHA-256 (lowercase hex) of a base64 ciphertext string.
 */
export async function vaultCodecComputeCiphertextHash(base64Ciphertext: string): Promise<string> {
  await initRustCore();
  return core.vaultCodecComputeCiphertextHash(base64Ciphertext);
}

/**
 * Read all non-empty values for a field key from an item, returning them as
 * a string array (single-value fields are wrapped to a 1-element array).
 */
function getFieldValues(item: Item, fieldKey: string): string[] {
  const field = item.Fields?.find(f => f.FieldKey === fieldKey);
  if (!field) {
    return [];
  }
  if (Array.isArray(field.Value)) {
    return field.Value.filter(v => v && v.length > 0);
  }
  return field.Value ? [field.Value] : [];
}
