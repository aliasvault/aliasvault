/**
 * AES-GCM helpers for tests that read or write vault ciphertext API-side.
 */

import { EncryptionUtility } from '@aliasvault/client/crypto/EncryptionUtility';
import { base64ToBytes, bytesToBase64 } from '@aliasvault/client/utilities/Base64';

import './client-platform';

/**
 * Encrypts raw bytes, returning base64(IV | ciphertext | authTag).
 *
 * @param plaintextBytes - The plaintext bytes to encrypt
 * @param keyBytes - The 256-bit encryption key
 * @returns Base64-encoded ciphertext
 */
export async function symmetricEncryptBytes(plaintextBytes: Uint8Array, keyBytes: Uint8Array): Promise<string> {
  return EncryptionUtility.symmetricEncryptBytes(plaintextBytes, bytesToBase64(keyBytes));
}

/**
 * Decrypts a ciphertext produced by {@link symmetricEncryptBytes}.
 *
 * @param base64Ciphertext - Base64-encoded ciphertext (12-byte IV prepended)
 * @param keyBytes - The 256-bit encryption key
 * @returns The decrypted plaintext bytes
 */
export async function symmetricDecryptBytes(base64Ciphertext: string, keyBytes: Uint8Array): Promise<Uint8Array> {
  return EncryptionUtility.symmetricDecryptBytes(base64ToBytes(base64Ciphertext), bytesToBase64(keyBytes));
}
