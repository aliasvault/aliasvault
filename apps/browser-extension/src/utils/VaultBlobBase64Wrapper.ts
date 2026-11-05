/**
 * Base64 wrapper around the shared vault blob crypto in `@aliasvault/client/crypto/VaultBlob`, for the browser extension.
 *
 * The shared core works with the encrypted vault blob as raw bytes. The extension stores the blob in `storage.local` and
 * sends it from the popup to the background in runtime messages, which both only carry JSON values, so it keeps the blob
 * as base64 text. Extension code calls these functions instead of `VaultBlob` directly, so the conversion happens only here.
 */

import { decryptVaultBlob, encryptVaultBlob } from '@aliasvault/client/crypto/VaultBlob';
import { base64ToBytes, bytesToBase64 } from '@aliasvault/client/utilities/Base64';

/**
 * Encrypt a plaintext SQLite database into a base64 vault blob.
 * @param sqliteBytes - the database as exported by the SQLite engine
 * @param key - the symmetric key the vault is stored under
 */
export async function encryptVaultBlobBase64(sqliteBytes: Uint8Array, key: string): Promise<string> {
  return bytesToBase64(await encryptVaultBlob(sqliteBytes, key));
}

/**
 * Decrypt a base64 vault blob into the plaintext SQLite database.
 * @param vaultBlobBase64 - the vault blob as stored
 * @param key - the symmetric key the vault is stored under
 */
export async function decryptVaultBlobBase64(vaultBlobBase64: string, key: string): Promise<Uint8Array> {
  return decryptVaultBlob(base64ToBytes(vaultBlobBase64), key);
}

/**
 * A vault blob from the sync engine as base64, for storage.
 * @param bytes - the vault blob
 */
export function vaultBlobToBase64(bytes: Uint8Array): string {
  return bytesToBase64(bytes);
}

/**
 * A stored base64 vault blob as bytes, for the sync engine.
 * @param vaultBlobBase64 - the vault blob as stored
 */
export function vaultBlobFromBase64(vaultBlobBase64: string): Uint8Array {
  return base64ToBytes(vaultBlobBase64);
}
