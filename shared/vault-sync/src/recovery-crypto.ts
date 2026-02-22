import * as secrets from 'secrets.js-34r7h';
import { hexToUint8Array, bytesToHex } from './utils.js';

/**
 * Generate a 32-byte recovery key using Web Crypto API.
 */
export async function generateRecoveryKey(): Promise<Uint8Array> {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Encrypt plaintext with a recovery key using AES-256-GCM.
 * Output format: [iv(12) | ciphertext+authTag]
 * Web Crypto appends the 16-byte authTag to ciphertext automatically.
 */
export async function encryptWithRecoveryKey(
  plaintext: string,
  recoveryKey: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', recoveryKey as BufferSource, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded as BufferSource);
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), 12);
  return result;
}

/**
 * Decrypt data encrypted with encryptWithRecoveryKey.
 * Input format: [iv(12) | ciphertext+authTag]
 */
export async function decryptWithRecoveryKey(
  encrypted: Uint8Array,
  recoveryKey: Uint8Array,
): Promise<string> {
  const key = await crypto.subtle.importKey('raw', recoveryKey as BufferSource, 'AES-GCM', false, ['decrypt']);
  const iv = encrypted.slice(0, 12);
  const ciphertext = encrypted.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext as BufferSource);
  return new TextDecoder().decode(decrypted);
}

/**
 * Split a hex-encoded string into Shamir shares.
 * @param dataHex - Hex-encoded data to split
 * @param totalShares - Number of shares to generate
 * @param threshold - Minimum shares required to reconstruct
 */
export function splitIntoShares(dataHex: string, totalShares: number, threshold: number): string[] {
  return secrets.share(dataHex, totalShares, threshold);
}

/**
 * Combine Shamir shares to reconstruct the original hex-encoded data.
 */
export function combineShares(shares: string[]): string {
  return secrets.combine(shares);
}

/**
 * Encrypt a hex-encoded share with a guardian's RSA public key (RSA-OAEP-SHA256).
 * Encodes share as binary (hex→bytes) to stay within RSA-OAEP 190-byte limit.
 * Prefixes 1 byte odd-length flag to handle Shamir shares with odd hex length.
 * Payload format: [1 byte: isOdd flag][binary share data]
 */
export async function encryptShareForGuardian(
  shareHex: string,
  guardianPublicKeyJwk: JsonWebKey,
): Promise<Uint8Array> {
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    guardianPublicKeyJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  // Shamir shares can have odd-length hex; pad to even for hexToUint8Array
  const isOdd = shareHex.length % 2 !== 0;
  const paddedHex = isOdd ? '0' + shareHex : shareHex;
  const shareData = hexToUint8Array(paddedHex);
  // Prepend odd-length flag byte
  const payload = new Uint8Array(1 + shareData.length);
  payload[0] = isOdd ? 1 : 0;
  payload.set(shareData, 1);
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, payload as BufferSource);
  return new Uint8Array(encrypted);
}

/**
 * Decrypt an RSA-OAEP encrypted share using a guardian's private key.
 * Returns the hex-encoded share string.
 * Reverses the odd-length encoding from encryptShareForGuardian.
 */
export async function decryptShareFromGuardian(
  encryptedShare: Uint8Array,
  guardianPrivateKeyJwk: JsonWebKey,
): Promise<string> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    guardianPrivateKeyJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  );
  const decrypted = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, encryptedShare as BufferSource);
  const decryptedArray = new Uint8Array(decrypted);
  const isOdd = decryptedArray[0] === 1;
  const hex = bytesToHex(decryptedArray.slice(1));
  // Strip leading zero that was added for padding
  return isOdd ? hex.slice(1) : hex;
}

/**
 * Generate an RSA-OAEP 2048-bit key pair for guardian key setup and testing.
 */
export async function generateGuardianKeyPair(): Promise<{
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  );
  const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  return { publicKey, privateKey };
}
