import { LocalPreferencesService } from '@/utils/LocalPreferencesService';

/**
 * Get and clear the pending redirect URL from storage.
 * Used by Reinitialize page to restore user's intended destination after unlock.
 *
 * @returns The pending redirect URL, or null if none exists
 */
export async function consumePendingRedirectUrl(): Promise<string | null> {
  const url = await LocalPreferencesService.getPendingRedirectUrl();
  if (url) {
    await LocalPreferencesService.setPendingRedirectUrl(null);
  }
  return url;
}

/**
 * Clear the pending redirect URL from storage.
 * Used when popup is opened without a specific hash path to clear stale redirects.
 */
export async function clearPendingRedirectUrl(): Promise<void> {
  await LocalPreferencesService.setPendingRedirectUrl(null);
}
