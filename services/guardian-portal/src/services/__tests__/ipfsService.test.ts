import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @aliasvault/contract
vi.mock('@aliasvault/contract', () => ({
  assertCIDv1: vi.fn((cid: string) => {
    if (cid.startsWith('Qm')) throw new Error('CIDv0 detected');
    if (!/^[a-z2-7]/.test(cid)) throw new Error('CID must be base32 encoded (CIDv1)');
  }),
}));

import { fetchRecoveryMetadata } from '../ipfsService';

describe('ipfsService', () => {
  const validCid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
  const validMetadata = {
    version: 1,
    contractAddress: 'contract-addr-001',
    networkId: 'undeployed',
    vaultOwnerCommitment: 'aabb001122',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and returns valid metadata', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(validMetadata),
    }) as unknown as typeof fetch;

    const result = await fetchRecoveryMetadata(validCid, 'https://gateway.test.com/ipfs');

    expect(result).toEqual(validMetadata);
    expect(fetch).toHaveBeenCalledWith(
      `https://gateway.test.com/ipfs/${validCid}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('rejects CIDv0', async () => {
    await expect(fetchRecoveryMetadata('QmTest123')).rejects.toThrow('CIDv0 detected');
  });

  it('throws on HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;

    await expect(fetchRecoveryMetadata(validCid)).rejects.toThrow('HTTP 404');
  });

  it('throws on malformed metadata - missing contractAddress', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: 1 }),
    }) as unknown as typeof fetch;

    await expect(fetchRecoveryMetadata(validCid)).rejects.toThrow('missing contractAddress');
  });

  it('throws on unsupported version', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...validMetadata, version: 2 }),
    }) as unknown as typeof fetch;

    await expect(fetchRecoveryMetadata(validCid)).rejects.toThrow('unsupported version');
  });

  it('throws on non-object response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve('not-an-object'),
    }) as unknown as typeof fetch;

    await expect(fetchRecoveryMetadata(validCid)).rejects.toThrow('not an object');
  });
});
