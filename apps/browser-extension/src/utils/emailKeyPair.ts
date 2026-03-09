/**
 * X25519 email keypair generation and vault storage utilities.
 * Used for end-to-end encrypted email delivery via the SMTP bridge.
 *
 * Keypair is stored in VaultJson settings as hex-encoded strings:
 * - emailPublicKey: X25519 public key (64 hex chars = 32 bytes)
 * - emailPrivateKey: X25519 private key (64 hex chars = 32 bytes)
 *
 * The vault is encrypted at rest, so the private key is safe in settings.
 */

import nacl from 'tweetnacl';
import { bytesToHex, hexToBytes, isValidHex } from './hex';

export interface EmailKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/**
 * Generate a new X25519 keypair for email encryption.
 */
export function generateEmailKeyPair(): EmailKeyPair {
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: keyPair.publicKey,
    secretKey: keyPair.secretKey,
  };
}

/**
 * Read email keypair from vault settings.
 * Returns null if no keypair is stored.
 */
export function getEmailKeyPairFromSettings(
  settings: Record<string, string>,
): EmailKeyPair | null {
  const pubHex = settings.emailPublicKey;
  const privHex = settings.emailPrivateKey;

  if (!pubHex || !privHex) {
    return null;
  }

  if (!isValidHex(pubHex, 64) || !isValidHex(privHex, 64)) {
    return null;
  }

  return {
    publicKey: hexToBytes(pubHex),
    secretKey: hexToBytes(privHex),
  };
}

/**
 * Store email keypair in vault settings as hex strings.
 * Mutates the settings object in place.
 */
export function storeEmailKeyPairInSettings(
  settings: Record<string, string>,
  keyPair: EmailKeyPair,
): void {
  settings.emailPublicKey = bytesToHex(keyPair.publicKey);
  settings.emailPrivateKey = bytesToHex(keyPair.secretKey);
}
