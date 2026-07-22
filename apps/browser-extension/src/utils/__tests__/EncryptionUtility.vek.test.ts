import { describe, it, expect } from 'vitest';

import EncryptionUtility from '@/utils/EncryptionUtility';

describe('EncryptionUtility VEK wrap/unwrap (KEK/VEK model)', () => {
  it('generates a 256-bit VEK as base64', () => {
    const vek = EncryptionUtility.generateVaultEncryptionKey();
    expect(Buffer.from(vek, 'base64').length).toBe(32);
  });

  it('generates a unique VEK per call', () => {
    expect(EncryptionUtility.generateVaultEncryptionKey()).not.toBe(EncryptionUtility.generateVaultEncryptionKey());
  });

  it('round-trips a VEK through wrap and unwrap with the same KEK', async () => {
    const vek = EncryptionUtility.generateVaultEncryptionKey();
    const kek = EncryptionUtility.generateVaultEncryptionKey();

    const wrapped = await EncryptionUtility.wrapVaultEncryptionKey(vek, kek);
    expect(wrapped).not.toBe(vek);
    // IV(12) + ciphertext(32) + tag(16) = 60 bytes.
    expect(Buffer.from(wrapped, 'base64').length).toBe(60);

    const unwrapped = await EncryptionUtility.unwrapVaultEncryptionKey(wrapped, kek);
    expect(unwrapped).toBe(vek);
  });

  it('produces a different wrapped VEK per wrap call (random IV)', async () => {
    const vek = EncryptionUtility.generateVaultEncryptionKey();
    const kek = EncryptionUtility.generateVaultEncryptionKey();
    expect(await EncryptionUtility.wrapVaultEncryptionKey(vek, kek)).not.toBe(await EncryptionUtility.wrapVaultEncryptionKey(vek, kek));
  });

  it('rejects unwrapping with a wrong KEK (AES-GCM auth failure doubles as password check)', async () => {
    const vek = EncryptionUtility.generateVaultEncryptionKey();
    const kek = EncryptionUtility.generateVaultEncryptionKey();
    const wrongKek = EncryptionUtility.generateVaultEncryptionKey();

    const wrapped = await EncryptionUtility.wrapVaultEncryptionKey(vek, kek);
    await expect(EncryptionUtility.unwrapVaultEncryptionKey(wrapped, wrongKek)).rejects.toThrow();
  });

  it('unwraps a rewrapped VEK after a simulated password change', async () => {
    const vek = EncryptionUtility.generateVaultEncryptionKey();
    const oldKek = EncryptionUtility.generateVaultEncryptionKey();
    const newKek = EncryptionUtility.generateVaultEncryptionKey();

    // Password change: unwrap with old KEK, rewrap with new KEK. The VEK itself must survive unchanged.
    const wrappedOld = await EncryptionUtility.wrapVaultEncryptionKey(vek, oldKek);
    const unwrapped = await EncryptionUtility.unwrapVaultEncryptionKey(wrappedOld, oldKek);
    const wrappedNew = await EncryptionUtility.wrapVaultEncryptionKey(unwrapped, newKek);

    expect(await EncryptionUtility.unwrapVaultEncryptionKey(wrappedNew, newKek)).toBe(vek);
  });

  it('encrypts and decrypts vault content with a VEK end-to-end', async () => {
    const vek = EncryptionUtility.generateVaultEncryptionKey();
    const ciphertext = await EncryptionUtility.symmetricEncrypt('vault-content', vek);
    expect(await EncryptionUtility.symmetricDecrypt(ciphertext, vek)).toBe('vault-content');
  });
});
