import { describe, it, expect } from 'vitest';
import {
  generateRecoveryKey,
  encryptWithRecoveryKey,
  decryptWithRecoveryKey,
  splitIntoShares,
  combineShares,
  encryptShareForGuardian,
  decryptShareFromGuardian,
  generateGuardianKeyPair,
} from './recovery-crypto.js';
import { bytesToHex } from './utils.js';

describe('generateRecoveryKey', () => {
  it('returns a 32-byte Uint8Array', async () => {
    const key = await generateRecoveryKey();
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it('returns unique keys on each call', async () => {
    const key1 = await generateRecoveryKey();
    const key2 = await generateRecoveryKey();
    expect(bytesToHex(key1)).not.toBe(bytesToHex(key2));
  });
});

describe('encryptWithRecoveryKey / decryptWithRecoveryKey', () => {
  it('roundtrip: encrypt then decrypt returns original plaintext', async () => {
    const key = await generateRecoveryKey();
    const plaintext = 'my-secret-password';
    const encrypted = await encryptWithRecoveryKey(plaintext, key);
    const decrypted = await decryptWithRecoveryKey(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it('encrypted output has iv(12) + ciphertext format', async () => {
    const key = await generateRecoveryKey();
    const encrypted = await encryptWithRecoveryKey('test', key);
    expect(encrypted.length).toBeGreaterThan(12);
  });

  it('decryption with wrong key throws', async () => {
    const key1 = await generateRecoveryKey();
    const key2 = await generateRecoveryKey();
    const encrypted = await encryptWithRecoveryKey('secret', key1);
    await expect(decryptWithRecoveryKey(encrypted, key2)).rejects.toThrow();
  });

  it('handles empty string password', async () => {
    const key = await generateRecoveryKey();
    const encrypted = await encryptWithRecoveryKey('', key);
    const decrypted = await decryptWithRecoveryKey(encrypted, key);
    expect(decrypted).toBe('');
  });

  it('handles unicode/emoji password', async () => {
    const key = await generateRecoveryKey();
    const plaintext = 'p@ssw0rd-with-ünïcödé-and-emojis';
    const encrypted = await encryptWithRecoveryKey(plaintext, key);
    const decrypted = await decryptWithRecoveryKey(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it('handles long password (128 chars)', async () => {
    const key = await generateRecoveryKey();
    const plaintext = 'A'.repeat(128);
    const encrypted = await encryptWithRecoveryKey(plaintext, key);
    const decrypted = await decryptWithRecoveryKey(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });
});

describe('splitIntoShares / combineShares', () => {
  it('splits hex string into requested number of shares', () => {
    const hex = 'deadbeefcafebabe';
    const shares = splitIntoShares(hex, 3, 2);
    expect(shares).toHaveLength(3);
    shares.forEach((s) => {
      expect(s).toBeTruthy();
      expect(typeof s).toBe('string');
    });
  });

  it('roundtrip: any 2 of 3 shares reconstruct original', () => {
    const hex = 'deadbeefcafebabe';
    const shares = splitIntoShares(hex, 3, 2);

    expect(combineShares([shares[0], shares[1]])).toBe(hex);
    expect(combineShares([shares[0], shares[2]])).toBe(hex);
    expect(combineShares([shares[1], shares[2]])).toBe(hex);
  });

  it('single share cannot reconstruct original', () => {
    const hex = 'deadbeefcafebabe';
    const shares = splitIntoShares(hex, 3, 2);
    const result = combineShares([shares[0]]);
    expect(result).not.toBe(hex);
  });
});

describe('encryptShareForGuardian / decryptShareFromGuardian', () => {
  it('roundtrip: encrypt then decrypt returns original share hex', async () => {
    const keyPair = await generateGuardianKeyPair();
    const shareHex = 'abcdef1234567890';
    const encrypted = await encryptShareForGuardian(shareHex, keyPair.publicKey);
    expect(encrypted).toBeInstanceOf(Uint8Array);
    const decrypted = await decryptShareFromGuardian(encrypted, keyPair.privateKey);
    expect(decrypted).toBe(shareHex);
  });

  it('decryption with wrong private key throws', async () => {
    const keyPair1 = await generateGuardianKeyPair();
    const keyPair2 = await generateGuardianKeyPair();
    const shareHex = 'abcdef1234567890';
    const encrypted = await encryptShareForGuardian(shareHex, keyPair1.publicKey);
    await expect(decryptShareFromGuardian(encrypted, keyPair2.privateKey)).rejects.toThrow();
  });

  it('handles long share hex (128-char password equivalent)', async () => {
    // 128-char password → AES-GCM → ~156 bytes → hex ~312 chars → Shamir share ~314 chars
    // Binary encoding: ~157 bytes — well within RSA-OAEP 190-byte limit
    const key = await generateRecoveryKey();
    const longPassword = 'A'.repeat(128);
    const encrypted = await encryptWithRecoveryKey(longPassword, key);
    const hex = bytesToHex(encrypted);
    const shares = splitIntoShares(hex, 3, 2);

    const keyPair = await generateGuardianKeyPair();
    const encryptedShare = await encryptShareForGuardian(shares[0], keyPair.publicKey);
    const decryptedShare = await decryptShareFromGuardian(encryptedShare, keyPair.privateKey);
    expect(decryptedShare).toBe(shares[0]);
  });
});

describe('generateGuardianKeyPair', () => {
  it('returns valid JWK public and private keys', async () => {
    const keyPair = await generateGuardianKeyPair();
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey).toBeDefined();
    expect(keyPair.publicKey.kty).toBe('RSA');
    expect(keyPair.publicKey.alg).toBe('RSA-OAEP-256');
    expect(keyPair.privateKey.kty).toBe('RSA');
    expect(keyPair.privateKey.d).toBeDefined();
  });
});
