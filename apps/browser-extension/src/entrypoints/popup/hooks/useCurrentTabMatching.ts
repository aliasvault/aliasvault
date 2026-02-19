import { useCallback } from 'react';
import { sendMessage } from 'webext-bridge/popup';

import type { Item } from '@/utils/dist/core/models/vault';
import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import type { ItemsResponse } from '@/utils/types/messaging/ItemsResponse';

import { browser } from '#imports';

/**
 * Result of current tab matching.
 */
export type CurrentTabMatchResult = {
  /** Matched items for the current tab */
  items: Item[];
  /** Current tab URL (for prefilling search) */
  currentUrl: string;
  /** Current tab domain (for display/search) */
  domain: string;
};

/**
 * Hook for matching vault items against the current browser tab.
 *
 * Uses the same credential matching logic as the content script autofill popup,
 * respecting user's autofill matching mode settings.
 */
const useCurrentTabMatching = (): {
  matchCurrentTab: () => Promise<CurrentTabMatchResult | null>;
} => {
  /**
   * Match vault items against the current browser tab.
   *
   * @returns Promise resolving to match result, or null if matching fails
   */
  const matchCurrentTab = useCallback(async (): Promise<CurrentTabMatchResult | null> => {
    try {
      // Get the current active tab
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });

      if (!activeTab?.url) {
        return null;
      }

      // Skip non-http(s) URLs (like chrome://, about:, etc.)
      if (!activeTab.url.startsWith('http://') && !activeTab.url.startsWith('https://')) {
        return null;
      }

      // Extract domain for search prefill
      let domain = '';
      try {
        const url = new URL(activeTab.url);
        domain = url.hostname.replace(/^www\./, '');
      } catch {
        return null;
      }

      // Get autofill matching mode from user settings
      const matchingMode = await LocalPreferencesService.getAutofillMatchingMode();

      // Use the same filtering logic as content script
      const response = await sendMessage('GET_FILTERED_ITEMS', {
        currentUrl: activeTab.url,
        pageTitle: activeTab.title || '',
        matchingMode: matchingMode
      }, 'background') as ItemsResponse;

      if (!response.success || !response.items) {
        return null;
      }

      return {
        items: response.items,
        currentUrl: activeTab.url,
        domain: domain
      };
    } catch (error) {
      console.error('Error matching current tab:', error);
      return null;
    }
  }, []);

  return {
    matchCurrentTab,
  };
};

export default useCurrentTabMatching;
