import type { UnlockKeyDerivationParams, VaultMetadata } from '@aliasvault/models/metadata';
import { VaultDataBucketCategory } from '@aliasvault/models/vault';
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
import { VaultCodec } from '@aliasvault/client/sync/VaultCodec';

import NativeVaultManager from '@/specs/NativeVaultManager';
import { NativeDatabaseClient } from '@/platform/NativeDatabaseClient';
import { withDisplayItems } from '@/utils/DisplayItem';

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
   * The logo repository itself, which the item repository calls into.
   */
  private readonly logoRepository = new LogoRepository(this.database);

  /**
   * Repository for Item CRUD operations. Item reads return display items, which carry no logo bytes.
   */
  public readonly items = withDisplayItems(asyncRepository(new ItemRepository(this.database, this.logoRepository), this.database));

  /**
   * Repository for Folder operations.
   */
  public readonly folders = asyncRepository(new FolderRepository(this.database), this.database);

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
  public readonly settings = asyncRepository(new SettingsRepository(this.database), this.database, VaultDataBucketCategory.Settings);

  /**
   * Repository for the per-manifest keypairs that receive mail.
   */
  public readonly encryptionKeys = asyncRepository(new EncryptionKeyRepository(this.database), this.database);

  /**
   * Repository for per-item usage statistics.
   */
  public readonly itemStats = asyncRepository(new ItemStatsRepository(this.database), this.database, VaultDataBucketCategory.Stats);

  /**
   * The id of the user's personal manifest, or null when no pull has recorded one yet.
   */
  public getPersonalManifestId(): Promise<string | null> {
    return this.database.getPersonalManifestId();
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
   * Open a session in memory with the unlock key (the password-derived KEK), without keychain persistence.
   * Use this to test if a password-derived key is valid before persisting.
   *
   * @param base64UnlockKey The base64 encoded unlock key
   */
  public async storeUnlockKeyInMemory(base64UnlockKey: string): Promise<void> {
    try {
      await NativeVaultManager.storeUnlockKeyInMemory(base64UnlockKey);
    } catch (error) {
      console.error('Error storing unlock key in memory:', error);
      throw error;
    }
  }

  /**
   * Open a session with the unlock key (the password-derived KEK) AND persist it to keychain (may trigger biometric prompt).
   *
   * @param base64UnlockKey The base64 encoded unlock key
   */
  public async storeUnlockKey(base64UnlockKey: string): Promise<void> {
    try {
      // Open the session with the unlock key in the native module
      await NativeVaultManager.storeUnlockKey(base64UnlockKey);
    } catch (error) {
      console.error('Error storing unlock key:', error);
      throw error;
    }
  }

  /**
   * Store the key derivation params in the native keychain
   *
   * @param keyDerivationParams The key derivation parameters
   */
  public async storeUnlockKeyDerivationParams(keyDerivationParams: UnlockKeyDerivationParams): Promise<void> {
    try {
      const keyDerivationParamsJson = JSON.stringify(keyDerivationParams);
      await NativeVaultManager.storeUnlockKeyDerivationParams(keyDerivationParamsJson);
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
    const migrationId = await this.getLatestMigrationId();
    if (!migrationId) {
      throw new Error('No migrations found');
    }

    // Extract version from migration ID (e.g., "20240917191243_1.4.1-RenameAttachmentsPlural" -> "1.4.1")
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

  /**
   * Whether the vault still has to walk the sqlite-blob upgrade chain (VAULT_VERSIONS, frozen at 2.0.0) via the upgrade
   * page before it is eligible for anything else. Throws VaultVersionIncompatibleError for a vault newer than this app.
   *
   * TODO: this is the legacy sqlite-blob migration path; delete once all users have migrated.
   */
  public async requiresLegacySqliteBlobMigration(): Promise<boolean> {
    const currentVersion = await this.getDatabaseVersion();
    const latestVersion = await this.getLatestDatabaseVersion();
    return currentVersion.revision < latestVersion.revision;
  }

  /**
   * Whether the local database schema is older than the current full schema (COMPLETE_SCHEMA_SQL), which the manifest
   * migration rebuilds. Not applicable while the sqlite-blob chain is still pending.
   */
  public async requiresSchemaMigration(): Promise<boolean> {
    if (await this.requiresLegacySqliteBlobMigration()) {
      return false;
    }

    const localMigrationId = await this.getLatestMigrationId();
    const schemaMigrationId = VaultCodec.getSchemaMigrationId(new VaultSqlGenerator().getCompleteSchemaSql());

    // An unstamped database or an unreadable schema constant gives no evidence of staleness; don't block on a guess.
    if (!localMigrationId || !schemaMigrationId) {
      return false;
    }

    return localMigrationId < schemaMigrationId;
  }

  /**
   * The latest EF migration id the vault is stamped with, or null when it carries none.
   */
  private async getLatestMigrationId(): Promise<string | null> {
    const results = await this.database.executeQuery<{ MigrationId: string }>(`
      SELECT MigrationId
      FROM __EFMigrationsHistory
      ORDER BY MigrationId DESC
      LIMIT 1`);
    return results[0]?.MigrationId ?? null;
  }
}

export default SqliteClient;
