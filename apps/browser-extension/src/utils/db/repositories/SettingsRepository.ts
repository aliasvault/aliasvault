import type { EncryptionKey, PasswordSettings, TotpCode, Attachment } from '@/utils/dist/core/models/vault';

import { BaseRepository } from '../BaseRepository';

/**
 * SQL query constants for Settings and related operations.
 */
const SettingsQueries = {
  /**
   * Get setting by key.
   */
  GET_SETTING: `
    SELECT s.Value
    FROM Settings s
    WHERE s.Key = ?`,

  /**
   * Get all encryption keys.
   */
  GET_ENCRYPTION_KEYS: `
    SELECT
      x.PublicKey,
      x.PrivateKey,
      x.IsPrimary
    FROM EncryptionKeys x`,

  /**
   * Get TOTP codes for an item.
   */
  GET_TOTP_FOR_ITEM: `
    SELECT
      Id,
      Name,
      SecretKey,
      ItemId
    FROM TotpCodes
    WHERE ItemId = ? AND IsDeleted = 0`,

  /**
   * Get attachments for an item.
   */
  GET_ATTACHMENTS_FOR_ITEM: `
    SELECT
      Id,
      Filename,
      Blob,
      ItemId,
      CreatedAt,
      UpdatedAt,
      IsDeleted
    FROM Attachments
    WHERE ItemId = ? AND IsDeleted = 0`
};

/**
 * Repository for Settings and auxiliary data operations.
 */
export class SettingsRepository extends BaseRepository {
  /**
   * Get setting from database for a given key.
   * Returns default value (empty string by default) if setting is not found.
   * @param key - The setting key
   * @param defaultValue - Default value if setting not found
   * @returns The setting value
   */
  public getSetting(key: string, defaultValue: string = ''): string {
    const results = this.client.executeQuery<{ Value: string }>(
      SettingsQueries.GET_SETTING,
      [key]
    );
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
      Length: 18,
      UseLowercase: true,
      UseUppercase: true,
      UseNumbers: true,
      UseSpecialChars: true,
      UseNonAmbiguousChars: false
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
   * Fetch all encryption keys.
   * @returns Array of encryption keys
   */
  public getAllEncryptionKeys(): EncryptionKey[] {
    return this.client.executeQuery<EncryptionKey>(SettingsQueries.GET_ENCRYPTION_KEYS);
  }

  /**
   * Get TOTP codes for an item.
   * @param itemId - The ID of the item to get TOTP codes for
   * @returns Array of TotpCode objects
   */
  public getTotpCodesForItem(itemId: string): TotpCode[] {
    try {
      if (!this.tableExists('TotpCodes')) {
        return [];
      }

      return this.client.executeQuery<TotpCode>(SettingsQueries.GET_TOTP_FOR_ITEM, [itemId]);
    } catch (error) {
      console.error('Error getting TOTP codes for item:', error);
      return [];
    }
  }

  /**
   * Get attachments for an item.
   * @param itemId - The ID of the item
   * @returns Array of attachments for the item
   */
  public getAttachmentsForItem(itemId: string): Attachment[] {
    try {
      if (!this.tableExists('Attachments')) {
        return [];
      }

      return this.client.executeQuery<Attachment>(
        SettingsQueries.GET_ATTACHMENTS_FOR_ITEM,
        [itemId]
      );
    } catch (error) {
      console.error('Error getting attachments for item:', error);
      return [];
    }
  }

  /**
   * Get the default email domain for new aliases.
   * @returns The default email domain or empty string if not set
   */
  public getDefaultEmailDomain(): string {
    return this.getSetting('DefaultEmailDomain');
  }

  /**
   * Get the effective identity language, falling back to browser language.
   * @returns The effective language code
   */
  public getEffectiveIdentityLanguage(): string {
    const storedLanguage = this.getDefaultIdentityLanguage();
    if (storedLanguage) {
      return storedLanguage;
    }
    // Fall back to browser language (first two characters)
    return navigator.language.substring(0, 2);
  }
}
