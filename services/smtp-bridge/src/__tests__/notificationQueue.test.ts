import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationQueue } from '../services/notificationQueue.js';

// Mock metrics to avoid prom-client dependency in tests
vi.mock('../metrics.js', () => ({
  emailsReceived: { inc: vi.fn() },
  encryptionErrors: { inc: vi.fn() },
  txErrors: { inc: vi.fn() },
  rpcDuration: { observe: vi.fn() },
}));

function createQueue(batchWindowMs = 100): NotificationQueue {
  return new NotificationQueue({
    batchWindowMs,
  } as any);
}

describe('NotificationQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches multiple notifications into one call', async () => {
    const queue = createQueue(100);
    const notifyFn = vi.fn<(addr: string, cid: string) => Promise<void>>().mockResolvedValue(undefined);
    queue.setNotifyFn(notifyFn);

    queue.enqueue('contract-a', 'manifest-1');
    queue.enqueue('contract-a', 'manifest-2');
    queue.enqueue('contract-a', 'manifest-3');

    // Advance past batch window
    await vi.advanceTimersByTimeAsync(150);

    // Only one call with the latest manifestCid
    expect(notifyFn).toHaveBeenCalledTimes(1);
    expect(notifyFn).toHaveBeenCalledWith('contract-a', 'manifest-3');

    queue.stop();
  });

  it('serializes per user — different contracts flush independently', async () => {
    const queue = createQueue(100);
    const notifyFn = vi.fn<(addr: string, cid: string) => Promise<void>>().mockResolvedValue(undefined);
    queue.setNotifyFn(notifyFn);

    queue.enqueue('contract-a', 'manifest-a');
    queue.enqueue('contract-b', 'manifest-b');

    await vi.advanceTimersByTimeAsync(150);

    expect(notifyFn).toHaveBeenCalledTimes(2);
    expect(notifyFn).toHaveBeenCalledWith('contract-a', 'manifest-a');
    expect(notifyFn).toHaveBeenCalledWith('contract-b', 'manifest-b');

    queue.stop();
  });

  it('retries on transient failure', async () => {
    const queue = createQueue(50);
    const notifyFn = vi
      .fn<(addr: string, cid: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    queue.setNotifyFn(notifyFn);

    queue.enqueue('contract-a', 'manifest-1');

    // Flush triggers
    await vi.advanceTimersByTimeAsync(100);
    // Retry delay (2s base * 2^0 = 2s)
    await vi.advanceTimersByTimeAsync(3000);

    expect(notifyFn).toHaveBeenCalledTimes(2);

    queue.stop();
  });

  it('dead-letters after max retries', async () => {
    const queue = createQueue(50);
    const notifyFn = vi
      .fn<(addr: string, cid: string) => Promise<void>>()
      .mockRejectedValue(new Error('permanent failure'));
    queue.setNotifyFn(notifyFn);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    queue.enqueue('contract-a', 'manifest-1');

    // Flush + all retries (3 attempts, exponential backoff: 2s, 4s)
    await vi.advanceTimersByTimeAsync(100);   // flush
    await vi.advanceTimersByTimeAsync(2500);  // retry 1
    await vi.advanceTimersByTimeAsync(5000);  // retry 2

    expect(notifyFn).toHaveBeenCalledTimes(3);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Dead-letter'),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    queue.stop();
  });

  it('stop prevents new enqueues', () => {
    const queue = createQueue(100);
    const notifyFn = vi.fn<(addr: string, cid: string) => Promise<void>>().mockResolvedValue(undefined);
    queue.setNotifyFn(notifyFn);

    queue.stop();
    queue.enqueue('contract-a', 'manifest-1');

    expect(queue.getPendingCount('contract-a')).toBe(0);
  });

  it('throws if notifyFn not set', async () => {
    const queue = createQueue(50);
    queue.enqueue('contract-a', 'manifest-1');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await vi.advanceTimersByTimeAsync(100);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Dead-letter'),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
    queue.stop();
  });
});
