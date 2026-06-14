import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';

// Mock heavy SDK dependencies before importing the module under test.
// vault-registry-api.ts has module-level CompiledContract.make().pipe() calls
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
    VaultRegistry: { Contract: {}, ledger: vi.fn() },
    vaultRegistryWitnesses: {},
    createVaultRegistryPrivateState: vi.fn(),
    assertCIDv1: (cid: string) => {
        if (cid.startsWith('Qm')) throw new Error('CIDv0 detected. Convert to CIDv1 using IPFS CID.parse().');
        if (!/^[a-z2-7]/.test(cid)) throw new Error('CID must be base32 encoded (CIDv1).');
    },
}));

// Import the module under test (vitest hoists vi.mock calls above imports)
import {
    updateVault,
    getVaultCID,
    initVaultRegistryLogger,
    transferOwnership,
    storeRecoveryKeyHash,
    addBackupWallet,
    removeBackupWallet,
    backupTransfer,
} from '../vault-registry-api';

// Minimal mock logger — prevents undefined access in API functions
const mockLogger = {
    info: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
} as unknown as Logger;

// Minimal mock contract factory — each test gets a unique contract address
let addressCounter = 0;
const mockTxResult = { public: { txId: 'mock-tx', blockHeight: 1n } };
const createMockContract = (address?: string) =>
    ({
        callTx: {
            updateVault: vi.fn().mockResolvedValue(mockTxResult),
            transferOwnership: vi.fn().mockResolvedValue(mockTxResult),
            storeRecoveryKeyHash: vi.fn().mockResolvedValue(mockTxResult),
            addBackupWallet: vi.fn().mockResolvedValue(mockTxResult),
            removeBackupWallet: vi.fn().mockResolvedValue(mockTxResult),
            backupTransfer: vi.fn().mockResolvedValue(mockTxResult),
        },
        deployTxData: {
            public: { contractAddress: address ?? `mock-address-${++addressCounter}` },
        },
    }) as unknown as Parameters<typeof updateVault>[0];

describe('VaultRegistry API — CID store', () => {
    beforeEach(() => {
        initVaultRegistryLogger(mockLogger);
    });

    it('getVaultCID returns null for unknown contract', () => {
        const contract = createMockContract('unknown-address');
        expect(getVaultCID(contract)).toBeNull();
    });

    it('updateVault rejects CIDv0 before submitting tx', async () => {
        const contract = createMockContract();
        await expect(updateVault(contract, 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG')).rejects.toThrow(
            'CIDv0 detected',
        );
        // Verify no tx was submitted
        expect(contract.callTx.updateVault).not.toHaveBeenCalled();
    });

    it('updateVault rejects non-base32 CID before submitting tx', async () => {
        const contract = createMockContract();
        await expect(updateVault(contract, 'BAFY...')).rejects.toThrow('base32 encoded');
        expect(contract.callTx.updateVault).not.toHaveBeenCalled();
    });

    it('updateVault stores CID and getVaultCID retrieves it', async () => {
        const contract = createMockContract('store-test-address');
        const testCid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

        await updateVault(contract, testCid);

        expect(getVaultCID(contract)).toBe(testCid);
    });

    it('updateVault sends SHA-256 hash of CID to contract', async () => {
        const crypto = await import('node:crypto');
        const contract = createMockContract();
        const testCid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
        const expectedHash = crypto.createHash('sha256').update(testCid).digest();

        await updateVault(contract, testCid);

        expect(contract.callTx.updateVault).toHaveBeenCalledWith(expectedHash);
    });

    it('updateVault overwrites previous CID for same contract', async () => {
        const contract = createMockContract('overwrite-test-address');
        const cid1 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
        const cid2 = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenora';

        await updateVault(contract, cid1);
        expect(getVaultCID(contract)).toBe(cid1);

        await updateVault(contract, cid2);
        expect(getVaultCID(contract)).toBe(cid2);
    });
});

describe('VaultRegistry API — new circuits', () => {
    beforeEach(() => {
        initVaultRegistryLogger(mockLogger);
    });

    it('transferOwnership calls callTx.transferOwnership', async () => {
        const contract = createMockContract();
        const commitment = new Uint8Array(32).fill(0xaa);
        await transferOwnership(contract, commitment);
        expect(contract.callTx.transferOwnership).toHaveBeenCalledWith(commitment);
    });

    it('storeRecoveryKeyHash calls callTx.storeRecoveryKeyHash', async () => {
        const contract = createMockContract();
        const keyHash = new Uint8Array(32).fill(0xbb);
        await storeRecoveryKeyHash(contract, keyHash);
        expect(contract.callTx.storeRecoveryKeyHash).toHaveBeenCalledWith(keyHash);
    });

    it('addBackupWallet calls callTx.addBackupWallet with commitment and timestamp', async () => {
        const contract = createMockContract();
        const commitment = new Uint8Array(32).fill(0xcc);
        await addBackupWallet(contract, commitment, 1700000000n);
        expect(contract.callTx.addBackupWallet).toHaveBeenCalledWith(commitment, 1700000000n);
    });

    it('removeBackupWallet calls callTx.removeBackupWallet', async () => {
        const contract = createMockContract();
        const commitment = new Uint8Array(32).fill(0xdd);
        await removeBackupWallet(contract, commitment);
        expect(contract.callTx.removeBackupWallet).toHaveBeenCalledWith(commitment);
    });

    it('backupTransfer calls callTx.backupTransfer', async () => {
        const contract = createMockContract();
        const commitment = new Uint8Array(32).fill(0xee);
        await backupTransfer(contract, commitment);
        expect(contract.callTx.backupTransfer).toHaveBeenCalledWith(commitment);
    });
});
