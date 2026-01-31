import type { EncryptionKey, PasswordSettings, TotpCode, Attachment } from '@/utils/dist/core/models/vault';

import { BaseRepository } from '../BaseRepository';

/**
 * Sort order options for credentials list.
 * Values must match the C# CredentialSortOrder enum in the Blazor client for cross-platform sync.
 */
export type CredentialSortOrder = 'OldestFirst' | 'NewestFirst' | 'Alphabetical';

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
  public async getSetting(key: string, defaultValue: string = ''): Promise<string> {
    const results = await this.client.executeQuery<{ Value: string }>(
      SettingsQueries.GET_SETTING,
      [key]
    );
    return results.length > 0 ? results[0].Value : defaultValue;
  }

  /**
   * Get the default identity language from the database.
   * @returns The stored override value if set, otherwise empty string
   */
  public async getDefaultIdentityLanguage(): Promise<string> {
    return this.getSetting('DefaultIdentityLanguage');
  }

  /**
   * Get the default identity gender preference from the database.
   * @returns The gender preference or 'random' if not set
   */
  public async getDefaultIdentityGender(): Promise<string> {
    return this.getSetting('DefaultIdentityGender', 'random');
  }

  /**
   * Get the default identity age range from the database.
   * @returns The age range preference or 'random' if not set
   */
  public async getDefaultIdentityAgeRange(): Promise<string> {
    return this.getSetting('DefaultIdentityAgeRange', 'random');
  }

  /**
   * Get the password settings from the database.
   * @returns Password settings object
   */
  public async getPasswordSettings(): Promise<PasswordSettings> {
    const settingsJson = await this.getSetting('PasswordGenerationSettings');

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
  public async getAllEncryptionKeys(): Promise<EncryptionKey[]> {
    return this.client.executeQuery<EncryptionKey>(SettingsQueries.GET_ENCRYPTION_KEYS);
  }

  /**
   * Get TOTP codes for an item.
   * @param itemId - The ID of the item to get TOTP codes for
   * @returns Array of TotpCode objects
   */
  public async getTotpCodesForItem(itemId: string): Promise<TotpCode[]> {
    try {
      if (!await this.tableExists('TotpCodes')) {
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
  public async getAttachmentsForItem(itemId: string): Promise<Attachment[]> {
    try {
      if (!await this.tableExists('Attachments')) {
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
  public async getDefaultEmailDomain(): Promise<string> {
    return this.getSetting('DefaultEmailDomain');
  }

  /**
   * Update or insert a setting.
   * @param key - The setting key
   * @param value - The setting value
   */
  public async updateSetting(key: string, value: string): Promise<void> {
    await this.withTransaction(async () => {
      const now = this.now();

      // Check if setting exists
      const results = await this.client.executeQuery<{ count: number }>(
        `SELECT COUNT(*) as count FROM Settings WHERE Key = ?`,
        [key]
      );
      const exists = results[0]?.count > 0;

      if (exists) {
        await this.client.executeUpdate(
          `UPDATE Settings SET Value = ?, UpdatedAt = ? WHERE Key = ?`,
          [value, now, key]
        );
      } else {
        await this.client.executeUpdate(
          `INSERT INTO Settings (Key, Value, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?)`,
          [key, value, now, now, 0]
        );
      }
    });
  }

  /**
   * Get the credentials sort order preference.
   * Uses the same key the other clients use for cross-platform sync.
   * @returns The sort order preference
   */
  public async getCredentialsSortOrder(): Promise<CredentialSortOrder> {
    const value = await this.getSetting('CredentialsSortOrder', 'OldestFirst');
    // Validate the value is a valid sort order
    if (value === 'OldestFirst' || value === 'NewestFirst' || value === 'Alphabetical') {
      return value;
    }
    return 'OldestFirst';
  }

  /**
   * Set the credentials sort order preference.
   * Uses the same key the other clients use for cross-platform sync.
   * @param order - The sort order to set
   */
  public async setCredentialsSortOrder(order: CredentialSortOrder): Promise<void> {
    await this.updateSetting('CredentialsSortOrder', order);
  }
}
