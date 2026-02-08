import { describe, it, expect, vi } from 'vitest';
import { withRetry, isRetryableError } from '../retry.js';
import { IpfsError, IpfsErrorCodes } from '../errors.js';

describe('isRetryableError', () => {
  it('returns true for retryable IpfsError codes', () => {
    const error = new IpfsError(IpfsErrorCodes.IPFS_UPLOAD_FAILED, 'upload failed');
    expect(isRetryableError(error)).toBe(true);
  });

  it('returns true for IPFS_DOWNLOAD_FAILED', () => {
    const error = new IpfsError(IpfsErrorCodes.IPFS_DOWNLOAD_FAILED, 'download failed');
    expect(isRetryableError(error)).toBe(true);
  });

  it('returns true for IPFS_TIMEOUT', () => {
    const error = new IpfsError(IpfsErrorCodes.IPFS_TIMEOUT, 'timeout');
    expect(isRetryableError(error)).toBe(true);
  });

  it('returns false for IPFS_AUTH_FAILED (permanent)', () => {
    const error = new IpfsError(IpfsErrorCodes.IPFS_AUTH_FAILED, 'auth failed');
    expect(isRetryableError(error)).toBe(false);
  });

  it('returns false for IPFS_INVALID_CID (permanent)', () => {
    const error = new IpfsError(IpfsErrorCodes.IPFS_INVALID_CID, 'invalid cid');
    expect(isRetryableError(error)).toBe(false);
  });

  it('returns false for generic Error', () => {
    expect(isRetryableError(new Error('generic'))).toBe(false);
  });

  it('returns true for fetch TypeError (network error)', () => {
    const error = new TypeError('Failed to fetch');
    expect(isRetryableError(error)).toBe(true);
  });
});

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('result');
    const result = await withRetry(fn, 3, 1);
    expect(result).toBe('result');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient failure then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new IpfsError(IpfsErrorCodes.IPFS_UPLOAD_FAILED, 'fail'))
      .mockResolvedValueOnce('success');
    const result = await withRetry(fn, 3, 1);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after maxRetries exhausted', async () => {
    const error = new IpfsError(IpfsErrorCodes.IPFS_UPLOAD_FAILED, 'persistent fail');
    const fn = vi.fn().mockRejectedValue(error);
    await expect(withRetry(fn, 2, 1)).rejects.toThrow('persistent fail');
    // 1 initial + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on permanent failure (auth)', async () => {
    const error = new IpfsError(IpfsErrorCodes.IPFS_AUTH_FAILED, 'bad auth');
    const fn = vi.fn().mockRejectedValue(error);
    await expect(withRetry(fn, 3, 1)).rejects.toThrow('bad auth');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on IPFS_INVALID_CID', async () => {
    const error = new IpfsError(IpfsErrorCodes.IPFS_INVALID_CID, 'bad cid');
    const fn = vi.fn().mockRejectedValue(error);
    await expect(withRetry(fn, 3, 1)).rejects.toThrow('bad cid');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff between retries', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new IpfsError(IpfsErrorCodes.IPFS_UPLOAD_FAILED, 'fail'))
      .mockRejectedValueOnce(new IpfsError(IpfsErrorCodes.IPFS_UPLOAD_FAILED, 'fail'))
      .mockResolvedValueOnce('ok');

    const start = Date.now();
    await withRetry(fn, 3, 10); // 10ms base delay
    const elapsed = Date.now() - start;

    // First retry: 10ms, second retry: 20ms = ~30ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(20);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('works with maxRetries=0 (no retries)', async () => {
    const error = new IpfsError(IpfsErrorCodes.IPFS_UPLOAD_FAILED, 'fail');
    const fn = vi.fn().mockRejectedValue(error);
    await expect(withRetry(fn, 0, 1)).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
