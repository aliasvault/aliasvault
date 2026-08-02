import { storage } from '#imports';

/**
 * Storage keys for the popup navigation state that is persisted across popup opens.
 */
export const NAVIGATION_STATE_KEYS = {
  LAST_VISITED_PAGE: 'session:lastVisitedPage',
  LAST_VISITED_TIME: 'session:lastVisitedTime',
  NAVIGATION_HISTORY: 'session:navigationHistory',
  LAST_TAB_URL: 'session:lastTabUrl',
} as const;

/**
 * A single entry in the persisted popup navigation history.
 */
export type NavigationHistoryEntry = {
  pathname: string;
  search: string;
  hash: string;
};

/**
 * Service for reading and clearing the persisted popup navigation state (last visited page + history).
 */
export const NavigationStateService = {
  /**
   * Persist the current page, visit time and navigation history.
   */
  async storeNavigationState(pathname: string, historyEntries: NavigationHistoryEntry[]): Promise<void> {
    await Promise.all([
      storage.setItem(NAVIGATION_STATE_KEYS.LAST_VISITED_PAGE, pathname),
      storage.setItem(NAVIGATION_STATE_KEYS.LAST_VISITED_TIME, Date.now()),
      storage.setItem(NAVIGATION_STATE_KEYS.NAVIGATION_HISTORY, historyEntries),
    ]);
  },

  /**
   * Get the persisted navigation state (last visited page, visit time and history).
   */
  async getNavigationState(): Promise<{ lastPage: string | null, lastVisitTime: number | null, history: NavigationHistoryEntry[] | null }> {
    const [lastPage, lastVisitTime, history] = await Promise.all([
      storage.getItem(NAVIGATION_STATE_KEYS.LAST_VISITED_PAGE) as Promise<string | null>,
      storage.getItem(NAVIGATION_STATE_KEYS.LAST_VISITED_TIME) as Promise<number | null>,
      storage.getItem(NAVIGATION_STATE_KEYS.NAVIGATION_HISTORY) as Promise<NavigationHistoryEntry[] | null>,
    ]);
    return { lastPage, lastVisitTime, history };
  },

  /**
   * Clear the persisted navigation state so the next popup open starts fresh instead of restoring the last page.
   * Keeps the last tab URL, which is used separately for tab-switch detection.
   */
  async clearNavigationState(): Promise<void> {
    await storage.removeItems([NAVIGATION_STATE_KEYS.LAST_VISITED_PAGE, NAVIGATION_STATE_KEYS.LAST_VISITED_TIME, NAVIGATION_STATE_KEYS.NAVIGATION_HISTORY]);
  },

  /**
   * Get the last known browser tab URL, used to detect tab switches between popup opens.
   */
  async getLastTabUrl(): Promise<string | null> {
    return await storage.getItem(NAVIGATION_STATE_KEYS.LAST_TAB_URL) as string | null;
  },

  /**
   * Store the current browser tab URL for future tab-switch detection.
   */
  async setLastTabUrl(url: string): Promise<void> {
    await storage.setItem(NAVIGATION_STATE_KEYS.LAST_TAB_URL, url);
  },
};
