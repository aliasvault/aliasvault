import { Buffer } from 'buffer';

import type { IRustCore } from '@aliasvault/client/rust/RustCoreBinding';

import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Call one Rust core function through the native dispatcher: positional arguments travel as a JSON array, the result
 * comes back as JSON text.
 */
async function call<T>(name: string, ...args: unknown[]): Promise<T> {
  return JSON.parse(await NativeVaultManager.rustCall(name, JSON.stringify(args))) as T;
}

/**
 * Call a function that returns bytes, which the dispatcher sends as a base64 string.
 */
async function callForBytes(name: string, ...args: unknown[]): Promise<Uint8Array> {
  return new Uint8Array(Buffer.from(await call<string>(name, ...args), 'base64'));
}

/**
 * Encode bytes as the base64 string the dispatcher expects for a byte argument.
 */
function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/*
 * The client core's Rust binding on mobile: the uniffi Swift/Kotlin bindings, reached through the one generic
 * `NativeVaultManager.rustCall` method. Swift and Kotlin hold a case per function and no logic. Functions that take a
 * document receive it as a single JSON argument, matching their `*Json` uniffi exports; vault codec documents already
 * carry byte columns as `{ __b64 }`, so they serialize as is. The vault sync engine is driven natively on mobile, so it
 * has no JavaScript session.
 */
export const nativeRustCore: IRustCore = {
  init: async (): Promise<void> => {},

  extractDomain: (url) => call('extractDomain', url),
  extractRootDomain: (domain) => call('extractRootDomain', domain),
  selectFaviconTarget: (urls) => call('selectFaviconTarget', urls),
  filterCredentials: (input) => call('filterCredentialsJson', JSON.stringify(input)),

  generatePassword: (settingsJson) => call('generatePassword', settingsJson),
  getDicewareLanguages: () => call('getDicewareLanguages'),
  generateIdentity: (requestJson) => call('generateIdentity', requestJson),
  generateIdentityUsername: (inputJson) => call('generateIdentityUsername', inputJson),
  generateIdentityEmailPrefix: (inputJson) => call('generateIdentityEmailPrefix', inputJson),
  generateRandomEmailPrefix: (length) => call('generateRandomEmailPrefix', length),
  getIdentityLanguages: () => call('getIdentityLanguages'),
  getIdentityAgeRanges: () => call('getIdentityAgeRanges'),

  parseEmailSource: (source) => call('parseEmailSource', base64(source)),
  decodeEmailSource: (source) => callForBytes('decodeEmailSource', base64(source)),
  extractEmailAttachment: (source, index, detachedBody) => callForBytes('extractEmailAttachment', base64(source), index, detachedBody ? base64(detachedBody) : null),

  argon2DeriveKey: (password, salt, encryptionSettings) => callForBytes('argon2DeriveKey', password, salt, encryptionSettings),

  srpGenerateSalt: () => call('srpGenerateSalt'),
  srpDerivePrivateKey: (salt, identity, passwordHash) => call('srpDerivePrivateKey', salt, identity, passwordHash),
  srpDeriveVerifier: (privateKey) => call('srpDeriveVerifier', privateKey),
  srpGenerateEphemeral: () => call('srpGenerateEphemeral'),
  srpDeriveSession: (clientSecret, serverPublic, salt, identity, privateKey) => call('srpDeriveSession', clientSecret, serverPublic, salt, identity, privateKey),

  getSyncableTableNames: () => call('getSyncableTableNames'),
  getPruneTableQueries: () => call('getPruneTableQueries'),

  vaultCodecCanonicalizeFromSqlite: (input) => call('vaultCodecCanonicalizeFromSqlite', JSON.stringify(input)),
  vaultCodecMaterializeAsSqlite: (input) => call('vaultCodecMaterializeAsSqlite', JSON.stringify(input)),
  vaultCodecExtractBuckets: (input) => call('vaultCodecExtractBuckets', JSON.stringify(input)),
  vaultCodecBucketLayout: () => call('vaultCodecBucketLayout'),
  vaultCodecOverflowTable: () => call('vaultCodecOverflowTable'),
  vaultCodecGenerateManifestSalt: () => call('vaultCodecGenerateManifestSalt'),
  vaultCodecLogoIdForSource: (manifestId, source) => call('vaultCodecLogoIdForSource', manifestId, source),
  vaultCodecLogoIdFor: (manifestId, kind, source) => call('vaultCodecLogoIdFor', manifestId, kind, source),
  vaultCodecLogoContentHash: (bytes) => call('vaultCodecLogoContentHash', base64(bytes)),
  vaultCodecPackPayload: (payloadJson) => callForBytes('vaultCodecPackPayload', payloadJson),
  vaultCodecUnpackPayload: (plainBytes) => call('vaultCodecUnpackPayload', base64(plainBytes)),
  vaultCodecValidateManifest: (manifest) => call('vaultCodecValidateManifest', JSON.stringify(manifest)),
  vaultCodecValidateDataBucket: (bucket) => call('vaultCodecValidateDataBucket', JSON.stringify(bucket)),
  vaultCodecComputeCiphertextHash: (base64Ciphertext) => call('vaultCodecComputeCiphertextHash', base64Ciphertext),
  vaultCodecComputeContentFingerprint: (payloadJson) => call('vaultCodecComputeContentFingerprint', payloadJson),
  vaultCodecExtractEncryptionKeyForPublicKey: (manifest, publicKey) => call('vaultCodecExtractEncryptionKeyForPublicKey', JSON.stringify(manifest), publicKey),

  vaultSharingResolveManifestWriteSet: (input) => call('vaultSharingResolveManifestWriteSet', JSON.stringify(input)),
  vaultSharingPartitionManifestAccess: (input) => call('vaultSharingPartitionManifestAccess', JSON.stringify(input)),

  createVaultSyncSession: () => Promise.reject(new Error('The vault sync engine is driven natively on mobile and has no JavaScript session.')),
};
