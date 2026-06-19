import { AppInfo } from '@/utils/AppInfo';

import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Legacy official hosted API URL from before the aliasvault.net -> aliasvault.com domain move.
 * Existing installs that were set up while this was the default still have it persisted natively.
 */
const LEGACY_API_URL = 'https://app.aliasvault.net/api';

/**
 * One-time, idempotent migration that rewrites a persisted legacy aliasvault.net official API URL
 * to the current aliasvault.com default. Only the exact old official default is migrated; custom
 * self-hosted URLs are left untouched. Safe to run on every cold start (no-op once migrated or when
 * no URL is stored).
 *
 * Added in the 0.29.7 release. Can be removed once installs from before 0.29.7 are no longer in use.
 */
export async function migrateLegacyApiUrl(): Promise<void> {
  try {
    const apiUrl = await NativeVaultManager.getApiUrl();
    if (apiUrl === LEGACY_API_URL) {
      await NativeVaultManager.setApiUrl(AppInfo.DEFAULT_API_URL);
    }
  } catch (error) {
    console.warn('Failed to migrate legacy API URL:', error);
  }
}
