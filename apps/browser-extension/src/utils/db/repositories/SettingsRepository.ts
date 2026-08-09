import { DEFAULT_PASSWORD_LENGTH, DEFAULT_WORD_COUNT, DEFAULT_LANGUAGE_CODE, matchAvailableLanguage } from '@/utils/dist/core/models/defaults';
import type { PasswordSettings } from '@/utils/dist/core/models/vault';
import { getIdentityLanguages } from '@/utils/RustCore';

import { BaseRepository } from '../BaseRepository';
import { SettingsQueries } from '../queries/SettingsQueries';

/**
 * Sort order options for credentials list.
 */
export type CredentialSortOrder = 'OldestFirst' | 'NewestFirst' | 'Alphabetical';

/**
 * Repository for the vault's user preferences: the manifest-scoped key/value rows of the Settings table.
 */
export class SettingsRepository extends BaseRepository {
  /**
   * Get setting from database for a given key, from the manifest this client writes into.
   * @param key - The setting key
   * @param defaultValue - Default value if setting not found
   * @returns The setting value
   */
  public getSetting(key: string, defaultValue: string = ''): string {
    const manifestId = this.client.getActiveManifestId() ?? this.personalManifestId();
    if (!manifestId) {
      return defaultValue;
    }

    const results = this.client.executeQuery<{ Value: string }>(SettingsQueries.GET_SETTING, [manifestId, key]);
    return results.length > 0 ? results[0].Value : defaultValue;
  }

  /**
   * Get the default identity language from the database.
   * @returns The stored override value if set, otherwise empty string
   */
  public getDefaultIdentityLanguage(): string {
    return this.getSetting('DefaultIdentityLanguage');
  }

  /**
   * Get the default identity gender preference from the database.
   * @returns The gender preference or 'random' if not set
   */
  public getDefaultIdentityGender(): string {
    return this.getSetting('DefaultIdentityGender', 'random');
  }

  /**
   * Get the default identity age range from the database.
   * @returns The age range preference or 'random' if not set
   */
  public getDefaultIdentityAgeRange(): string {
    return this.getSetting('DefaultIdentityAgeRange', 'random');
  }

  /**
   * Get the password settings from the database.
   * @returns Password settings object
   */
  public getPasswordSettings(): PasswordSettings {
    const settingsJson = this.getSetting('PasswordGenerationSettings');

    const defaultSettings: PasswordSettings = {
      Length: DEFAULT_PASSWORD_LENGTH,
      UseLowercase: true,
      UseUppercase: true,
      UseNumbers: true,
      UseSpecialChars: true,
      UseNonAmbiguousChars: false,
      Type: 'basic',
      WordCount: DEFAULT_WORD_COUNT,
      // Empty = "auto": the passphrase language is resolved from the app language during runtime.
      Language: '',
      Capitalization: 'Lowercase',
      Separator: 'Dash',
      Salt: 'None'
    };

    try {
      if (settingsJson) {
        return { ...defaultSettings, ...JSON.parse(settingsJson) };
      }
    } catch (error) {
      console.warn('Failed to parse password settings:', error);
    }

    return defaultSettings;
  }

  /**
   * Persist the password generator settings as a JSON blob.
   * Mirrors the `PasswordGenerationSettings` key used by the other AliasVault clients.
   * @param settings - The password settings to store.
   */
  public setPasswordSettings(settings: PasswordSettings): void {
    this.updateSetting('PasswordGenerationSettings', JSON.stringify(settings));
  }

  /**
   * Get the default email domain for new aliases.
   * @returns The default email domain or empty string if not set
   */
  public getDefaultEmailDomain(): string {
    return this.getSetting('DefaultEmailDomain');
  }

  /**
   * Get the effective identity language. Uses the explicit override when set, otherwise matches the
   * browser language to one of the identity generator's available languages via the shared
   * region-variant alternative-code table (e.g. "de-CH" -> "de"), falling back to English.
   * Async because the available languages are owned by the Rust core.
   * @returns The effective language code
   */
  public async getEffectiveIdentityLanguage(): Promise<string> {
    const storedLanguage = this.getDefaultIdentityLanguage();
    if (storedLanguage) {
      return storedLanguage;
    }
    return matchAvailableLanguage(navigator.language, await getIdentityLanguages()) ?? DEFAULT_LANGUAGE_CODE;
  }

  /**
   * Get the credentials sort order preference.
   * Uses the same key the other clients use for cross-platform sync.
   * @returns The sort order preference
   */
  public getCredentialsSortOrder(): CredentialSortOrder {
    const value = this.getSetting('CredentialsSortOrder', 'NewestFirst');
    // Validate the value is a valid sort order
    if (value === 'OldestFirst' || value === 'NewestFirst' || value === 'Alphabetical') {
      return value;
    }
    return 'NewestFirst';
  }

  /**
   * Update or insert a setting.
   * @param key - The setting key
   * @param value - The setting value
   */
  public updateSetting(key: string, value: string): void {
    const now = this.now();
    const manifestId = this.activeManifestId();

    // Check if setting exists within this manifest.
    const results = this.client.executeQuery<{ count: number }>(
      SettingsQueries.COUNT_BY_KEY,
      [manifestId, key]
    );
    const exists = results[0]?.count > 0;

    if (exists) {
      this.client.executeUpdate(
        SettingsQueries.UPDATE_SETTING,
        [value, now, manifestId, key]
      );
    } else {
      this.client.executeUpdate(
        SettingsQueries.INSERT_SETTING,
        [manifestId, key, value, now, now, 0]
      );
    }
  }

  /**
   * Set the credentials sort order preference.
   * Uses the same key the other clients use for cross-platform sync.
   * @param order - The sort order to set
   */
  public setCredentialsSortOrder(order: CredentialSortOrder): void {
    this.updateSetting('CredentialsSortOrder', order);
  }
}
