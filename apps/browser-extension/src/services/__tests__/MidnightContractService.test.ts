import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock wxt/utils/storage (used by WalletState, pulled in by getWalletNetworkConfig)
vi.mock('wxt/utils/storage', () => ({
  storage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

// Hoist the mocks so they are available when vi.mock factories run (vitest hoists
// vi.mock calls above top-level const declarations, so bare consts would be
// undefined during factory execution).
const mocks = vi.hoisted(() => {
  const mockQueryContractState = vi.fn();
  const mockIndexerPublicDataProvider = vi.fn(() => ({
    queryContractState: mockQueryContractState,
  }));
  const mockFindDeployedContract = vi.fn();
  const mockLedgerVR = vi.fn();
  return {
    mockQueryContractState,
    mockIndexerPublicDataProvider,
    mockFindDeployedContract,
    mockLedgerVR,
  };
});

const { mockQueryContractState, mockIndexerPublicDataProvider, mockFindDeployedContract, mockLedgerVR } = mocks;

vi.mock('@midnight-ntwrk/midnight-js-indexer-public-data-provider', () => ({
  indexerPublicDataProvider: mocks.mockIndexerPublicDataProvider,
}));
vi.mock('@midnight-ntwrk/midnight-js-http-client-proof-provider', () => ({
  httpClientProofProvider: vi.fn(() => ({})),
}));
vi.mock('@midnight-ntwrk/midnight-js-contracts', () => ({
  findDeployedContract: mocks.mockFindDeployedContract,
}));
vi.mock('@midnight-ntwrk/compact-js', () => ({
  CompiledContract: {
    make: vi.fn(() => ({ pipe: vi.fn((fn: unknown) => fn) })),
    withWitnesses: vi.fn((w: unknown) => w),
  },
}));
vi.mock('@aliasvault/contract', () => ({
  VaultRegistry: {
    Contract: {},
    ledger: mocks.mockLedgerVR,
  },
  vaultRegistryWitnesses: {},
  createVaultRegistryPrivateState: vi.fn(),
}));

// Mock contracts config
vi.mock('../../../../../shared/config/contracts', () => ({
  CONTRACTS: {
    VaultRegistry: { address: 'test-vault-registry-address', version: '0.1.0' },
  },
}));

// Mock networkConfig
vi.mock('../../entrypoints/popup/config/networkConfig', () => ({
  getNetworkConfig: () => ({
    networkId: 'preprod',
    indexerUrl: 'https://indexer.test/api/v4/graphql',
    wsIndexerUrl: 'wss://indexer.test/api/v4/graphql/ws',
    nodeUrl: 'https://rpc.test',
    proofServerUrl: 'https://proof.test',
  }),
  getWalletNetworkConfig: vi.fn().mockResolvedValue({
    networkId: 'preprod',
    indexerUrl: 'https://indexer.test/api/v4/graphql',
    wsIndexerUrl: 'wss://indexer.test/api/v4/graphql/ws',
    nodeUrl: 'https://rpc.test',
    proofServerUrl: 'https://proof.test',
  }),
}));

// Mock providers
vi.mock('../providers/ExtensionZkConfigProvider', () => ({
  ExtensionZkConfigProvider: vi.fn(),
}));
vi.mock('../providers/InMemoryPrivateStateProvider', () => ({
  InMemoryPrivateStateProvider: vi.fn(),
}));
vi.mock('../providers/LaceWalletProxy', () => ({
  LaceWalletProxy: vi.fn(),
}));
vi.mock('../providers/LaceMidnightProxy', () => ({
  LaceMidnightProxy: vi.fn(),
}));

import { MidnightContractService } from '../MidnightContractService';

describe('MidnightContractService', () => {
  let service: MidnightContractService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MidnightContractService();
  });

  describe('isVaultRegistered', () => {
    it('returns false when contract state is null', async () => {
      mockQueryContractState.mockResolvedValue(null);
      const result = await service.isVaultRegistered();
      expect(result).toBe(false);
    });

    it('returns false when owner is all zero bytes', async () => {
      mockQueryContractState.mockResolvedValue({ data: 'mock-data' });
      mockLedgerVR.mockReturnValue({ owner: new Uint8Array(32) });

      const result = await service.isVaultRegistered();
      expect(result).toBe(false);
    });

    it('returns true when owner has non-zero bytes', async () => {
      const nonZeroOwner = new Uint8Array(32);
      nonZeroOwner[0] = 1;
      mockQueryContractState.mockResolvedValue({ data: 'mock-data' });
      mockLedgerVR.mockReturnValue({ owner: nonZeroOwner });

      const result = await service.isVaultRegistered();
      expect(result).toBe(true);
    });
  });

  describe('registerVaultOnChain', () => {
    it('throws if contract not joined', async () => {
      const hash = new Uint8Array(32);
      await expect(service.registerVaultOnChain(hash)).rejects.toThrow('Contract not joined');
    });

    it('throws if hash is not 32 bytes', async () => {
      (service as any).contract = { callTx: { registerVault: vi.fn() } };
      const hash = new Uint8Array(16);
      await expect(service.registerVaultOnChain(hash)).rejects.toThrow('exactly 32 bytes');
    });

    it('calls contract.callTx.registerVault with hash', async () => {
      const mockRegister = vi.fn().mockResolvedValue(undefined);
      (service as any).contract = { callTx: { registerVault: mockRegister } };
      const hash = new Uint8Array(32);
      hash[0] = 0xAB;

      await service.registerVaultOnChain(hash);
      expect(mockRegister).toHaveBeenCalledWith(hash);
    });
  });
});
