import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock external dependencies BEFORE importing the module under test
vi.mock('@aliasvault/contract', () => ({
  assertCIDv1: vi.fn((cid: string) => {
    if (cid.startsWith('Qm')) throw new Error('CIDv0 detected');
    if (!/^[a-z2-7]/.test(cid)) throw new Error('CID must be base32 encoded (CIDv1)');
  }),
}));

vi.mock('@aliasvault/vault-sync', () => ({
  validateSharePackage: vi.fn((data: unknown) => data),
  decryptShareFromGuardian: vi.fn(),
  base64ToUint8Array: vi.fn((b64: string) => new TextEncoder().encode(b64)),
}));

import {
  fetchSharePackage,
  decryptGuardianShare,
  findGuardianShareIndex,
  canReleaseShare,
} from '../shareReleaseService';
import { validateSharePackage, decryptShareFromGuardian } from '@aliasvault/vault-sync';
import type { GuardianSharePackage } from '@aliasvault/vault-sync';

const mockValidateSharePackage = vi.mocked(validateSharePackage);
const mockDecryptShareFromGuardian = vi.mocked(decryptShareFromGuardian);

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

const testRsaPrivateKey: JsonWebKey = {
  kty: 'RSA',
  n: 'test-n',
  e: 'AQAB',
  d: 'test-d',
};

describe('fetchSharePackage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and returns a validated share package with valid CID', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(validPackage),
    }) as unknown as typeof fetch;

    mockValidateSharePackage.mockReturnValue(validPackage);

    const result = await fetchSharePackage('bafyvalidcidtest123');

    expect(result.version).toBe(2);
    expect(result.shares).toHaveLength(3);
    expect(fetch).toHaveBeenCalledWith(
      'https://gateway.pinata.cloud/ipfs/bafyvalidcidtest123',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockValidateSharePackage).toHaveBeenCalledWith(validPackage);
  });

  it('uses custom gateway URL when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(validPackage),
    }) as unknown as typeof fetch;
    mockValidateSharePackage.mockReturnValue(validPackage);

    await fetchSharePackage('bafyvalidcidtest123', 'https://custom.gateway.io/ipfs');

    expect(fetch).toHaveBeenCalledWith(
      'https://custom.gateway.io/ipfs/bafyvalidcidtest123',
      expect.any(Object),
    );
  });

  it('rejects CIDv0 (starts with Qm)', async () => {
    await expect(fetchSharePackage('QmInvalidCIDv0')).rejects.toThrow('CIDv0 detected');
  });

  it('throws on HTTP error response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;

    await expect(fetchSharePackage('bafyvalidcidtest123')).rejects.toThrow(
      'Failed to fetch share package: HTTP 404',
    );
  });

  it('throws on network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch;

    await expect(fetchSharePackage('bafyvalidcidtest123')).rejects.toThrow('Network error');
  });
});

describe('decryptGuardianShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a valid RecoveryShareFile for a known share index', async () => {
    mockDecryptShareFromGuardian.mockResolvedValue('deadbeef1234');

    const result = await decryptGuardianShare(validPackage, 1, testRsaPrivateKey);

    expect(result).toEqual({
      version: 1,
      shareIndex: 1,
      shareHex: 'deadbeef1234',
    });
    expect(mockDecryptShareFromGuardian).toHaveBeenCalledTimes(1);
  });

  it('throws when share index not found in package', async () => {
    await expect(decryptGuardianShare(validPackage, 99, testRsaPrivateKey)).rejects.toThrow(
      'Share at index 99 not found in package',
    );
    expect(mockDecryptShareFromGuardian).not.toHaveBeenCalled();
  });

  it('propagates decryption errors', async () => {
    mockDecryptShareFromGuardian.mockRejectedValue(new Error('RSA decryption failed'));

    await expect(decryptGuardianShare(validPackage, 0, testRsaPrivateKey)).rejects.toThrow(
      'RSA decryption failed',
    );
  });
});

describe('findGuardianShareIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds the correct index when the second share decrypts successfully', async () => {
    mockDecryptShareFromGuardian
      .mockRejectedValueOnce(new Error('Wrong key'))
      .mockResolvedValueOnce('share1hex');

    const index = await findGuardianShareIndex(validPackage, testRsaPrivateKey);

    expect(index).toBe(1);
    expect(mockDecryptShareFromGuardian).toHaveBeenCalledTimes(2);
  });

  it('finds the first share (index 0) when it decrypts successfully', async () => {
    mockDecryptShareFromGuardian.mockResolvedValueOnce('share0hex');

    const index = await findGuardianShareIndex(validPackage, testRsaPrivateKey);

    expect(index).toBe(0);
    expect(mockDecryptShareFromGuardian).toHaveBeenCalledTimes(1);
  });

  it('finds the last share (index 2) when only it decrypts successfully', async () => {
    mockDecryptShareFromGuardian
      .mockRejectedValueOnce(new Error('Wrong key'))
      .mockRejectedValueOnce(new Error('Wrong key'))
      .mockResolvedValueOnce('share2hex');

    const index = await findGuardianShareIndex(validPackage, testRsaPrivateKey);

    expect(index).toBe(2);
    expect(mockDecryptShareFromGuardian).toHaveBeenCalledTimes(3);
  });

  it('throws when no share can be decrypted (wrong guardian key)', async () => {
    mockDecryptShareFromGuardian
      .mockRejectedValueOnce(new Error('Wrong key'))
      .mockRejectedValueOnce(new Error('Wrong key'))
      .mockRejectedValueOnce(new Error('Wrong key'));

    await expect(findGuardianShareIndex(validPackage, testRsaPrivateKey)).rejects.toThrow(
      'No share found for this guardian key',
    );
    expect(mockDecryptShareFromGuardian).toHaveBeenCalledTimes(3);
  });
});

describe('canReleaseShare', () => {
  const NOW_SECONDS = Math.floor(Date.now() / 1000);
  const SEVENTY_TWO_HOURS = 259_200;

  it('returns canRelease: true when all conditions met (time-lock expired)', () => {
    const pastTime = BigInt(NOW_SECONDS - SEVENTY_TWO_HOURS - 100);
    const result = canReleaseShare(pastTime, 2, 2, false);
    expect(result).toEqual({ canRelease: true });
  });

  it('returns false when recovery already completed', () => {
    const pastTime = BigInt(NOW_SECONDS - SEVENTY_TWO_HOURS - 100);
    const result = canReleaseShare(pastTime, 2, 2, true);
    expect(result).toEqual({ canRelease: false, reason: 'Recovery already completed' });
  });

  it('returns false when no active recovery (recoveryInitiatedAt = 0)', () => {
    const result = canReleaseShare(0n, 2, 2, false);
    expect(result).toEqual({ canRelease: false, reason: 'No active recovery' });
  });

  it('returns false when insufficient approvals', () => {
    const pastTime = BigInt(NOW_SECONDS - SEVENTY_TWO_HOURS - 100);
    const result = canReleaseShare(pastTime, 1, 2, false);
    expect(result).toEqual({ canRelease: false, reason: 'Insufficient approvals: 1/2' });
  });

  it('returns false when time-lock not expired (shows remaining time)', () => {
    // Set recovery to 1 hour ago (71h remaining)
    const recentTime = BigInt(NOW_SECONDS - 3600);
    const result = canReleaseShare(recentTime, 2, 2, false);
    expect(result.canRelease).toBe(false);
    expect(result.reason).toMatch(/Time-lock not expired/);
    expect(result.reason).toMatch(/\d+h \d+m remaining/);
  });

  it('checks conditions in priority order: completed > not active > insufficient > time-lock', () => {
    // All conditions fail, but recoveryComplete takes precedence
    const result = canReleaseShare(0n, 0, 2, true);
    expect(result.reason).toBe('Recovery already completed');
  });

  it('returns true when approvals exceed threshold', () => {
    const pastTime = BigInt(NOW_SECONDS - SEVENTY_TWO_HOURS - 100);
    const result = canReleaseShare(pastTime, 3, 2, false);
    expect(result).toEqual({ canRelease: true });
  });
});
