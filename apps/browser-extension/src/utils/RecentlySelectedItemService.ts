import { storage } from '#imports';
import { StorageKeys } from '@/utils/constants/storageKeys';

/**
 * Time-to-live for recently selected items (60 seconds).
 */
const TTL_MS = 60 * 1000;

/**
 * Interface for the recently selected item data.
 */
export interface IRecentlySelectedItem {
  itemId: string;
  timestamp: number;
  domain: string;
}

/**
 * Service for managing the recently selected autofill item.
 * This enables "smart autofill" where the most recently selected credential
 * is prioritized in subsequent autofill suggestions for multi-step login flows.
 *
 * The recently selected item is stored in session storage with a 60-second TTL
 * and is scoped to the domain to prevent cross-site leakage.
 */
export const RecentlySelectedItemService = {
  /**
   * Store a recently selected item with the current timestamp.
   * @param itemId - The ID of the item that was selected
   * @param domain - The domain where the item was used (for scoping)
   */
  async setRecentlySelected(itemId: string, domain: string): Promise<void> {
    const data: IRecentlySelectedItem = {
      itemId,
      timestamp: Date.now(),
      domain,
    };
    await storage.setItem(StorageKeys.RECENTLY_SELECTED_ITEM, data);
  },

  /**
   * Get the recently selected item if it exists and is not expired.
   * @param domain - The current domain to check against
   * @returns The item ID if valid, or null if expired or not matching domain
   */
  async getRecentlySelected(domain: string): Promise<string | null> {
    const data = await storage.getItem(StorageKeys.RECENTLY_SELECTED_ITEM) as IRecentlySelectedItem | null;

    if (!data) {
      return null;
    }

    // Check if expired
    const age = Date.now() - data.timestamp;
    if (age > TTL_MS) {
      await this.clear();
      return null;
    }

    // Check if domain matches
    if (data.domain !== domain) {
      return null;
    }

    return data.itemId;
  },

  /**
   * Check if a recently selected item exists and is valid for the current domain.
   * @param domain - The current domain to check against
   * @returns True if a valid recently selected item exists
   */
  async hasRecentlySelected(domain: string): Promise<boolean> {
    const itemId = await this.getRecentlySelected(domain);
    return itemId !== null;
  },

  /**
   * Clear the recently selected item.
   */
  async clear(): Promise<void> {
    await storage.removeItem(StorageKeys.RECENTLY_SELECTED_ITEM);
  },

  /**
   * Get the remaining TTL in milliseconds for the currently selected item.
   * @returns Remaining TTL in ms, or 0 if expired or not set
   */
  async getRemainingTTL(): Promise<number> {
    const data = await storage.getItem(StorageKeys.RECENTLY_SELECTED_ITEM) as IRecentlySelectedItem | null;

    if (!data) {
      return 0;
    }

    const age = Date.now() - data.timestamp;
    const remaining = TTL_MS - age;

    return remaining > 0 ? remaining : 0;
  },
};
