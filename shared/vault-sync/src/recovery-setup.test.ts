import { describe, it, expect } from 'vitest';
import { setupGuardianRecovery } from './recovery-setup.js';
import {
  deriveEncryptionKey,
  decryptShareFromGuardian,
  combineShares,
  decryptWithRecoveryKey,
  generateGuardianKeyPair,
} from './recovery-crypto.js';
import { sha256, bytesToHex, base64ToUint8Array, hexToUint8Array } from './utils.js';

async function createTestGuardianKeys() {
  const g1 = await generateGuardianKeyPair();
  const g2 = await generateGuardianKeyPair();
  const g3 = await generateGuardianKeyPair();
  return { keys: [g1, g2, g3] as const };
}

describe('setupGuardianRecovery', () => {
  it('returns valid structure: no recoveryKey, has recoveryKeyHash(32) and sharePackage with 3 shares', async () => {
    const { keys } = await createTestGuardianKeys();
    const result = await setupGuardianRecovery({
      masterPassword: 'test-password',
      guardianPublicKeys: [keys[0].publicKey, keys[1].publicKey, keys[2].publicKey],
      ownerCommitment: 'aabbccdd',
    });

    // v2: NO recoveryKey in result
    expect((result as Record<string, unknown>).recoveryKey).toBeUndefined();
    expect(result.recoveryKeyHash).toBeInstanceOf(Uint8Array);
    expect(result.recoveryKeyHash.length).toBe(32);
    expect(result.sharePackage.shares).toHaveLength(3);
  });

  it('sharePackage has correct metadata: version=2, threshold=2, totalShares=3, encryptedPassword present', async () => {
    const { keys } = await createTestGuardianKeys();
    const result = await setupGuardianRecovery({
      masterPassword: 'test-password',
      guardianPublicKeys: [keys[0].publicKey, keys[1].publicKey, keys[2].publicKey],
      ownerCommitment: 'aabbccdd',
    });

    expect(result.sharePackage.version).toBe(2);
    expect(result.sharePackage.threshold).toBe(2);
    expect(result.sharePackage.totalShares).toBe(3);
    expect(result.sharePackage.vaultOwnerCommitment).toBe('aabbccdd');
    expect(result.sharePackage.encryptedPassword).toBeTruthy();
    expect(typeof result.sharePackage.encryptedPassword).toBe('string');
  });

  it('full roundtrip v2: setup → decrypt 2 shares → combine → verify hash → derive key → decrypt password', async () => {
    const masterPassword = 'my-super-secret-password-123!';
    const { keys } = await createTestGuardianKeys();
    const result = await setupGuardianRecovery({
      masterPassword,
      guardianPublicKeys: [keys[0].publicKey, keys[1].publicKey, keys[2].publicKey],
      ownerCommitment: 'aabbccdd',
    });

    // 1. Decrypt 2 shares with guardian private keys
    const share0 = await decryptShareFromGuardian(
      base64ToUint8Array(result.sharePackage.shares[0].encryptedShare),
      keys[0].privateKey,
    );
    const share1 = await decryptShareFromGuardian(
      base64ToUint8Array(result.sharePackage.shares[1].encryptedShare),
      keys[1].privateKey,
    );

    // 2. Combine any 2 shares → shamirSecret hex
    const shamirSecretHex = combineShares([share0, share1]);

    // 3. Verify on-chain hash: SHA-256(shamirSecretHex) matches recoveryKeyHash
    const hashCheck = await sha256(shamirSecretHex);
    expect(bytesToHex(hashCheck)).toBe(bytesToHex(result.recoveryKeyHash));

    // 4. Derive encryption key from Shamir secret
    const encryptionKey = await deriveEncryptionKey(hexToUint8Array(shamirSecretHex));

    // 5. Decrypt encrypted password from IPFS package
    const encryptedPassword = base64ToUint8Array(result.sharePackage.encryptedPassword);
    const recovered = await decryptWithRecoveryKey(encryptedPassword, encryptionKey);
    expect(recovered).toBe(masterPassword);
  });

  it('recoveryKeyHash is verified via roundtrip (hash of shamirSecret hex)', async () => {
    const { keys } = await createTestGuardianKeys();
    const result = await setupGuardianRecovery({
      masterPassword: 'test-password',
      guardianPublicKeys: [keys[0].publicKey, keys[1].publicKey, keys[2].publicKey],
      ownerCommitment: 'aabbccdd',
    });

    // Decrypt all 3 shares and combine with different pairs to verify consistency
    const share0 = await decryptShareFromGuardian(
      base64ToUint8Array(result.sharePackage.shares[0].encryptedShare),
      keys[0].privateKey,
    );
    const share2 = await decryptShareFromGuardian(
      base64ToUint8Array(result.sharePackage.shares[2].encryptedShare),
      keys[2].privateKey,
    );

    const shamirSecretHex = combineShares([share0, share2]);
    const expectedHash = await sha256(shamirSecretHex);
    expect(bytesToHex(result.recoveryKeyHash)).toBe(bytesToHex(expectedHash));
  });

  it('throws on empty masterPassword', async () => {
    const { keys } = await createTestGuardianKeys();
    await expect(
      setupGuardianRecovery({
        masterPassword: '',
        guardianPublicKeys: [keys[0].publicKey, keys[1].publicKey, keys[2].publicKey],
        ownerCommitment: 'aabbccdd',
      }),
    ).rejects.toThrow('masterPassword is required');
  });

  it('throws on wrong number of guardian keys', async () => {
    const g1 = await generateGuardianKeyPair();
    const g2 = await generateGuardianKeyPair();
    await expect(
      setupGuardianRecovery({
        masterPassword: 'test',
        guardianPublicKeys: [g1.publicKey, g2.publicKey] as unknown as [JsonWebKey, JsonWebKey, JsonWebKey],
        ownerCommitment: 'aabbccdd',
      }),
    ).rejects.toThrow('Exactly 3 guardian public keys are required');
  });

  it('throws on empty ownerCommitment', async () => {
    const { keys } = await createTestGuardianKeys();
    await expect(
      setupGuardianRecovery({
        masterPassword: 'test',
        guardianPublicKeys: [keys[0].publicKey, keys[1].publicKey, keys[2].publicKey],
        ownerCommitment: '',
      }),
    ).rejects.toThrow('ownerCommitment is required');
  });
});
