/**
 * X25519 email decryption service.
 * Decrypts email blobs encrypted by the SMTP bridge (ADR-008).
 *
 * Blob format: [ephemeralPubKey(32) | nonce(24) | ciphertext]
 * Uses tweetnacl nacl.box.open() for X25519 authenticated decryption.
 */

import nacl from 'tweetnacl';

export interface DecryptedEmail {
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{ name: string; contentType: string; base64: string }>;
  receivedAt: number;
}

const HEADER_SIZE = 32 + 24; // ephemeralPubKey + nonce

/**
 * Decrypt an encrypted email blob using the recipient's X25519 private key.
 *
 * @param blob - Encrypted blob: [ephemeralPubKey(32) | nonce(24) | ciphertext]
 * @param userPrivateKey - Recipient's X25519 secret key (32 bytes)
 * @returns Parsed DecryptedEmail
 * @throws Error with 'EMAIL_DECRYPTION_FAILED' if decryption fails
 */
export function decryptEmailBlob(blob: Uint8Array, userPrivateKey: Uint8Array): DecryptedEmail {
  if (blob.length <= HEADER_SIZE) {
    throw new Error('EMAIL_DECRYPTION_FAILED: Blob too short — expected at least 57 bytes');
  }

  const ephemeralPubKey = blob.slice(0, 32);
  const nonce = blob.slice(32, 56);
  const ciphertext = blob.slice(56);

  const decrypted = nacl.box.open(ciphertext, nonce, ephemeralPubKey, userPrivateKey);
  if (!decrypted) {
    throw new Error('EMAIL_DECRYPTION_FAILED: Could not decrypt email — wrong key or corrupted data');
  }

  return JSON.parse(new TextDecoder().decode(decrypted));
}
