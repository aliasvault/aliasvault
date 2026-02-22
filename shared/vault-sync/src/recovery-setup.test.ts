import { describe, it, expect } from 'vitest';
import { setupGuardianRecovery } from './recovery-setup.js';
import {
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
  it('returns valid structure: recoveryKey(32), recoveryKeyHash(32), sharePackage with 3 shares', async () => {
    const { keys } = await createTestGuardianKeys();
    const result = await setupGuardianRecovery({
      masterPassword: 'test-password',
      guardianPublicKeys: [keys[0].publicKey, keys[1].publicKey, keys[2].publicKey],
      ownerCommitment: 'aabbccdd',
    });

    expect(result.recoveryKey).toBeInstanceOf(Uint8Array);
    expect(result.recoveryKey.length).toBe(32);
    expect(result.recoveryKeyHash).toBeInstanceOf(Uint8Array);
    expect(result.recoveryKeyHash.length).toBe(32);
    expect(result.sharePackage.shares).toHaveLength(3);
  });

  it('sharePackage has correct metadata: version=1, threshold=2, totalShares=3', async () => {
    const { keys } = await createTestGuardianKeys();
    const result = await setupGuardianRecovery({
      masterPassword: 'test-password',
      guardianPublicKeys: [keys[0].publicKey, keys[1].publicKey, keys[2].publicKey],
      ownerCommitment: 'aabbccdd',
    });

    expect(result.sharePackage.version).toBe(1);
    expect(result.sharePackage.threshold).toBe(2);
    expect(result.sharePackage.totalShares).toBe(3);
    expect(result.sharePackage.vaultOwnerCommitment).toBe('aabbccdd');
  });

  it('recoveryKeyHash matches sha256(bytesToHex(recoveryKey))', async () => {
    const { keys } = await createTestGuardianKeys();
    const result = await setupGuardianRecovery({
      masterPassword: 'test-password',
      guardianPublicKeys: [keys[0].publicKey, keys[1].publicKey, keys[2].publicKey],
      ownerCommitment: 'aabbccdd',
    });

    const expectedHash = await sha256(bytesToHex(result.recoveryKey));
    expect(bytesToHex(result.recoveryKeyHash)).toBe(bytesToHex(expectedHash));
  });

  it('full roundtrip: setup → decrypt 2 shares → combine → decrypt with recovery key → original password', async () => {
    const masterPassword = 'my-super-secret-password-123!';
    const { keys } = await createTestGuardianKeys();
    const result = await setupGuardianRecovery({
      masterPassword,
      guardianPublicKeys: [keys[0].publicKey, keys[1].publicKey, keys[2].publicKey],
      ownerCommitment: 'aabbccdd',
    });

    // Decrypt shares 0 and 1 with their respective guardian private keys
    const share0 = await decryptShareFromGuardian(
      base64ToUint8Array(result.sharePackage.shares[0].encryptedShare),
      keys[0].privateKey,
    );
    const share1 = await decryptShareFromGuardian(
      base64ToUint8Array(result.sharePackage.shares[1].encryptedShare),
      keys[1].privateKey,
    );

    // Combine any 2 shares → encrypted password hex
    const encryptedHex = combineShares([share0, share1]);

    // Convert hex back to Uint8Array and decrypt with recovery key
    const encryptedBytes = hexToUint8Array(encryptedHex);
    const recovered = await decryptWithRecoveryKey(encryptedBytes, result.recoveryKey);
    expect(recovered).toBe(masterPassword);
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
