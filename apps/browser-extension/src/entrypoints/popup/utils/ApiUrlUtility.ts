import { useState } from 'react';

import { AppInfo } from '@/utils/AppInfo';

import { storage } from '#imports';

/**
 * Hook to manage API URL state and display logic.
 * @returns Object containing apiUrl state and utility functions
 */
export const useApiUrl = (): {
  apiUrl: string;
  setApiUrl: (url: string) => void;
  loadApiUrl: () => Promise<void>;
  getDisplayUrl: () => string;
} => {
  const [apiUrl, setApiUrl] = useState<string>(AppInfo.DEFAULT_API_URL);

  /**
   * Load the API URL from storage.
   */
  const loadApiUrl = async (): Promise<void> => {
    const storedUrl = await storage.getItem('local:apiUrl') as string;
    if (storedUrl && storedUrl.length > 0) {
      setApiUrl(storedUrl);
    } else {
      setApiUrl(AppInfo.DEFAULT_API_URL);
    }
  };

  /**
   * Get the display URL for UI presentation.
   * @returns Formatted display URL
   */
  const getDisplayUrl = (): string => {
    const cleanUrl = apiUrl.replace('https://', '').replace('http://', '').replace(':443', '').replace('/api', '');
    return cleanUrl === 'app.aliasvault.com' ? 'aliasvault.com' : cleanUrl;
  };

  return {
    apiUrl,
    setApiUrl,
    loadApiUrl,
    getDisplayUrl,
  };
};