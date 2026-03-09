import nacl from 'tweetnacl';

/**
 * X25519 hybrid encryption per ADR-008.
 * Ephemeral keypair provides forward secrecy.
 * Output format: [ephemeralPubKey(32) | nonce(24) | ciphertext]
 */
export class EmailEncryptor {
  /**
   * Encrypt email JSON with recipient's X25519 public key.
   * Ephemeral secret key is discarded after encryption (forward secrecy).
   */
  encrypt(emailJson: string, recipientPublicKey: Uint8Array): Uint8Array {
    if (recipientPublicKey.length !== 32) {
      throw new Error(`Invalid public key length: expected 32, got ${recipientPublicKey.length}`);
    }

    const ephemeral = nacl.box.keyPair();
    const nonce = nacl.randomBytes(24);
    const messageBytes = new TextEncoder().encode(emailJson);
    const encrypted = nacl.box(messageBytes, nonce, recipientPublicKey, ephemeral.secretKey);

    if (!encrypted) {
      throw new Error('Encryption failed');
    }

    // Package: [ephemeralPubKey(32) | nonce(24) | ciphertext]
    const result = new Uint8Array(32 + 24 + encrypted.length);
    result.set(ephemeral.publicKey, 0);
    result.set(nonce, 32);
    result.set(encrypted, 56);
    return result;
  }

  /**
   * Decrypt email encrypted with X25519 hybrid encryption.
   * Used for testing round-trip only — bridge never decrypts.
   */
  static decrypt(encrypted: Uint8Array, recipientSecretKey: Uint8Array): string {
    if (encrypted.length < 56) {
      throw new Error('Encrypted data too short');
    }

    const ephemeralPubKey = encrypted.slice(0, 32);
    const nonce = encrypted.slice(32, 56);
    const ciphertext = encrypted.slice(56);

    const decrypted = nacl.box.open(ciphertext, nonce, ephemeralPubKey, recipientSecretKey);
    if (!decrypted) {
      throw new Error('Decryption failed — wrong key or corrupted data');
    }

    return new TextDecoder().decode(decrypted);
  }
}
