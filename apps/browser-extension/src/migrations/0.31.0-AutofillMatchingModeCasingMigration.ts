import { AutofillMatchingMode } from '@aliasvault/client/rust/RustCore';

import { StorageKeys } from '@/utils/constants/storageKeys';
import { logFailure } from '@/utils/Diagnostics';

import { storage } from '#imports';

/**
 * Stored snake_case spellings from before the Rust core moved to camelCase enum values.
 */
const LEGACY_MATCHING_MODES: Record<string, AutofillMatchingMode> = {
  'url_exact': AutofillMatchingMode.URL_EXACT,
  'url_subdomain': AutofillMatchingMode.URL_SUBDOMAIN,
};

/**
 * One-time, idempotent migration that rewrites a persisted snake_case autofill matching mode to its camelCase value.
 *
 * Added in the 0.31.0 release. Can be removed once installs from before 0.31.0 are no longer in use.
 */
export async function migrateAutofillMatchingModeCasing(): Promise<void> {
  try {
    const value = await storage.getItem(StorageKeys.AUTOFILL_MATCHING_MODE) as string | null;
    if (value !== null && value in LEGACY_MATCHING_MODES) {
      await storage.setItem(StorageKeys.AUTOFILL_MATCHING_MODE, LEGACY_MATCHING_MODES[value]);
    }
  } catch (error) {
    logFailure('Failed to migrate autofill matching mode casing', error);
  }
}
