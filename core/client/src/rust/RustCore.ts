/**
 * Typed wrapper around the AliasVault Rust core (shared with iOS, Android, and the Blazor client).
 *
 * Algorithms (URL matching, credential filtering, domain extraction, the vault codec) live in `core/rust`.
 */
import { resolveDefaultLanguage } from '@aliasvault/models/defaults';
import { FieldKey } from '@aliasvault/models/vault';

import { getPlatform } from '../platform/ClientPlatform';
import { deviceLanguage } from '../platform/DeviceLanguage';

import { AutofillMatchingMode } from './RustCoreTypes';

import type { IRustCore } from './RustCoreBinding';
import type { CodecBucketLayoutEntry, CodecCanonicalized, CodecCanonicalizeInput, CodecCanonicalMergeInput, CodecCanonicalMergeOutput, CodecDataBucket, CodecManifest, CodecMaterialized, CodecValidation, FaviconTarget, IdentityNameInput, IdentityRequest, ParsedEmail, SharingAccessPartition, SharingManifestRecord, SharingWriteSet } from './RustCoreTypes';
import type { Identity } from '@aliasvault/models/identity';
import type { Item, PasswordSettings } from '@aliasvault/models/vault';

export { AutofillMatchingMode } from './RustCoreTypes';
export type { CodecBlobEntry, CodecBucketLayoutEntry, CodecCanonicalized, CodecCanonicalizeInput, CodecCanonicalMergeInput, CodecCanonicalMergeOutput, CodecDataBucket, CodecManifest, CodecMaterialized, CodecValidation, FaviconTarget, IdentityNameInput, IdentityRequest, ParsedEmail, SharingAccessPartition, SharingManifestRecord, SharingWriteSet } from './RustCoreTypes';

/**
 * The host's Rust core binding.
 */
export function rustCore(): IRustCore {
  return getPlatform().rustCore;
}

/**
 * Initialize the Rust core.
 */
export function initRustCore(): Promise<void> {
  return rustCore().init();
}

/**
 * Extract the host (subdomain + domain) from a URL.
 * Example: `https://www.example.com/path` > `example.com`.
 * Returns empty string for inputs the Rust extractor rejects, e.g.
 * reversed-TLD app bundle identifiers like `com.example.app`.
 */
export async function extractDomain(url: string): Promise<string> {
  return rustCore().extractDomain(url);
}

/**
 * Extract the root domain.
 * Example: `sub.example.co.uk` > `example.co.uk`.
 */
export async function extractRootDomain(domain: string): Promise<string> {
  return rustCore().extractRootDomain(domain);
}

/**
 * Read a URL field value as an ordered list, accepting the single-string and multi-value
 * shapes a field can hold.
 */
export function toUrlList(urlValue: string | string[] | undefined | null): string[] {
  if (!urlValue) {
    return [];
  }

  const urlList = Array.isArray(urlValue) ? urlValue : [urlValue];
  return urlList.filter((url): url is string => Boolean(url?.trim()));
}

/**
 * Pick which of an item's URLs a favicon comes from, and the key to store it under.
 * Returns null when no URL qualifies.
 */
export async function selectFaviconTarget(urls: string[]): Promise<FaviconTarget | null> {
  return rustCore().selectFaviconTarget(urls);
}

/**
 * Generate a password or passphrase from the given settings.
 */
export async function generatePassword(settings: PasswordSettings, seed?: string): Promise<string> {
  const effective = await applyEffectiveDicewareLanguage(settings);
  const payload = seed ? { ...effective, Seed: seed } : effective;
  return rustCore().generatePassword(JSON.stringify(payload));
}

/**
 * Resolve the effective Diceware passphrase language when none is explicitly chosen.
 */
async function applyEffectiveDicewareLanguage(settings: PasswordSettings): Promise<PasswordSettings> {
  if (settings.Type !== 'diceware' || (settings.Language && settings.Language.trim().length > 0)) {
    return settings;
  }
  const codes = await getDicewareLanguages();
  return { ...settings, Language: resolveDefaultLanguage(deviceLanguage(), codes) };
}

/**
 * Get the list of bundled Diceware wordlist language ISO codes (first is the default, 'en').
 */
export async function getDicewareLanguages(): Promise<string[]> {
  const languages = await rustCore().getDicewareLanguages();
  return languages.length > 0 ? languages : ['en'];
}

/**
 * Generate a random identity (alias persona) in the Rust core.
 * Returns the identity with a yyyy-MM-dd birth date string.
 */
export async function generateIdentity(request: IdentityRequest): Promise<Identity> {
  return JSON.parse(await rustCore().generateIdentity(JSON.stringify(request))) as Identity;
}

/**
 * Generate a username from persona name fields (alphanumeric, 6-20 characters).
 */
export async function generateIdentityUsername(input: IdentityNameInput): Promise<string> {
  return rustCore().generateIdentityUsername(JSON.stringify(input));
}

/**
 * Generate an email prefix from persona name fields (6-20 characters).
 */
export async function generateIdentityEmailPrefix(input: IdentityNameInput): Promise<string> {
  return rustCore().generateIdentityEmailPrefix(JSON.stringify(input));
}

/**
 * Generate a random alphanumeric email prefix that is not based on any identity.
 * Used for login-type credentials where no persona fields are available.
 */
export async function generateRandomEmailPrefix(length: number = 14): Promise<string> {
  return rustCore().generateRandomEmailPrefix(length);
}

/**
 * Get the list of bundled identity dictionary language ISO codes.
 * The set is owned by the Rust core; unknown codes fall back to English during generation.
 */
export async function getIdentityLanguages(): Promise<string[]> {
  const languages = await rustCore().getIdentityLanguages();
  return languages.length > 0 ? languages : ['en'];
}

/**
 * Get the list of identity age range option values ('random' plus 5-year ranges).
 */
export async function getIdentityAgeRanges(): Promise<string[]> {
  return rustCore().getIdentityAgeRanges();
}

/**
 * Parse a raw RFC 822 email source into its html/plain bodies and attachment metadata.
 */
export async function parseEmailSource(source: Uint8Array): Promise<ParsedEmail> {
  return rustCore().parseEmailSource(source);
}

/**
 * Turn a stored email source into the raw RFC 822 message bytes for showing the message source without parsing it.
 */
export async function decodeEmailSource(source: Uint8Array): Promise<Uint8Array> {
  return rustCore().decodeEmailSource(source);
}

/**
 * Extract the decoded bytes of one attachment, identified by its index in the parsed attachment list.
 */
export async function extractEmailAttachment(source: Uint8Array, index: number, detachedBody?: Uint8Array): Promise<Uint8Array> {
  return rustCore().extractEmailAttachment(source, index, detachedBody);
}

/**
 * Derive a 32-byte key from a password using Argon2id.
 */
export async function argon2DeriveKey(password: string, salt: string, encryptionSettings: string): Promise<Uint8Array> {
  return rustCore().argon2DeriveKey(password, salt, encryptionSettings);
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
export async function filterItems(items: Item[], currentUrl: string, pageTitle: string, matchingMode: AutofillMatchingMode = AutofillMatchingMode.DEFAULT): Promise<Item[]> {
  const credentials = items.map(item => ({
    Id: item.Id,
    ItemName: item.Name ?? '',
    ItemUrls: getFieldValues(item, FieldKey.LoginUrl)
  }));

  const result = await rustCore().filterCredentials({
    credentials,
    current_url: currentUrl,
    page_title: pageTitle,
    matching_mode: matchingMode
  });

  return result.matched_ids
    .map(id => items.find(item => item.Id === id))
    .filter((item): item is Item => item !== undefined);
}

/**
 * True if `newUrl` is already represented in `existingUrls` under
 * host-only comparison (scheme, `www.`, path, query, fragment, trailing
 * slash all ignored). Falls back to lowercased exact-match when the Rust
 * extractor returns no domain (app bundle identifiers).
 */
export async function isUrlAlreadyLinked(existingUrls: string[], newUrl: string): Promise<boolean> {
  const newKey = await urlComparisonKey(newUrl);
  if (!newKey) {
    return false;
  }
  const existingKeys = await Promise.all(existingUrls.map(existing => urlComparisonKey(existing)));
  return existingKeys.some(key => key === newKey);
}

/**
 * Host-only comparison key of a URL: its domain, or the lowercased URL when the extractor yields none.
 */
async function urlComparisonKey(url: string): Promise<string> {
  const trimmed = url.trim().toLowerCase();
  if (!trimmed) {
    return trimmed;
  }
  const domain = await rustCore().extractDomain(trimmed);
  return domain.length > 0 ? domain : trimmed;
}

/*
 * Vault codec (manifest-v1 storage format).
 */

/**
 * Canonicalize normalized tables into manifest + data buckets + blob map.
 */
export async function vaultCodecCanonicalizeFromSqlite(input: CodecCanonicalizeInput): Promise<CodecCanonicalized> {
  return rustCore().vaultCodecCanonicalizeFromSqlite(input);
}

/**
 * Materialize the vault's manifests + data buckets into the table set the platform inserts.
 */
export async function vaultCodecMaterializeAsSqlite(manifests: CodecManifest[], dataBuckets: CodecDataBucket[], schemaColumns: Record<string, string[]>): Promise<CodecMaterialized> {
  return rustCore().vaultCodecMaterializeAsSqlite({ manifests, dataBuckets, schemaColumns });
}

/**
 * Merge the local canonical vault onto the server canonical vault (the base), one manifest at a
 * time, rows out.
 */
export async function vaultCodecMergeCanonical(input: CodecCanonicalMergeInput): Promise<CodecCanonicalMergeOutput> {
  return rustCore().mergeCanonical(input);
}

/**
 * Extract the encryption-key row whose `PublicKey` matches `publicKey` from a decrypted manifest.
 */
export async function vaultCodecExtractEncryptionKeyForPublicKey(manifest: CodecManifest, publicKey: string): Promise<Record<string, unknown> | null> {
  return rustCore().vaultCodecExtractEncryptionKeyForPublicKey(manifest, publicKey);
}

/**
 * Build a bucket category's data buckets from its tables, one per manifest in `manifestIds` (bucket-only push
 * path).
 */
export async function vaultCodecExtractBuckets(category: string, manifestIds: string[], tables: Record<string, Array<Record<string, unknown>>>): Promise<CodecDataBucket[]> {
  return rustCore().vaultCodecExtractBuckets({ category, manifestIds, tables });
}

/**
 * The name of the client-local SQLite table that carries the codec overflow inside the vault DB.
 */
export async function vaultCodecOverflowTable(): Promise<string> {
  return rustCore().vaultCodecOverflowTable();
}

/**
 * The vault tables that take part in sync, as declared by the shared vault table registry.
 */
export async function getSyncableTableNames(): Promise<string[]> {
  return rustCore().getSyncableTableNames();
}

/**
 * The bucket layout: every category and the tables it owns.
 */
export async function vaultCodecBucketLayout(): Promise<CodecBucketLayoutEntry[]> {
  return rustCore().vaultCodecBucketLayout();
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
  return rustCore().vaultCodecLogoIdForSource(manifestId, source);
}

/**
 * The `Logos.Id` to use for the logo `(kind, source)` inside the manifest with id `manifestId`.
 */
export async function vaultCodecLogoIdFor(manifestId: string, kind: string, source: string): Promise<string> {
  return rustCore().vaultCodecLogoIdFor(manifestId, kind, source);
}

/**
 * The SHA-256 (lowercase hex) of an uploaded logo's bytes: the `Source` a `custom` logo row is stored
 * under, which is what makes picking the same image again reuse the row that already holds it.
 */
export async function vaultCodecLogoContentHash(bytes: Uint8Array): Promise<string> {
  return rustCore().vaultCodecLogoContentHash(bytes);
}

/**
 * Generate a fresh 32-byte per-manifest blob-hashing salt (lowercase hex).
 */
export async function vaultCodecGenerateManifestSalt(): Promise<string> {
  return rustCore().vaultCodecGenerateManifestSalt();
}

/**
 * Pack a payload JSON string into gzip(envelope{contentHash, payload}). The caller encrypts the result.
 */
export async function vaultCodecPackPayload(payloadJson: string): Promise<Uint8Array> {
  return rustCore().vaultCodecPackPayload(payloadJson);
}

/**
 * Unpack a (decrypted) payload: gunzip > verify content hash > return the payload JSON string.
 */
export async function vaultCodecUnpackPayload(plainBytes: Uint8Array): Promise<string> {
  return rustCore().vaultCodecUnpackPayload(plainBytes);
}

/**
 * Structurally validate a manifest before upload.
 */
export async function vaultCodecValidateManifest(manifest: CodecManifest): Promise<CodecValidation> {
  return rustCore().vaultCodecValidateManifest(manifest);
}

/**
 * Validate a data bucket before upload.
 */
export async function vaultCodecValidateDataBucket(bucket: CodecDataBucket): Promise<CodecValidation> {
  return rustCore().vaultCodecValidateDataBucket(bucket);
}

/**
 * SHA-256 (lowercase hex) of a base64 ciphertext string.
 */
export async function vaultCodecComputeCiphertextHash(base64Ciphertext: string): Promise<string> {
  return rustCore().vaultCodecComputeCiphertextHash(base64Ciphertext);
}

/**
 * Content fingerprint of a manifest / data-bucket payload JSON for change detection: SHA-256 (lowercase hex)
 * of the Rust codec's canonical JSON, excluding the volatile `canonicalizedAt` timestamp. Calculated in Rust so
 * every platform uses the same fingerprinting algorithm.
 */
export async function vaultCodecComputeContentFingerprint(payloadJson: string): Promise<string> {
  return rustCore().vaultCodecComputeContentFingerprint(payloadJson);
}

/**
 * Work out which manifests the next push writes, personal manifest first.
 * @param input - the personal manifest, what the vault holds rows for, what opened, and the held records.
 */
export async function vaultSharingResolveManifestWriteSet(input: { personalManifestId: string; personalManifestSalt: string; stampedManifestIds: string[]; openedManifestIds: string[]; heldRecords: SharingManifestRecord[]; displayNames: Record<string, string> }): Promise<SharingWriteSet> {
  return rustCore().vaultSharingResolveManifestWriteSet(input);
}

/**
 * Split what the local vault holds by what this account can still open.
 * @param input - what the vault holds, what this session can write, and what the last snapshot served.
 */
export async function vaultSharingPartitionManifestAccess(input: { manifestIdsInVault: string[]; writableManifestIds: string[]; grantedManifestIds: string[] }): Promise<SharingAccessPartition> {
  return rustCore().vaultSharingPartitionManifestAccess(input);
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
