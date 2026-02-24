import { describe, it, expect, vi } from 'vitest';
import { persistGuardianRecovery, type RecoveryPersistProvider } from './recovery-persist.js';
import type { SetupResult, GuardianSharePackage } from './recovery-setup.js';
import { sha256 } from './utils.js';

function createMockProvider(cid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenesa'): RecoveryPersistProvider {
  return {
    uploadToIpfs: vi.fn().mockResolvedValue(cid),
    storeSharesCidHash: vi.fn().mockResolvedValue(undefined),
    storeRecoveryKeyHash: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockSetupResult(): SetupResult {
  const sharePackage: GuardianSharePackage = {
    version: 2,
    vaultOwnerCommitment: 'aabbccdd',
    threshold: 2,
    totalShares: 3,
    encryptedPassword: 'ZW5jcnlwdGVkUGFzc3dvcmQ=',
    shares: [
      { index: 0, encryptedShare: 'c2hhcmUw' },
      { index: 1, encryptedShare: 'c2hhcmUx' },
      { index: 2, encryptedShare: 'c2hhcmUy' },
    ],
  };
  return {
    recoveryKeyHash: new Uint8Array(32).fill(0xcd),
    sharePackage,
  };
}

describe('persistGuardianRecovery', () => {
  it('calls all 3 provider methods in correct order', async () => {
    const provider = createMockProvider();
    const setupResult = createMockSetupResult();
    const callOrder: string[] = [];

    (provider.uploadToIpfs as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('uploadToIpfs');
      return 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenesa';
    });
    (provider.storeSharesCidHash as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('storeSharesCidHash');
    });
    (provider.storeRecoveryKeyHash as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('storeRecoveryKeyHash');
    });

    await persistGuardianRecovery(setupResult, provider);

    expect(callOrder).toEqual([
      'uploadToIpfs',
      'storeSharesCidHash',
      'storeRecoveryKeyHash',
    ]);
  });

  it('uploads valid JSON with v2 structure including encryptedPassword to IPFS', async () => {
    const provider = createMockProvider();
    const setupResult = createMockSetupResult();

    await persistGuardianRecovery(setupResult, provider);

    const uploadCall = (provider.uploadToIpfs as ReturnType<typeof vi.fn>).mock.calls[0];
    const uploadedBytes = uploadCall[0] as Uint8Array;
    const json = JSON.parse(new TextDecoder().decode(uploadedBytes));

    expect(json.version).toBe(2);
    expect(json.threshold).toBe(2);
    expect(json.totalShares).toBe(3);
    expect(json.shares).toHaveLength(3);
    expect(json.vaultOwnerCommitment).toBe('aabbccdd');
    expect(json.encryptedPassword).toBe('ZW5jcnlwdGVkUGFzc3dvcmQ=');
  });

  it('throws on CIDv0 (assertCIDv1 validation)', async () => {
    const provider = createMockProvider('QmOldCidV0FormatThatShouldBeRejected');
    const setupResult = createMockSetupResult();

    await expect(persistGuardianRecovery(setupResult, provider)).rejects.toThrow('CIDv0');
  });

  it('stores SHA-256 of CID string as sharesCidHash', async () => {
    const cid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenesa';
    const provider = createMockProvider(cid);
    const setupResult = createMockSetupResult();

    await persistGuardianRecovery(setupResult, provider);

    const expectedHash = await sha256(cid);
    const storedHash = (provider.storeSharesCidHash as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(new Uint8Array(storedHash)).toEqual(expectedHash);
  });

  it('returns sharesCid from provider', async () => {
    const cid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenesa';
    const provider = createMockProvider(cid);
    const setupResult = createMockSetupResult();

    const result = await persistGuardianRecovery(setupResult, provider);
    expect(result.sharesCid).toBe(cid);
  });

  it('propagates error if IPFS upload fails', async () => {
    const provider = createMockProvider();
    (provider.uploadToIpfs as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('IPFS upload failed'),
    );
    const setupResult = createMockSetupResult();

    await expect(persistGuardianRecovery(setupResult, provider)).rejects.toThrow(
      'IPFS upload failed',
    );
  });
});
