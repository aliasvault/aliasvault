import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Storage keys for local preferences.
 * These are defined inline since they're only used by this service.
 */
const KEYS = {
  // Autofill configuration
  AUTOFILL_CONFIGURED: 'autofill_configured',

  // Timeouts
  CLIPBOARD_CLEAR_TIMEOUT: 'clipboard_clear_timeout',

  // UI preferences
  SHOW_FOLDERS: 'items-show-folders',
} as const;

/**
 * Service for managing user preferences that are stored locally (not in the vault).
 * Provides typed getters/setters with sensible defaults for all local storage settings.
 *
 * Note: This service handles UI preferences stored in AsyncStorage.
 * Security-sensitive settings (auth tokens, vault data) are handled by the native layer.
 */
export const LocalPreferencesService = {
  /**
   * Get whether autofill has been configured by the user.
   * @returns Whether autofill has been configured. Defaults to false.
   */
  async getAutofillConfigured(): Promise<boolean> {
    const value = await AsyncStorage.getItem(KEYS.AUTOFILL_CONFIGURED);
    return value === 'true';
  },

  /**
   * Set whether autofill has been configured.
   */
  async setAutofillConfigured(configured: boolean): Promise<void> {
    await AsyncStorage.setItem(KEYS.AUTOFILL_CONFIGURED, configured.toString());
  },

  /**
   * Get the clipboard clear timeout in seconds.
   * @returns Timeout in seconds. Defaults to 15.
   */
  async getClipboardClearTimeout(): Promise<number> {
    const value = await AsyncStorage.getItem(KEYS.CLIPBOARD_CLEAR_TIMEOUT);
    return value ? parseInt(value, 10) : 15;
  },

  /**
   * Set the clipboard clear timeout in seconds.
   */
  async setClipboardClearTimeout(timeout: number): Promise<void> {
    await AsyncStorage.setItem(KEYS.CLIPBOARD_CLEAR_TIMEOUT, timeout.toString());
  },

  /**
   * Get the show folders preference.
   * @returns Whether to show folders (true) or show all items flat (false). Defaults to true.
   */
  async getShowFolders(): Promise<boolean> {
    const value = await AsyncStorage.getItem(KEYS.SHOW_FOLDERS);
    // Default to true if not set
    return value === null ? true : value === 'true';
  },

  /**
   * Set the show folders preference.
   */
  async setShowFolders(showFolders: boolean): Promise<void> {
    await AsyncStorage.setItem(KEYS.SHOW_FOLDERS, showFolders.toString());
  },

  /**
   * Clear all UI preferences. Can be called on logout.
   * Note: This only clears UI preferences, not security-related settings.
   */
  async clearUiPreferences(): Promise<void> {
    await AsyncStorage.removeItem(KEYS.SHOW_FOLDERS);
  },

  /**
   * Clear all preferences. Called on logout to reset everything.
   * Note: Security settings are handled by the native layer.
   */
  async clearAll(): Promise<void> {
    await Promise.all([
      AsyncStorage.removeItem(KEYS.AUTOFILL_CONFIGURED),
      AsyncStorage.removeItem(KEYS.CLIPBOARD_CLEAR_TIMEOUT),
      AsyncStorage.removeItem(KEYS.SHOW_FOLDERS),
    ]);
  },
};
