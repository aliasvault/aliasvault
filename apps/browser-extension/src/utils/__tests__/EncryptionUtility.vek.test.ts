import { describe, it, expect } from 'vitest';

import EncryptionUtility from '@/utils/EncryptionUtility';

describe('EncryptionUtility VEK encrypt/decrypt (KEK/VEK model)', () => {
  it('generates a 256-bit VEK as base64', () => {
    const vek = EncryptionUtility.generateVaultEncryptionKey();
    expect(Buffer.from(vek, 'base64').length).toBe(32);
  });

  it('generates a unique VEK per call', () => {
    expect(EncryptionUtility.generateVaultEncryptionKey()).not.toBe(EncryptionUtility.generateVaultEncryptionKey());
  });

  it('round-trips a VEK through encrypt and decrypt with the same KEK', async () => {
    const vek = EncryptionUtility.generateVaultEncryptionKey();
    const kek = EncryptionUtility.generateVaultEncryptionKey();

    const encrypted = await EncryptionUtility.encryptVaultEncryptionKey(vek, kek);
    expect(encrypted).not.toBe(vek);
    // IV(12) + ciphertext(32) + tag(16) = 60 bytes.
    expect(Buffer.from(encrypted, 'base64').length).toBe(60);

    const decrypted = await EncryptionUtility.decryptVaultEncryptionKey(encrypted, kek);
    expect(decrypted).toBe(vek);
  });

  it('produces a different encrypted VEK per encrypt call (random IV)', async () => {
    const vek = EncryptionUtility.generateVaultEncryptionKey();
    const kek = EncryptionUtility.generateVaultEncryptionKey();
    expect(await EncryptionUtility.encryptVaultEncryptionKey(vek, kek)).not.toBe(await EncryptionUtility.encryptVaultEncryptionKey(vek, kek));
  });

  it('rejects decrypting with a wrong KEK (AES-GCM auth failure doubles as password check)', async () => {
    const vek = EncryptionUtility.generateVaultEncryptionKey();
    const kek = EncryptionUtility.generateVaultEncryptionKey();
    const wrongKek = EncryptionUtility.generateVaultEncryptionKey();

    const encrypted = await EncryptionUtility.encryptVaultEncryptionKey(vek, kek);
    await expect(EncryptionUtility.decryptVaultEncryptionKey(encrypted, wrongKek)).rejects.toThrow();
  });

  it('decrypts a re-encrypted VEK after a simulated password change', async () => {
    const vek = EncryptionUtility.generateVaultEncryptionKey();
    const oldKek = EncryptionUtility.generateVaultEncryptionKey();
    const newKek = EncryptionUtility.generateVaultEncryptionKey();

    // Password change: decrypt with old KEK, re-encrypt with new KEK. The VEK itself must survive unchanged.
    const encryptedOld = await EncryptionUtility.encryptVaultEncryptionKey(vek, oldKek);
    const decrypted = await EncryptionUtility.decryptVaultEncryptionKey(encryptedOld, oldKek);
    const encryptedNew = await EncryptionUtility.encryptVaultEncryptionKey(decrypted, newKek);

    expect(await EncryptionUtility.decryptVaultEncryptionKey(encryptedNew, newKek)).toBe(vek);
  });

  it('encrypts and decrypts vault content with a VEK end-to-end', async () => {
    const vek = EncryptionUtility.generateVaultEncryptionKey();
    const ciphertext = await EncryptionUtility.symmetricEncrypt('vault-content', vek);
    expect(await EncryptionUtility.symmetricDecrypt(ciphertext, vek)).toBe('vault-content');
  });
});
