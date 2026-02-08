import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IpfsService } from '../IpfsService.js';
import { IpfsError, IpfsErrorCodes } from '../errors.js';
import type { IpfsProvider } from '../types.js';

// Mock @aliasvault/contract — assertCIDv1 validates CIDv1 format
vi.mock('@aliasvault/contract', () => ({
  assertCIDv1: (cid: string) => {
    if (cid.startsWith('Qm')) {
      throw new Error('CIDv0 detected. Convert to CIDv1 using IPFS CID.parse().');
    }
    if (!/^[a-z2-7]/.test(cid)) {
      throw new Error('CID must be base32 encoded (CIDv1).');
    }
  },
}));

const VALID_CID = 'bafkreid7qoywk77r7rj3slobqfekdvs57qwuwh5d2z3sqsw52iabe3mqne';
const CIDV0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

function createMockProvider(overrides?: Partial<IpfsProvider>): IpfsProvider {
  return {
    upload: vi.fn().mockResolvedValue(VALID_CID),
    download: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    ...overrides,
  };
}

describe('IpfsService', () => {
  let provider: IpfsProvider;
  let service: IpfsService;

  beforeEach(() => {
    provider = createMockProvider();
    service = new IpfsService(provider, { maxRetries: 0, baseDelayMs: 1 });
  });

  describe('constructor', () => {
    it('throws if provider is not provided', () => {
      expect(() => new IpfsService(null as unknown as IpfsProvider)).toThrow('IpfsProvider is required');
    });

    it('uses default config when not provided', () => {
      const svc = new IpfsService(provider);
      expect(svc).toBeInstanceOf(IpfsService);
    });

    it('accepts custom config', () => {
      const svc = new IpfsService(provider, { maxRetries: 5, baseDelayMs: 500 });
      expect(svc).toBeInstanceOf(IpfsService);
    });
  });

  describe('upload', () => {
    it('returns CIDv1 string on success', async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await service.upload(data);
      expect(result).toBe(VALID_CID);
      expect(provider.upload).toHaveBeenCalledWith(data);
    });

    it('rejects empty data', async () => {
      await expect(service.upload(new Uint8Array([]))).rejects.toThrow('Upload data must not be empty');
    });

    it('rejects CIDv0 returned by provider', async () => {
      const badProvider = createMockProvider({
        upload: vi.fn().mockResolvedValue(CIDV0),
      });
      const svc = new IpfsService(badProvider, { maxRetries: 0 });
      await expect(svc.upload(new Uint8Array([1]))).rejects.toThrow(IpfsError);
      try {
        await svc.upload(new Uint8Array([1]));
      } catch (err) {
        expect(err).toBeInstanceOf(IpfsError);
        expect((err as IpfsError).code).toBe(IpfsErrorCodes.IPFS_INVALID_CID);
      }
    });

    it('rejects invalid CID format from provider', async () => {
      const badProvider = createMockProvider({
        upload: vi.fn().mockResolvedValue('INVALID_CID_123'),
      });
      const svc = new IpfsService(badProvider, { maxRetries: 0 });
      await expect(svc.upload(new Uint8Array([1]))).rejects.toThrow(IpfsError);
    });

    it('retries on transient provider failure', async () => {
      const retryProvider = createMockProvider({
        upload: vi.fn()
          .mockRejectedValueOnce(new IpfsError(IpfsErrorCodes.IPFS_UPLOAD_FAILED, 'fail'))
          .mockResolvedValueOnce(VALID_CID),
      });
      const svc = new IpfsService(retryProvider, { maxRetries: 2, baseDelayMs: 1 });
      const result = await svc.upload(new Uint8Array([1, 2]));
      expect(result).toBe(VALID_CID);
      expect(retryProvider.upload).toHaveBeenCalledTimes(2);
    });

    it('propagates non-retryable errors immediately', async () => {
      const authProvider = createMockProvider({
        upload: vi.fn().mockRejectedValue(new IpfsError(IpfsErrorCodes.IPFS_AUTH_FAILED, 'auth fail')),
      });
      const svc = new IpfsService(authProvider, { maxRetries: 3, baseDelayMs: 1 });
      await expect(svc.upload(new Uint8Array([1]))).rejects.toThrow('auth fail');
      expect(authProvider.upload).toHaveBeenCalledTimes(1);
    });
  });

  describe('download', () => {
    it('returns Uint8Array for valid CID', async () => {
      const result = await service.download(VALID_CID);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result).toEqual(new Uint8Array([1, 2, 3]));
      expect(provider.download).toHaveBeenCalledWith(VALID_CID);
    });

    it('rejects CIDv0 input', async () => {
      await expect(service.download(CIDV0)).rejects.toThrow(IpfsError);
      try {
        await service.download(CIDV0);
      } catch (err) {
        expect((err as IpfsError).code).toBe(IpfsErrorCodes.IPFS_INVALID_CID);
      }
    });

    it('rejects invalid CID format', async () => {
      await expect(service.download('INVALID_CID')).rejects.toThrow(IpfsError);
    });

    it('retries on transient download failure', async () => {
      const retryProvider = createMockProvider({
        download: vi.fn()
          .mockRejectedValueOnce(new IpfsError(IpfsErrorCodes.IPFS_DOWNLOAD_FAILED, 'fail'))
          .mockResolvedValueOnce(new Uint8Array([4, 5, 6])),
      });
      const svc = new IpfsService(retryProvider, { maxRetries: 2, baseDelayMs: 1 });
      const result = await svc.download(VALID_CID);
      expect(result).toEqual(new Uint8Array([4, 5, 6]));
      expect(retryProvider.download).toHaveBeenCalledTimes(2);
    });
  });
});
