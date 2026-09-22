import { VaultDataBucketCategory } from '@aliasvault/models/vault';
import { VaultSqlGenerator, checkVersionCompatibility, extractVersionFromMigrationId } from '@aliasvault/vault';

import { VaultVersionIncompatibleError } from '../api/errors/VaultVersionIncompatibleError';
import { StorageKeys } from '../constants/StorageKeys';
import { getPlatform } from '../platform/ClientPlatform';
import { TranslatableMessage } from '../platform/TranslatableMessage';
import { VaultCodec } from '../sync/VaultCodec';
import { base64ToBytes, bytesToBase64 } from '../utilities/Base64';
import { logDefect } from '../utilities/Diagnostics';
import { detectImageMimeType } from '../utilities/ImageType';

import { syncRepository } from './DbOp';

import {
  ItemRepository,
  ItemStatsRepository,
  PasskeyRepository,
  FolderRepository,
  SettingsRepository,
  EncryptionKeyRepository,
  LogoRepository,
} from './index';

import type { ISyncDatabaseClient, SqliteBindValue } from './BaseRepository';
import type { SyncRepository } from './DbOp';
import type { ISqliteDatabase } from '../platform/SqliteEngine';
import type { VaultMutationScope } from '../sync/VaultMutationScope';
import type { VaultVersion } from '@aliasvault/vault';

/** Minimum number of free pages before a VACUUM is worth the full database rewrite on export. */
const VACUUM_MIN_FREE_PAGES = 64;

/** A VACUUM runs when the freelist holds at least this fraction (1/n) of the database's pages. */
const VACUUM_FREE_PAGE_RATIO = 10;

/**
 * Core SQLite database client.
 * Provides low-level database operations and exposes repositories for domain-specific operations.
 */
export class SqliteClient implements ISyncDatabaseClient {
  private db: ISqliteDatabase | null = null;
  private transactionOpen: boolean = false;

  /**
   * The mutation scopes written into since the host last drained them. Writes on this client persist nothing
   * by themselves: the host exports the whole database afterwards, and reads this to know what changed.
   */
  private readonly pendingMutationScopes = new Set<VaultMutationScope>();

  /**
   * The manifest this client writes new rows into, when the user has switched to one explicitly.
   * Null means "not chosen" and the user's personal manifest applies.
   */
  private activeManifestId: string | null = null;

  /**
   * The id of the user's personal manifest.
   */
  private personalManifestId: string | null = null;

  // Lazy-initialized repositories
  private _items: SyncRepository<ItemRepository> | null = null;
  private _itemStats: SyncRepository<ItemStatsRepository> | null = null;
  private _passkeys: SyncRepository<PasskeyRepository> | null = null;
  private _folders: SyncRepository<FolderRepository> | null = null;
  private _settings: SyncRepository<SettingsRepository> | null = null;
  private _encryptionKeys: SyncRepository<EncryptionKeyRepository> | null = null;
  private _logos: SyncRepository<LogoRepository> | null = null;
  private _logoRepository: LogoRepository | null = null;

  /**
   * The manifest new rows are stamped with when they cannot inherit one from a parent row, or null when
   * the client has not switched vaults and the personal manifest applies.
   * @returns The active manifest id, or null when none is set
   */
  public getActiveManifestId(): string | null {
    return this.activeManifestId;
  }

  /**
   * Switch the manifest this client writes into. Pass null to go back to the personal manifest.
   *
   * TODO: this method is not called yet, as a null manifestId will default to the personal manifest
   * which is what we want for now.
   */
  public setActiveManifestId(manifestId: string | null): void {
    this.activeManifestId = manifestId;
  }

  /**
   * The id of the user's personal manifest, as reported by the last pull. It is what the client writes into while
   * no other manifest is switched to.
   * @returns The personal manifest id, or null when no pull has recorded one yet
   */
  public getPersonalManifestId(): string | null {
    return this.personalManifestId;
  }

  /**
   * Repository for Item CRUD operations.
   */
  public get items(): SyncRepository<ItemRepository> {
    if (!this._items) {
      this._items = syncRepository(new ItemRepository(this, this.logoRepository), this);
    }
    return this._items;
  }

  /**
   * Repository for per-item usage statistics (last used, use counts).
   */
  public get itemStats(): SyncRepository<ItemStatsRepository> {
    if (!this._itemStats) {
      this._itemStats = syncRepository(new ItemStatsRepository(this), this, VaultDataBucketCategory.Stats);
    }
    return this._itemStats;
  }

  /**
   * Repository for Passkey operations.
   */
  public get passkeys(): SyncRepository<PasskeyRepository> {
    if (!this._passkeys) {
      this._passkeys = syncRepository(new PasskeyRepository(this), this);
    }
    return this._passkeys;
  }

  /**
   * Repository for Folder operations.
   */
  public get folders(): SyncRepository<FolderRepository> {
    if (!this._folders) {
      this._folders = syncRepository(new FolderRepository(this), this);
    }
    return this._folders;
  }

  /**
   * Repository for the vault's user preferences.
   */
  public get settings(): SyncRepository<SettingsRepository> {
    if (!this._settings) {
      this._settings = syncRepository(new SettingsRepository(this), this, VaultDataBucketCategory.Settings);
    }
    return this._settings;
  }

  /**
   * Repository for the per-manifest keypairs that receive mail.
   */
  public get encryptionKeys(): SyncRepository<EncryptionKeyRepository> {
    if (!this._encryptionKeys) {
      this._encryptionKeys = syncRepository(new EncryptionKeyRepository(this), this);
    }
    return this._encryptionKeys;
  }

  /**
   * Repository for item logo operations (favicons, built-in logos and uploaded images alike).
   */
  public get logos(): SyncRepository<LogoRepository> {
    if (!this._logos) {
      this._logos = syncRepository(this.logoRepository, this);
    }
    return this._logos;
  }

  /**
   * The logo repository itself, which the item repository calls into.
   */
  private get logoRepository(): LogoRepository {
    if (!this._logoRepository) {
      this._logoRepository = new LogoRepository(this);
    }
    return this._logoRepository;
  }

  // ===== IDatabaseClient Implementation =====

  /**
   * Get the underlying database instance.
   */
  public getDb(): ISqliteDatabase | null {
    return this.db;
  }

  /**
   * Initialize the SQLite database from a base64 string.
   * @param base64String - Base64 encoded SQLite database
   */
  public async initializeFromBase64(base64String: string): Promise<void> {
    return this.initializeFromBytes(base64ToBytes(base64String));
  }

  /**
   * Initialize the SQLite database from the raw database bytes.
   * @param bytes - the SQLite database
   */
  public async initializeFromBytes(bytes: Uint8Array): Promise<void> {
    try {
      // Open the database in memory through the host's SQLite engine.
      this.db = await getPlatform().sqlite.open(bytes);

      // Get the personal manifest id from local storage
      this.personalManifestId = (await getPlatform().storage.get(StorageKeys.VAULT_PERSONAL_MANIFEST_ID)) as string | null;

      // Reset repository instances when database changes
      this._items = null;
      this._passkeys = null;
      this._folders = null;
      this._settings = null;
      this._logos = null;
    } catch (error) {
      logDefect('[Sqlite] Initializing the database failed', error);
      throw error;
    }
  }

  /**
   * Whether a transaction is open.
   */
  public isInTransaction(): boolean {
    return this.transactionOpen;
  }

  /**
   * Begin a new transaction.
   */
  public beginTransaction(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (this.transactionOpen) {
      throw new Error('Transaction already in progress');
    }

    try {
      this.db.exec('BEGIN TRANSACTION');
      this.transactionOpen = true;
    } catch (error) {
      logDefect('[Sqlite] BEGIN TRANSACTION failed', error);
      throw error;
    }
  }

  /**
   * Commit the current transaction.
   */
  public async commitTransaction(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (!this.transactionOpen) {
      throw new Error('No transaction in progress');
    }

    try {
      this.db.exec('COMMIT');
      this.transactionOpen = false;
    } catch (error) {
      logDefect('[Sqlite] COMMIT failed', error);
      throw error;
    }
  }

  /**
   * Record that a repository wrote into a mutation scope.
   * @param scope - The scope that was written into
   */
  public recordMutationScope(scope: VaultMutationScope): void {
    this.pendingMutationScopes.add(scope);
  }

  /**
   * Take the scopes written into since the last drain, and clear them. Called by the host right after the
   * operation it is about to persist, so the sync knows whether a bucket-only push covers the change. A host
   * whose persist then fails puts them back through {@link recordMutationScope}: the write stays in the
   * database either way, and an unrecorded scope can strand it behind a later bucket-only push.
   * @returns The scopes written into, empty when nothing was written
   */
  public takeMutationScopes(): VaultMutationScope[] {
    const scopes = [...this.pendingMutationScopes];
    this.pendingMutationScopes.clear();
    return scopes;
  }

  /**
   * Rollback the current transaction.
   */
  public rollbackTransaction(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (!this.transactionOpen) {
      throw new Error('No transaction in progress');
    }

    try {
      this.db.exec('ROLLBACK');
      this.transactionOpen = false;
    } catch (error) {
      logDefect('[Sqlite] ROLLBACK failed', error);
      throw error;
    }
  }

  /**
   * Export the SQLite database to a base64 string.
   * @returns Base64 encoded string of the database
   */
  public exportToBase64(): string {
    return bytesToBase64(this.exportToBytes());
  }

  /**
   * Export the SQLite database as raw bytes.
   * @returns The database bytes
   */
  public exportToBytes(): Uint8Array {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      this.vacuumIfFragmented();
      return this.db.export();
    } catch (error) {
      logDefect('[Sqlite] Exporting the database failed', error);
      throw error;
    }
  }

  /**
   * Rebuild the database to reclaim free pages, but only when enough of them have accumulated to be worth it.
   */
  private vacuumIfFragmented(): void {
    const freePages = this.executeQuery<{ freelist_count: number }>('PRAGMA freelist_count')[0]?.freelist_count ?? 0;
    const totalPages = this.executeQuery<{ page_count: number }>('PRAGMA page_count')[0]?.page_count ?? 0;

    if (freePages >= VACUUM_MIN_FREE_PAGES && freePages * VACUUM_FREE_PAGE_RATIO >= totalPages) {
      this.executeRaw('VACUUM');
    }
  }

  /**
   * Execute a SELECT query.
   * @param query - SQL query string
   * @param params - Query parameters
   * @returns Array of result objects
   */
  public executeQuery<T>(query: string, params: SqliteBindValue[] = []): T[] {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      return this.db.query<T>(query, params);
    } catch (error) {
      logDefect(`[Sqlite] Query failed: ${query}`, error);
      throw error;
    }
  }

  /**
   * Whether a table has a given column.
   * @param table - Table name
   * @param column - Column name
   * @returns True when the table exists and has the column
   */
  public hasColumn(table: string, column: string): boolean {
    return this.executeQuery<{ name: string }>('SELECT name FROM pragma_table_info(?) WHERE name = ?', [table, column]).length > 0;
  }

  /**
   * Execute an INSERT, UPDATE, or DELETE query.
   * @param query - SQL query string
   * @param params - Query parameters
   * @returns Number of rows affected
   */
  public executeUpdate(query: string, params: SqliteBindValue[] = []): number {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      return this.db.run(query, params);
    } catch (error) {
      logDefect(`[Sqlite] Update failed: ${query}`, error);
      throw error;
    }
  }

  /**
   * Execute raw SQL command(s).
   * @param query - SQL command(s) to execute (may contain multiple statements separated by semicolons)
   */
  public executeRaw(query: string): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const statements = query.split(';');

      for (const statement of statements) {
        const trimmedStatement = statement.trim();

        // Skip empty statements and transaction control statements
        if (trimmedStatement.length === 0 ||
            trimmedStatement.toUpperCase().startsWith('BEGIN TRANSACTION') ||
            trimmedStatement.toUpperCase().startsWith('COMMIT') ||
            trimmedStatement.toUpperCase().startsWith('ROLLBACK')) {
          continue;
        }

        this.db.exec(trimmedStatement);
      }
    } catch (error) {
      logDefect('[Sqlite] Raw SQL failed', error);
      throw error;
    }
  }

  /**
   * Close the database connection and free resources.
   */
  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Get the current database version from the migrations history.
   *
   * TODO: part of the sqlite-blob upgrade chain (frozen up to 2.0.0); delete once all users
   * have migrated. New schema changes ship via requiresSchemaMigration / migrateVaultToCurrentSchema instead.
   * @returns The database version information
   */
  public async getDatabaseVersion(): Promise<VaultVersion> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const results = this.executeQuery<{ MigrationId: string }>(`
        SELECT MigrationId
        FROM __EFMigrationsHistory
        ORDER BY MigrationId DESC
        LIMIT 1`);

      if (results.length === 0) {
        throw new Error('No migrations found in the database.');
      }

      const migrationId = results[0].MigrationId;
      const databaseVersion = extractVersionFromMigrationId(migrationId);

      if (!databaseVersion) {
        throw new Error('Could not extract version from migration ID');
      }

      const compatibilityResult = checkVersionCompatibility(databaseVersion);

      if (!compatibilityResult.isCompatible) {
        const errorMessage = await getPlatform().translate(TranslatableMessage.ClientOutdated);
        throw new VaultVersionIncompatibleError(errorMessage);
      }

      if (compatibilityResult.isKnownVersion && compatibilityResult.clientVersion) {
        return compatibilityResult.clientVersion;
      }

      const vaultSqlGenerator = new VaultSqlGenerator();
      const latestClientVersion = vaultSqlGenerator.getLatestVersion();

      return {
        revision: latestClientVersion.revision,
        version: databaseVersion,
        description: `Unknown version ${databaseVersion} (backwards compatible)`,
        releaseVersion: latestClientVersion.releaseVersion,
        compatibleUpToVersion: latestClientVersion.compatibleUpToVersion
      };
    } catch (error) {
      logDefect('[Sqlite] Reading the database version failed', error);
      throw error;
    }
  }

  /**
   * Get the latest available database version.
   *
   * TODO: part of the sqlite-blob upgrade chain (frozen up to 2.0.0); delete once all users
   * have migrated. New schema changes ship via requiresSchemaMigration / migrateVaultToCurrentSchema instead.
   * @returns The latest VaultVersion
   */
  public async getLatestDatabaseVersion(): Promise<VaultVersion> {
    const vaultSqlGenerator = new VaultSqlGenerator();
    const allVersions = vaultSqlGenerator.getAllVersions();
    return allVersions[allVersions.length - 1];
  }

  /**
   * Whether the vault still has to walk the sqlite-blob upgrade chain (VAULT_VERSIONS, frozen at 2.0.0) via the /upgrade
   * page before it is eligible for anything else.
   *
   * TODO: this is the legacy sqlite-blob migration path, which we will stop supporting later; delete once all
   * users have migrated. New schema changes ship via requiresSchemaMigration / migrateVaultToCurrentSchema instead.
   * @returns True if there are pending migrations
   */
  public async requiresLegacySqliteBlobMigration(): Promise<boolean> {
    try {
      const currentVersion = await this.getDatabaseVersion();
      const latestVersion = await this.getLatestDatabaseVersion();

      return currentVersion.revision < latestVersion.revision;
    } catch (error) {
      logDefect('[Sqlite] Checking for pending migrations failed', error);
      throw error;
    }
  }

  /**
   * Whether the local database schema is older than the current full schema (COMPLETE_SCHEMA_SQL).
   * 
   * @returns True when the local schema predates the current full schema
   */
  public async requiresSchemaMigration(): Promise<boolean> {
    if (await this.requiresLegacySqliteBlobMigration()) {
      /*
       * Still on the sqlite-blob upgrade chain: that upgrade has to run first, so the migration is not applicable yet.
       * TODO: delete once all users have migrated.
       */
      return false;
    }

    const localMigrationId = VaultCodec.getLatestMigrationId(this);
    const schemaMigrationId = VaultCodec.getSchemaMigrationId(new VaultSqlGenerator().getCompleteSchemaSql());

    // An unstamped database or an unreadable schema constant gives no evidence of staleness; don't block on a guess.
    if (!localMigrationId || !schemaMigrationId) {
      return false;
    }

    return localMigrationId < schemaMigrationId;
  }

  /**
   * Convert binary data to a base64 encoded image source.
   * @param bytes - Binary image data
   * @returns Data URL for the image, or null if no valid image data
   */
  public static imgSrcFromBytes(bytes: Uint8Array<ArrayBufferLike> | number[] | undefined): string | null {
    if (!bytes || (Array.isArray(bytes) && bytes.length === 0) || (bytes instanceof Uint8Array && bytes.length === 0)) {
      return null;
    }

    try {
      const logoBytes = this.toUint8Array(bytes);
      const base64Logo = this.base64Encode(logoBytes);
      if (!base64Logo) {
        return null;
      }
      const mimeType = this.detectMimeType(logoBytes);
      return `data:${mimeType};base64,${base64Logo}`;
    } catch (error) {
      logDefect('[Sqlite] Building the logo data URL failed', error);
      return null;
    }
  }

  /**
   * Detect MIME type from file signature (magic numbers), defaulting to an icon.
   * @param bytes - Binary data to analyze
   * @returns MIME type string
   */
  private static detectMimeType(bytes: Uint8Array): string {
    return detectImageMimeType(bytes) ?? 'image/x-icon';
  }

  /**
   * Convert various binary data formats to Uint8Array.
   * @param buffer - Binary data in various formats
   * @returns Normalized Uint8Array
   */
  private static toUint8Array(buffer: Uint8Array | number[] | { [key: number]: number }): Uint8Array {
    if (buffer instanceof Uint8Array) {
      return buffer;
    }

    if (Array.isArray(buffer)) {
      return new Uint8Array(buffer);
    }

    const length = Object.keys(buffer).length;
    const arr = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      arr[i] = buffer[i];
    }

    return arr;
  }

  /**
   * Base64 encode binary data.
   * @param buffer - Binary data to encode
   * @returns Base64 encoded string or null on error
   */
  private static base64Encode(buffer: Uint8Array | number[] | { [key: number]: number }): string | null {
    try {
      return bytesToBase64(this.toUint8Array(buffer));
    } catch (error) {
      logDefect('[Sqlite] Base64 encoding failed', error);
      return null;
    }
  }
}

export default SqliteClient;
