import { storage } from '#imports';

/*
 * Storage keys for local preferences.
 * These are defined inline since they're only used by this service.
 */
const KEYS = {
  // Site settings
  DISABLED_SITES: 'local:aliasvault_disabled_sites',
  TEMPORARY_DISABLED_SITES: 'local:aliasvault_temporary_disabled_sites',
  PASSKEY_DISABLED_SITES: 'local:aliasvault_passkey_disabled_sites',

  // Global toggles
  GLOBAL_AUTOFILL_POPUP_ENABLED: 'local:aliasvault_global_autofill_popup_enabled',
  GLOBAL_CONTEXT_MENU_ENABLED: 'local:aliasvault_global_context_menu_enabled',
  PASSKEY_PROVIDER_ENABLED: 'local:aliasvault_passkey_provider_enabled',

  // Timeouts
  CLIPBOARD_CLEAR_TIMEOUT: 'local:aliasvault_clipboard_clear_timeout',
  AUTO_LOCK_TIMEOUT: 'local:aliasvault_auto_lock_timeout',
  VAULT_LOCKED_DISMISS_UNTIL: 'local:aliasvault_vault_locked_dismiss_until',

  // Matching mode
  AUTOFILL_MATCHING_MODE: 'local:aliasvault_autofill_matching_mode',

  // History (TODO: move to vault in v1.0)
  CUSTOM_EMAIL_HISTORY: 'local:aliasvault_custom_email_history',
  CUSTOM_USERNAME_HISTORY: 'local:aliasvault_custom_username_history',

  // UI preferences
  SHOW_FOLDERS: 'local:aliasvault_show_folders',
  AUTO_CLOSE_UNLOCK_POPUP: 'local:aliasvault_auto_close_unlock_popup',

  // Session/Navigation state
  PENDING_REDIRECT_URL: 'session:pendingRedirectUrl',
  SKIP_FORM_RESTORE: 'local:aliasvault_skip_form_restore',
} as const;

/**
 * Autofill matching mode options.
 */
export enum AutofillMatchingMode {
  DEFAULT = 'default',
  URL_SUBDOMAIN = 'url_subdomain',
  URL_EXACT = 'url_exact',
}

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
    const value = await storage.getItem(KEYS.SHOW_FOLDERS) as boolean | null;
    return value ?? true;
  },

  /**
   * Set the show folders preference.
   */
  async setShowFolders(showFolders: boolean): Promise<void> {
    await storage.setItem(KEYS.SHOW_FOLDERS, showFolders);
  },

  /**
   * Get the auto-close unlock popup preference.
   * @returns Whether to auto-close the popup after unlocking. Defaults to true.
   */
  async getAutoCloseUnlockPopup(): Promise<boolean> {
    const value = await storage.getItem(KEYS.AUTO_CLOSE_UNLOCK_POPUP) as boolean | null;
    return value ?? true;
  },

  /**
   * Set the auto-close unlock popup preference.
   */
  async setAutoCloseUnlockPopup(enabled: boolean): Promise<void> {
    await storage.setItem(KEYS.AUTO_CLOSE_UNLOCK_POPUP, enabled);
  },

  /**
   * Get whether the global autofill popup is enabled.
   * @returns Whether autofill popup is globally enabled. Defaults to true.
   */
  async getGlobalAutofillPopupEnabled(): Promise<boolean> {
    const value = await storage.getItem(KEYS.GLOBAL_AUTOFILL_POPUP_ENABLED) as boolean | null;
    return value !== false;
  },

  /**
   * Set whether the global autofill popup is enabled.
   */
  async setGlobalAutofillPopupEnabled(enabled: boolean): Promise<void> {
    await storage.setItem(KEYS.GLOBAL_AUTOFILL_POPUP_ENABLED, enabled);
  },

  /**
   * Get the autofill matching mode.
   * @returns The matching mode. Defaults to DEFAULT.
   */
  async getAutofillMatchingMode(): Promise<AutofillMatchingMode> {
    const value = await storage.getItem(KEYS.AUTOFILL_MATCHING_MODE) as AutofillMatchingMode | null;
    return value ?? AutofillMatchingMode.DEFAULT;
  },

  /**
   * Set the autofill matching mode.
   */
  async setAutofillMatchingMode(mode: AutofillMatchingMode): Promise<void> {
    await storage.setItem(KEYS.AUTOFILL_MATCHING_MODE, mode);
  },

  /**
   * Get the list of permanently disabled sites.
   * @returns Array of disabled site URLs. Defaults to empty array.
   */
  async getDisabledSites(): Promise<string[]> {
    const value = await storage.getItem(KEYS.DISABLED_SITES) as string[] | null;
    return value ?? [];
  },

  /**
   * Set the list of permanently disabled sites.
   */
  async setDisabledSites(sites: string[]): Promise<void> {
    await storage.setItem(KEYS.DISABLED_SITES, sites);
  },

  /**
   * Get the map of temporarily disabled sites with their expiry timestamps.
   * @returns Record of site URL to expiry timestamp. Defaults to empty object.
   */
  async getTemporaryDisabledSites(): Promise<Record<string, number>> {
    const value = await storage.getItem(KEYS.TEMPORARY_DISABLED_SITES) as Record<string, number> | null;
    return value ?? {};
  },

  /**
   * Set the map of temporarily disabled sites.
   */
  async setTemporaryDisabledSites(sites: Record<string, number>): Promise<void> {
    await storage.setItem(KEYS.TEMPORARY_DISABLED_SITES, sites);
  },

  /**
   * Get whether the global context menu is enabled.
   * @returns Whether context menu is globally enabled. Defaults to true.
   */
  async getGlobalContextMenuEnabled(): Promise<boolean> {
    const value = await storage.getItem(KEYS.GLOBAL_CONTEXT_MENU_ENABLED) as boolean | null;
    return value !== false;
  },

  /**
   * Set whether the global context menu is enabled.
   */
  async setGlobalContextMenuEnabled(enabled: boolean): Promise<void> {
    await storage.setItem(KEYS.GLOBAL_CONTEXT_MENU_ENABLED, enabled);
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
    const value = await storage.getItem(KEYS.PASSKEY_PROVIDER_ENABLED) as boolean | null;
    return value !== false;
  },

  /**
   * Set whether the passkey provider is globally enabled.
   */
  async setPasskeyProviderEnabled(enabled: boolean): Promise<void> {
    await storage.setItem(KEYS.PASSKEY_PROVIDER_ENABLED, enabled);
  },

  /**
   * Get the list of sites where passkey provider is disabled.
   * @returns Array of disabled site URLs. Defaults to empty array.
   */
  async getPasskeyDisabledSites(): Promise<string[]> {
    const value = await storage.getItem(KEYS.PASSKEY_DISABLED_SITES) as string[] | null;
    return value ?? [];
  },

  /**
   * Set the list of sites where passkey provider is disabled.
   */
  async setPasskeyDisabledSites(sites: string[]): Promise<void> {
    await storage.setItem(KEYS.PASSKEY_DISABLED_SITES, sites);
  },

  /**
   * Get the clipboard clear timeout in seconds.
   * @returns Timeout in seconds. Defaults to 10.
   */
  async getClipboardClearTimeout(): Promise<number> {
    const value = await storage.getItem(KEYS.CLIPBOARD_CLEAR_TIMEOUT) as number | null;
    return value ?? 10;
  },

  /**
   * Set the clipboard clear timeout in seconds.
   */
  async setClipboardClearTimeout(timeout: number): Promise<void> {
    await storage.setItem(KEYS.CLIPBOARD_CLEAR_TIMEOUT, timeout);
  },

  /**
   * Get the auto-lock timeout in seconds.
   * @returns Timeout in seconds. Defaults to 0 (never).
   */
  async getAutoLockTimeout(): Promise<number> {
    const value = await storage.getItem(KEYS.AUTO_LOCK_TIMEOUT) as number | null;
    return value ?? 0;
  },

  /**
   * Set the auto-lock timeout in seconds.
   */
  async setAutoLockTimeout(timeout: number): Promise<void> {
    await storage.setItem(KEYS.AUTO_LOCK_TIMEOUT, timeout);
  },

  /**
   * Get the vault locked dismiss until timestamp.
   * @returns Timestamp until which the vault locked message is dismissed. Defaults to 0.
   */
  async getVaultLockedDismissUntil(): Promise<number> {
    const value = await storage.getItem(KEYS.VAULT_LOCKED_DISMISS_UNTIL) as number | null;
    return value ?? 0;
  },

  /**
   * Set the vault locked dismiss until timestamp.
   */
  async setVaultLockedDismissUntil(timestamp: number): Promise<void> {
    await storage.setItem(KEYS.VAULT_LOCKED_DISMISS_UNTIL, timestamp);
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
    const value = await storage.getItem(KEYS.CUSTOM_EMAIL_HISTORY) as string[] | null;
    return value ?? [];
  },

  /**
   * Set the custom email history.
   */
  async setCustomEmailHistory(history: string[]): Promise<void> {
    await storage.setItem(KEYS.CUSTOM_EMAIL_HISTORY, history);
  },

  /**
   * Get the custom username history.
   * @returns Array of previously used custom usernames. Defaults to empty array.
   */
  async getCustomUsernameHistory(): Promise<string[]> {
    const value = await storage.getItem(KEYS.CUSTOM_USERNAME_HISTORY) as string[] | null;
    return value ?? [];
  },

  /**
   * Set the custom username history.
   */
  async setCustomUsernameHistory(history: string[]): Promise<void> {
    await storage.setItem(KEYS.CUSTOM_USERNAME_HISTORY, history);
  },

  /**
   * Clear all UI preferences. Can be called on logout.
   * Note: This only clears UI preferences, not security-related settings.
   */
  async clearUiPreferences(): Promise<void> {
    await storage.removeItem(KEYS.SHOW_FOLDERS);
  },

  /**
   * Reset all site-specific settings (disabled sites, temporary disabled sites).
   */
  async resetAllSiteSettings(): Promise<void> {
    await storage.setItem(KEYS.DISABLED_SITES, []);
    await storage.setItem(KEYS.TEMPORARY_DISABLED_SITES, {});
    await storage.setItem(KEYS.PASSKEY_DISABLED_SITES, []);
  },

  /**
   * Clear all preferences. Called on logout to reset everything.
   */
  async clearAll(): Promise<void> {
    await Promise.all([
      storage.removeItem(KEYS.SHOW_FOLDERS),
      storage.removeItem(KEYS.DISABLED_SITES),
      storage.removeItem(KEYS.TEMPORARY_DISABLED_SITES),
      storage.removeItem(KEYS.PASSKEY_DISABLED_SITES),
      storage.removeItem(KEYS.VAULT_LOCKED_DISMISS_UNTIL),
      storage.removeItem(KEYS.CUSTOM_EMAIL_HISTORY),
      storage.removeItem(KEYS.CUSTOM_USERNAME_HISTORY),
      /*
       * Note: We don't clear global settings like autofill enabled, clipboard timeout, etc.
       * as those are user preferences that should persist across logins.
       */
    ]);
  },

  /**
   * Get the pending redirect URL (used for passkey flows).
   * @returns The pending redirect URL or null if not set.
   */
  async getPendingRedirectUrl(): Promise<string | null> {
    const value = await storage.getItem(KEYS.PENDING_REDIRECT_URL) as string | null;
    return value ?? null;
  },

  /**
   * Set the pending redirect URL.
   */
  async setPendingRedirectUrl(url: string | null): Promise<void> {
    if (url === null) {
      await storage.removeItem(KEYS.PENDING_REDIRECT_URL);
    } else {
      await storage.setItem(KEYS.PENDING_REDIRECT_URL, url);
    }
  },

  /**
   * Get whether form restore should be skipped.
   * @returns Whether to skip form restore. Defaults to false.
   */
  async getSkipFormRestore(): Promise<boolean> {
    const value = await storage.getItem(KEYS.SKIP_FORM_RESTORE) as boolean | null;
    return value ?? false;
  },

  /**
   * Set whether form restore should be skipped.
   */
  async setSkipFormRestore(skip: boolean): Promise<void> {
    await storage.setItem(KEYS.SKIP_FORM_RESTORE, skip);
  },
};
