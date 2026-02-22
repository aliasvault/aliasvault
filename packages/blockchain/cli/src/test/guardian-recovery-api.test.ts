import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';

// Mock heavy SDK dependencies before importing the module under test.
// guardian-recovery-api.ts has module-level CompiledContract.make().pipe() calls
// that require the full Midnight SDK — these mocks prevent that.

vi.mock('../config', () => ({ currentDir: '/tmp/test' }));

vi.mock('@midnight-ntwrk/compact-js', () => ({
  CompiledContract: {
    make: () => ({ pipe: (..._fns: unknown[]) => ({}) }),
    withWitnesses: () => (x: unknown) => x,
    withCompiledFileAssets: () => (x: unknown) => x,
  },
}));

vi.mock('@midnight-ntwrk/midnight-js-contracts', () => ({
  deployContract: vi.fn(),
  findDeployedContract: vi.fn(),
}));

vi.mock('@midnight-ntwrk/midnight-js-utils', () => ({
  assertIsContractAddress: vi.fn(),
}));

vi.mock('@aliasvault/contract', () => ({
  GuardianRecovery: { Contract: {}, ledger: vi.fn() },
  guardianRecoveryWitnesses: {},
  createGuardianRecoveryPrivateState: vi.fn(),
}));

// Import the module under test (vitest hoists vi.mock calls above imports)
import {
  initGuardianRecoveryLogger,
  deployGuardianRecovery,
  joinGuardianRecovery,
  initialize,
  addGuardian,
  removeGuardian,
  storeSharesCidHash,
  initiateRecovery,
  approveRecovery,
  claimRecovery,
  cancelRecovery,
  getGuardianRecoveryLedgerState,
} from '../guardian-recovery-api';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { GuardianRecovery } from '@aliasvault/contract';

// Minimal mock logger — prevents undefined access in API functions
const mockLogger = { info: vi.fn(), trace: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as unknown as Logger;

// Minimal mock contract factory — each test gets a unique contract address
let addressCounter = 0;
const mockTxResult = { public: { txId: 'mock-tx', blockHeight: 1n } };
const createMockContract = (address?: string) => ({
  callTx: {
    initialize: vi.fn().mockResolvedValue(mockTxResult),
    addGuardian: vi.fn().mockResolvedValue(mockTxResult),
    removeGuardian: vi.fn().mockResolvedValue(mockTxResult),
    storeSharesCidHash: vi.fn().mockResolvedValue(mockTxResult),
    initiateRecovery: vi.fn().mockResolvedValue(mockTxResult),
    approveRecovery: vi.fn().mockResolvedValue(mockTxResult),
    claimRecovery: vi.fn().mockResolvedValue(mockTxResult),
    cancelRecovery: vi.fn().mockResolvedValue(mockTxResult),
  },
  deployTxData: {
    public: { contractAddress: address ?? `mock-address-${++addressCounter}` },
  },
}) as unknown as Parameters<typeof initialize>[0];

describe('GuardianRecovery API — circuit wrappers', () => {
  beforeEach(() => {
    initGuardianRecoveryLogger(mockLogger);
  });

  it('initialize calls callTx.initialize', async () => {
    const contract = createMockContract();
    const ownerCom = new Uint8Array(32).fill(0x11);
    await initialize(contract, ownerCom);
    expect(contract.callTx.initialize).toHaveBeenCalledWith(ownerCom);
  });

  it('addGuardian calls callTx.addGuardian', async () => {
    const contract = createMockContract();
    const guardianCom = new Uint8Array(32).fill(0x22);
    await addGuardian(contract, guardianCom);
    expect(contract.callTx.addGuardian).toHaveBeenCalledWith(guardianCom);
  });

  it('removeGuardian calls callTx.removeGuardian', async () => {
    const contract = createMockContract();
    const guardianCom = new Uint8Array(32).fill(0x33);
    await removeGuardian(contract, guardianCom);
    expect(contract.callTx.removeGuardian).toHaveBeenCalledWith(guardianCom);
  });

  it('storeSharesCidHash calls callTx.storeSharesCidHash', async () => {
    const contract = createMockContract();
    const cidHash = new Uint8Array(32).fill(0x44);
    await storeSharesCidHash(contract, cidHash);
    expect(contract.callTx.storeSharesCidHash).toHaveBeenCalledWith(cidHash);
  });

  it('initiateRecovery calls callTx.initiateRecovery with bigint', async () => {
    const contract = createMockContract();
    await initiateRecovery(contract, 1700000000n);
    expect(contract.callTx.initiateRecovery).toHaveBeenCalledWith(1700000000n);
  });

  it('approveRecovery calls callTx.approveRecovery', async () => {
    const contract = createMockContract();
    await approveRecovery(contract);
    expect(contract.callTx.approveRecovery).toHaveBeenCalled();
  });

  it('claimRecovery calls callTx.claimRecovery', async () => {
    const contract = createMockContract();
    await claimRecovery(contract);
    expect(contract.callTx.claimRecovery).toHaveBeenCalled();
  });

  it('cancelRecovery calls callTx.cancelRecovery', async () => {
    const contract = createMockContract();
    await cancelRecovery(contract);
    expect(contract.callTx.cancelRecovery).toHaveBeenCalled();
  });
});

describe('GuardianRecovery API — deploy/join', () => {
  beforeEach(() => {
    initGuardianRecoveryLogger(mockLogger);
    vi.mocked(deployContract).mockReset();
    vi.mocked(findDeployedContract).mockReset();
  });

  it('deployGuardianRecovery calls deployContract with correct params', async () => {
    const mockResult = { deployTxData: { public: { contractAddress: 'mock-addr' } } };
    vi.mocked(deployContract).mockResolvedValue(mockResult as never);
    const sk = new Uint8Array(32).fill(0xaa);
    await deployGuardianRecovery({} as never, sk);
    expect(deployContract).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        privateStateId: 'guardianRecoveryPrivateState',
      }),
    );
  });

  it('joinGuardianRecovery calls findDeployedContract with address', async () => {
    const mockResult = { deployTxData: { public: { contractAddress: 'existing-addr' } } };
    vi.mocked(findDeployedContract).mockResolvedValue(mockResult as never);
    const sk = new Uint8Array(32).fill(0xbb);
    await joinGuardianRecovery({} as never, 'existing-addr', sk);
    expect(findDeployedContract).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        contractAddress: 'existing-addr',
        privateStateId: 'guardianRecoveryPrivateState',
      }),
    );
  });
});

describe('GuardianRecovery API — getGuardianRecoveryLedgerState', () => {
  beforeEach(() => {
    initGuardianRecoveryLogger(mockLogger);
  });

  it('returns null when contract state is null', async () => {
    const providers = {
      publicDataProvider: {
        queryContractState: vi.fn().mockResolvedValue(null),
      },
    } as never;
    const result = await getGuardianRecoveryLedgerState(providers, 'some-address' as never);
    expect(result).toBeNull();
  });

  it('returns mapped ledger fields when state exists', async () => {
    const mockLedger = {
      owner: new Uint8Array(32).fill(0x11),
      guardianCount: 2n,
      recoveryInitiatedAt: 100n,
      sharesCidHash: new Uint8Array(32).fill(0x22),
      recoveryComplete: false,
      guardians: { isEmpty: () => false },
      approvedGuardians: { isEmpty: () => true },
    };
    vi.mocked(GuardianRecovery.ledger).mockReturnValue(mockLedger as never);
    const providers = {
      publicDataProvider: {
        queryContractState: vi.fn().mockResolvedValue({ data: 'mock-data' }),
      },
    } as never;
    const result = await getGuardianRecoveryLedgerState(providers, 'some-address' as never);
    expect(result).toEqual({
      owner: mockLedger.owner,
      guardianCount: 2n,
      recoveryInitiatedAt: 100n,
      sharesCidHash: mockLedger.sharesCidHash,
      recoveryComplete: false,
      guardiansEmpty: false,
      approvedGuardiansEmpty: true,
    });
  });
});
