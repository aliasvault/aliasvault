import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultSyncService } from '../VaultSyncService';
import { VaultSyncError, VaultSyncErrorCodes } from '../errors';
import { sha256, bytesToHex } from '../utils';
import type { VaultSyncProvider, VaultLoadProvider } from '../types';

// --- Test data ---

const LOCAL_VAULT_JSON = JSON.stringify({
  version: 1,
  credentials: {
    'cred-1': {
      id: 'cred-1',
      serviceName: 'GitHub',
      username: 'user1',
      password: { value: 'pass1', createdAt: 1000, updatedAt: 1000 },
      alias: { birthDate: '1990-01-01' },
      attachments: [],
      totpCodes: [],
      passkeys: [],
      createdAt: 1000,
      updatedAt: 2000,
      isDeleted: false,
    },
  },
  settings: {},
  encryptionKeys: [],
  lastModified: 2000,
});

const REMOTE_VAULT_JSON = JSON.stringify({
  version: 1,
  credentials: {
    'cred-1': {
      id: 'cred-1',
      serviceName: 'GitHub',
      username: 'user1',
      password: { value: 'pass1', createdAt: 1000, updatedAt: 1000 },
      alias: { birthDate: '1990-01-01' },
      attachments: [],
      totpCodes: [],
      passkeys: [],
      createdAt: 1000,
      updatedAt: 2000,
      isDeleted: false,
    },
    'cred-2': {
      id: 'cred-2',
      serviceName: 'GitLab',
      username: 'user2',
      password: { value: 'pass2', createdAt: 1500, updatedAt: 1500 },
      alias: { birthDate: '1991-02-02' },
      attachments: [],
      totpCodes: [],
      passkeys: [],
      createdAt: 1500,
      updatedAt: 2500,
      isDeleted: false,
    },
  },
  settings: {},
  encryptionKeys: [],
  lastModified: 2500,
});

const FAKE_CID = 'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
const FAKE_REMOTE_ENCRYPTED = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);
const FAKE_MERGED_ENCRYPTED = new Uint8Array([0xCA, 0xFE, 0xBA, 0xBE]);
const ENCRYPTION_KEY = 'test-encryption-key';

async function fakeCidHash(): Promise<Uint8Array> {
  return await sha256(FAKE_CID);
}

// --- Mock factories ---

function createMockSyncProvider(overrides?: Partial<VaultSyncProvider>): VaultSyncProvider {
  return {
    uploadToIpfs: vi.fn().mockResolvedValue(FAKE_CID),
    updateContractCidHash: vi.fn().mockResolvedValue(undefined),
    persistCid: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function createMockLoadProvider(overrides?: Partial<VaultLoadProvider>): Promise<VaultLoadProvider> {
  const cidHashHex = bytesToHex(await fakeCidHash());
  return {
    readContractCidHash: vi.fn().mockImplementation(async () => await fakeCidHash()),
    getLocalCid: vi.fn().mockResolvedValue({ cid: FAKE_CID, cidHash: cidHashHex }),
    downloadFromIpfs: vi.fn().mockResolvedValue(FAKE_REMOTE_ENCRYPTED),
    discoverCidByHash: vi.fn().mockResolvedValue(FAKE_CID),
    persistCid: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockDecrypt(): (bytes: Uint8Array, key: string) => Promise<string> {
  return vi.fn().mockResolvedValue(REMOTE_VAULT_JSON);
}

function createMockEncrypt(): (plaintext: string, key: string) => Promise<Uint8Array> {
  return vi.fn().mockImplementation(async () => FAKE_MERGED_ENCRYPTED);
}

// --- Tests ---

describe('VaultSyncService.saveWithConflictCheck', () => {
  let syncProvider: VaultSyncProvider;
  let service: VaultSyncService;
  let decrypt: ReturnType<typeof createMockDecrypt>;
  let encrypt: ReturnType<typeof createMockEncrypt>;

  beforeEach(() => {
    syncProvider = createMockSyncProvider();
    service = new VaultSyncService(syncProvider);
    decrypt = createMockDecrypt();
    encrypt = createMockEncrypt();
  });

  // 5.2: No conflict (hashes match) → delegates to saveVault(), merged: false
  it('should save normally when hashes match (no conflict)', async () => {
    const cidHashHex = bytesToHex(await fakeCidHash());
    const loadProvider = await createMockLoadProvider({
      getLocalCid: vi.fn().mockResolvedValue({ cid: FAKE_CID, cidHash: cidHashHex }),
    });

    const result = await service.saveWithConflictCheck(
      LOCAL_VAULT_JSON, ENCRYPTION_KEY, loadProvider, decrypt, encrypt,
    );

    expect(result.merged).toBe(false);
    expect(result.summary).toBeUndefined();
    expect(result.cid).toBe(FAKE_CID);
    expect(result.cidHash).toBeTruthy();
    expect(syncProvider.uploadToIpfs).toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
  });

  // 5.3: Conflict detected → downloads remote, decrypts, merges, re-encrypts, saves merged
  it('should merge when hashes differ (conflict detected)', async () => {
    const loadProvider = await createMockLoadProvider({
      getLocalCid: vi.fn().mockResolvedValue({ cid: 'old-cid', cidHash: 'different-hash' }),
    });

    const result = await service.saveWithConflictCheck(
      LOCAL_VAULT_JSON, ENCRYPTION_KEY, loadProvider, decrypt, encrypt,
    );

    expect(result.merged).toBe(true);
    expect(result.summary).toBeDefined();
    expect(result.summary!.added).toContain('cred-2');
    expect(result.summary!.kept).toContain('cred-1');
    expect(loadProvider.discoverCidByHash).toHaveBeenCalled();
    expect(loadProvider.downloadFromIpfs).toHaveBeenCalledWith(FAKE_CID);
    expect(decrypt).toHaveBeenCalledWith(FAKE_REMOTE_ENCRYPTED, ENCRYPTION_KEY);
    // Encrypt should be called with merged JSON (not original local)
    expect(encrypt).toHaveBeenCalled();
    const encryptCall = (encrypt as ReturnType<typeof vi.fn>).mock.calls[0];
    const mergedVault = JSON.parse(encryptCall[0]);
    expect(mergedVault.credentials['cred-2']).toBeDefined();
    expect(encryptCall[1]).toBe(ENCRYPTION_KEY);
  });

  // 5.4: Conflict but remote download fails → throws IPFS_DOWNLOAD_FAILED
  it('should throw IPFS_DOWNLOAD_FAILED when remote download fails during conflict', async () => {
    const loadProvider = await createMockLoadProvider({
      getLocalCid: vi.fn().mockResolvedValue({ cid: 'old-cid', cidHash: 'different-hash' }),
      downloadFromIpfs: vi.fn().mockRejectedValue(new Error('Network timeout')),
    });

    try {
      await service.saveWithConflictCheck(
        LOCAL_VAULT_JSON, ENCRYPTION_KEY, loadProvider, decrypt, encrypt,
      );
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(VaultSyncError);
      const syncError = error as VaultSyncError;
      expect(syncError.code).toBe(VaultSyncErrorCodes.IPFS_DOWNLOAD_FAILED);
      expect(syncError.retryable).toBe(true);
    }
  });

  // 5.5: Conflict but remote decrypt fails → throws MERGE_DECRYPT_FAILED
  it('should throw MERGE_DECRYPT_FAILED when remote decrypt fails', async () => {
    const failDecrypt = vi.fn().mockRejectedValue(new Error('Decryption failed'));
    const loadProvider = await createMockLoadProvider({
      getLocalCid: vi.fn().mockResolvedValue({ cid: 'old-cid', cidHash: 'different-hash' }),
    });

    try {
      await service.saveWithConflictCheck(
        LOCAL_VAULT_JSON, ENCRYPTION_KEY, loadProvider, failDecrypt, encrypt,
      );
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(VaultSyncError);
      const syncError = error as VaultSyncError;
      expect(syncError.code).toBe(VaultSyncErrorCodes.MERGE_DECRYPT_FAILED);
      expect(syncError.retryable).toBe(false);
    }
  });

  // 5.6: On-chain hash read fails → throws LEDGER_READ_FAILED
  it('should throw LEDGER_READ_FAILED when on-chain hash read fails', async () => {
    const loadProvider = await createMockLoadProvider({
      readContractCidHash: vi.fn().mockRejectedValue(new Error('Indexer unreachable')),
    });

    try {
      await service.saveWithConflictCheck(
        LOCAL_VAULT_JSON, ENCRYPTION_KEY, loadProvider, decrypt, encrypt,
      );
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(VaultSyncError);
      const syncError = error as VaultSyncError;
      expect(syncError.code).toBe(VaultSyncErrorCodes.LEDGER_READ_FAILED);
      expect(syncError.retryable).toBe(true);
    }
  });

  // 5.7: No local CID cached (first save) → skip conflict check, proceed with save
  it('should skip conflict check on first save (no local CID)', async () => {
    const loadProvider = await createMockLoadProvider({
      getLocalCid: vi.fn().mockResolvedValue({ cid: null, cidHash: null }),
    });

    const result = await service.saveWithConflictCheck(
      LOCAL_VAULT_JSON, ENCRYPTION_KEY, loadProvider, decrypt, encrypt,
    );

    expect(result.merged).toBe(false);
    expect(result.summary).toBeUndefined();
    expect(syncProvider.uploadToIpfs).toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
    expect(loadProvider.discoverCidByHash).not.toHaveBeenCalled();
  });

  // 5.8: Merged vault is uploaded (not the original local vault)
  it('should upload the merged vault, not the original local vault', async () => {
    const loadProvider = await createMockLoadProvider({
      getLocalCid: vi.fn().mockResolvedValue({ cid: 'old-cid', cidHash: 'different-hash' }),
    });

    const result = await service.saveWithConflictCheck(
      LOCAL_VAULT_JSON, ENCRYPTION_KEY, loadProvider, decrypt, encrypt,
    );

    // The encrypted bytes passed to saveVault should be FAKE_MERGED_ENCRYPTED (from encrypt mock)
    expect(syncProvider.uploadToIpfs).toHaveBeenCalledWith(FAKE_MERGED_ENCRYPTED);
    expect(result.uploadedBytes).toBe(FAKE_MERGED_ENCRYPTED);
  });

  // H2: Encrypt failure throws ENCRYPT_FAILED, not raw error
  it('should throw ENCRYPT_FAILED when encrypt callback fails (no-conflict path)', async () => {
    const cidHashHex = bytesToHex(await fakeCidHash());
    const loadProvider = await createMockLoadProvider({
      getLocalCid: vi.fn().mockResolvedValue({ cid: FAKE_CID, cidHash: cidHashHex }),
    });
    const failEncrypt = vi.fn().mockRejectedValue(new Error('Crypto error'));

    try {
      await service.saveWithConflictCheck(
        LOCAL_VAULT_JSON, ENCRYPTION_KEY, loadProvider, decrypt, failEncrypt,
      );
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(VaultSyncError);
      const syncError = error as VaultSyncError;
      expect(syncError.code).toBe(VaultSyncErrorCodes.ENCRYPT_FAILED);
      expect(syncError.retryable).toBe(false);
    }
  });

  // Additional: no sync provider throws
  it('should throw if no sync provider configured', async () => {
    const serviceWithoutProvider = new VaultSyncService();
    const loadProvider = await createMockLoadProvider();

    await expect(
      serviceWithoutProvider.saveWithConflictCheck(
        LOCAL_VAULT_JSON, ENCRYPTION_KEY, loadProvider, decrypt, encrypt,
      ),
    ).rejects.toThrow('VaultSyncProvider is required');
  });
});
