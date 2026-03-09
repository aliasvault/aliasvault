import type { EnvConfig } from '../config/env.js';
import { hashAlias } from './aliasHashing.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class AliasLookupService {
  private cache = new Map<string, CacheEntry<string>>();
  private queryFn: ((aliasHash: Uint8Array) => Promise<string | null>) | null = null;

  constructor(private config: EnvConfig) {}

  /**
   * Set the contract query function. Called after contract setup.
   * queryFn should call AliasRegistry.getContractAddress(aliasHash)
   * and return the VaultRegistry address or null if not found.
   */
  setQueryFn(fn: (aliasHash: Uint8Array) => Promise<string | null>): void {
    this.queryFn = fn;
  }

  /**
   * Look up a VaultRegistry contract address by alias local part.
   * Returns null if alias is not registered.
   */
  async lookupAlias(localPart: string): Promise<string | null> {
    const cacheKey = localPart.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    if (!this.queryFn) {
      throw new Error('AliasLookupService not initialized: queryFn not set');
    }

    const aliasHash = hashAlias(localPart);
    const contractAddress = await this.queryFn(aliasHash);

    if (contractAddress) {
      this.cache.set(cacheKey, {
        value: contractAddress,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }

    return contractAddress;
  }
}
