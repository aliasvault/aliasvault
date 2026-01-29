import initSqlJs, { Database } from 'sql.js';

import type { VaultVersion } from '@/utils/dist/core/vault';
import { VaultSqlGenerator, checkVersionCompatibility, extractVersionFromMigrationId } from '@/utils/dist/core/vault';
import { VaultVersionIncompatibleError } from '@/utils/types/errors/VaultVersionIncompatibleError';

import { t } from '@/i18n/StandaloneI18n';

import {
  ItemRepository,
  PasskeyRepository,
  FolderRepository,
  SettingsRepository,
  LogoRepository
} from './db';

import type { IDatabaseClient, SqliteBindValue } from './db/BaseRepository';

/**
 * Core SQLite database client.
 * Provides low-level database operations and exposes repositories for domain-specific operations.
 */
export class SqliteClient implements IDatabaseClient {
  private db: Database | null = null;
  private isInTransaction: boolean = false;

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
      this._items = new ItemRepository(this, this.logos);
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

  // ===== IDatabaseClient Implementation =====

  /**
   * Get the underlying database instance.
   */
  public getDb(): Database | null {
    return this.db;
  }

  /**
   * Initialize the SQLite database from a base64 string.
   * @param base64String - Base64 encoded SQLite database
   */
  public async initializeFromBase64(base64String: string): Promise<void> {
    try {
      // Convert base64 to Uint8Array
      const binaryString = atob(base64String);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Initialize SQL.js with the WASM file
      const SQL = await initSqlJs({
        /**
         * Locates SQL.js files from the local file system.
         * @param file - The name of the file to locate
         * @returns The complete URL path to the file
         */
        locateFile: (file: string): string => `src/${file}`
      });

      // Create database from the binary data
      this.db = new SQL.Database(bytes);

      // Reset repository instances when database changes
      this._items = null;
      this._passkeys = null;
      this._folders = null;
      this._settings = null;
      this._logos = null;
    } catch (error) {
      console.error('Error initializing SQLite database:', error);
      throw error;
    }
  }

  /**
   * Begin a new transaction.
   */
  public beginTransaction(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (this.isInTransaction) {
      throw new Error('Transaction already in progress');
    }

    try {
      this.db.run('BEGIN TRANSACTION');
      this.isInTransaction = true;
    } catch (error) {
      console.error('Error beginning transaction:', error);
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

    if (!this.isInTransaction) {
      throw new Error('No transaction in progress');
    }

    try {
      this.db.run('COMMIT');
      this.isInTransaction = false;
    } catch (error) {
      console.error('Error committing transaction:', error);
      throw error;
    }
  }

  /**
   * Rollback the current transaction.
   */
  public rollbackTransaction(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (!this.isInTransaction) {
      throw new Error('No transaction in progress');
    }

    try {
      this.db.run('ROLLBACK');
      this.isInTransaction = false;
    } catch (error) {
      console.error('Error rolling back transaction:', error);
      throw error;
    }
  }

  /**
   * Export the SQLite database to a base64 string.
   * @returns Base64 encoded string of the database
   */
  public exportToBase64(): string {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      // Vacuum to free up space before exporting
      this.db.run('VACUUM');

      const binaryArray = this.db.export();

      let binaryString = '';
      for (let i = 0; i < binaryArray.length; i++) {
        binaryString += String.fromCharCode(binaryArray[i]);
      }
      return btoa(binaryString);
    } catch (error) {
      console.error('Error exporting SQLite database:', error);
      throw error;
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
      const stmt = this.db.prepare(query);
      stmt.bind(params);

      const results: T[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject() as T);
      }
      stmt.free();

      return results;
    } catch (error) {
      console.error('Error executing query:', error);
      throw error;
    }
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
      const stmt = this.db.prepare(query);
      stmt.bind(params);
      stmt.step();
      const changes = this.db.getRowsModified();
      stmt.free();
      return changes;
    } catch (error) {
      console.error('Error executing update:', error);
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

        this.db.run(trimmedStatement);
      }
    } catch (error) {
      console.error('Error executing raw SQL:', error);
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
        const errorMessage = await t('common.errors.browserExtensionOutdated');
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
      console.error('Error getting database version:', error);
      throw error;
    }
  }

  /**
   * Get the latest available database version.
   * @returns The latest VaultVersion
   */
  public async getLatestDatabaseVersion(): Promise<VaultVersion> {
    const vaultSqlGenerator = new VaultSqlGenerator();
    const allVersions = vaultSqlGenerator.getAllVersions();
    return allVersions[allVersions.length - 1];
  }

  /**
   * Check if there are pending migrations.
   * @returns True if there are pending migrations
   */
  public async hasPendingMigrations(): Promise<boolean> {
    try {
      const currentVersion = await this.getDatabaseVersion();
      const latestVersion = await this.getLatestDatabaseVersion();

      return currentVersion.revision < latestVersion.revision;
    } catch (error) {
      console.error('Error checking pending migrations:', error);
      throw error;
    }
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
      console.error('Error setting logo:', error);
      return null;
    }
  }

  /**
   * Extract and normalize source domain from a URL string.
   * @param urlString - The URL to extract the domain from
   * @returns The normalized source domain (e.g., 'github.com'), or 'unknown' if extraction fails
   */
  public static extractSourceFromUrl(urlString: string | undefined | null): string {
    if (!urlString) {
      return 'unknown';
    }

    try {
      const url = new URL(urlString.startsWith('http') ? urlString : `https://${urlString}`);
      return url.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return 'unknown';
    }
  }

  /**
   * Detect MIME type from file signature (magic numbers).
   * @param bytes - Binary data to analyze
   * @returns MIME type string
   */
  private static detectMimeType(bytes: Uint8Array): string {
    /**
     * Check if the file is an SVG file.
     * @returns True if the file is an SVG
     */
    const isSvg = (): boolean => {
      const header = new TextDecoder().decode(bytes.slice(0, 5)).toLowerCase();
      return header.includes('<?xml') || header.includes('<svg');
    };

    /**
     * Check if the file is an ICO file.
     * @returns True if the file is an ICO
     */
    const isIco = (): boolean => {
      return bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00;
    };

    /**
     * Check if the file is a PNG file.
     * @returns True if the file is a PNG
     */
    const isPng = (): boolean => {
      return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    };

    if (isSvg()) {
      return 'image/svg+xml';
    }
    if (isIco()) {
      return 'image/x-icon';
    }
    if (isPng()) {
      return 'image/png';
    }

    return 'image/x-icon';
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
      const arr = Array.from(this.toUint8Array(buffer));
      return btoa(arr.reduce((data, byte) => data + String.fromCharCode(byte), ''));
    } catch (error) {
      console.error('Error encoding to base64:', error);
      return null;
    }
  }
}

export default SqliteClient;
