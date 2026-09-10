import { useCallback } from 'react';

import { browser } from '#imports';

/**
 * Details of the current browser tab.
 */
export type CurrentTabInfo = {
  /** Current tab URL */
  currentUrl: string;
  /** Current tab hostname, without a leading `www.` (for display/search) */
  domain: string;
};

/**
 * Hook for reading the current browser tab.
 */
const useCurrentTabInfo = (): {
  getCurrentTabInfo: () => Promise<CurrentTabInfo | null>;
} => {
  /**
   * Get the URL and hostname of the active tab.
   *
   * @returns Promise resolving to the tab info, or null for non-http(s) tabs and parse failures
   */
  const getCurrentTabInfo = useCallback(async (): Promise<CurrentTabInfo | null> => {
    try {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });

      if (!activeTab?.url) {
        return null;
      }

      // Skip non-http(s) URLs (like chrome://, about:, etc.)
      if (!activeTab.url.startsWith('http://') && !activeTab.url.startsWith('https://')) {
        return null;
      }

      return {
        currentUrl: activeTab.url,
        domain: new URL(activeTab.url).hostname.replace(/^www\./, ''),
      };
    } catch {
      return null;
    }
  }, []);

  return {
    getCurrentTabInfo,
  };
};

export default useCurrentTabInfo;
