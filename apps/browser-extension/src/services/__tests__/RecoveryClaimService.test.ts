import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dynamic imports used by RecoveryClaimService
const mockQueryContractState = vi.fn();
const mockIndexerPublicDataProvider = vi.fn(() => ({
  queryContractState: mockQueryContractState,
}));
const mockFindDeployedContract = vi.fn();
const mockLedgerVR = vi.fn();
const mockLedgerGR = vi.fn();
const mockAssertCIDv1 = vi.fn();
const mockParseSharePackageFromBytes = vi.fn();
const mockClaimRecovery = vi.fn();
const mockValidateShareFile = vi.fn();

class MockRecoveryClaimError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'RecoveryClaimError';
  }
}

// Mock networkConfig so the async getWalletNetworkConfig resolves to deterministic URLs.
vi.mock('../../entrypoints/popup/config/networkConfig', () => ({
  getNetworkConfig: () => ({
    networkId: 'undeployed',
    indexerUrl: 'http://localhost:8088',
    wsIndexerUrl: 'ws://localhost:8088',
    nodeUrl: 'http://localhost:9944',
    proofServerUrl: 'http://localhost:6300',
  }),
  getWalletNetworkConfig: vi.fn().mockResolvedValue({
    networkId: 'undeployed',
    indexerUrl: 'http://localhost:8088',
    wsIndexerUrl: 'ws://localhost:8088',
    nodeUrl: 'http://localhost:9944',
    proofServerUrl: 'http://localhost:6300',
  }),
}));

// Mock createMidnightProviders — returns a stub providers object
vi.mock('../providers/createMidnightProviders', () => ({
  createMidnightProviders: vi.fn().mockResolvedValue({
    privateStateProvider: {},
    publicDataProvider: {},
    zkConfigProvider: {},
    proofProvider: {},
    walletProvider: {},
    midnightProvider: {},
  }),
}));

vi.mock('@midnight-ntwrk/midnight-js-indexer-public-data-provider', () => ({
  indexerPublicDataProvider: mockIndexerPublicDataProvider,
}));
vi.mock('@midnight-ntwrk/midnight-js-contracts', () => ({
  findDeployedContract: mockFindDeployedContract,
}));
vi.mock('@midnight-ntwrk/compact-js', () => ({
  CompiledContract: {
    make: vi.fn(() => ({ pipe: vi.fn((fn: unknown) => fn) })),
    withWitnesses: vi.fn((w: unknown) => w),
  },
}));
vi.mock('@aliasvault/contract', () => ({
  VaultRegistry: { ledger: mockLedgerVR },
  GuardianRecovery: { Contract: {}, ledger: mockLedgerGR },
  guardianRecoveryWitnesses: {},
  createGuardianRecoveryPrivateState: vi.fn(),
  assertCIDv1: mockAssertCIDv1,
}));
vi.mock('@aliasvault/vault-sync', () => ({
  parseSharePackageFromBytes: mockParseSharePackageFromBytes,
  claimRecovery: mockClaimRecovery,
  RecoveryClaimError: MockRecoveryClaimError,
  validateShareFile: mockValidateShareFile,
}));

import {
  fetchOnChainRecoveryKeyHash,
  fetchSharePackageFromIpfs,
  executeRecoveryClaim,
  getRecoveryState,
  validateImportedShare,
} from '../RecoveryClaimService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchOnChainRecoveryKeyHash', () => {
  it('returns recoveryKeyHash from VaultRegistry ledger', async () => {
    const hash = new Uint8Array(32).fill(0xab);
    mockQueryContractState.mockResolvedValue({ data: 'mock-state' });
    mockLedgerVR.mockReturnValue({ recoveryKeyHash: hash });

    const result = await fetchOnChainRecoveryKeyHash('contract-addr', 'http://localhost:8088', 'ws://localhost:8088');

    expect(result).toEqual(hash);
    expect(mockIndexerPublicDataProvider).toHaveBeenCalledWith('http://localhost:8088', 'ws://localhost:8088');
    expect(mockQueryContractState).toHaveBeenCalledWith('contract-addr');
    expect(mockLedgerVR).toHaveBeenCalledWith('mock-state');
  });

  it('returns null when contract not found', async () => {
    mockQueryContractState.mockResolvedValue(null);

    const result = await fetchOnChainRecoveryKeyHash('missing-contract');

    expect(result).toBeNull();
  });
});

describe('fetchSharePackageFromIpfs', () => {
  it('fetches and parses share package from IPFS', async () => {
    const mockPackage = {
      version: 2,
      vaultOwnerCommitment: 'aa',
      threshold: 2,
      totalShares: 3,
      encryptedPassword: 'enc',
      shares: [{ index: 0, encryptedShare: 's0' }],
    };
    const mockBytes = new Uint8Array([1, 2, 3]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(mockBytes.buffer),
    }) as unknown as typeof fetch;
    mockParseSharePackageFromBytes.mockReturnValue(mockPackage);

    const result = await fetchSharePackageFromIpfs('bafyvalidcid123', 'my-gateway.pinata.cloud');

    expect(mockAssertCIDv1).toHaveBeenCalledWith('bafyvalidcid123');
    expect(fetch).toHaveBeenCalledWith('https://my-gateway.pinata.cloud/files/bafyvalidcid123');
    expect(mockParseSharePackageFromBytes).toHaveBeenCalled();
    expect(result.version).toBe(2);
  });

  it('rejects invalid CID', async () => {
    mockAssertCIDv1.mockImplementation(() => {
      throw new Error('CIDv0 detected');
    });

    await expect(
      fetchSharePackageFromIpfs('QmInvalid', 'gateway.test'),
    ).rejects.toThrow('CIDv0 detected');
  });

  it('throws on HTTP error', async () => {
    mockAssertCIDv1.mockImplementation(() => {}); // Reset: allow CID through
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;

    await expect(
      fetchSharePackageFromIpfs('bafyvalidcid123', 'gateway.test'),
    ).rejects.toThrow('HTTP 404');
  });
});

describe('executeRecoveryClaim', () => {
  const mockShareFiles = [
    { version: 1 as const, shareIndex: 0, shareHex: 'aabb' },
    { version: 1 as const, shareIndex: 1, shareHex: 'ccdd' },
  ];
  const mockSharePackage = {
    version: 2 as const,
    vaultOwnerCommitment: 'aa',
    threshold: 2,
    totalShares: 3,
    encryptedPassword: 'enc',
    shares: [],
  };
  const mockHash = new Uint8Array(32).fill(0xff);

  it('delegates to claimRecovery and returns result', async () => {
    mockClaimRecovery.mockResolvedValue({ masterPassword: 'recovered-pass' });

    const result = await executeRecoveryClaim(mockShareFiles, mockSharePackage, mockHash);

    expect(result.masterPassword).toBe('recovered-pass');
    expect(mockClaimRecovery).toHaveBeenCalledWith({
      sharePackage: mockSharePackage,
      shareFiles: mockShareFiles,
      onChainRecoveryKeyHash: mockHash,
    });
  });

  it('re-throws RecoveryClaimError with structured code', async () => {
    const error = new MockRecoveryClaimError('RECOVERY_CLAIM_HASH_MISMATCH', 'Hash mismatch');
    mockClaimRecovery.mockRejectedValue(error);

    await expect(
      executeRecoveryClaim(mockShareFiles, mockSharePackage, mockHash),
    ).rejects.toThrow(MockRecoveryClaimError);
  });

  it('wraps non-RecoveryClaimError with user-friendly message', async () => {
    mockClaimRecovery.mockRejectedValue(new Error('crypto failure'));

    await expect(
      executeRecoveryClaim(mockShareFiles, mockSharePackage, mockHash),
    ).rejects.toThrow('Recovery claim failed: crypto failure');
  });
});

describe('getRecoveryState', () => {
  it('returns recovery state from GuardianRecovery ledger', async () => {
    mockQueryContractState.mockResolvedValue({ data: 'gr-state' });
    mockLedgerGR.mockReturnValue({
      recoveryInitiatedAt: 1000n,
      approvedGuardians: { size: () => 2n },
      recoveryComplete: false,
      sharesCidHash: new Uint8Array(32).fill(0xdd),
    });

    const result = await getRecoveryState('gr-contract-addr');

    expect(result).not.toBeNull();
    expect(result!.recoveryInitiatedAt).toBe(1000n);
    expect(result!.approvalCount).toBe(2);
    expect(result!.recoveryComplete).toBe(false);
    expect(result!.sharesCidHash).toEqual(new Uint8Array(32).fill(0xdd));
  });

  it('returns null when contract not found', async () => {
    mockQueryContractState.mockResolvedValue(null);

    const result = await getRecoveryState('missing-contract');

    expect(result).toBeNull();
  });

  it('reads correct ledger fields', async () => {
    mockQueryContractState.mockResolvedValue({ data: 'state' });
    mockLedgerGR.mockReturnValue({
      recoveryInitiatedAt: 0n,
      approvedGuardians: { size: () => 0n },
      recoveryComplete: true,
      sharesCidHash: new Uint8Array(32),
    });

    const result = await getRecoveryState('contract-addr');

    expect(result!.recoveryInitiatedAt).toBe(0n);
    expect(result!.approvalCount).toBe(0);
    expect(result!.recoveryComplete).toBe(true);
  });
});

describe('validateImportedShare', () => {
  it('delegates to validateShareFile from vault-sync', async () => {
    const shareData = { version: 1, shareIndex: 0, shareHex: 'aabb' };
    mockValidateShareFile.mockReturnValue(shareData);

    const result = await validateImportedShare(shareData);

    expect(mockValidateShareFile).toHaveBeenCalledWith(shareData);
    expect(result).toEqual(shareData);
  });

  it('propagates validation errors', async () => {
    mockValidateShareFile.mockImplementation(() => {
      throw new Error('Invalid share format');
    });

    await expect(validateImportedShare({ bad: true })).rejects.toThrow('Invalid share format');
  });
});
