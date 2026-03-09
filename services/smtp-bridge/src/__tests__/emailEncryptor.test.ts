import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { EmailEncryptor } from '../services/emailEncryptor.js';

describe('EmailEncryptor', () => {
  const encryptor = new EmailEncryptor();

  it('encrypts and decrypts email JSON round-trip', () => {
    const recipientKeyPair = nacl.box.keyPair();
    const email = JSON.stringify({
      from: 'sender@example.com',
      to: 'alias@alias.id',
      subject: 'Test',
      body: 'Hello World',
      receivedAt: 1709553600,
    });

    const encrypted = encryptor.encrypt(email, recipientKeyPair.publicKey);
    const decrypted = EmailEncryptor.decrypt(encrypted, recipientKeyPair.secretKey);

    expect(decrypted).toBe(email);
  });

  it('produces output with correct format: [pubKey(32) | nonce(24) | ciphertext]', () => {
    const recipientKeyPair = nacl.box.keyPair();
    const message = 'test message';

    const encrypted = encryptor.encrypt(message, recipientKeyPair.publicKey);

    // Minimum size: 32 (pubKey) + 24 (nonce) + 16 (nacl.box overhead) + message length
    expect(encrypted.length).toBeGreaterThanOrEqual(56 + 16);

    // Ephemeral public key should be 32 bytes (different from recipient's)
    const ephemeralPub = encrypted.slice(0, 32);
    expect(ephemeralPub.length).toBe(32);
  });

  it('uses different ephemeral keys for each encryption (forward secrecy)', () => {
    const recipientKeyPair = nacl.box.keyPair();
    const message = 'same message';

    const enc1 = encryptor.encrypt(message, recipientKeyPair.publicKey);
    const enc2 = encryptor.encrypt(message, recipientKeyPair.publicKey);

    // Ephemeral public keys should differ
    const pub1 = enc1.slice(0, 32);
    const pub2 = enc2.slice(0, 32);
    expect(Buffer.from(pub1).equals(Buffer.from(pub2))).toBe(false);

    // But both decrypt to the same message
    expect(EmailEncryptor.decrypt(enc1, recipientKeyPair.secretKey)).toBe(message);
    expect(EmailEncryptor.decrypt(enc2, recipientKeyPair.secretKey)).toBe(message);
  });

  it('fails decryption with wrong key', () => {
    const recipientKeyPair = nacl.box.keyPair();
    const wrongKeyPair = nacl.box.keyPair();
    const message = 'secret message';

    const encrypted = encryptor.encrypt(message, recipientKeyPair.publicKey);

    expect(() => EmailEncryptor.decrypt(encrypted, wrongKeyPair.secretKey)).toThrow(
      'Decryption failed',
    );
  });

  it('throws on invalid public key length', () => {
    expect(() => encryptor.encrypt('test', new Uint8Array(16))).toThrow('Invalid public key length');
  });

  it('handles large email payloads with attachments', () => {
    const recipientKeyPair = nacl.box.keyPair();
    const largePayload = JSON.stringify({
      from: 'sender@example.com',
      to: 'alias@alias.id',
      subject: 'Large email',
      body: 'x'.repeat(10000),
      attachments: [{ name: 'file.txt', contentType: 'text/plain', base64: 'Y'.repeat(5000) }],
      receivedAt: 1709553600,
    });

    const encrypted = encryptor.encrypt(largePayload, recipientKeyPair.publicKey);
    const decrypted = EmailEncryptor.decrypt(encrypted, recipientKeyPair.secretKey);

    expect(decrypted).toBe(largePayload);
  });

  it('decrypt throws on data too short', () => {
    const key = nacl.box.keyPair().secretKey;
    expect(() => EmailEncryptor.decrypt(new Uint8Array(55), key)).toThrow('too short');
  });
});
