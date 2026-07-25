import { LOCAL_PREFERENCE_STORAGE_KEYS, StorageKeys } from '@/utils/constants/storageKeys';
import { AutofillMatchingMode } from '@/utils/RustCore';

import { storage } from '#imports';

/**
 * Concrete unlock methods that can be used to unlock the vault.
 */
export type UnlockMethod = 'password' | 'pin' | 'mobile';

/**
 * Service for managing user preferences that are stored locally (not in the vault).
 * Provides typed getters/setters with sensible defaults for all local storage settings.
 */
export const LocalPreferencesService = {
  /**
   * Get the show folders preference.
   * @returns Whether to show folders (true) or show all items flat (false). Defaults to true.
   */
  async getShowFolders(): Promise<boolean> {
    const value = await storage.getItem(StorageKeys.SHOW_FOLDERS) as boolean | null;
    return value ?? true;
  },

  /**
   * Set the show folders preference.
   */
  async setShowFolders(showFolders: boolean): Promise<void> {
    await storage.setItem(StorageKeys.SHOW_FOLDERS, showFolders);
  },

  /**
   * Get the auto-close unlock popup preference.
   * @returns Whether to auto-close the popup after unlocking. Defaults to true.
   */
  async getAutoCloseUnlockPopup(): Promise<boolean> {
    const value = await storage.getItem(StorageKeys.AUTO_CLOSE_UNLOCK_POPUP) as boolean | null;
    return value ?? true;
  },

  /**
   * Set the auto-close unlock popup preference.
   */
  async setAutoCloseUnlockPopup(enabled: boolean): Promise<void> {
    await storage.setItem(StorageKeys.AUTO_CLOSE_UNLOCK_POPUP, enabled);
  },

  /*
   * ============================================
   * Unlock screen behavior
   * ============================================
   */

  /**
   * Get the last-used unlock method (recorded after a successful unlock).
   * @returns The last-used method, or null if none has been recorded yet.
   */
  async getLastUsedUnlockMethod(): Promise<UnlockMethod | null> {
    const value = await storage.getItem(StorageKeys.LAST_USED_UNLOCK_METHOD) as UnlockMethod | null;
    if (value === 'password' || value === 'pin' || value === 'mobile') {
      return value;
    }
    return null;
  },

  /**
   * Set the last-used unlock method.
   */
  async setLastUsedUnlockMethod(method: UnlockMethod): Promise<void> {
    await storage.setItem(StorageKeys.LAST_USED_UNLOCK_METHOD, method);
  },

  /**
   * Get the autofill matching mode.
   * @returns The matching mode. Defaults to DEFAULT.
   */
  async getAutofillMatchingMode(): Promise<AutofillMatchingMode> {
    const value = await storage.getItem(StorageKeys.AUTOFILL_MATCHING_MODE) as AutofillMatchingMode | null;
    return value ?? AutofillMatchingMode.DEFAULT;
  },

  /**
   * Set the autofill matching mode.
   */
  async setAutofillMatchingMode(mode: AutofillMatchingMode): Promise<void> {
    await storage.setItem(StorageKeys.AUTOFILL_MATCHING_MODE, mode);
  },

  /**
   * Get the list of permanently disabled sites.
   * @returns Array of disabled site URLs. Defaults to empty array.
   */
  async getDisabledSites(): Promise<string[]> {
    const value = await storage.getItem(StorageKeys.DISABLED_SITES) as string[] | null;
    return value ?? [];
  },

  /**
   * Set the list of permanently disabled sites.
   */
  async setDisabledSites(sites: string[]): Promise<void> {
    await storage.setItem(StorageKeys.DISABLED_SITES, sites);
  },

  /**
   * Get the map of temporarily disabled sites with their expiry timestamps.
   * @returns Record of site URL to expiry timestamp. Defaults to empty object.
   */
  async getTemporaryDisabledSites(): Promise<Record<string, number>> {
    const value = await storage.getItem(StorageKeys.TEMPORARY_DISABLED_SITES) as Record<string, number> | null;
    return value ?? {};
  },

  /**
   * Set the map of temporarily disabled sites.
   */
  async setTemporaryDisabledSites(sites: Record<string, number>): Promise<void> {
    await storage.setItem(StorageKeys.TEMPORARY_DISABLED_SITES, sites);
  },

  /**
   * Get whether the global context menu is enabled.
   * @returns Whether context menu is globally enabled. Defaults to true.
   */
  async getGlobalContextMenuEnabled(): Promise<boolean> {
    const value = await storage.getItem(StorageKeys.GLOBAL_CONTEXT_MENU_ENABLED) as boolean | null;
    return value !== false;
  },

  /**
   * Set whether the global context menu is enabled.
   */
  async setGlobalContextMenuEnabled(enabled: boolean): Promise<void> {
    await storage.setItem(StorageKeys.GLOBAL_CONTEXT_MENU_ENABLED, enabled);
  },

  /*
   * ============================================
   * Passkey Settings
   * ============================================
   */

  /**
   * Get whether the passkey provider is globally enabled.
   * @returns Whether passkey provider is enabled. Defaults to true.
   */
  async getPasskeyProviderEnabled(): Promise<boolean> {
    const value = await storage.getItem(StorageKeys.PASSKEY_PROVIDER_ENABLED) as boolean | null;
    return value !== false;
  },

  /**
   * Set whether the passkey provider is globally enabled.
   */
  async setPasskeyProviderEnabled(enabled: boolean): Promise<void> {
    await storage.setItem(StorageKeys.PASSKEY_PROVIDER_ENABLED, enabled);
  },

  /**
   * Get the list of sites where passkey provider is disabled.
   * @returns Array of disabled site URLs. Defaults to empty array.
   */
  async getPasskeyDisabledSites(): Promise<string[]> {
    const value = await storage.getItem(StorageKeys.PASSKEY_DISABLED_SITES) as string[] | null;
    return value ?? [];
  },

  /**
   * Set the list of sites where passkey provider is disabled.
   */
  async setPasskeyDisabledSites(sites: string[]): Promise<void> {
    await storage.setItem(StorageKeys.PASSKEY_DISABLED_SITES, sites);
  },

  /**
   * Get the clipboard clear timeout in seconds.
   * @returns Timeout in seconds. Defaults to 10.
   */
  async getClipboardClearTimeout(): Promise<number> {
    const value = await storage.getItem(StorageKeys.CLIPBOARD_CLEAR_TIMEOUT) as number | null;
    return value ?? 10;
  },

  /**
   * Set the clipboard clear timeout in seconds.
   */
  async setClipboardClearTimeout(timeout: number): Promise<void> {
    await storage.setItem(StorageKeys.CLIPBOARD_CLEAR_TIMEOUT, timeout);
  },

  /**
   * Get the auto-lock timeout in seconds.
   * @returns Timeout in seconds. Defaults to 0 (never).
   */
  async getAutoLockTimeout(): Promise<number> {
    const value = await storage.getItem(StorageKeys.AUTO_LOCK_TIMEOUT) as number | null;
    return value ?? 0;
  },

  /**
   * Set the auto-lock timeout in seconds.
   */
  async setAutoLockTimeout(timeout: number): Promise<void> {
    await storage.setItem(StorageKeys.AUTO_LOCK_TIMEOUT, timeout);
  },

  /**
   * Get the vault locked dismiss until timestamp.
   * @returns Timestamp until which the vault locked message is dismissed. Defaults to 0.
   */
  async getVaultLockedDismissUntil(): Promise<number> {
    const value = await storage.getItem(StorageKeys.VAULT_LOCKED_DISMISS_UNTIL) as number | null;
    return value ?? 0;
  },

  /**
   * Set the vault locked dismiss until timestamp.
   */
  async setVaultLockedDismissUntil(timestamp: number): Promise<void> {
    await storage.setItem(StorageKeys.VAULT_LOCKED_DISMISS_UNTIL, timestamp);
  },

  /*
   * ============================================
   * History Settings (for custom email/username)
   * ============================================
   */

  /**
   * Get the custom email history.
   * @returns Array of previously used custom emails. Defaults to empty array.
   */
  async getCustomEmailHistory(): Promise<string[]> {
    const value = await storage.getItem(StorageKeys.CUSTOM_EMAIL_HISTORY) as string[] | null;
    return value ?? [];
  },

  /**
   * Set the custom email history.
   */
  async setCustomEmailHistory(history: string[]): Promise<void> {
    await storage.setItem(StorageKeys.CUSTOM_EMAIL_HISTORY, history);
  },

  /**
   * Get the custom username history.
   * @returns Array of previously used custom usernames. Defaults to empty array.
   */
  async getCustomUsernameHistory(): Promise<string[]> {
    const value = await storage.getItem(StorageKeys.CUSTOM_USERNAME_HISTORY) as string[] | null;
    return value ?? [];
  },

  /**
   * Set the custom username history.
   */
  async setCustomUsernameHistory(history: string[]): Promise<void> {
    await storage.setItem(StorageKeys.CUSTOM_USERNAME_HISTORY, history);
  },

  /**
   * Clear all UI preferences. Can be called on logout.
   * Note: This only clears UI preferences, not security-related settings.
   */
  async clearUiPreferences(): Promise<void> {
    await storage.removeItem(StorageKeys.SHOW_FOLDERS);
  },

  /**
   * Reset all site-specific settings (disabled sites, temporary disabled sites).
   */
  async resetAllSiteSettings(): Promise<void> {
    await storage.setItem(StorageKeys.DISABLED_SITES, []);
    await storage.setItem(StorageKeys.TEMPORARY_DISABLED_SITES, {});
    await storage.setItem(StorageKeys.PASSKEY_DISABLED_SITES, []);
  },

  /**
   * Clear all preferences. Called on logout to reset everything.
   * Clears all keys managed by this service.
   */
  async clearAll(): Promise<void> {
    await Promise.all(LOCAL_PREFERENCE_STORAGE_KEYS.map(key => storage.removeItem(key)));
  },

  /**
   * Get the pending redirect URL (used for passkey flows).
   * @returns The pending redirect URL or null if not set.
   */
  async getPendingRedirectUrl(): Promise<string | null> {
    const value = await storage.getItem(StorageKeys.PENDING_REDIRECT_URL) as string | null;
    return value ?? null;
  },

  /**
   * Set the pending redirect URL.
   */
  async setPendingRedirectUrl(url: string | null): Promise<void> {
    if (url === null) {
      await storage.removeItem(StorageKeys.PENDING_REDIRECT_URL);
    } else {
      await storage.setItem(StorageKeys.PENDING_REDIRECT_URL, url);
    }
  },

  /**
   * Get whether form restore should be skipped.
   * @returns Whether to skip form restore. Defaults to false.
   */
  async getSkipFormRestore(): Promise<boolean> {
    const value = await storage.getItem(StorageKeys.SKIP_FORM_RESTORE) as boolean | null;
    return value ?? false;
  },

  /**
   * Set whether form restore should be skipped.
   */
  async setSkipFormRestore(skip: boolean): Promise<void> {
    await storage.setItem(StorageKeys.SKIP_FORM_RESTORE, skip);
  },

  /*
   * ============================================
   * Remember Login Save Feature Settings
   * ============================================
   */

  /**
   * Get whether the login save feature is enabled.
   * @returns Whether login save is enabled. Defaults to true (enabled by default).
   */
  async getLoginSaveEnabled(): Promise<boolean> {
    const value = await storage.getItem(StorageKeys.LOGIN_SAVE_ENABLED) as boolean | null;
    return value !== false;
  },

  /**
   * Set whether the login save feature is enabled.
   */
  async setLoginSaveEnabled(enabled: boolean): Promise<void> {
    await storage.setItem(StorageKeys.LOGIN_SAVE_ENABLED, enabled);
  },

  /**
   * Get the auto-dismiss timeout for the login save prompt in seconds.
   * @returns Timeout in seconds. Defaults to 15.
   */
  async getLoginSaveAutoDismissSeconds(): Promise<number> {
    const value = await storage.getItem(StorageKeys.LOGIN_SAVE_AUTO_DISMISS_SECONDS) as number | null;
    return value ?? 15;
  },

  /**
   * Set the auto-dismiss timeout for the login save prompt in seconds.
   */
  async setLoginSaveAutoDismissSeconds(seconds: number): Promise<void> {
    await storage.setItem(StorageKeys.LOGIN_SAVE_AUTO_DISMISS_SECONDS, seconds);
  },

  /**
   * Get the list of blocked domains for login save.
   * @returns Array of blocked domain URLs. Defaults to empty array.
   */
  async getLoginSaveBlockedDomains(): Promise<string[]> {
    const value = await storage.getItem(StorageKeys.LOGIN_SAVE_BLOCKED_DOMAINS) as string[] | null;
    return value ?? [];
  },

  /**
   * Set the list of blocked domains for login save.
   */
  async setLoginSaveBlockedDomains(domains: string[]): Promise<void> {
    await storage.setItem(StorageKeys.LOGIN_SAVE_BLOCKED_DOMAINS, domains);
  },

  /*
   * ============================================
   * Brute Force Protection
   * ============================================
   */

  /**
   * Get the password unlock failed attempts count.
   * @returns The number of failed password unlock attempts. Defaults to 0.
   */
  async getPasswordUnlockFailedAttempts(): Promise<number> {
    const value = await storage.getItem(StorageKeys.PASSWORD_UNLOCK_FAILED_ATTEMPTS) as number | string | null;
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      return parseInt(value, 10) || 0;
    }
    return 0;
  },

  /**
   * Set the password unlock failed attempts count.
   */
  async setPasswordUnlockFailedAttempts(attempts: number): Promise<void> {
    await storage.setItem(StorageKeys.PASSWORD_UNLOCK_FAILED_ATTEMPTS, attempts);
  },

  /**
   * Reset the password unlock failed attempts counter.
   */
  async resetPasswordUnlockFailedAttempts(): Promise<void> {
    await storage.removeItem(StorageKeys.PASSWORD_UNLOCK_FAILED_ATTEMPTS);
  },

  /*
   * ============================================
   * Autofill Behavior Settings
   * ============================================
   */

  /**
   * Get whether the global autofill popup is enabled.
   * @returns Whether autofill popup is globally enabled. Defaults to true.
   */
  async getGlobalAutofillPopupEnabled(): Promise<boolean> {
    const value = await storage.getItem(StorageKeys.CREDENTIAL_AUTOFILL_POPUP_ENABLED) as boolean | null;
    return value !== false;
  },

  /**
   * Set whether the global autofill popup is enabled.
   */
  async setGlobalAutofillPopupEnabled(enabled: boolean): Promise<void> {
    await storage.setItem(StorageKeys.CREDENTIAL_AUTOFILL_POPUP_ENABLED, enabled);
  },

  /**
   * Get whether TOTP autofill is enabled.
   * @returns Whether TOTP autofill is enabled. Defaults to true (enabled by default).
   */
  async getTotpAutofillEnabled(): Promise<boolean> {
    const value = await storage.getItem(StorageKeys.TOTP_AUTOFILL_ENABLED) as boolean | null;
    return value !== false;
  },

  /**
   * Set whether TOTP autofill is enabled.
   */
  async setTotpAutofillEnabled(enabled: boolean): Promise<void> {
    await storage.setItem(StorageKeys.TOTP_AUTOFILL_ENABLED, enabled);
  },

  /**
   * Get whether to automatically copy TOTP code to clipboard after autofill.
   * @returns Whether to auto-copy TOTP. Defaults to true (enabled by default).
   */
  async getAutoCopyTotpOnAutofill(): Promise<boolean> {
    const value = await storage.getItem(StorageKeys.AUTO_COPY_TOTP_ON_AUTOFILL) as boolean | null;
    return value !== false;
  },

  /**
   * Set whether to automatically copy TOTP code to clipboard after autofill.
   */
  async setAutoCopyTotpOnAutofill(enabled: boolean): Promise<void> {
    await storage.setItem(StorageKeys.AUTO_COPY_TOTP_ON_AUTOFILL, enabled);
  },
};
