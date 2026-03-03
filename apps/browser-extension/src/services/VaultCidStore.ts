/**
 * CID persistence utility for the browser extension.
 * Stores the IPFS CID and its SHA-256 hash in chrome.storage.local.
 *
 * Storage keys:
 * - local:vaultCID — full CIDv1 string (for IPFS retrieval)
 * - local:vaultCidHash — hex-encoded SHA-256 hash (for on-chain integrity verification)
 * - local:midnightSecretKey — hex-encoded secret key cache (same-device performance)
 *
 * Cleared on logout via handleClearVault().
 */

import { storage } from 'wxt/utils/storage';

/**
 * Manages CID and secret key persistence in chrome.storage.local.
 */
export class VaultCidStore {
  /**
   * Store CID and its hash after a successful vault save.
   */
  static async set(cid: string, cidHash: string): Promise<void> {
    await storage.setItems([
      { key: 'local:vaultCID', value: cid },
      { key: 'local:vaultCidHash', value: cidHash },
    ]);
  }

  /**
   * Retrieve stored CID and hash.
   */
  static async get(): Promise<{ cid: string | null; cidHash: string | null }> {
    const cid = await storage.getItem('local:vaultCID') as string | null;
    const cidHash = await storage.getItem('local:vaultCidHash') as string | null;
    return { cid, cidHash };
  }

  /**
   * Clear stored CID data. Called on logout.
   */
  static async clear(): Promise<void> {
    await storage.removeItems(['local:vaultCID', 'local:vaultCidHash', 'local:midnightSecretKey']);
  }

  /**
   * Cache the Midnight secret key for same-device performance.
   * Primary storage is in the SQLite vault DB (cross-device via IPFS).
   */
  static async setSecretKey(secretKeyHex: string): Promise<void> {
    await storage.setItem('local:midnightSecretKey', secretKeyHex);
  }

  /**
   * Retrieve cached secret key.
   */
  static async getSecretKey(): Promise<string | null> {
    return await storage.getItem('local:midnightSecretKey') as string | null;
  }

  /**
   * Read secretKey from the vault settings.
   * Used on new devices after downloading and decrypting the vault from IPFS.
   *
   * @param vaultStore - Initialized vault store with getSetting capability
   * @returns Hex-encoded secret key, or null if not found
   */
  static readSecretKeyFromVault(
    vaultStore: { getSetting: (key: string, defaultValue?: string) => string },
  ): string | null {
    const value = vaultStore.getSetting('midnightSecretKey', '');
    return value || null;
  }
}
