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
import type { Identity } from '@/utils/dist/core/models/identity';
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
 * Request for {@link generateIdentity}. All fields except `language` are optional.
 */
export type IdentityRequest = {
  /** Dictionary language code (e.g. 'en'); unknown codes fall back to English. */
  language: string;
  /** Gender preference: 'male', 'female' or 'random' (default). */
  gender?: string;
  /** Age range preference as stored in settings (e.g. '21-25' or 'random'). */
  ageRange?: string;
};

/**
 * Name and birth date input for identity-based username/email prefix generation.
 */
export type IdentityNameInput = {
  firstName: string;
  lastName: string;
  /** Birth date; only the leading yyyy year part is used. */
  birthDate: string;
};

/**
 * Generate a random identity (alias persona) in the Rust core.
 * Returns the identity with a yyyy-MM-dd birth date string.
 */
export async function generateIdentity(request: IdentityRequest): Promise<Identity> {
  await initRustCore();
  return JSON.parse(core.generateIdentity(JSON.stringify(request))) as Identity;
}

/**
 * Generate a username from persona name fields (alphanumeric, 6-20 characters).
 */
export async function generateIdentityUsername(input: IdentityNameInput): Promise<string> {
  await initRustCore();
  return core.generateIdentityUsername(JSON.stringify(input));
}

/**
 * Generate an email prefix from persona name fields (6-20 characters).
 */
export async function generateIdentityEmailPrefix(input: IdentityNameInput): Promise<string> {
  await initRustCore();
  return core.generateIdentityEmailPrefix(JSON.stringify(input));
}

/**
 * Generate a random alphanumeric email prefix that is not based on any identity.
 * Used for login-type credentials where no persona fields are available.
 */
export async function generateRandomEmailPrefix(length: number = 14): Promise<string> {
  await initRustCore();
  return core.generateRandomEmailPrefix(length);
}

/**
 * Get the list of bundled identity dictionary language ISO codes.
 * The set is owned by the Rust core; unknown codes fall back to English during generation.
 */
export async function getIdentityLanguages(): Promise<string[]> {
  await initRustCore();
  const languages = core.getIdentityLanguages() as string[];
  return languages.length > 0 ? languages : ['en'];
}

/**
 * Get the list of identity age range option values ('random' plus 5-year ranges).
 */
export async function getIdentityAgeRanges(): Promise<string[]> {
  await initRustCore();
  return core.getIdentityAgeRanges() as string[];
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
  /** Latest EF migration ID; readers derive the data-model version label from it. */
  migrationId: string;
  userSalt: string;
  canonicalizedAt: string;
  manifestId: string;
  anchorFolderId?: string | null;
  tables: Record<string, Array<Record<string, unknown>>>;
  [key: string]: unknown;
};

/** One shared manifest to split out during canonicalize: its manifest id, anchor folder id, and that manifest's own blob salt. */
export type CodecSharedManifestSpec = { manifestId: string; anchorFolderId: string; userSalt: string };

/** One manifest of a materialize input. */
export type CodecManifestEntry = { manifest: CodecManifest; isRoot: boolean };

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

/**
 * One manifest produced by canonicaliz.
 */
export type CodecCanonicalizedManifest = CodecManifestEntry & { blobs: Record<string, CodecBlobEntry> };

/**
 * Result of canonicalize.
 */
export type CodecCanonicalized = {
  manifests: CodecCanonicalizedManifest[];
  dataBuckets: CodecDataBucket[];
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
  rootManifestId: string;
  sharedManifests?: CodecSharedManifestSpec[];
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
 * Materialize the vault's manifests + data buckets into the table set the platform inserts.
 */
export async function vaultCodecMaterializeAsSqlite(manifests: CodecManifestEntry[], dataBuckets: CodecDataBucket[], schemaColumns: Record<string, string[]>): Promise<CodecMaterialized> {
  await initRustCore();
  return core.vaultCodecMaterializeAsSqlite({ manifests, dataBuckets, schemaColumns }) as CodecMaterialized;
}

/**
 * Extract the encryption-key row whose `PublicKey` matches `publicKey` from a decrypted manifest.
 */
export async function vaultCodecExtractEncryptionKeyForPublicKey(manifest: CodecManifest, publicKey: string): Promise<Record<string, unknown> | null> {
  await initRustCore();
  return (core.vaultCodecExtractEncryptionKeyForPublicKey(manifest, publicKey) ?? null) as Record<string, unknown> | null;
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
 * The `Logos.Id` to use for a source domain inside the manifest with id `manifestId` (pass the root
 * manifest's own id for personal logos).
 *
 * Logo identity is derived: two devices that fetch the same favicon independently produce
 * the same row and merge by LWW. The same domain in two different manifests deliberately yields
 * two different ids, so a shared manifest's logo and the user's own logo for that domain never
 * overwrite each other.
 */
export async function vaultCodecLogoIdForSource(manifestId: string, source: string): Promise<string> {
  await initRustCore();
  return core.vaultCodecLogoIdForSource(manifestId, source);
}

/**
 * The `Logos.Id` to use for the logo `(kind, source)` inside the manifest with id `manifestId`.
 */
export async function vaultCodecLogoIdFor(manifestId: string, kind: string, source: string): Promise<string> {
  await initRustCore();
  return core.vaultCodecLogoIdFor(manifestId, kind, source);
}

/**
 * The SHA-256 (lowercase hex) of an uploaded logo's bytes: the `Source` a `custom` logo row is stored
 * under, which is what makes picking the same image again reuse the row that already holds it.
 */
export async function vaultCodecLogoContentHash(bytes: Uint8Array): Promise<string> {
  await initRustCore();
  return core.vaultCodecLogoContentHash(bytes);
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
 * Content fingerprint of a manifest / data-bucket payload JSON for change detection: SHA-256 (lowercase hex)
 * of the Rust codec's canonical JSON, excluding the volatile `canonicalizedAt` timestamp. Calculated in Rust so
 * every platform uses the same fingerprinting algorithm.
 */
export async function vaultCodecComputeContentFingerprint(payloadJson: string): Promise<string> {
  await initRustCore();
  return core.vaultCodecComputeContentFingerprint(payloadJson);
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
