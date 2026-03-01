import { describe, it, expect, vi } from 'vitest';
import {
  claimRecovery,
  validateSharePackage,
  parseSharePackageFromBytes,
  validateShareFile,
  RecoveryClaimError,
  RecoveryClaimErrorCodes,
} from './recovery-claim.js';
import type { RecoveryShareFile, RecoveryClaimParams } from './recovery-claim.js';
import { setupGuardianRecovery } from './recovery-setup.js';
import type { GuardianSharePackage } from './recovery-setup.js';
import {
  generateGuardianKeyPair,
  decryptShareFromGuardian,
  deriveEncryptionKey,
} from './recovery-crypto.js';
import { sha256, bytesToHex, base64ToUint8Array, hexToUint8Array } from './utils.js';

/**
 * Helper: run full setup and decrypt shares for test fixtures.
 * Returns { sharePackage, recoveryKeyHash, shareFiles (all 3), masterPassword }.
 */
async function createTestFixture(masterPassword = 'my-super-secret-password-123!') {
  const g1 = await generateGuardianKeyPair();
  const g2 = await generateGuardianKeyPair();
  const g3 = await generateGuardianKeyPair();
  const keys = [g1, g2, g3] as const;

  const result = await setupGuardianRecovery({
    masterPassword,
    guardianPublicKeys: [keys[0].publicKey, keys[1].publicKey, keys[2].publicKey],
    ownerCommitment: 'aabbccdd',
  });

  // Decrypt all 3 shares
  const shareFiles: RecoveryShareFile[] = [];
  for (let i = 0; i < 3; i++) {
    const shareHex = await decryptShareFromGuardian(
      base64ToUint8Array(result.sharePackage.shares[i].encryptedShare),
      keys[i].privateKey,
    );
    shareFiles.push({ version: 1, shareIndex: i, shareHex });
  }

  return {
    sharePackage: result.sharePackage,
    recoveryKeyHash: result.recoveryKeyHash,
    shareFiles,
    masterPassword,
    keys,
  };
}

describe('claimRecovery', () => {
  it('happy path: 2 valid shares + correct on-chain hash → returns masterPassword', async () => {
    const fixture = await createTestFixture();

    const result = await claimRecovery({
      sharePackage: fixture.sharePackage,
      shareFiles: [fixture.shareFiles[0], fixture.shareFiles[1]],
      onChainRecoveryKeyHash: fixture.recoveryKeyHash,
    });

    expect(result.masterPassword).toBe(fixture.masterPassword);
  });

  it('3-of-3 shares: all shares provided still works', async () => {
    const fixture = await createTestFixture();

    const result = await claimRecovery({
      sharePackage: fixture.sharePackage,
      shareFiles: fixture.shareFiles,
      onChainRecoveryKeyHash: fixture.recoveryKeyHash,
    });

    expect(result.masterPassword).toBe(fixture.masterPassword);
  });

  it('error: INSUFFICIENT_SHARES when providing fewer shares than threshold', async () => {
    const fixture = await createTestFixture();

    await expect(
      claimRecovery({
        sharePackage: fixture.sharePackage,
        shareFiles: [fixture.shareFiles[0]], // only 1, need 2
        onChainRecoveryKeyHash: fixture.recoveryKeyHash,
      }),
    ).rejects.toThrow(RecoveryClaimError);

    try {
      await claimRecovery({
        sharePackage: fixture.sharePackage,
        shareFiles: [fixture.shareFiles[0]],
        onChainRecoveryKeyHash: fixture.recoveryKeyHash,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(RecoveryClaimError);
      expect((e as RecoveryClaimError).code).toBe(RecoveryClaimErrorCodes.INSUFFICIENT_SHARES);
      expect((e as RecoveryClaimError).message).toContain('Need at least 2');
    }
  });

  it('error: HASH_MISMATCH when on-chain hash does not match reconstructed secret', async () => {
    const fixture = await createTestFixture();
    const wrongHash = new Uint8Array(32).fill(0xff);

    await expect(
      claimRecovery({
        sharePackage: fixture.sharePackage,
        shareFiles: [fixture.shareFiles[0], fixture.shareFiles[1]],
        onChainRecoveryKeyHash: wrongHash,
      }),
    ).rejects.toThrow(RecoveryClaimError);

    try {
      await claimRecovery({
        sharePackage: fixture.sharePackage,
        shareFiles: [fixture.shareFiles[0], fixture.shareFiles[1]],
        onChainRecoveryKeyHash: wrongHash,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(RecoveryClaimError);
      expect((e as RecoveryClaimError).code).toBe(RecoveryClaimErrorCodes.HASH_MISMATCH);
    }
  });

  it('error: DECRYPTION_FAILED when encrypted password is corrupted', async () => {
    const fixture = await createTestFixture();

    // Corrupt the encrypted password
    const corruptedPackage: GuardianSharePackage = {
      ...fixture.sharePackage,
      encryptedPassword: 'AAAA', // invalid base64 → invalid AES-GCM ciphertext
    };

    await expect(
      claimRecovery({
        sharePackage: corruptedPackage,
        shareFiles: [fixture.shareFiles[0], fixture.shareFiles[1]],
        onChainRecoveryKeyHash: fixture.recoveryKeyHash,
      }),
    ).rejects.toThrow(RecoveryClaimError);

    try {
      await claimRecovery({
        sharePackage: corruptedPackage,
        shareFiles: [fixture.shareFiles[0], fixture.shareFiles[1]],
        onChainRecoveryKeyHash: fixture.recoveryKeyHash,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(RecoveryClaimError);
      expect((e as RecoveryClaimError).code).toBe(RecoveryClaimErrorCodes.DECRYPTION_FAILED);
    }
  });

  it('ephemeral key zeroing: encryptionKey is zeroed after successful claim', async () => {
    const fixture = await createTestFixture();

    // Spy on deriveEncryptionKey to capture the key before it gets zeroed
    const originalFill = Uint8Array.prototype.fill;
    let fillCalledWithZero = false;
    const fillSpy = vi.spyOn(Uint8Array.prototype, 'fill').mockImplementation(function (
      this: Uint8Array,
      ...args: Parameters<Uint8Array['fill']>
    ) {
      if (args[0] === 0 && this.length === 32) {
        fillCalledWithZero = true;
      }
      return originalFill.apply(this, args);
    });

    await claimRecovery({
      sharePackage: fixture.sharePackage,
      shareFiles: [fixture.shareFiles[0], fixture.shareFiles[1]],
      onChainRecoveryKeyHash: fixture.recoveryKeyHash,
    });

    expect(fillCalledWithZero).toBe(true);
    fillSpy.mockRestore();
  });
});

describe('validateSharePackage', () => {
  const validPackage: GuardianSharePackage = {
    version: 2,
    vaultOwnerCommitment: 'aabbccdd',
    threshold: 2,
    totalShares: 3,
    encryptedPassword: 'base64encrypteddata',
    shares: [
      { index: 0, encryptedShare: 'share0data' },
      { index: 1, encryptedShare: 'share1data' },
      { index: 2, encryptedShare: 'share2data' },
    ],
  };

  it('accepts valid v2 package', () => {
    const result = validateSharePackage(validPackage);
    expect(result.version).toBe(2);
    expect(result.threshold).toBe(2);
    expect(result.shares).toHaveLength(3);
  });

  it('rejects non-object (null)', () => {
    expect(() => validateSharePackage(null)).toThrow(RecoveryClaimError);
    expect(() => validateSharePackage(null)).toThrow('Share package must be an object');
  });

  it('rejects non-object (undefined)', () => {
    expect(() => validateSharePackage(undefined)).toThrow(RecoveryClaimError);
  });

  it('rejects non-object (string)', () => {
    expect(() => validateSharePackage('not an object')).toThrow(RecoveryClaimError);
  });

  it('rejects wrong version', () => {
    expect(() => validateSharePackage({ ...validPackage, version: 1 })).toThrow('Unsupported share package version: 1');
  });

  it('rejects missing encryptedPassword', () => {
    expect(() => validateSharePackage({ ...validPackage, encryptedPassword: '' })).toThrow(
      'Share package missing encryptedPassword',
    );
  });

  it('rejects non-string encryptedPassword', () => {
    expect(() => validateSharePackage({ ...validPackage, encryptedPassword: 123 })).toThrow(
      'Share package missing encryptedPassword',
    );
  });

  it('rejects missing threshold', () => {
    expect(() => validateSharePackage({ ...validPackage, threshold: 0 })).toThrow(
      'Share package missing or invalid threshold',
    );
  });

  it('rejects non-number threshold', () => {
    expect(() => validateSharePackage({ ...validPackage, threshold: 'two' })).toThrow(
      'Share package missing or invalid threshold',
    );
  });

  it('rejects missing totalShares', () => {
    expect(() => validateSharePackage({ ...validPackage, totalShares: 0 })).toThrow(
      'Share package missing or invalid totalShares',
    );
  });

  it('rejects missing vaultOwnerCommitment', () => {
    expect(() => validateSharePackage({ ...validPackage, vaultOwnerCommitment: '' })).toThrow(
      'Share package missing vaultOwnerCommitment',
    );
  });

  it('rejects empty shares array', () => {
    expect(() => validateSharePackage({ ...validPackage, shares: [] })).toThrow(
      'Share package must have non-empty shares array',
    );
  });

  it('rejects non-array shares', () => {
    expect(() => validateSharePackage({ ...validPackage, shares: 'not-array' })).toThrow(
      'Share package must have non-empty shares array',
    );
  });

  it('rejects invalid share entries (missing index)', () => {
    expect(() =>
      validateSharePackage({
        ...validPackage,
        shares: [{ encryptedShare: 'data' }],
      }),
    ).toThrow('Invalid share at index 0');
  });

  it('rejects invalid share entries (missing encryptedShare)', () => {
    expect(() =>
      validateSharePackage({
        ...validPackage,
        shares: [{ index: 0 }],
      }),
    ).toThrow('Invalid share at index 0');
  });
});

describe('parseSharePackageFromBytes', () => {
  const validPackage: GuardianSharePackage = {
    version: 2,
    vaultOwnerCommitment: 'aabbccdd',
    threshold: 2,
    totalShares: 3,
    encryptedPassword: 'base64encrypteddata',
    shares: [
      { index: 0, encryptedShare: 'share0data' },
      { index: 1, encryptedShare: 'share1data' },
      { index: 2, encryptedShare: 'share2data' },
    ],
  };

  it('parses valid JSON bytes', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(validPackage));
    const result = parseSharePackageFromBytes(bytes);
    expect(result.version).toBe(2);
    expect(result.shares).toHaveLength(3);
  });

  it('rejects invalid JSON', () => {
    const bytes = new TextEncoder().encode('not valid json{{{');
    expect(() => parseSharePackageFromBytes(bytes)).toThrow('Share package is not valid JSON');
  });

  it('rejects valid JSON that fails validation', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1 }));
    expect(() => parseSharePackageFromBytes(bytes)).toThrow(RecoveryClaimError);
  });
});

describe('validateShareFile', () => {
  const validShareFile: RecoveryShareFile = {
    version: 1,
    shareIndex: 0,
    shareHex: 'deadbeef1234',
  };

  it('accepts valid v1 share file', () => {
    const result = validateShareFile(validShareFile);
    expect(result.version).toBe(1);
    expect(result.shareIndex).toBe(0);
    expect(result.shareHex).toBe('deadbeef1234');
  });

  it('rejects non-object (null)', () => {
    expect(() => validateShareFile(null)).toThrow('Share file must be an object');
  });

  it('rejects non-object (undefined)', () => {
    expect(() => validateShareFile(undefined)).toThrow(RecoveryClaimError);
  });

  it('rejects non-object (number)', () => {
    expect(() => validateShareFile(42)).toThrow(RecoveryClaimError);
  });

  it('rejects wrong version', () => {
    expect(() => validateShareFile({ ...validShareFile, version: 2 })).toThrow(
      'Unsupported share file version: 2',
    );
  });

  it('rejects missing shareIndex', () => {
    expect(() => validateShareFile({ version: 1, shareHex: 'abc' })).toThrow(
      'Share file missing shareIndex',
    );
  });

  it('rejects missing shareHex', () => {
    expect(() => validateShareFile({ version: 1, shareIndex: 0 })).toThrow(
      'Share file missing shareHex',
    );
  });

  it('rejects empty shareHex', () => {
    expect(() => validateShareFile({ version: 1, shareIndex: 0, shareHex: '' })).toThrow(
      'Share file missing shareHex',
    );
  });
});

describe('claimRecovery full roundtrip', () => {
  it('setupGuardianRecovery → decrypt 2 shares → claimRecovery → verify recovered password', async () => {
    const masterPassword = 'roundtrip-test-password-456!';
    const fixture = await createTestFixture(masterPassword);

    // Use shares 0 and 2 (any 2-of-3 combination)
    const result = await claimRecovery({
      sharePackage: fixture.sharePackage,
      shareFiles: [fixture.shareFiles[0], fixture.shareFiles[2]],
      onChainRecoveryKeyHash: fixture.recoveryKeyHash,
    });

    expect(result.masterPassword).toBe(masterPassword);
  });

  it('works with shares 1 and 2 (different 2-of-3 combination)', async () => {
    const masterPassword = 'another-roundtrip-test!';
    const fixture = await createTestFixture(masterPassword);

    const result = await claimRecovery({
      sharePackage: fixture.sharePackage,
      shareFiles: [fixture.shareFiles[1], fixture.shareFiles[2]],
      onChainRecoveryKeyHash: fixture.recoveryKeyHash,
    });

    expect(result.masterPassword).toBe(masterPassword);
  });
});
