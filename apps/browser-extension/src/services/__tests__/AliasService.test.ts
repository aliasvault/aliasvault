import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dynamic imports used by AliasService
const mockQueryContractState = vi.fn();
const mockIndexerPublicDataProvider = vi.fn(() => ({
  queryContractState: mockQueryContractState,
}));
const mockFindDeployedContract = vi.fn();
const mockHttpClientProofProvider = vi.fn();
const mockLedgerAR = vi.fn();
const mockCallTxClaimAlias = vi.fn();
const mockCallTxReleaseAlias = vi.fn();

vi.mock('@midnight-ntwrk/midnight-js-indexer-public-data-provider', () => ({
  indexerPublicDataProvider: mockIndexerPublicDataProvider,
}));
vi.mock('@midnight-ntwrk/midnight-js-contracts', () => ({
  findDeployedContract: mockFindDeployedContract,
}));
vi.mock('@midnight-ntwrk/midnight-js-http-client-proof-provider', () => ({
  httpClientProofProvider: mockHttpClientProofProvider,
}));
vi.mock('@midnight-ntwrk/compact-js', () => ({
  CompiledContract: {
    make: vi.fn(() => ({ pipe: vi.fn((fn: unknown) => fn) })),
    withWitnesses: vi.fn((w: unknown) => w),
  },
}));
vi.mock('@aliasvault/contract', () => ({
  AliasRegistry: {
    Contract: {},
    ledger: mockLedgerAR,
  },
  aliasRegistryWitnesses: {},
  createAliasRegistryPrivateState: vi.fn(),
}));

// Mock contracts config — must provide a non-empty address
// Path resolved from the service file's import: '../../../../shared/config/contracts'
vi.mock('../../../../../shared/config/contracts', () => ({
  CONTRACTS: {
    AliasRegistry: { address: 'test-alias-registry-address', version: '0.1.0' },
    VaultRegistry: { address: 'test-vault-registry-address', version: '0.1.0' },
  },
}));

import {
  claimAlias,
  checkAliasAvailable,
  releaseAlias,
} from '../AliasService';

const TEST_SECRET_KEY = new Uint8Array(32).fill(0xaa);
const TEST_VAULT_ADDR = '0200000000000000000000000000000000000000000000000000000000000001';

beforeEach(() => {
  vi.clearAllMocks();

  // Default: findDeployedContract returns a contract with callTx
  mockFindDeployedContract.mockResolvedValue({
    callTx: {
      claimAlias: mockCallTxClaimAlias,
      releaseAlias: mockCallTxReleaseAlias,
    },
  });
  mockCallTxClaimAlias.mockResolvedValue(undefined);
  mockCallTxReleaseAlias.mockResolvedValue(undefined);
});

describe('claimAlias', () => {
  it('joins AliasRegistry and calls claimAlias circuit', async () => {
    await claimAlias('zk-tiger-7842', TEST_SECRET_KEY, TEST_VAULT_ADDR);

    expect(mockFindDeployedContract).toHaveBeenCalledOnce();
    expect(mockCallTxClaimAlias).toHaveBeenCalledOnce();

    // Verify aliasHash is a 32-byte Uint8Array (SHA-256 output)
    const callArgs = mockCallTxClaimAlias.mock.calls[0];
    expect(callArgs[0]).toBeInstanceOf(Uint8Array);
    expect(callArgs[0].length).toBe(32);
    // Verify contract address is passed
    expect(callArgs[1]).toBe(TEST_VAULT_ADDR);
  });

  it('hashes alias consistently (SHA-256 of name@alias.id)', async () => {
    await claimAlias('test-alias', TEST_SECRET_KEY, TEST_VAULT_ADDR);
    const hash1 = mockCallTxClaimAlias.mock.calls[0][0];

    mockCallTxClaimAlias.mockClear();
    mockFindDeployedContract.mockResolvedValue({
      callTx: { claimAlias: mockCallTxClaimAlias, releaseAlias: mockCallTxReleaseAlias },
    });

    await claimAlias('test-alias', TEST_SECRET_KEY, TEST_VAULT_ADDR);
    const hash2 = mockCallTxClaimAlias.mock.calls[0][0];

    expect(Buffer.from(hash1)).toEqual(Buffer.from(hash2));
  });

  it('propagates contract errors', async () => {
    mockCallTxClaimAlias.mockRejectedValue(new Error('Alias already claimed'));

    await expect(
      claimAlias('taken-alias', TEST_SECRET_KEY, TEST_VAULT_ADDR)
    ).rejects.toThrow('Alias already claimed');
  });
});

describe('checkAliasAvailable', () => {
  it('returns true when contract state not found', async () => {
    mockQueryContractState.mockResolvedValue(null);

    const available = await checkAliasAvailable('new-alias');

    expect(available).toBe(true);
  });

  it('returns true when alias is not in aliasOwners map', async () => {
    mockQueryContractState.mockResolvedValue({ data: 'mock-state' });
    mockLedgerAR.mockReturnValue({
      aliasOwners: {
        member: vi.fn(() => false),
      },
    });

    const available = await checkAliasAvailable('unclaimed-alias');

    expect(available).toBe(true);
  });

  it('returns false when alias is claimed', async () => {
    mockQueryContractState.mockResolvedValue({ data: 'mock-state' });
    mockLedgerAR.mockReturnValue({
      aliasOwners: {
        member: vi.fn(() => true),
      },
    });

    const available = await checkAliasAvailable('claimed-alias');

    expect(available).toBe(false);
  });

  it('returns true when member() throws (graceful fallback)', async () => {
    mockQueryContractState.mockResolvedValue({ data: 'mock-state' });
    mockLedgerAR.mockReturnValue({
      aliasOwners: {
        member: vi.fn(() => { throw new Error('key format error'); }),
      },
    });

    const available = await checkAliasAvailable('error-alias');

    expect(available).toBe(true);
  });
});

describe('releaseAlias', () => {
  it('joins AliasRegistry and calls releaseAlias circuit', async () => {
    await releaseAlias('my-alias', TEST_SECRET_KEY);

    expect(mockFindDeployedContract).toHaveBeenCalledOnce();
    expect(mockCallTxReleaseAlias).toHaveBeenCalledOnce();

    const callArgs = mockCallTxReleaseAlias.mock.calls[0];
    expect(callArgs[0]).toBeInstanceOf(Uint8Array);
    expect(callArgs[0].length).toBe(32);
  });

  it('propagates contract errors', async () => {
    mockCallTxReleaseAlias.mockRejectedValue(new Error('Not the alias owner'));

    await expect(
      releaseAlias('not-mine', TEST_SECRET_KEY)
    ).rejects.toThrow('Not the alias owner');
  });
});
