import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultSyncService } from '../VaultSyncService';
import { VaultSyncError, VaultSyncErrorCodes } from '../errors';
import { base64ToUint8Array, uint8ArrayToBase64, sha256, bytesToHex, hexToUint8Array } from '../utils';
import type { VaultSyncProvider, VaultLoadProvider } from '../types';

// --- Mock provider factory ---

function createMockProvider(overrides?: Partial<VaultSyncProvider>): VaultSyncProvider {
  return {
    uploadToIpfs: vi.fn().mockResolvedValue('bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'),
    updateContractCidHash: vi.fn().mockResolvedValue(undefined),
    persistCid: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createTestData(): Uint8Array {
  return new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
}

// --- VaultSyncService tests ---

describe('VaultSyncService', () => {
  let provider: VaultSyncProvider;
  let service: VaultSyncService;

  beforeEach(() => {
    provider = createMockProvider();
    service = new VaultSyncService(provider);
  });

  it('should throw if saveVault called without provider', async () => {
    const serviceWithoutProvider = new VaultSyncService();
    await expect(serviceWithoutProvider.saveVault(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      'VaultSyncProvider is required for saveVault()'
    );
  });

  // Task 6.1: Full save pipeline with mock IPFS + contract
  it('should execute full save pipeline: IPFS upload → hash → contract → persist', async () => {
    const data = createTestData();
    const result = await service.saveVault(data);

    // Verify IPFS upload was called with the data
    expect(provider.uploadToIpfs).toHaveBeenCalledWith(data);

    // Verify contract update was called with a 32-byte hash
    expect(provider.updateContractCidHash).toHaveBeenCalledTimes(1);
    const cidHashArg = (provider.updateContractCidHash as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(cidHashArg).toBeInstanceOf(Uint8Array);
    expect(cidHashArg.length).toBe(32);

    // Verify CID persistence was called
    expect(provider.persistCid).toHaveBeenCalledTimes(1);

    // Verify result shape
    expect(result.cid).toBe('bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi');
    expect(result.cidHash).toBeTruthy();
    expect(result.cidHash.length).toBe(64); // hex-encoded SHA-256 = 64 chars
  });

  // Task 6.2: Upload returns CID, CID hash sent to contract
  it('should hash the CID and send hash to contract', async () => {
    const fakeCid = 'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
    provider = createMockProvider({
      uploadToIpfs: vi.fn().mockResolvedValue(fakeCid),
    });
    service = new VaultSyncService(provider);

    const result = await service.saveVault(createTestData());

    // Independently compute expected hash
    const expectedHashBytes = await sha256(fakeCid);
    const expectedHashHex = bytesToHex(expectedHashBytes);

    // The contract should receive the raw hash bytes
    const cidHashArg = (provider.updateContractCidHash as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(bytesToHex(cidHashArg)).toBe(expectedHashHex);

    // The result should contain the hex-encoded hash
    expect(result.cidHash).toBe(expectedHashHex);

    // The persist should receive CID and hex hash
    expect(provider.persistCid).toHaveBeenCalledWith(fakeCid, expectedHashHex);
  });

  // Task 6.3: IPFS failure wraps in VaultSyncError with retryable=true
  it('should throw retryable VaultSyncError on IPFS upload failure', async () => {
    provider = createMockProvider({
      uploadToIpfs: vi.fn().mockRejectedValue(new Error('Network timeout')),
    });
    service = new VaultSyncService(provider);

    await expect(service.saveVault(createTestData())).rejects.toThrow(VaultSyncError);

    try {
      await service.saveVault(createTestData());
    } catch (error) {
      expect(error).toBeInstanceOf(VaultSyncError);
      const syncError = error as VaultSyncError;
      expect(syncError.code).toBe(VaultSyncErrorCodes.IPFS_UPLOAD_FAILED);
      expect(syncError.retryable).toBe(true);
      expect(syncError.cause).toBeInstanceOf(Error);
    }
  });

  // Task 6.4: Contract failure throws VaultSyncError with retryable=false
  it('should throw non-retryable VaultSyncError on contract update failure', async () => {
    provider = createMockProvider({
      updateContractCidHash: vi.fn().mockRejectedValue(new Error('Not the vault owner')),
    });
    service = new VaultSyncService(provider);

    try {
      await service.saveVault(createTestData());
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(VaultSyncError);
      const syncError = error as VaultSyncError;
      expect(syncError.code).toBe(VaultSyncErrorCodes.CONTRACT_UPDATE_FAILED);
      expect(syncError.retryable).toBe(false);
      expect(syncError.cause?.message).toBe('Not the vault owner');
    }
  });

  // Task 6.4 (CID persistence failure)
  it('should throw retryable VaultSyncError on CID persistence failure', async () => {
    provider = createMockProvider({
      persistCid: vi.fn().mockRejectedValue(new Error('Storage quota exceeded')),
    });
    service = new VaultSyncService(provider);

    try {
      await service.saveVault(createTestData());
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(VaultSyncError);
      const syncError = error as VaultSyncError;
      expect(syncError.code).toBe(VaultSyncErrorCodes.CID_PERSISTENCE_FAILED);
      expect(syncError.retryable).toBe(true);
    }
  });

  // Task 6.5: Empty data validation
  it('should throw INVALID_ENCRYPTED_DATA for empty data', async () => {
    try {
      await service.saveVault(new Uint8Array(0));
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(VaultSyncError);
      const syncError = error as VaultSyncError;
      expect(syncError.code).toBe(VaultSyncErrorCodes.INVALID_ENCRYPTED_DATA);
      expect(syncError.retryable).toBe(false);
    }

    // IPFS should never be called
    expect(provider.uploadToIpfs).not.toHaveBeenCalled();
  });

  // Verify pipeline order: IPFS first, then contract, then persist
  it('should call providers in correct order', async () => {
    const callOrder: string[] = [];

    provider = createMockProvider({
      uploadToIpfs: vi.fn().mockImplementation(async () => {
        callOrder.push('ipfs');
        return 'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      }),
      updateContractCidHash: vi.fn().mockImplementation(async () => {
        callOrder.push('contract');
      }),
      persistCid: vi.fn().mockImplementation(async () => {
        callOrder.push('persist');
      }),
    });
    service = new VaultSyncService(provider);

    await service.saveVault(createTestData());

    expect(callOrder).toEqual(['ipfs', 'contract', 'persist']);
  });

  // Contract not called if IPFS fails
  it('should not call contract if IPFS upload fails', async () => {
    provider = createMockProvider({
      uploadToIpfs: vi.fn().mockRejectedValue(new Error('IPFS down')),
    });
    service = new VaultSyncService(provider);

    await expect(service.saveVault(createTestData())).rejects.toThrow();

    expect(provider.updateContractCidHash).not.toHaveBeenCalled();
    expect(provider.persistCid).not.toHaveBeenCalled();
  });

  // Persist not called if contract fails
  it('should not persist CID if contract update fails', async () => {
    provider = createMockProvider({
      updateContractCidHash: vi.fn().mockRejectedValue(new Error('Contract error')),
    });
    service = new VaultSyncService(provider);

    await expect(service.saveVault(createTestData())).rejects.toThrow();

    expect(provider.persistCid).not.toHaveBeenCalled();
  });
});

// --- Utility function tests ---

describe('base64ToUint8Array / uint8ArrayToBase64', () => {
  // Task 6.6: base64-to-Uint8Array conversion preserves data integrity
  it('should round-trip preserving data integrity', () => {
    const original = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const base64 = uint8ArrayToBase64(original);
    const restored = base64ToUint8Array(base64);

    expect(restored).toEqual(original);
  });

  it('should handle empty data', () => {
    const empty = new Uint8Array(0);
    const base64 = uint8ArrayToBase64(empty);
    const restored = base64ToUint8Array(base64);

    expect(restored).toEqual(empty);
  });

  it('should handle large binary data', () => {
    const large = new Uint8Array(10000);
    for (let i = 0; i < large.length; i++) {
      large[i] = i % 256;
    }
    const base64 = uint8ArrayToBase64(large);
    const restored = base64ToUint8Array(base64);

    expect(restored).toEqual(large);
  });
});

describe('sha256', () => {
  it('should produce 32-byte hash', async () => {
    const hash = await sha256('hello');
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  it('should produce deterministic output', async () => {
    const hash1 = await sha256('test-cid');
    const hash2 = await sha256('test-cid');
    expect(bytesToHex(hash1)).toBe(bytesToHex(hash2));
  });

  it('should produce different hashes for different inputs', async () => {
    const hash1 = await sha256('cid-1');
    const hash2 = await sha256('cid-2');
    expect(bytesToHex(hash1)).not.toBe(bytesToHex(hash2));
  });
});

describe('bytesToHex', () => {
  it('should convert bytes to hex string', () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0x10, 0xff]);
    expect(bytesToHex(bytes)).toBe('000f10ff');
  });

  it('should handle empty array', () => {
    expect(bytesToHex(new Uint8Array(0))).toBe('');
  });
});

describe('hexToUint8Array', () => {
  it('should convert hex string to bytes', () => {
    const result = hexToUint8Array('000f10ff');
    expect(result).toEqual(new Uint8Array([0x00, 0x0f, 0x10, 0xff]));
  });

  it('should handle empty string', () => {
    expect(hexToUint8Array('')).toEqual(new Uint8Array(0));
  });

  it('should round-trip with bytesToHex', () => {
    const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const hex = bytesToHex(original);
    const restored = hexToUint8Array(hex);
    expect(restored).toEqual(original);
  });
});

// Task 6.7: secretKey round-trip test
describe('secretKey round-trip', () => {
  it('should survive hex encode → store → retrieve → decode cycle', () => {
    // Generate a mock 32-byte secret key
    const secretKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      secretKey[i] = i * 8 + 3; // Deterministic but non-trivial values
    }

    // Hex encode (simulating storage in SQLite Settings)
    const hexEncoded = bytesToHex(secretKey);
    expect(hexEncoded.length).toBe(64); // 32 bytes = 64 hex chars

    // Decode back (simulating retrieval from SQLite Settings)
    const decoded = new Uint8Array(hexEncoded.length / 2);
    for (let i = 0; i < hexEncoded.length; i += 2) {
      decoded[i / 2] = parseInt(hexEncoded.substring(i, i + 2), 16);
    }

    expect(decoded).toEqual(secretKey);
  });
});

// --- Load pipeline mock factory ---

const FAKE_CID = 'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
const FAKE_ENCRYPTED_BYTES = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);

async function fakeCidHash(): Promise<Uint8Array> {
  return await sha256(FAKE_CID);
}

function createMockLoadProvider(overrides?: Partial<VaultLoadProvider>): VaultLoadProvider {
  return {
    readContractCidHash: vi.fn().mockImplementation(async () => await fakeCidHash()),
    getLocalCid: vi.fn().mockResolvedValue({ cid: FAKE_CID, cidHash: null }),
    downloadFromIpfs: vi.fn().mockResolvedValue(FAKE_ENCRYPTED_BYTES),
    discoverCidByHash: vi.fn().mockResolvedValue(FAKE_CID),
    persistCid: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// --- VaultSyncService.loadVault() tests ---

describe('VaultSyncService.loadVault', () => {
  let saveProvider: VaultSyncProvider;
  let service: VaultSyncService;

  beforeEach(() => {
    saveProvider = createMockProvider();
    service = new VaultSyncService(saveProvider);
  });

  // Task 8.1: loadVault returns null (up to date) when cidHash matches local
  it('should return null when on-chain cidHash matches local cidHash', async () => {
    const cidHashHex = bytesToHex(await fakeCidHash());
    const loadProvider = createMockLoadProvider({
      getLocalCid: vi.fn().mockResolvedValue({ cid: FAKE_CID, cidHash: cidHashHex }),
    });

    const result = await service.loadVault(loadProvider);

    expect(result).toBeNull();
    expect(loadProvider.downloadFromIpfs).not.toHaveBeenCalled();
  });

  // Task 8.2: loadVault downloads from IPFS when cidHash differs from local
  // H1 fix: stale local CID must NOT be reused — always discover new CID via Pinata
  it('should download from IPFS when cidHash differs from local', async () => {
    const loadProvider = createMockLoadProvider({
      getLocalCid: vi.fn().mockResolvedValue({ cid: 'bafkstale-old-cid', cidHash: 'stale-hash-that-does-not-match' }),
    });

    const result = await service.loadVault(loadProvider);

    expect(result).not.toBeNull();
    expect(result!.encryptedBytes).toEqual(FAKE_ENCRYPTED_BYTES);
    expect(result!.cid).toBe(FAKE_CID);
    expect(result!.source).toBe('ipfs-download');
    expect(loadProvider.discoverCidByHash).toHaveBeenCalled();
    expect(loadProvider.downloadFromIpfs).toHaveBeenCalledWith(FAKE_CID);
    expect(loadProvider.persistCid).toHaveBeenCalled();
  });

  // Task 8.3: loadVault triggers CID discovery when no local CID
  it('should trigger CID discovery when no local CID (new device)', async () => {
    const loadProvider = createMockLoadProvider({
      getLocalCid: vi.fn().mockResolvedValue({ cid: null, cidHash: null }),
    });

    const result = await service.loadVault(loadProvider);

    expect(result).not.toBeNull();
    expect(result!.source).toBe('ipfs-download');
    expect(loadProvider.discoverCidByHash).toHaveBeenCalled();
    expect(loadProvider.downloadFromIpfs).toHaveBeenCalledWith(FAKE_CID);
  });

  // Task 8.4: loadVault throws VAULT_NOT_FOUND when no registration on-chain
  it('should throw VAULT_NOT_FOUND when no registration on-chain', async () => {
    const loadProvider = createMockLoadProvider({
      readContractCidHash: vi.fn().mockResolvedValue(null),
    });

    try {
      await service.loadVault(loadProvider);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(VaultSyncError);
      const syncError = error as VaultSyncError;
      expect(syncError.code).toBe(VaultSyncErrorCodes.VAULT_NOT_FOUND);
      expect(syncError.retryable).toBe(false);
    }
  });

  // Task 8.5: CID discovery finds correct CID by hash matching
  it('should use discovered CID for download when local CID is null', async () => {
    const discoveredCid = 'bafkreidiscoveredcidtestvalue1234567890abcdefghijklmnopqrstuv';
    const loadProvider = createMockLoadProvider({
      getLocalCid: vi.fn().mockResolvedValue({ cid: null, cidHash: null }),
      discoverCidByHash: vi.fn().mockResolvedValue(discoveredCid),
    });

    const result = await service.loadVault(loadProvider);

    expect(result).not.toBeNull();
    expect(result!.cid).toBe(discoveredCid);
    expect(loadProvider.downloadFromIpfs).toHaveBeenCalledWith(discoveredCid);
  });

  // Task 8.6: CID discovery returns null when no matching pin
  it('should throw CID_DISCOVERY_FAILED when no matching pin found', async () => {
    const loadProvider = createMockLoadProvider({
      getLocalCid: vi.fn().mockResolvedValue({ cid: null, cidHash: null }),
      discoverCidByHash: vi.fn().mockResolvedValue(null),
    });

    try {
      await service.loadVault(loadProvider);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(VaultSyncError);
      const syncError = error as VaultSyncError;
      expect(syncError.code).toBe(VaultSyncErrorCodes.CID_DISCOVERY_FAILED);
      expect(syncError.retryable).toBe(false);
    }
  });

  // Task 8.7: download retry on transient failure (wrapped as IPFS_DOWNLOAD_FAILED)
  it('should throw retryable IPFS_DOWNLOAD_FAILED on download failure', async () => {
    const loadProvider = createMockLoadProvider({
      getLocalCid: vi.fn().mockResolvedValue({ cid: FAKE_CID, cidHash: 'different-hash' }),
      downloadFromIpfs: vi.fn().mockRejectedValue(new Error('Network timeout')),
    });

    try {
      await service.loadVault(loadProvider);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(VaultSyncError);
      const syncError = error as VaultSyncError;
      expect(syncError.code).toBe(VaultSyncErrorCodes.IPFS_DOWNLOAD_FAILED);
      expect(syncError.retryable).toBe(true);
      expect(syncError.cause?.message).toBe('Network timeout');
    }
  });

  // LEDGER_READ_FAILED on indexer error
  it('should throw retryable LEDGER_READ_FAILED on indexer error', async () => {
    const loadProvider = createMockLoadProvider({
      readContractCidHash: vi.fn().mockRejectedValue(new Error('Indexer unreachable')),
    });

    try {
      await service.loadVault(loadProvider);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(VaultSyncError);
      const syncError = error as VaultSyncError;
      expect(syncError.code).toBe(VaultSyncErrorCodes.LEDGER_READ_FAILED);
      expect(syncError.retryable).toBe(true);
    }
  });

  // CID_DISCOVERY_FAILED on discovery error (transient)
  it('should throw retryable CID_DISCOVERY_FAILED on discovery error', async () => {
    const loadProvider = createMockLoadProvider({
      getLocalCid: vi.fn().mockResolvedValue({ cid: null, cidHash: null }),
      discoverCidByHash: vi.fn().mockRejectedValue(new Error('Pinata API down')),
    });

    try {
      await service.loadVault(loadProvider);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(VaultSyncError);
      const syncError = error as VaultSyncError;
      expect(syncError.code).toBe(VaultSyncErrorCodes.CID_DISCOVERY_FAILED);
      expect(syncError.retryable).toBe(true);
    }
  });

  // Pipeline order: readContract → getLocal → discoverCid → download → persist
  it('should call load providers in correct order', async () => {
    const callOrder: string[] = [];
    const loadProvider = createMockLoadProvider({
      readContractCidHash: vi.fn().mockImplementation(async () => {
        callOrder.push('readContract');
        return await fakeCidHash();
      }),
      getLocalCid: vi.fn().mockImplementation(async () => {
        callOrder.push('getLocal');
        return { cid: 'bafkstale', cidHash: 'different' };
      }),
      discoverCidByHash: vi.fn().mockImplementation(async () => {
        callOrder.push('discoverCid');
        return FAKE_CID;
      }),
      downloadFromIpfs: vi.fn().mockImplementation(async () => {
        callOrder.push('download');
        return FAKE_ENCRYPTED_BYTES;
      }),
      persistCid: vi.fn().mockImplementation(async () => {
        callOrder.push('persist');
      }),
    });

    await service.loadVault(loadProvider);

    expect(callOrder).toEqual(['readContract', 'getLocal', 'discoverCid', 'download', 'persist']);
  });
});
