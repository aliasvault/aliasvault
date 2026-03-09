import type { EnvConfig } from '../config/env.js';
import { txErrors } from '../metrics.js';

interface PendingNotification {
  contractAddress: string;
  manifestCid: string;
}

interface QueueEntry {
  pending: PendingNotification[];
  timer: ReturnType<typeof setTimeout> | null;
  processing: boolean;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;

/**
 * Per-user serialization queue with configurable batch window.
 * Collects emails per VaultRegistry contract address, then issues
 * a single notifyNewMail() call per batch window.
 */
export class NotificationQueue {
  private queues = new Map<string, QueueEntry>();
  private notifyFn: ((contractAddress: string, manifestCid: string) => Promise<void>) | null = null;
  private batchWindowMs: number;
  private stopped = false;

  constructor(config: EnvConfig) {
    this.batchWindowMs = config.batchWindowMs;
  }

  /**
   * Set the contract call function.
   * notifyFn calls notifyNewMail(manifestCid) on the user's VaultRegistry.
   */
  setNotifyFn(fn: (contractAddress: string, manifestCid: string) => Promise<void>): void {
    this.notifyFn = fn;
  }

  /**
   * Enqueue a notification. The most recent manifestCid wins
   * (since manifest is cumulative, only the latest matters).
   */
  enqueue(contractAddress: string, manifestCid: string): void {
    if (this.stopped) return;

    let entry = this.queues.get(contractAddress);
    if (!entry) {
      entry = { pending: [], timer: null, processing: false };
      this.queues.set(contractAddress, entry);
    }

    entry.pending.push({ contractAddress, manifestCid });

    // Start batch timer if not already running
    if (!entry.timer && !entry.processing) {
      entry.timer = setTimeout(() => {
        entry!.timer = null;
        this.flush(contractAddress);
      }, this.batchWindowMs);
    }
  }

  /**
   * Flush all pending notifications for a contract address.
   * Only the latest manifestCid is sent (manifests are cumulative).
   */
  private async flush(contractAddress: string): Promise<void> {
    const entry = this.queues.get(contractAddress);
    if (!entry || entry.pending.length === 0 || entry.processing) return;

    entry.processing = true;

    // Take the latest manifestCid (cumulative — only newest matters)
    const latest = entry.pending[entry.pending.length - 1];
    entry.pending = [];

    try {
      await this.sendWithRetry(contractAddress, latest.manifestCid);
    } catch (err) {
      console.error(`[notification-queue] Dead-letter for ${contractAddress}:`, err);
      txErrors.inc();
    } finally {
      entry.processing = false;

      // If more items accumulated while processing, flush again
      if (entry.pending.length > 0 && !this.stopped) {
        entry.timer = setTimeout(() => {
          entry!.timer = null;
          this.flush(contractAddress);
        }, this.batchWindowMs);
      }
    }
  }

  private async sendWithRetry(contractAddress: string, manifestCid: string): Promise<void> {
    if (!this.notifyFn) {
      throw new Error('NotificationQueue not initialized: notifyFn not set');
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this.notifyFn(contractAddress, manifestCid);
        return;
      } catch (err) {
        if (attempt === MAX_RETRIES - 1) {
          throw err;
        }
        const delay = RETRY_BASE_MS * Math.pow(2, attempt);
        console.warn(`[notification-queue] Retry ${attempt + 1}/${MAX_RETRIES} for ${contractAddress} in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Stop all timers and prevent new enqueues.
   */
  stop(): void {
    this.stopped = true;
    for (const [, entry] of this.queues) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
    }
  }

  /** Expose queue size for testing */
  get size(): number {
    return this.queues.size;
  }

  /** Expose pending count for a specific contract for testing */
  getPendingCount(contractAddress: string): number {
    return this.queues.get(contractAddress)?.pending.length ?? 0;
  }
}
