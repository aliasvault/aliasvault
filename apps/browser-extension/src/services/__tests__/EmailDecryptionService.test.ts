import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { decryptEmailBlob, DecryptedEmail } from '../EmailDecryptionService';

/**
 * Helper: encrypt email JSON using X25519 hybrid encryption (mirrors bridge EmailEncryptor).
 * Output format: [ephemeralPubKey(32) | nonce(24) | ciphertext]
 */
function encryptForTest(emailJson: string, recipientPublicKey: Uint8Array): Uint8Array {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const messageBytes = new TextEncoder().encode(emailJson);
  const encrypted = nacl.box(messageBytes, nonce, recipientPublicKey, ephemeral.secretKey);
  if (!encrypted) throw new Error('Test encryption failed');

  const result = new Uint8Array(32 + 24 + encrypted.length);
  result.set(ephemeral.publicKey, 0);
  result.set(nonce, 32);
  result.set(encrypted, 56);
  return result;
}

const TEST_EMAIL: DecryptedEmail = {
  from: 'sender@example.com',
  to: 'alias@alias.id',
  subject: 'Test email',
  body: 'Hello from the blockchain!',
  receivedAt: 1709553600,
};

const TEST_EMAIL_WITH_ATTACHMENTS: DecryptedEmail = {
  from: 'sender@example.com',
  to: 'alias@alias.id',
  subject: 'With attachment',
  body: 'See attached.',
  attachments: [
    { name: 'doc.pdf', contentType: 'application/pdf', base64: 'dGVzdA==' },
  ],
  receivedAt: 1709554200,
};

describe('decryptEmailBlob', () => {
  const keyPair = nacl.box.keyPair();

  it('decrypts a valid encrypted email blob', () => {
    const blob = encryptForTest(JSON.stringify(TEST_EMAIL), keyPair.publicKey);
    const result = decryptEmailBlob(blob, keyPair.secretKey);

    expect(result.from).toBe(TEST_EMAIL.from);
    expect(result.to).toBe(TEST_EMAIL.to);
    expect(result.subject).toBe(TEST_EMAIL.subject);
    expect(result.body).toBe(TEST_EMAIL.body);
    expect(result.receivedAt).toBe(TEST_EMAIL.receivedAt);
    expect(result.attachments).toBeUndefined();
  });

  it('decrypts email with attachments', () => {
    const blob = encryptForTest(JSON.stringify(TEST_EMAIL_WITH_ATTACHMENTS), keyPair.publicKey);
    const result = decryptEmailBlob(blob, keyPair.secretKey);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments![0].name).toBe('doc.pdf');
    expect(result.attachments![0].contentType).toBe('application/pdf');
    expect(result.attachments![0].base64).toBe('dGVzdA==');
  });

  it('throws EMAIL_DECRYPTION_FAILED for corrupted blob', () => {
    const blob = encryptForTest(JSON.stringify(TEST_EMAIL), keyPair.publicKey);
    // Corrupt the ciphertext portion
    blob[60] ^= 0xff;
    blob[61] ^= 0xff;

    expect(() => decryptEmailBlob(blob, keyPair.secretKey)).toThrow('EMAIL_DECRYPTION_FAILED');
  });

  it('throws EMAIL_DECRYPTION_FAILED for wrong key', () => {
    const wrongKey = nacl.box.keyPair();
    const blob = encryptForTest(JSON.stringify(TEST_EMAIL), keyPair.publicKey);

    expect(() => decryptEmailBlob(blob, wrongKey.secretKey)).toThrow('EMAIL_DECRYPTION_FAILED');
  });

  it('throws for truncated blob (less than 56 bytes header)', () => {
    const shortBlob = new Uint8Array(40);

    expect(() => decryptEmailBlob(shortBlob, keyPair.secretKey)).toThrow();
  });

  it('throws for empty blob', () => {
    const emptyBlob = new Uint8Array(0);

    expect(() => decryptEmailBlob(emptyBlob, keyPair.secretKey)).toThrow();
  });

  it('throws for blob with valid header but no ciphertext', () => {
    // 32 + 24 = 56 bytes header, 0 bytes ciphertext
    const headerOnly = new Uint8Array(56);

    expect(() => decryptEmailBlob(headerOnly, keyPair.secretKey)).toThrow('EMAIL_DECRYPTION_FAILED');
  });
});
