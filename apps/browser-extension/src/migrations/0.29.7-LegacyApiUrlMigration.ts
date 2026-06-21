import { AppInfo } from '@/utils/AppInfo';

import { storage } from '#imports';

/**
 * Legacy official hosted URLs from before the aliasvault.net -> aliasvault.com domain move.
 * Existing installs may still have these persisted from when they were the defaults.
 */
const LEGACY_API_URL = 'https://app.aliasvault.net/api';
const LEGACY_CLIENT_URL = 'https://app.aliasvault.net';

/**
 * One-time, idempotent migration that rewrites a persisted legacy aliasvault.net official URL to
 * the current aliasvault.com default. Only the exact old official defaults are migrated; custom
 * self-hosted URLs are left untouched. Safe to run on every startup (no-op once migrated or when
 * the official instance is used, which is stored as an empty string).
 *
 * Added in the 0.29.7 release. Can be removed once installs from before 0.29.7 are no longer in use.
 */
export async function migrateLegacyApiUrl(): Promise<void> {
  try {
    const apiUrl = await storage.getItem('local:apiUrl') as string | null;
    if (apiUrl === LEGACY_API_URL) {
      await storage.setItem('local:apiUrl', AppInfo.DEFAULT_API_URL);
    }

    const clientUrl = await storage.getItem('local:clientUrl') as string | null;
    if (clientUrl === LEGACY_CLIENT_URL) {
      await storage.setItem('local:clientUrl', AppInfo.DEFAULT_CLIENT_URL);
    }
  } catch (error) {
    console.error('Failed to migrate legacy API URL:', error);
  }
}
