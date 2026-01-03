import { Buffer } from 'buffer';

import type { EncryptionKeyDerivationParams, VaultMetadata } from '@/utils/dist/core/models/metadata';
import type { EncryptionKey, PasswordSettings } from '@/utils/dist/core/models/vault';
import { VaultSqlGenerator, VaultVersion, checkVersionCompatibility, extractVersionFromMigrationId } from '@/utils/dist/core/vault';
import { VaultVersionIncompatibleError } from '@/utils/types/errors/VaultVersionIncompatibleError';

import NativeVaultManager from '@/specs/NativeVaultManager';
import { ItemRepository } from '@/utils/db/repositories/ItemRepository';
import { SettingsRepository } from '@/utils/db/repositories/SettingsRepository';
import { LogoRepository } from '@/utils/db/repositories/LogoRepository';
import { FolderRepository } from '@/utils/db/repositories/FolderRepository';
import { PasskeyRepository } from '@/utils/db/repositories/PasskeyRepository';
import type { IDatabaseClient, SqliteBindValue } from '@/utils/db/BaseRepository';

type SQLiteBindValue = string | number | null | Uint8Array;

/**
 * Client for interacting with the SQLite database through native code.
 * Implements IDatabaseClient interface for repository pattern.
 */
class SqliteClient implements IDatabaseClient {
  // Lazy-initialized repositories
  private _items: ItemRepository | null = null;
  private _passkeys: PasskeyRepository | null = null;
  private _folders: FolderRepository | null = null;
  private _settings: SettingsRepository | null = null;
  private _logos: LogoRepository | null = null;

  /**
   * Repository for Item CRUD operations.
   */
  public get items(): ItemRepository {
    if (!this._items) {
      this._items = new ItemRepository(this);
    }
    return this._items;
  }

  /**
   * Repository for Passkey operations.
   */
  public get passkeys(): PasskeyRepository {
    if (!this._passkeys) {
      this._passkeys = new PasskeyRepository(this);
    }
    return this._passkeys;
  }

  /**
   * Repository for Folder operations.
   */
  public get folders(): FolderRepository {
    if (!this._folders) {
      this._folders = new FolderRepository(this);
    }
    return this._folders;
  }

  /**
   * Repository for Settings and auxiliary data operations.
   */
  public get settings(): SettingsRepository {
    if (!this._settings) {
      this._settings = new SettingsRepository(this);
    }
    return this._settings;
  }

  /**
   * Repository for Logo management operations.
   */
  public get logos(): LogoRepository {
    if (!this._logos) {
      this._logos = new LogoRepository(this);
    }
    return this._logos;
  }

  /**
   * Store the vault metadata via the native code implementation.
   *
   * Metadata is stored in plain text in UserDefaults. The metadata consists of the following:
   * - public email domains
   * - private email domains
   * - hidden private email domains
   * - vault revision number
   */
  public async storeMetadata(metadata: string): Promise<void> {
    try {
      await NativeVaultManager.storeMetadata(metadata);
    } catch (error) {
      console.error('Error storing vault metadata:', error);
      throw error;
    }
  }

  /**
   * Retrieve the vault metadata from native storage
   * @returns The parsed VaultMetadata object
   * @throws Error if metadata is not found or cannot be parsed
   */
  public async getVaultMetadata(): Promise<VaultMetadata> {
    try {
      const metadataJson = await NativeVaultManager.getVaultMetadata();
      if (!metadataJson) {
        throw new Error('No vault metadata found in native storage');
      }

      try {
        return JSON.parse(metadataJson) as VaultMetadata;
      } catch {
        throw new Error('Failed to parse vault metadata from native storage');
      }
    } catch (error) {
      console.error('Error retrieving vault metadata:', error);
      throw error;
    }
  }

  /**
   * Get the default email domain from the vault metadata.
   * Returns the first valid private domain if available, otherwise the first valid public domain.
   * Returns null if no valid domains are found.
   */
  public async getDefaultEmailDomain(): Promise<string | null> {
    try {
      const metadata = await this.getVaultMetadata();
      if (!metadata) {
        return null;
      }

      const { privateEmailDomains, publicEmailDomains, hiddenPrivateEmailDomains } = metadata;

      /**
       * Check if a domain is valid (not empty, not 'DISABLED.TLD', not hidden, and exists in either private or public domains)
       */
      const isValidDomain = (domain: string): boolean => {
        return Boolean(domain &&
               domain !== 'DISABLED.TLD' &&
               domain !== '' &&
               !hiddenPrivateEmailDomains?.includes(domain) &&
               (privateEmailDomains?.includes(domain) || publicEmailDomains?.includes(domain)));
      };

      // Get the default email domain from vault settings
      const defaultEmailDomain = await this.getSetting('DefaultEmailDomain');

      // First check if the default domain that is configured in the vault is still valid (not hidden)
      if (defaultEmailDomain && isValidDomain(defaultEmailDomain)) {
        return defaultEmailDomain;
      }

      // If default domain is not valid, fall back to first available private domain
      // Filter out hidden private domains from the list of private domains
      const firstPrivate = privateEmailDomains?.filter(domain => !hiddenPrivateEmailDomains?.includes(domain)).find(isValidDomain);
      if (firstPrivate) {
        return firstPrivate;
      }

      // Return first valid public domain if no private domains are available
      const firstPublic = publicEmailDomains?.find(isValidDomain);
      if (firstPublic) {
        return firstPublic;
      }

      return null;
    } catch (error) {
      console.error('Error getting default email domain:', error);
      return null;
    }
  }

  /**
   * Get the private email domains supported by the AliasVault server from the vault metadata.
   * @returns The private email domains.
   */
  public async getPrivateEmailDomains(): Promise<string[]> {
    const metadata = await this.getVaultMetadata();
    return metadata?.privateEmailDomains ?? [];
  }

  /**
   * Store the encryption key in the native keychain
   *
   * @param base64EncryptionKey The base64 encoded encryption key
   */
  public async storeEncryptionKey(base64EncryptionKey: string): Promise<void> {
    try {
      // Store the encryption key in the native module
      await NativeVaultManager.storeEncryptionKey(base64EncryptionKey);
    } catch (error) {
      console.error('Error storing encryption key:', error);
      throw error;
    }
  }

  /**
   * Store the key derivation params in the native keychain
   *
   * @param keyDerivationParams The key derivation parameters
   */
  public async storeEncryptionKeyDerivationParams(keyDerivationParams: EncryptionKeyDerivationParams): Promise<void> {
    try {
      const keyDerivationParamsJson = JSON.stringify(keyDerivationParams);
      await NativeVaultManager.storeEncryptionKeyDerivationParams(keyDerivationParamsJson);
    } catch (error) {
      console.error('Error storing encryption key derivation params:', error);
      throw error;
    }
  }

  /**
   * Execute a SELECT query
   */
  public async executeQuery<T>(query: string, params: SQLiteBindValue[] = []): Promise<T[]> {
    try {
      /*
       * Convert any Uint8Array parameters to base64 strings as the Native wrapper
       * communication requires everything to be a string.
       */
      const convertedParams = params.map(param => {
        if (param instanceof Uint8Array) {
          /*
           * We prefix the base64 string with "av-base64:" to indicate that it is a base64 encoded Uint8Array.
           * So the receiving end knows that it should convert this value back to a Uint8Array before using it in the query.
           */
          return 'av-base64-to-blob:' + Buffer.from(param).toString('base64');
        }
        return param;
      });

      const results = await NativeVaultManager.executeQuery(query, convertedParams);
      return results as T[];
    } catch (error) {
      console.error('Error executing query:', error);
      throw error;
    }
  }

  /**
   * Execute an INSERT, UPDATE, or DELETE query
   */
  public async executeUpdate(query: string, params: SQLiteBindValue[] = []): Promise<number> {
    try {
      /*
       * Convert any Uint8Array parameters to base64 strings as the Native wrapper
       * communication requires everything to be a string.
       */
      const convertedParams = params.map(param => {
        if (param instanceof Uint8Array) {
          /*
           * We prefix the base64 string with "av-base64-to-blob:" to indicate that it is a base64 encoded Uint8Array.
           * So the receiving end knows that it should convert this value back to a Uint8Array before using it in the query.
           */
          return 'av-base64-to-blob:' + Buffer.from(param).toString('base64');
        }
        return param;
      });

      const result = await NativeVaultManager.executeUpdate(query, convertedParams);
      return result as number;
    } catch (error) {
      console.error('Error executing update:', error);
      throw error;
    }
  }

  /**
   * Fetch all encryption keys.
   */
  public async getAllEncryptionKeys(): Promise<EncryptionKey[]> {
    return this.executeQuery<EncryptionKey>(`SELECT
                x.PublicKey,
                x.PrivateKey,
                x.IsPrimary
            FROM EncryptionKeys x`);
  }

  /**
   * Get setting from database for a given key.
   * Returns default value (empty string by default) if setting is not found.
   */
  public async getSetting(key: string, defaultValue: string = ''): Promise<string> {
    const results = await this.executeQuery<{ Value: string }>(`SELECT
                s.Value
            FROM Settings s
            WHERE s.Key = ?`, [key]);

    return results.length > 0 ? results[0].Value : defaultValue;
  }

  /**
   * Get the default identity language from the database.
   * Returns the stored override value if set, otherwise returns empty string to indicate no explicit preference.
   * Use getEffectiveIdentityLanguage() to get the language with smart defaults based on UI language.
   */
  public async getDefaultIdentityLanguage(): Promise<string> {
    return this.getSetting('DefaultIdentityLanguage');
  }

  /**
   * Get the effective identity generator language to use.
   * If user has explicitly set a language preference, use that.
   * Otherwise, intelligently match the UI language to an available identity generator language.
   * Falls back to "en" if no match is found.
   */
  public async getEffectiveIdentityLanguage(): Promise<string> {
    const explicitLanguage = await this.getDefaultIdentityLanguage();

    // If user has explicitly set a language preference, use it
    if (explicitLanguage) {
      return explicitLanguage;
    }

    // Otherwise, try to match UI language to an identity generator language
    const { mapUiLanguageToIdentityLanguage } = await import('@/utils/dist/core/identity-generator');
    const { default: i18n } = await import('@/i18n');

    const uiLanguage = i18n.language;
    const mappedLanguage = mapUiLanguageToIdentityLanguage(uiLanguage);

    // Return the mapped language, or fall back to "en" if no match found
    return mappedLanguage ?? 'en';
  }

  /**
   * Get the default identity gender preference from the database.
   */
  public async getDefaultIdentityGender(): Promise<string> {
    return this.getSetting('DefaultIdentityGender', 'random');
  }

  /**
   * Get the default identity age range from the database.
   */
  public async getDefaultIdentityAgeRange(): Promise<string> {
    return this.getSetting('DefaultIdentityAgeRange', 'random');
  }

  /**
   * Update a setting in the database.
   * @param key The setting key
   * @param value The setting value
   */
  public async updateSetting(key: string, value: string): Promise<void> {
    await NativeVaultManager.beginTransaction();

    const currentDateTime = new Date().toISOString()
      .replace('T', ' ')
      .replace('Z', '')
      .substring(0, 23);

    // First check if the setting already exists
    const checkQuery = `SELECT COUNT(*) as count FROM Settings WHERE Key = ?`;
    const checkResults = await this.executeQuery<{ count: number }>(checkQuery, [key]);
    const exists = checkResults[0]?.count > 0;

    if (exists) {
      // Update existing record
      const updateQuery = `
        UPDATE Settings
        SET Value = ?, UpdatedAt = ?
        WHERE Key = ?`;
      await this.executeUpdate(updateQuery, [value, currentDateTime, key]);
    } else {
      // Insert new record
      const insertQuery = `
        INSERT INTO Settings (Key, Value, CreatedAt, UpdatedAt, IsDeleted)
        VALUES (?, ?, ?, ?, ?)`;
      await this.executeUpdate(insertQuery, [key, value, currentDateTime, currentDateTime, 0]);
    }

    await NativeVaultManager.commitTransaction();
  }

  /**
   * Get the password settings from the database.
   */
  public async getPasswordSettings(): Promise<PasswordSettings> {
    const settingsJson = await this.getSetting('PasswordGenerationSettings');

    // Default settings if none found or parsing fails
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
   * Get the current database version from the migrations history.
   * Returns the internal version information that matches the current database version.
   * Uses semantic versioning to allow backwards-compatible minor/patch versions.
   */
  public async getDatabaseVersion(): Promise<VaultVersion> {
    // Query the migrations history table for the latest migration
    const results = await this.executeQuery<{ MigrationId: string }>(`
      SELECT MigrationId
      FROM __EFMigrationsHistory
      ORDER BY MigrationId DESC
      LIMIT 1`);

    if (results.length === 0) {
      throw new Error('No migrations found');
    }

    // Extract version from migration ID (e.g., "20240917191243_1.4.1-RenameAttachmentsPlural" -> "1.4.1")
    const migrationId = results[0].MigrationId;
    const databaseVersion = extractVersionFromMigrationId(migrationId);

    if (!databaseVersion) {
      throw new Error('Could not extract version from migration ID');
    }

    // Check version compatibility using semantic versioning
    const compatibilityResult = checkVersionCompatibility(databaseVersion);

    if (!compatibilityResult.isCompatible) {
      throw new VaultVersionIncompatibleError('vault.errors.appOutdated');
    }

    // If the version is known, return the full version info
    if (compatibilityResult.isKnownVersion && compatibilityResult.clientVersion) {
      return compatibilityResult.clientVersion;
    }

    /*
     * Version is unknown but compatible (same major version).
     * Create a VaultVersion object with the actual database version but use the latest client's revision number.
     * This allows older clients to work with newer backwards-compatible database versions.
     */
    const vaultSqlGenerator = new VaultSqlGenerator();
    const latestClientVersion = vaultSqlGenerator.getLatestVersion();

    // Return a version object with the actual database version string but the latest known revision
    return {
      revision: latestClientVersion.revision,
      version: databaseVersion, // Use the actual database version (e.g., "1.7.0")
      description: `Unknown version ${databaseVersion} (backwards compatible)`,
      releaseVersion: latestClientVersion.releaseVersion,
      compatibleUpToVersion: latestClientVersion.compatibleUpToVersion
    };
  }

  /**
   * Returns the version info of the latest available vault migration.
   */
  public async getLatestDatabaseVersion(): Promise<VaultVersion> {
    const vaultSqlGenerator = new VaultSqlGenerator();
    const allVersions = vaultSqlGenerator.getAllVersions();
    return allVersions[allVersions.length - 1];
  }
}

export default SqliteClient;