import { describe, it, expect } from 'vitest';

import EncryptionUtility from './EncryptionUtility';

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

  it('opens the full KEK to AK to VEK chain after a simulated password change (AK rewrap)', async () => {
    const vek = EncryptionUtility.generateVaultEncryptionKey();
    const accountKey = EncryptionUtility.generateVaultEncryptionKey();
    const oldKek = EncryptionUtility.generateVaultEncryptionKey();
    const newKek = EncryptionUtility.generateVaultEncryptionKey();

    const encryptedAccountKeyOld = await EncryptionUtility.encryptVaultEncryptionKey(accountKey, oldKek);
    const encryptedVek = await EncryptionUtility.encryptVaultEncryptionKey(vek, accountKey);

    const decryptedAccountKey = await EncryptionUtility.decryptVaultEncryptionKey(encryptedAccountKeyOld, oldKek);
    const encryptedAccountKeyNew = await EncryptionUtility.encryptVaultEncryptionKey(decryptedAccountKey, newKek);

    const accountKeyViaNewKek = await EncryptionUtility.decryptVaultEncryptionKey(encryptedAccountKeyNew, newKek);
    expect(accountKeyViaNewKek).toBe(accountKey);
    expect(await EncryptionUtility.decryptVaultEncryptionKey(encryptedVek, accountKeyViaNewKek)).toBe(vek);
  });

  it('encrypts and decrypts vault content with a VEK end-to-end', async () => {
    const vek = EncryptionUtility.generateVaultEncryptionKey();
    const ciphertext = await EncryptionUtility.symmetricEncrypt('vault-content', vek);
    expect(await EncryptionUtility.symmetricDecrypt(ciphertext, vek)).toBe('vault-content');
  });
});
