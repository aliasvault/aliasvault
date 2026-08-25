/**
 * The locally stored vault blob: AES-GCM over the raw bytes of the SQLite database.
 */

import { base64ToBytes } from '@/utils/Base64';
import { EncryptionUtility } from '@/utils/EncryptionUtility';

/**
 * The bytes every SQLite database file begins with. They tell the two plaintext shapes apart with no version
 * marker: base64 text cannot start with them, since the space at index 6 is not in the base64 alphabet.
 */
const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\u0000');

/**
 * Encrypt a plaintext SQLite database for local storage.
 * @param sqliteBytes - the database as exported by sql.js
 * @param key - the symmetric key the vault is stored under
 * @returns Base64 of (IV | ciphertext | tag).
 */
export async function encryptVaultBlob(sqliteBytes: Uint8Array, key: string): Promise<string> {
  return EncryptionUtility.symmetricEncryptBytes(sqliteBytes, key);
}

/**
 * Decrypt a stored vault blob into the plaintext SQLite database.
 *
 * Reads both shapes: the database bytes this build writes, and the base64 text older builds wrote (which is
 * also what a server still on the sqlite-blob storage format serves). A vault in the older shape is converted
 * by the next write, so nothing has to migrate it up front. TODO: the base64 fallback can be removed
 * once all users have migrated to 0.31.0+.
 * @param encryptedBlob - base64 of (IV | ciphertext | tag) as stored
 * @param key - the symmetric key the vault is stored under
 */
export async function decryptVaultBlob(encryptedBlob: string, key: string): Promise<Uint8Array> {
  const plaintext = await EncryptionUtility.symmetricDecryptBytes(base64ToBytes(encryptedBlob), key);
  if (isSqliteDatabase(plaintext)) {
    return plaintext;
  }

  // LEGACY: the plaintext is base64 text of the database.
  return base64ToBytes(new TextDecoder().decode(plaintext));
}

/**
 * Whether these plaintext bytes are a SQLite database rather than base64 text of one.
 * @param bytes - the decrypted plaintext
 */
function isSqliteDatabase(bytes: Uint8Array): boolean {
  return bytes.length >= SQLITE_HEADER.length && SQLITE_HEADER.every((byte, index) => bytes[index] === byte);
}
