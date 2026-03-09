import type { EnvConfig } from '../config/env.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class EmailKeyLookupService {
  private cache = new Map<string, CacheEntry<Uint8Array>>();
  private queryFn: ((contractAddress: string) => Promise<Uint8Array | null>) | null = null;

  constructor(private config: EnvConfig) {}

  /**
   * Set the query function. Called after indexer setup.
   * queryFn should read emailPublicKey from VaultRegistry public ledger via indexer.
   */
  setQueryFn(fn: (contractAddress: string) => Promise<Uint8Array | null>): void {
    this.queryFn = fn;
  }

  /**
   * Get the email public key for a VaultRegistry contract address.
   * Returns null if no email public key is set.
   */
  async getEmailPublicKey(contractAddress: string): Promise<Uint8Array | null> {
    const cached = this.cache.get(contractAddress);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    if (!this.queryFn) {
      throw new Error('EmailKeyLookupService not initialized: queryFn not set');
    }

    const publicKey = await this.queryFn(contractAddress);

    if (publicKey) {
      this.cache.set(contractAddress, {
        value: publicKey,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }

    return publicKey;
  }
}
