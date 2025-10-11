import { useState } from 'react';

import { AppInfo } from '@/utils/AppInfo';
import NativeVaultManager from '@/specs/NativeVaultManager';

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
   * Load the API URL from native storage.
   */
  const loadApiUrl = async (): Promise<void> => {
    try {
      const storedUrl = await NativeVaultManager.getApiUrl();
      if (storedUrl && storedUrl.length > 0) {
        setApiUrl(storedUrl);
      } else {
        setApiUrl(AppInfo.DEFAULT_API_URL);
      }
    } catch (error) {
      console.warn('Failed to get API URL from native layer:', error);
    }
  };

  /**
   * Get the display URL for UI presentation.
   * @returns Formatted display URL
   */
  const getDisplayUrl = (): string => {
    const cleanUrl = apiUrl.replace('https://', '').replace('http://', '').replace(':443', '').replace('/api', '');
    return cleanUrl === 'app.aliasvault.net' ? 'aliasvault.net' : cleanUrl;
  };

  return {
    apiUrl,
    setApiUrl,
    loadApiUrl,
    getDisplayUrl,
  };
};
