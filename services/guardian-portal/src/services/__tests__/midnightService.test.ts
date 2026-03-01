import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mock functions (available to vi.mock factories) ---
const {
  mockFindDeployedContract,
  mockHttpClientProofProvider,
  mockIndexerPublicDataProvider,
  mockCreatePrivateState,
  MockFetchZkConfigProvider,
  mockToHex,
  mockFromHex,
  mockDeserialize,
  mockPrivateStateProvider,
} = vi.hoisted(() => ({
  mockFindDeployedContract: vi.fn(),
  mockHttpClientProofProvider: vi.fn(() => ({ prove: vi.fn() })),
  mockIndexerPublicDataProvider: vi.fn(() => ({ queryContractState: vi.fn() })),
  mockCreatePrivateState: vi.fn(),
  MockFetchZkConfigProvider: vi.fn(),
  mockToHex: vi.fn((_bytes: Uint8Array) => '0xdeadbeef'),
  mockFromHex: vi.fn((_hex: string) => new Uint8Array([0xde, 0xad])),
  mockDeserialize: vi.fn(() => ({ deserialized: true })),
  mockPrivateStateProvider: { set: vi.fn(), get: vi.fn(), remove: vi.fn(), clear: vi.fn() },
}));

// --- Mock Midnight SDK modules ---
vi.mock('@midnight-ntwrk/midnight-js-contracts', () => ({
  findDeployedContract: mockFindDeployedContract,
}));
vi.mock('@midnight-ntwrk/midnight-js-http-client-proof-provider', () => ({
  httpClientProofProvider: mockHttpClientProofProvider,
}));
vi.mock('@midnight-ntwrk/midnight-js-indexer-public-data-provider', () => ({
  indexerPublicDataProvider: mockIndexerPublicDataProvider,
}));
vi.mock('@midnight-ntwrk/compact-js', () => ({
  CompiledContract: {
    make: vi.fn(() => ({ pipe: vi.fn((fn: unknown) => fn) })),
    withWitnesses: vi.fn((w: unknown) => w),
  },
}));
vi.mock('@aliasvault/contract', () => ({
  GuardianRecovery: { Contract: {} },
  createGuardianRecoveryPrivateState: mockCreatePrivateState,
  guardianRecoveryWitnesses: {},
}));
vi.mock('@midnight-ntwrk/midnight-js-fetch-zk-config-provider', () => ({
  FetchZkConfigProvider: MockFetchZkConfigProvider,
}));
vi.mock('@midnight-ntwrk/compact-runtime', () => ({
  toHex: mockToHex,
  fromHex: mockFromHex,
}));
vi.mock('@midnight-ntwrk/ledger-v7', () => ({
  Transaction: { deserialize: mockDeserialize },
}));
vi.mock('../inMemoryPrivateStateProvider', () => ({
  inMemoryPrivateStateProvider: () => mockPrivateStateProvider,
}));

import {
  GUARDIAN_THRESHOLD,
  configureGuardianProviders,
  joinContract,
  getContractState,
  isGuardian,
  hasApproved,
  approveRecovery,
} from '../midnightService';
import type { ConnectedAPI, ShieldedAddresses, ServiceConfiguration } from '../walletService';

// --- Test helpers ---

function mockHandle(ledger: Record<string, unknown>) {
  return { deployTxData: { public: ledger } } as unknown as Parameters<typeof getContractState>[0];
}

function makeConnectedAPI(overrides?: Partial<ConnectedAPI>): ConnectedAPI {
  return {
    getShieldedAddresses: vi.fn(),
    getConfiguration: vi.fn(),
    balanceUnsealedTransaction: vi.fn().mockResolvedValue({ tx: '0xbalanced' }),
    submitTransaction: vi.fn().mockResolvedValue(undefined),
    getConnectionStatus: vi.fn(),
    ...overrides,
  };
}

function makeShieldedAddresses(): ShieldedAddresses {
  return {
    shieldedCoinPublicKey: 'coin-pub-key-abc',
    shieldedEncryptionPublicKey: 'enc-pub-key-xyz',
  };
}

function makeServiceConfig(): ServiceConfiguration {
  return {
    proverServerUri: 'http://localhost:6300',
    indexerUri: 'http://localhost:8088',
    indexerWsUri: 'ws://localhost:8088/ws',
  };
}

describe('midnightService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GUARDIAN_THRESHOLD', () => {
    it('equals 2', () => {
      expect(GUARDIAN_THRESHOLD).toBe(2);
    });
  });

  describe('getContractState', () => {
    it('reads all fields and converts approvedGuardians.size() to number', () => {
      const owner = new Uint8Array([1, 2, 3]);
      const sharesCidHash = new Uint8Array([4, 5, 6]);
      const handle = mockHandle({
        owner,
        guardianCount: 3n,
        recoveryInitiatedAt: 1000n,
        sharesCidHash,
        recoveryComplete: false,
        approvedGuardians: { size: () => 2n },
      });

      const state = getContractState(handle);

      expect(state.owner).toBe(owner);
      expect(state.guardianCount).toBe(3n);
      expect(state.recoveryInitiatedAt).toBe(1000n);
      expect(state.sharesCidHash).toBe(sharesCidHash);
      expect(state.recoveryComplete).toBe(false);
      expect(state.approvalCount).toBe(2);
      expect(typeof state.approvalCount).toBe('number');
    });

    it('handles zero approvedGuardians', () => {
      const handle = mockHandle({
        owner: new Uint8Array(32),
        guardianCount: 0n,
        recoveryInitiatedAt: 0n,
        sharesCidHash: new Uint8Array(32),
        recoveryComplete: false,
        approvedGuardians: { size: () => 0n },
      });

      expect(getContractState(handle).approvalCount).toBe(0);
    });
  });

  describe('isGuardian', () => {
    it('returns true when commitment is a member', () => {
      const commitment = new Uint8Array([10, 20]);
      const handle = mockHandle({
        guardians: { member: (c: Uint8Array) => c === commitment },
      });

      expect(isGuardian(handle, commitment)).toBe(true);
    });

    it('returns false when commitment is not a member', () => {
      const handle = mockHandle({
        guardians: { member: () => false },
      });

      expect(isGuardian(handle, new Uint8Array([99]))).toBe(false);
    });
  });

  describe('hasApproved', () => {
    it('returns true when commitment is in approvedGuardians', () => {
      const commitment = new Uint8Array([10, 20]);
      const handle = mockHandle({
        approvedGuardians: { member: (c: Uint8Array) => c === commitment },
      });

      expect(hasApproved(handle, commitment)).toBe(true);
    });

    it('returns false when commitment is not in approvedGuardians', () => {
      const handle = mockHandle({
        approvedGuardians: { member: () => false },
      });

      expect(hasApproved(handle, new Uint8Array([99]))).toBe(false);
    });
  });

  describe('configureGuardianProviders', () => {
    it('returns all 6 providers when wallet is connected', () => {
      const api = makeConnectedAPI();
      const addrs = makeShieldedAddresses();
      const config = makeServiceConfig();

      const providers = configureGuardianProviders(api, addrs, config);

      expect(providers).toHaveProperty('publicDataProvider');
      expect(providers).toHaveProperty('proofProvider');
      expect(providers).toHaveProperty('zkConfigProvider');
      expect(providers).toHaveProperty('privateStateProvider');
      expect(providers).toHaveProperty('walletProvider');
      expect(providers).toHaveProperty('midnightProvider');
    });

    it('constructs FetchZkConfigProvider with window.location.origin', () => {
      configureGuardianProviders(null, null, null);

      expect(MockFetchZkConfigProvider).toHaveBeenCalledWith(
        window.location.origin,
        expect.any(Function),
      );
    });

    it('passes proverServerUri from serviceConfig to httpClientProofProvider', () => {
      const config = makeServiceConfig();
      configureGuardianProviders(null, null, config);

      expect(mockHttpClientProofProvider).toHaveBeenCalledWith(
        'http://localhost:6300',
        expect.anything(),
      );
    });

    it('passes indexerUri and indexerWsUri from serviceConfig to indexerPublicDataProvider', () => {
      const config = makeServiceConfig();
      configureGuardianProviders(null, null, config);

      expect(mockIndexerPublicDataProvider).toHaveBeenCalledWith(
        'http://localhost:8088',
        'ws://localhost:8088/ws',
      );
    });

    it('falls back to empty strings when serviceConfig is null', () => {
      configureGuardianProviders(null, null, null);

      expect(mockHttpClientProofProvider).toHaveBeenCalledWith('', expect.anything());
      expect(mockIndexerPublicDataProvider).toHaveBeenCalledWith('', '');
    });

    it('uses inMemoryPrivateStateProvider', () => {
      const providers = configureGuardianProviders(null, null, null);
      expect(providers.privateStateProvider).toBe(mockPrivateStateProvider);
    });

    describe('walletProvider', () => {
      it('getCoinPublicKey returns shieldedCoinPublicKey', () => {
        const addrs = makeShieldedAddresses();
        const { walletProvider } = configureGuardianProviders(makeConnectedAPI(), addrs, null);

        expect(walletProvider.getCoinPublicKey()).toBe('coin-pub-key-abc');
      });

      it('getEncryptionPublicKey returns shieldedEncryptionPublicKey', () => {
        const addrs = makeShieldedAddresses();
        const { walletProvider } = configureGuardianProviders(makeConnectedAPI(), addrs, null);

        expect(walletProvider.getEncryptionPublicKey()).toBe('enc-pub-key-xyz');
      });

      it('balanceTx serializes via toHex, calls balanceUnsealedTransaction, and deserializes result', async () => {
        const api = makeConnectedAPI();
        const { walletProvider } = configureGuardianProviders(api, makeShieldedAddresses(), null);

        const mockTx = { serialize: vi.fn(() => new Uint8Array([1, 2, 3])) };
        const result = await walletProvider.balanceTx(mockTx as any);

        expect(mockToHex).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
        expect(api.balanceUnsealedTransaction).toHaveBeenCalledWith('0xdeadbeef');
        expect(mockFromHex).toHaveBeenCalledWith('0xbalanced');
        expect(mockDeserialize).toHaveBeenCalledWith(
          'signature', 'proof', 'binding',
          new Uint8Array([0xde, 0xad]),
        );
        expect(result).toEqual({ deserialized: true });
      });

      it('getCoinPublicKey throws readonly when shieldedAddresses is null', () => {
        const { walletProvider } = configureGuardianProviders(makeConnectedAPI(), null, null);
        expect(() => walletProvider.getCoinPublicKey()).toThrow('readonly');
      });

      it('getEncryptionPublicKey throws readonly when shieldedAddresses is null', () => {
        const { walletProvider } = configureGuardianProviders(makeConnectedAPI(), null, null);
        expect(() => walletProvider.getEncryptionPublicKey()).toThrow('readonly');
      });

      it('balanceTx throws readonly when connectedAPI is null', async () => {
        const { walletProvider } = configureGuardianProviders(null, makeShieldedAddresses(), null);
        const mockTx = { serialize: vi.fn() };

        await expect(walletProvider.balanceTx(mockTx as any)).rejects.toThrow('readonly');
      });
    });

    describe('midnightProvider', () => {
      it('submitTx serializes via toHex, calls submitTransaction, and returns first txId', async () => {
        const api = makeConnectedAPI();
        const { midnightProvider } = configureGuardianProviders(api, makeShieldedAddresses(), null);

        const mockTx = {
          serialize: vi.fn(() => new Uint8Array([4, 5, 6])),
          identifiers: vi.fn(() => ['txid-001', 'txid-002']),
        };
        const txId = await midnightProvider.submitTx(mockTx as any);

        expect(mockToHex).toHaveBeenCalledWith(new Uint8Array([4, 5, 6]));
        expect(api.submitTransaction).toHaveBeenCalledWith('0xdeadbeef');
        expect(mockTx.identifiers).toHaveBeenCalled();
        expect(txId).toBe('txid-001');
      });

      it('submitTx throws readonly when connectedAPI is null', async () => {
        const { midnightProvider } = configureGuardianProviders(null, null, null);
        const mockTx = { serialize: vi.fn(), identifiers: vi.fn() };

        await expect(midnightProvider.submitTx(mockTx as any)).rejects.toThrow('readonly');
      });
    });
  });

  describe('joinContract', () => {
    it('calls findDeployedContract with providers and contract config', async () => {
      const mockContract = { callTx: {}, deployTxData: {} };
      mockFindDeployedContract.mockResolvedValue(mockContract);

      const api = makeConnectedAPI();
      const addrs = makeShieldedAddresses();
      const config = makeServiceConfig();
      const guardianKey = new Uint8Array([7, 8, 9]);

      const result = await joinContract('addr123', guardianKey, api, addrs, config);

      expect(mockFindDeployedContract).toHaveBeenCalledWith(
        expect.objectContaining({
          publicDataProvider: expect.anything(),
          proofProvider: expect.anything(),
          walletProvider: expect.anything(),
          midnightProvider: expect.anything(),
          privateStateProvider: expect.anything(),
          zkConfigProvider: expect.anything(),
        }),
        expect.objectContaining({
          contractAddress: 'addr123',
          privateStateId: 'guardianRecoveryPrivateState',
        }),
      );
      expect(mockCreatePrivateState).toHaveBeenCalledWith(
        new Uint8Array(32), // placeholder secretKey
        guardianKey,
      );
      expect(result).toBe(mockContract);
    });
  });

  describe('approveRecovery', () => {
    it('calls handle.callTx.approveRecovery()', async () => {
      const mockApproveRecovery = vi.fn().mockResolvedValue(undefined);
      const handle = { callTx: { approveRecovery: mockApproveRecovery } } as any;

      await approveRecovery(handle);

      expect(mockApproveRecovery).toHaveBeenCalledOnce();
    });
  });
});
