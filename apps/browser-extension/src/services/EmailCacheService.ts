/**
 * Email cache service — chrome.storage.local persistence layer.
 * Stores email metadata (not full body) for inbox list view.
 * Full body is re-fetched from IPFS on detail view.
 *
 * Storage keys:
 * - emailCache:{cid} → CachedEmail metadata
 * - emailCacheIndex → string[] of cached CIDs
 * - emailManifestCache → ManifestCacheEntry
 */

export interface CachedEmail {
  cid: string;
  from: string;
  to: string;
  subject: string;
  bodyPreview: string;
  receivedAt: number;
  isRead: boolean;
  cachedAt: number;
}

export interface ManifestCacheEntry {
  manifestCid: string;
  emailCids: string[];
  lastChecked: number;
}

const EMAIL_CACHE_PREFIX = 'emailCache:';
const INDEX_KEY = 'emailCacheIndex';
const MANIFEST_CACHE_KEY = 'emailManifestCache';

export class EmailCacheService {
  /**
   * Store email metadata in cache.
   */
  async cacheEmail(email: CachedEmail): Promise<void> {
    await chrome.storage.local.set({
      [`${EMAIL_CACHE_PREFIX}${email.cid}`]: email,
    });

    // Update index
    const index = await this.getCacheIndex();
    if (!index.includes(email.cid)) {
      index.push(email.cid);
      await chrome.storage.local.set({ [INDEX_KEY]: index });
    }
  }

  /**
   * Get all cached email metadata for list view.
   */
  async getCachedEmails(): Promise<CachedEmail[]> {
    const index = await this.getCacheIndex();
    if (index.length === 0) return [];

    const keys = index.map((cid) => `${EMAIL_CACHE_PREFIX}${cid}`);
    const result = await chrome.storage.local.get(keys);

    return keys
      .map((key) => result[key] as CachedEmail | undefined)
      .filter((email): email is CachedEmail => email !== undefined);
  }

  /**
   * Mark email as read in cache.
   */
  async markAsRead(cid: string): Promise<void> {
    const key = `${EMAIL_CACHE_PREFIX}${cid}`;
    const result = await chrome.storage.local.get(key);
    const email = result[key] as CachedEmail | undefined;

    if (!email) return;

    email.isRead = true;
    await chrome.storage.local.set({ [key]: email });
  }

  /**
   * Delete email from local cache (IPFS unpin deferred).
   */
  async deleteEmail(cid: string): Promise<void> {
    await chrome.storage.local.remove(`${EMAIL_CACHE_PREFIX}${cid}`);

    // Update index
    const index = await this.getCacheIndex();
    const updated = index.filter((c) => c !== cid);
    await chrome.storage.local.set({ [INDEX_KEY]: updated });
  }

  /**
   * Get set of all cached CIDs for new-email detection.
   */
  async getKnownCids(): Promise<Set<string>> {
    const index = await this.getCacheIndex();
    return new Set(index);
  }

  /**
   * Save manifest cache metadata.
   */
  async saveManifestCache(manifestCid: string, emailCids: string[]): Promise<void> {
    const entry: ManifestCacheEntry = {
      manifestCid,
      emailCids,
      lastChecked: Date.now(),
    };
    await chrome.storage.local.set({ [MANIFEST_CACHE_KEY]: entry });
  }

  /**
   * Get cached manifest metadata.
   */
  async getManifestCache(): Promise<ManifestCacheEntry | null> {
    const result = await chrome.storage.local.get(MANIFEST_CACHE_KEY);
    return (result[MANIFEST_CACHE_KEY] as ManifestCacheEntry) ?? null;
  }

  /**
   * Get the CID index from storage.
   */
  private async getCacheIndex(): Promise<string[]> {
    const result = await chrome.storage.local.get(INDEX_KEY);
    return (result[INDEX_KEY] as string[]) ?? [];
  }
}
