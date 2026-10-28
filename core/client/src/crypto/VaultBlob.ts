/**
 * The locally stored vault blob: AES-GCM over the raw bytes of the SQLite database.
 * WebCrypto re-implementation of Rust `core/rust/src/crypto/vault_blob.rs`, the base format, because AES-GCM in wasm
 * runs without hardware acceleration.
 * Other platform implementations: core/rust/src/crypto/vault_blob.rs (iOS and Android through uniffi).
 */

import { base64ToBytes, bytesToBase64 } from '../utilities/Base64';

import { EncryptionUtility } from './EncryptionUtility';

/** The bytes every SQLite database file begins with. Base64 text cannot start with them. */
const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\u0000');

/**
 * Encrypt a plaintext SQLite database for local storage.
 * @param sqliteBytes - the database as exported by the SQLite engine
 * @param key - the symmetric key the vault is stored under
 * @returns Base64 of (IV | ciphertext | tag).
 */
export async function encryptVaultBlob(sqliteBytes: Uint8Array, key: string): Promise<string> {
  return bytesToBase64(await EncryptionUtility.symmetricEncryptBytes(sqliteBytes, key));
}

/**
 * Decrypt a stored vault blob into the plaintext SQLite database.
 * @param encryptedBlob - base64 of (IV | ciphertext | tag) as stored
 * @param key - the symmetric key the vault is stored under
 */
export async function decryptVaultBlob(encryptedBlob: string, key: string): Promise<Uint8Array> {
  const plaintext = await EncryptionUtility.symmetricDecryptBytes(base64ToBytes(encryptedBlob), key);
  if (isSqliteDatabase(plaintext)) {
    return plaintext;
  }

  /*
   * LEGACY: builds before 0.31.0 stored the base64 text of the database, so a plaintext without the SQLite header is
   * decoded as base64. TODO: remove once every vault has been written by 0.31.0+.
   */
  return base64ToBytes(new TextDecoder().decode(plaintext));
}

/**
 * Whether these plaintext bytes are a SQLite database rather than base64 text of one.
 * @param bytes - the decrypted plaintext
 */
function isSqliteDatabase(bytes: Uint8Array): boolean {
  return bytes.length >= SQLITE_HEADER.length && SQLITE_HEADER.every((byte, index) => bytes[index] === byte);
}
