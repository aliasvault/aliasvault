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
import type { CodecCanonicalized, CodecCanonicalizeInput, FaviconTarget, IdentityNameInput, IdentityRequest, ParsedEmail } from './RustCoreTypes';
import type { Identity } from '@aliasvault/models/identity';
import type { Item, PasswordSettings } from '@aliasvault/models/vault';

export { AutofillMatchingMode } from './RustCoreTypes';
export type { CodecBlobEntry, CodecCanonicalized, CodecCanonicalizeInput, CodecDataBucket, CodecManifest, CodecTableData, FaviconTarget, IdentityNameInput, IdentityRequest, ParsedEmail, ParsedEmailAttachment } from './RustCoreTypes';

/**
 * The host's Rust core binding.
 */
export function rustCore(): IRustCore {
  return getPlatform().rustCore;
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
    id: item.Id,
    itemName: item.Name ?? '',
    itemUrls: getFieldValues(item, FieldKey.LoginUrl)
  }));

  const result = await rustCore().filterCredentials({
    credentials,
    currentUrl,
    pageTitle,
    matchingMode
  });

  return result.matchedIds
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
 * The vault tables that take part in sync, as declared by the shared vault table registry.
 */
export async function getSyncableTableNames(): Promise<string[]> {
  return rustCore().getSyncableTableNames();
}

/**
 * The `Logos.Id` to use for the logo `(kind, source)` inside the manifest with id `manifestId`.
 *
 * Logo identity is derived: two devices that fetch the same favicon independently produce
 * the same row and merge by LWW. The same domain in two different manifests deliberately yields
 * two different ids, so a shared manifest's logo and the user's own logo for that domain never
 * overwrite each other.
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
