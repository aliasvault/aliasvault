import type { EncryptionKeyDerivationParams, VaultMetadata } from '@aliasvault/models/metadata';
import { asyncRepository } from '@aliasvault/client/database/DbOp';
import { EncryptionKeyRepository } from '@aliasvault/client/database/repositories/EncryptionKeyRepository';
import { FolderRepository } from '@aliasvault/client/database/repositories/FolderRepository';
import { ItemRepository } from '@aliasvault/client/database/repositories/ItemRepository';
import { ItemStatsRepository } from '@aliasvault/client/database/repositories/ItemStatsRepository';
import { LogoRepository } from '@aliasvault/client/database/repositories/LogoRepository';
import { PasskeyRepository } from '@aliasvault/client/database/repositories/PasskeyRepository';
import { SettingsRepository } from '@aliasvault/client/database/repositories/SettingsRepository';
import { VaultSqlGenerator, VaultVersion, checkVersionCompatibility, extractVersionFromMigrationId } from '@aliasvault/vault';
import { VaultVersionIncompatibleError } from '@aliasvault/client/api/errors/VaultVersionIncompatibleError';

import NativeVaultManager from '@/specs/NativeVaultManager';
import { NativeDatabaseClient } from '@/platform/NativeDatabaseClient';

/**
 * The vault as the app reads and writes it: the client core's repositories over the native vault store, plus the
 * vault metadata and key storage that only exist natively.
 */
class SqliteClient {
  /**
   * The native vault store, as the client core's database client.
   */
  private readonly database = new NativeDatabaseClient();

  /**
   * The logo repository itself, which the item and folder repositories call into.
   */
  private readonly logoRepository = new LogoRepository(this.database);

  /**
   * Repository for Item CRUD operations.
   */
  public readonly items = asyncRepository(new ItemRepository(this.database, this.logoRepository), this.database);

  /**
   * Repository for Folder operations.
   */
  public readonly folders = asyncRepository(new FolderRepository(this.database, this.logoRepository), this.database);

  /**
   * Repository for item logo operations.
   */
  public readonly logos = asyncRepository(this.logoRepository, this.database);

  /**
   * Repository for Passkey operations.
   */
  public readonly passkeys = asyncRepository(new PasskeyRepository(this.database), this.database);

  /**
   * Repository for the vault's user preferences.
   */
  public readonly settings = asyncRepository(new SettingsRepository(this.database), this.database);

  /**
   * Repository for the per-manifest keypairs that receive mail.
   */
  public readonly encryptionKeys = asyncRepository(new EncryptionKeyRepository(this.database), this.database);

  /**
   * Repository for per-item usage statistics.
   */
  public readonly itemStats = asyncRepository(new ItemStatsRepository(this.database), this.database);

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
      const defaultEmailDomain = await this.settings.getDefaultEmailDomain();

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
   * Store the encryption key in memory only (no keychain persistence).
   * Use this to test if a password-derived key is valid before persisting.
   *
   * @param base64EncryptionKey The base64 encoded encryption key
   */
  public async storeEncryptionKeyInMemory(base64EncryptionKey: string): Promise<void> {
    try {
      await NativeVaultManager.storeEncryptionKeyInMemory(base64EncryptionKey);
    } catch (error) {
      console.error('Error storing encryption key in memory:', error);
      throw error;
    }
  }

  /**
   * Store the encryption key in memory AND persist to keychain (may trigger biometric prompt).
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
   * Get the current database version from the migrations history.
   * Returns the internal version information that matches the current database version.
   * Uses semantic versioning to allow backwards-compatible minor/patch versions.
   */
  public async getDatabaseVersion(): Promise<VaultVersion> {
    // Query the migrations history table for the latest migration
    const results = await this.database.executeQuery<{ MigrationId: string }>(`
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
