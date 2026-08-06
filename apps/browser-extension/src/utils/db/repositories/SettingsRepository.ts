import { DEFAULT_PASSWORD_LENGTH, DEFAULT_WORD_COUNT, DEFAULT_LANGUAGE_CODE, matchAvailableLanguage } from '@/utils/dist/core/models/defaults';
import type { EncryptionKey, PasswordSettings, TotpCode, Attachment } from '@/utils/dist/core/models/vault';
import { getIdentityLanguages } from '@/utils/RustCore';

import { BaseRepository } from '../BaseRepository';
import { EncryptionKeyQueries } from '../queries/EncryptionKeyQueries';
import { SettingsQueries } from '../queries/SettingsQueries';

/**
 * Sort order options for credentials list.
 */
export type CredentialSortOrder = 'OldestFirst' | 'NewestFirst' | 'Alphabetical';

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
   * Fetch every keypair that can decrypt inbound mail (both root manifest and optional shared manifest keys).
   * @returns Array of encryption keys
   */
  public getAllEncryptionKeys(): EncryptionKey[] {
    return this.client.executeQuery<EncryptionKey>(EncryptionKeyQueries.GET_ALL);
  }

  /**
   * Get the id of the root/default manifest.
   * @returns The root manifest id, or null when not known yet
   */
  public getRootManifestId(): string | null {
    return this.rootManifestId();
  }

  /**
   * Get the user's active personal keypair.
   * @returns The active personal keypair, or null when absent
   */
  public getPrimaryEncryptionKey(): EncryptionKey | null {
    const rootManifestId = this.rootManifestId();
    return rootManifestId ? this.getActiveManifestEncryptionKey(rootManifestId) : null;
  }

  /**
   * Get a manifest's active keypair, whose public half is published to the server as that manifest's delivery
   * key. Returns null for a manifest that has no keypair in this vault.
   * @param manifestId - The manifest id the keypair is stamped with
   * @returns The active keypair, or null when the manifest has none
   */
  public getActiveManifestEncryptionKey(manifestId: string): EncryptionKey | null {
    const results = this.client.executeQuery<EncryptionKey>(EncryptionKeyQueries.GET_ACTIVE_FOR_MANIFEST, [manifestId]);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Make the given keypair the manifest's active one, demoting (never deleting) whatever it supersedes so
   * mail received before the rotation stays decryptable.
   * @param manifestId - The manifest id to stamp the keypair with
   * @param publicKey - The public half, published to the server for delivery
   * @param privateKey - The private half, which never leaves the manifest
   */
  public setActiveManifestEncryptionKey(manifestId: string, publicKey: string, privateKey: string): void {
    const now = this.now();
    this.client.executeUpdate(EncryptionKeyQueries.DEMOTE_FOR_MANIFEST, [now, manifestId]);
    this.client.executeUpdate(EncryptionKeyQueries.INSERT_FOR_MANIFEST, [this.generateId(), manifestId, publicKey, privateKey, now, now]);
  }

  /**
   * Retain a copy of a keypair among the personal keys as a non-primary row.
   *
   * Used by the owner of a shared manifest to keep its delivery keys. The originals live only in the
   * shared manifest itself, so unsharing or deleting the anchor folder takes them out of the vault and would leave the
   * owner unable to decrypt mail their own alias received while it was shared.
   * @param publicKey - The public half, used as the identity of the key
   * @param privateKey - The private half
   */
  public retainNonPrimaryEncryptionKey(publicKey: string, privateKey: string): void {
    const rootManifestId = this.rootManifestId();
    if (!rootManifestId) {
      return;
    }

    const existing = this.client.executeQuery<{ count: number }>(EncryptionKeyQueries.COUNT_BY_PUBLIC_KEY, [rootManifestId, publicKey]);
    if ((existing[0]?.count ?? 0) > 0) {
      return;
    }

    const now = this.now();
    this.client.executeUpdate(EncryptionKeyQueries.INSERT_NON_PRIMARY, [this.generateId(), rootManifestId, publicKey, privateKey, now, now]);
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

    // Check if setting exists
    const results = this.client.executeQuery<{ count: number }>(
      SettingsQueries.COUNT_BY_KEY,
      [key]
    );
    const exists = results[0]?.count > 0;

    if (exists) {
      this.client.executeUpdate(
        SettingsQueries.UPDATE_SETTING,
        [value, now, key]
      );
    } else {
      this.client.executeUpdate(
        SettingsQueries.INSERT_SETTING,
        [key, value, now, now, 0]
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
