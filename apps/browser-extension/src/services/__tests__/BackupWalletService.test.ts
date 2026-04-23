import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dynamic imports used by BackupWalletService
const mockQueryContractState = vi.fn();
const mockIndexerPublicDataProvider = vi.fn(() => ({
  queryContractState: mockQueryContractState,
}));
const mockFindDeployedContract = vi.fn();
const mockLedgerVR = vi.fn();
const mockBackupCommitment = vi.fn();
const mockCallTxAddBackupWallet = vi.fn();
const mockCallTxRemoveBackupWallet = vi.fn();
const mockCallTxBackupTransfer = vi.fn();

// Mock networkConfig so the async getWalletNetworkConfig resolves to deterministic URLs.
// Without this, the real implementation dynamically imports WalletState and may hang in tests.
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
  VaultRegistry: {
    Contract: {},
    ledger: mockLedgerVR,
    pureCircuits: { backupCommitment: mockBackupCommitment },
  },
  vaultRegistryWitnesses: {},
  createVaultRegistryPrivateState: vi.fn(),
}));

import {
  getBackupWalletStatus,
  addBackupWallet,
  removeBackupWallet,
  executeBackupTransfer,
} from '../BackupWalletService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getBackupWalletStatus', () => {
  it('returns empty array when contract not found', async () => {
    mockQueryContractState.mockResolvedValue(null);

    const result = await getBackupWalletStatus('missing-contract', 'http://localhost:8088');

    expect(result).toEqual([]);
  });

  it('returns backup wallets with maturation status', async () => {
    const commitment1 = new Uint8Array(32).fill(0xaa);
    const commitment2 = new Uint8Array(32).fill(0xbb);
    // registeredAt = 0 means very old → always matured
    const registeredAt1 = 1n;
    // registeredAt = current time → not matured
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const registeredAt2 = nowSeconds;

    const mockMap = new Map<Uint8Array, bigint>();
    // Simulate [Symbol.iterator] for the Map
    const entries: [Uint8Array, bigint][] = [
      [commitment1, registeredAt1],
      [commitment2, registeredAt2],
    ];

    mockQueryContractState.mockResolvedValue({ data: 'mock-state' });
    mockLedgerVR.mockReturnValue({
      backupWallets: {
        [Symbol.iterator]: function* () {
          for (const entry of entries) yield entry;
        },
      },
    });

    const result = await getBackupWalletStatus('contract-addr', 'http://localhost:8088');

    expect(result).toHaveLength(2);
    // First wallet: registered at timestamp 1 → matured long ago
    expect(result[0].commitment).toEqual(commitment1);
    expect(result[0].registeredAt).toBe(1n);
    expect(result[0].matured).toBe(true);
    expect(result[0].timeRemaining).toBe(0);

    // Second wallet: registered now → not matured
    expect(result[1].commitment).toEqual(commitment2);
    expect(result[1].matured).toBe(false);
    expect(result[1].timeRemaining).toBeGreaterThan(0);
  });

  it('handles empty backup wallets map', async () => {
    mockQueryContractState.mockResolvedValue({ data: 'mock-state' });
    mockLedgerVR.mockReturnValue({
      backupWallets: {
        [Symbol.iterator]: function* () {
          // empty
        },
      },
    });

    const result = await getBackupWalletStatus('contract-addr', 'http://localhost:8088');
    expect(result).toEqual([]);
  });
});

describe('addBackupWallet', () => {
  it('calls contract with correct commitment and timestamp', async () => {
    const backupKey = new Uint8Array(32).fill(0x11);
    const secretKey = new Uint8Array(32).fill(0x22);
    const commitment = new Uint8Array(32).fill(0x33);
    mockBackupCommitment.mockReturnValue(commitment);

    const mockContract = {
      callTx: {
        addBackupWallet: mockCallTxAddBackupWallet.mockResolvedValue({}),
      },
    };
    mockFindDeployedContract.mockResolvedValue(mockContract);

    await addBackupWallet('contract-addr', backupKey, secretKey, 'http://localhost:8088', 'http://localhost:6300');

    expect(mockBackupCommitment).toHaveBeenCalledWith(backupKey);
    expect(mockCallTxAddBackupWallet).toHaveBeenCalledWith(
      commitment,
      expect.any(BigInt),
    );
  });
});

describe('removeBackupWallet', () => {
  it('calls contract with correct commitment', async () => {
    const walletCommitment = new Uint8Array(32).fill(0xcc);
    const secretKey = new Uint8Array(32).fill(0x22);

    const mockContract = {
      callTx: {
        removeBackupWallet: mockCallTxRemoveBackupWallet.mockResolvedValue({}),
      },
    };
    mockFindDeployedContract.mockResolvedValue(mockContract);

    await removeBackupWallet('contract-addr', walletCommitment, secretKey, 'http://localhost:8088', 'http://localhost:6300');

    expect(mockCallTxRemoveBackupWallet).toHaveBeenCalledWith(walletCommitment);
  });
});

describe('executeBackupTransfer', () => {
  it('calls contract backupTransfer with correct args', async () => {
    const backupKey = new Uint8Array(32).fill(0x44);
    const newOwnerCommitment = new Uint8Array(32).fill(0x55);

    const mockContract = {
      callTx: {
        backupTransfer: mockCallTxBackupTransfer.mockResolvedValue({}),
      },
    };
    mockFindDeployedContract.mockResolvedValue(mockContract);

    await executeBackupTransfer('contract-addr', backupKey, newOwnerCommitment, 'http://localhost:8088', 'http://localhost:6300');

    expect(mockCallTxBackupTransfer).toHaveBeenCalledWith(newOwnerCommitment);
  });

  it('propagates contract errors', async () => {
    const backupKey = new Uint8Array(32).fill(0x44);
    const newOwnerCommitment = new Uint8Array(32).fill(0x55);

    mockFindDeployedContract.mockRejectedValue(new Error('Contract not found'));

    await expect(
      executeBackupTransfer('contract-addr', backupKey, newOwnerCommitment, 'http://localhost:8088', 'http://localhost:6300'),
    ).rejects.toThrow('Contract not found');
  });
});
