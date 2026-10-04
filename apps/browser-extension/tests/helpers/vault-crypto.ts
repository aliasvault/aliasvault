/**
 * AES-GCM helpers for tests that read or write vault ciphertext API-side, bound to the same associated data the
 * Rust core uses (`core/rust/src/crypto/aad.rs`).
 */

import { randomBytes, webcrypto } from 'crypto';

import { base64ToBytes, bytesToBase64 } from '@aliasvault/client/utilities/Base64';

/**
 * Associated data of a manifest payload under its manifest's VEK.
 *
 * @param manifestId - The manifest the payload belongs to
 * @returns The AAD bytes
 */
export function manifestAad(manifestId: string): Uint8Array {
  return new TextEncoder().encode(`aliasvault/v1/manifest/${manifestId.toLowerCase()}`);
}

/**
 * Associated data of a data bucket payload under its manifest's VEK.
 *
 * @param manifestId - The manifest the bucket belongs to
 * @param category - The bucket category
 * @returns The AAD bytes
 */
export function bucketAad(manifestId: string, category: string): Uint8Array {
  return new TextEncoder().encode(`aliasvault/v1/bucket/${manifestId.toLowerCase()}/${category}`);
}

/**
 * Encrypts raw bytes bound to `aad`, returning base64(IV | ciphertext | authTag).
 *
 * @param plaintextBytes - The plaintext bytes to encrypt
 * @param keyBytes - The 256-bit encryption key
 * @param aad - The associated data the ciphertext is bound to
 * @returns Base64-encoded ciphertext
 */
export async function symmetricEncryptBytes(plaintextBytes: Uint8Array, keyBytes: Uint8Array, aad: Uint8Array): Promise<string> {
  const key = await webcrypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = randomBytes(12);
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintextBytes);
  return bytesToBase64(new Uint8Array(Buffer.concat([iv, Buffer.from(ciphertext)])));
}

/**
 * Decrypts a ciphertext produced by {@link symmetricEncryptBytes} with the same `aad`.
 *
 * @param base64Ciphertext - Base64-encoded ciphertext (12-byte IV prepended)
 * @param keyBytes - The 256-bit encryption key
 * @param aad - The associated data the ciphertext is bound to
 * @returns The decrypted plaintext bytes
 */
export async function symmetricDecryptBytes(base64Ciphertext: string, keyBytes: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  const bytes = base64ToBytes(base64Ciphertext);
  const key = await webcrypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const plaintext = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: aad }, key, bytes.subarray(12));
  return new Uint8Array(plaintext);
}
