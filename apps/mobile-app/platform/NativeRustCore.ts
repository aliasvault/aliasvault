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

/**
 * Reject a core function that mobile JavaScript never calls because the native layer (Swift/Kotlin) runs it.
 */
function notImplementedOnMobile(name: string, reason: string): Promise<never> {
  return Promise.reject(new Error(`${name} is not implemented on mobile: ${reason}`));
}

const PIN_IS_NATIVE = 'PIN unlock runs in the native VaultStore';

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
  isRpIdAllowedForHost: (rpId, host) => call('isRpIdAllowedForHost', rpId, host),
  isRelatedOriginAllowed: (callerOrigin, origins) => call('isRelatedOriginAllowed', callerOrigin, origins),
  selectFaviconTarget: (urls) => call('selectFaviconTarget', urls),
  filterCredentials: (input) => call('filterCredentialsJson', JSON.stringify(input)),

  generateTotpCode: (secret, unixSeconds, algorithm, digits, period) => call('generateTotpCode', secret, unixSeconds, algorithm, digits, period),

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

  symmetricEncryptBytes: (plaintext, keyBase64) => callForBytes('symmetricEncryptBytes', base64(plaintext), keyBase64),
  symmetricDecryptBytes: (encrypted, keyBase64) => callForBytes('symmetricDecryptBytes', base64(encrypted), keyBase64),
  symmetricDecrypt: (base64Ciphertext, keyBase64) => call('symmetricDecrypt', base64Ciphertext, keyBase64),
  rsaDecrypt: (base64Ciphertext, privateKeyJwk) => callForBytes('rsaDecrypt', base64Ciphertext, privateKeyJwk),

  pinGenerateSalt: () => notImplementedOnMobile('pinGenerateSalt', PIN_IS_NATIVE),
  pinEncrypt: () => notImplementedOnMobile('pinEncrypt', PIN_IS_NATIVE),
  pinDecrypt: () => notImplementedOnMobile('pinDecrypt', PIN_IS_NATIVE),
  pinIsLocked: () => notImplementedOnMobile('pinIsLocked', PIN_IS_NATIVE),
  pinRegisterFailure: () => notImplementedOnMobile('pinRegisterFailure', PIN_IS_NATIVE),

  argon2DeriveKey: (password, salt, encryptionSettings) => callForBytes('argon2DeriveKey', password, salt, encryptionSettings),
  deriveSrpPasswordHash: (unlockKeyBase64, encryptionType) => call('deriveSrpPasswordHash', unlockKeyBase64, encryptionType),
  openAccountKeyChain: (storedKey, encryptedAccountKey, encryptedVek, encryptedAccountPrivateKey) => call('openAccountKeyChain', storedKey, encryptedAccountKey, encryptedVek, encryptedAccountPrivateKey),
  createAccountKeyHierarchy: (unlockKeyBase64, publicKeyJwk, privateKeyJwk) => call('createAccountKeyHierarchyJson', unlockKeyBase64, publicKeyJwk, privateKeyJwk),
  reencryptAccountKey: (encryptedAccountKey, oldUnlockKeyBase64, newUnlockKeyBase64) => call('reencryptAccountKeyJson', encryptedAccountKey, oldUnlockKeyBase64, newUnlockKeyBase64),

  srpGenerateSalt: () => call('srpGenerateSalt'),
  srpDerivePrivateKey: (salt, identity, passwordHash) => call('srpDerivePrivateKey', salt, identity, passwordHash),
  srpDeriveVerifier: (privateKey) => call('srpDeriveVerifier', privateKey),
  srpGenerateEphemeral: () => call('srpGenerateEphemeral'),
  srpDeriveSession: (clientSecret, serverPublic, salt, identity, privateKey) => call('srpDeriveSession', clientSecret, serverPublic, salt, identity, privateKey),
  srpVerifySession: (clientPublic, clientProof, sessionKey, serverProof) => call('srpVerifySession', clientPublic, clientProof, sessionKey, serverProof),

  getSyncableTableNames: () => call('getSyncableTableNames'),

  vaultCodecCanonicalizeFromSqlite: (input) => call('vaultCodecCanonicalizeFromSqlite', JSON.stringify(input)),
  vaultCodecGenerateManifestSalt: () => call('vaultCodecGenerateManifestSalt'),
  vaultCodecLogoIdFor: (manifestId, kind, source) => call('vaultCodecLogoIdFor', manifestId, kind, source),
  vaultCodecLogoContentHash: (bytes) => call('vaultCodecLogoContentHash', base64(bytes)),
  vaultCodecPackPayload: (payloadJson) => callForBytes('vaultCodecPackPayload', payloadJson),
  vaultCodecUnpackPayload: (plainBytes) => call('vaultCodecUnpackPayload', base64(plainBytes)),

  createVaultSyncSession: () => notImplementedOnMobile('createVaultSyncSession', 'the vault sync engine is driven natively'),
};

