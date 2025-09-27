import { Buffer } from 'buffer';

import type { EncryptionKeyDerivationParams, VaultMetadata } from '@/utils/dist/shared/models/metadata';
import type { Attachment, Credential, EncryptionKey, PasswordSettings, TotpCode } from '@/utils/dist/shared/models/vault';
import { VaultSqlGenerator, VaultVersion } from '@/utils/dist/shared/vault-sql';
import { VaultVersionIncompatibleError } from '@/utils/types/errors/VaultVersionError';

import NativeVaultManager from '@/specs/NativeVaultManager';

type SQLiteBindValue = string | number | null | Uint8Array;

/**
 * Client for interacting with the SQLite database through native code.
 */
class SqliteClient {
  /**
   * Store the encrypted database via the native code implementation.
   */
  public async storeEncryptedDatabase(base64EncryptedDb: string): Promise<void> {
    try {
      await NativeVaultManager.storeDatabase(base64EncryptedDb);
    } catch (error) {
      console.error('Error initializing SQLite database:', error);
      throw error;
    }
  }

  /**
   * Store the vault metadata via the native code implementation.
   *
   * Metadata is stored in plain text in UserDefaults. The metadata consists of the following:
   * - public and private email domains
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

      const { privateEmailDomains, publicEmailDomains } = metadata;

      /**
       * Check if a domain is valid (not empty, not 'DISABLED.TLD', and exists in either private or public domains)
       */
      const isValidDomain = (domain: string): boolean => {
        return Boolean(domain &&
               domain !== 'DISABLED.TLD' &&
               domain !== '' &&
               (privateEmailDomains?.includes(domain) || publicEmailDomains?.includes(domain)));
      };

      // Get the default email domain from vault settings
      const defaultEmailDomain = await this.getSetting('DefaultEmailDomain');

      // First check if the default domain that is configured in the vault is still valid
      if (defaultEmailDomain && isValidDomain(defaultEmailDomain)) {
        return defaultEmailDomain;
      }

      // If default domain is not valid, fall back to first available private domain
      const firstPrivate = privateEmailDomains?.find(isValidDomain);
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
   * Close the database connection and free resources.
   */
  public close(): void {
    // No-op since the native code handles connection lifecycle
  }

  /**
   * Fetch a single credential with its associated service information.
   * @param credentialId - The ID of the credential to fetch.
   * @returns Credential object with service details or null if not found.
   */
  public async getCredentialById(credentialId: string): Promise<Credential | null> {
    const query = `
        SELECT DISTINCT
            c.Id,
            c.Username,
            c.Notes,
            c.ServiceId,
            s.Name as ServiceName,
            s.Url as ServiceUrl,
            s.Logo as Logo,
            a.FirstName,
            a.LastName,
            a.NickName,
            a.BirthDate,
            a.Gender,
            a.Email,
            p.Value as Password
        FROM Credentials c
        LEFT JOIN Services s ON c.ServiceId = s.Id
        LEFT JOIN Aliases a ON c.AliasId = a.Id
        LEFT JOIN Passwords p ON p.CredentialId = c.Id
        WHERE c.IsDeleted = 0
        AND c.Id = ?`;

    const results = await this.executeQuery(query, [credentialId]);

    if (results.length === 0) {
      return null;
    }

    // Convert the first row to a Credential object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = results[0] as any;
    return {
      Id: row.Id,
      Username: row.Username,
      Password: row.Password,
      ServiceName: row.ServiceName,
      ServiceUrl: row.ServiceUrl,
      Logo: row.Logo,
      Notes: row.Notes,
      Alias: {
        FirstName: row.FirstName,
        LastName: row.LastName,
        NickName: row.NickName,
        BirthDate: row.BirthDate,
        Gender: row.Gender,
        Email: row.Email
      }
    };
  }

  /**
   * Fetch all credentials with their associated service information.
   * @returns Array of Credential objects with service details.
   */
  public async getAllCredentials(): Promise<Credential[]> {
    const query = `
            SELECT DISTINCT
                c.Id,
                c.Username,
                c.Notes,
                c.ServiceId,
                s.Name as ServiceName,
                s.Url as ServiceUrl,
                s.Logo as Logo,
                a.FirstName,
                a.LastName,
                a.NickName,
                a.BirthDate,
                a.Gender,
                a.Email,
                p.Value as Password
            FROM Credentials c
            LEFT JOIN Services s ON c.ServiceId = s.Id
            LEFT JOIN Aliases a ON c.AliasId = a.Id
            LEFT JOIN Passwords p ON p.CredentialId = c.Id
            WHERE c.IsDeleted = 0
            ORDER BY c.CreatedAt DESC`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = await this.executeQuery<any>(query);

    return results.map((row) => ({
      Id: row.Id,
      Username: row.Username,
      Password: row.Password,
      ServiceName: row.ServiceName,
      ServiceUrl: row.ServiceUrl,
      Logo: row.Logo,
      Notes: row.Notes,
      Alias: {
        FirstName: row.FirstName,
        LastName: row.LastName,
        NickName: row.NickName,
        BirthDate: row.BirthDate,
        Gender: row.Gender,
        Email: row.Email
      }
    }));
  }

  /**
   * Delete a credential by ID
   * @param credentialId - The ID of the credential to delete
   * @returns The number of rows deleted
   */
  public async deleteCredentialById(credentialId: string): Promise<number> {
    try {
      await NativeVaultManager.beginTransaction();

      const currentDateTime = new Date().toISOString()
        .replace('T', ' ')
        .replace('Z', '')
        .substring(0, 23);

      // Update the credential, alias, and service to be deleted
      const query = `
        UPDATE Credentials
        SET IsDeleted = 1,
            UpdatedAt = ?
        WHERE Id = ?`;

      const aliasQuery = `
        UPDATE Aliases
        SET IsDeleted = 1,
            UpdatedAt = ?
        WHERE Id = (
          SELECT AliasId
          FROM Credentials
          WHERE Id = ?
        )`;

      const serviceQuery = `
        UPDATE Services
        SET IsDeleted = 1,
            UpdatedAt = ?
        WHERE Id = (
          SELECT ServiceId
          FROM Credentials
          WHERE Id = ?
        )`;

      const results = await this.executeUpdate(query, [currentDateTime, credentialId]);
      await this.executeUpdate(aliasQuery, [currentDateTime, credentialId]);
      await this.executeUpdate(serviceQuery, [currentDateTime, credentialId]);

      await NativeVaultManager.commitTransaction();
      return results;
    } catch (error) {
      await NativeVaultManager.rollbackTransaction();
      console.error('Error deleting credential:', error);
      throw error;
    }
  }

  /**
   * Fetch all unique email addresses from all credentials.
   * @returns Array of email addresses.
   */
  public async getAllEmailAddresses(): Promise<string[]> {
    const query = `
      SELECT DISTINCT
        a.Email
      FROM Credentials c
      LEFT JOIN Aliases a ON c.AliasId = a.Id
      WHERE a.Email IS NOT NULL AND a.Email != '' AND c.IsDeleted = 0
    `;

    const results = await this.executeQuery(query);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return results.map((row: any) => row.Email);
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
   */
  public async getDefaultIdentityLanguage(): Promise<string> {
    return this.getSetting('DefaultIdentityLanguage', 'en');
  }

  /**
   * Get the default identity gender preference from the database.
   */
  public async getDefaultIdentityGender(): Promise<string> {
    return this.getSetting('DefaultIdentityGender', 'random');
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
   * Create a new credential with associated entities
   * @param credential The credential object to insert
   * @param attachments The attachments to insert
   * @returns The ID of the newly created credential
   */
  public async createCredential(credential: Credential, attachments: Attachment[]): Promise<string> {
    try {
      await NativeVaultManager.beginTransaction();

      // 1. Insert Service
      let logoData = null;
      try {
        if (credential.Logo) {
          // Handle object-like array conversion
          if (typeof credential.Logo === 'object' && !ArrayBuffer.isView(credential.Logo)) {
            const values = Object.values(credential.Logo);
            logoData = new Uint8Array(values);
          // Handle existing array types
          } else if (Array.isArray(credential.Logo) || credential.Logo instanceof ArrayBuffer || credential.Logo instanceof Uint8Array) {
            logoData = new Uint8Array(credential.Logo);
          }
        }
      } catch (error) {
        console.warn('Failed to convert logo to Uint8Array:', error);
        logoData = null;
      }

      const serviceQuery = `
                INSERT INTO Services (Id, Name, Url, Logo, CreatedAt, UpdatedAt, IsDeleted)
                VALUES (?, ?, ?, ?, ?, ?, ?)`;
      const serviceId = crypto.randomUUID().toUpperCase();
      const currentDateTime = new Date().toISOString()
        .replace('T', ' ')
        .replace('Z', '')
        .substring(0, 23);
      await this.executeUpdate(serviceQuery, [
        serviceId,
        credential.ServiceName,
        credential.ServiceUrl ?? null,
        logoData,
        currentDateTime,
        currentDateTime,
        0
      ]);

      // 2. Insert Alias
      const aliasQuery = `
                INSERT INTO Aliases (Id, FirstName, LastName, NickName, BirthDate, Gender, Email, CreatedAt, UpdatedAt, IsDeleted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const aliasId = crypto.randomUUID().toUpperCase();
      await this.executeUpdate(aliasQuery, [
        aliasId,
        credential.Alias.FirstName ?? null,
        credential.Alias.LastName ?? null,
        credential.Alias.NickName ?? null,
        credential.Alias.BirthDate ?? null,
        credential.Alias.Gender ?? null,
        credential.Alias.Email ?? null,
        currentDateTime,
        currentDateTime,
        0
      ]);

      // 3. Insert Credential
      const credentialQuery = `
                INSERT INTO Credentials (Id, Username, Notes, ServiceId, AliasId, CreatedAt, UpdatedAt, IsDeleted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
      const credentialId = crypto.randomUUID().toUpperCase();
      await this.executeUpdate(credentialQuery, [
        credentialId,
        credential.Username ?? null,
        credential.Notes ?? null,
        serviceId,
        aliasId,
        currentDateTime,
        currentDateTime,
        0
      ]);

      // 4. Insert Password
      if (credential.Password) {
        const passwordQuery = `
                    INSERT INTO Passwords (Id, Value, CredentialId, CreatedAt, UpdatedAt, IsDeleted)
                    VALUES (?, ?, ?, ?, ?, ?)`;
        const passwordId = crypto.randomUUID().toUpperCase();
        await this.executeUpdate(passwordQuery, [
          passwordId,
          credential.Password,
          credentialId,
          currentDateTime,
          currentDateTime,
          0
        ]);
      }

      // 5. Insert Attachments
      for (const attachment of attachments) {
        const attachmentQuery = `
          INSERT INTO Attachments (Id, Filename, Blob, CredentialId, CreatedAt, UpdatedAt, IsDeleted)
          VALUES (?, ?, ?, ?, ?, ?, ?)`;
        await this.executeUpdate(attachmentQuery, [
          attachment.Id,
          attachment.Filename,
          attachment.Blob as Uint8Array,
          credentialId,
          currentDateTime,
          currentDateTime,
          0
        ]);
      }

      await NativeVaultManager.commitTransaction();
      return credentialId;

    } catch (error) {
      await NativeVaultManager.rollbackTransaction();
      console.error('Error creating credential:', error);
      throw error;
    }
  }

  /**
   * Get the current database version from the migrations history.
   * Returns the internal version information that matches the current database version.
   * Returns null if no matching version is found.
   */
  public async getDatabaseVersion(): Promise<VaultVersion> {
    let currentVersion = '';

    // Query the migrations history table for the latest migration
    const results = await this.executeQuery<{ MigrationId: string }>(`
      SELECT MigrationId
      FROM __EFMigrationsHistory
      ORDER BY MigrationId DESC
      LIMIT 1`);

    if (results.length === 0) {
      throw new Error('No migrations found');
    }

    // Extract version using regex - matches patterns like "20240917191243_1.4.1-RenameAttachmentsPlural"
    const migrationId = results[0].MigrationId;
    const versionRegex = /_(\d+\.\d+\.\d+)-/;
    const versionMatch = versionRegex.exec(migrationId);

    if (versionMatch?.[1]) {
      currentVersion = versionMatch[1];
    }

    // Get all available vault versions to get the revision number of the current version.
    const vaultSqlGenerator = new VaultSqlGenerator();
    const allVersions = vaultSqlGenerator.getAllVersions();
    const currentVersionRevision = allVersions.find(v => v.version === currentVersion);

    if (!currentVersionRevision) {
      throw new VaultVersionIncompatibleError('vault.errors.appOutdated');
    }

    return currentVersionRevision;
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
   * Get TOTP codes for a credential
   * @param credentialId - The ID of the credential to get TOTP codes for
   * @returns Array of TotpCode objects
   */
  public async getTotpCodesForCredential(credentialId: string): Promise<TotpCode[]> {
    try {
      /*
       * Check if TotpCodes table exists (for backward compatibility).
       * TODO: whenever the mobile app has a minimum client DB version of 1.5.0+,
       * we can remove this check as the TotpCodes table then is guaranteed to exist.
       */
      if (!await this.tableExists('TotpCodes')) {
        return [];
      }

      const query = `
        SELECT
          Id,
          Name,
          SecretKey,
          CredentialId
        FROM TotpCodes
        WHERE CredentialId = ? AND IsDeleted = 0`;

      return this.executeQuery<TotpCode>(query, [credentialId]);
    } catch (error) {
      console.error('Error getting TOTP codes:', error);
      // Return empty array instead of throwing to be robust
      return [];
    }
  }

  /**
   * Get attachments for a specific credential
   * @param credentialId - The ID of the credential
   * @returns Array of attachments for the credential
   */
  public async getAttachmentsForCredential(credentialId: string): Promise<Attachment[]> {
    try {
      if (!await this.tableExists('Attachments')) {
        return [];
      }

      const query = `
        SELECT
          Id,
          Filename,
          Blob,
          CredentialId,
          CreatedAt,
          UpdatedAt,
          IsDeleted
        FROM Attachments
        WHERE CredentialId = ? AND IsDeleted = 0`;
      return this.executeQuery<Attachment>(query, [credentialId]);
    } catch (error) {
      console.error('Error getting attachments:', error);
      return [];
    }
  }

  /**
   * Check if a table exists in the database
   * @param tableName - The name of the table to check
   * @returns True if the table exists, false otherwise
   */
  private async tableExists(tableName: string): Promise<boolean> {
    try {
      const query = `
        SELECT name FROM sqlite_master
        WHERE type='table' AND name=?`;

      const results = await this.executeQuery(query, [tableName]);
      return results.length > 0;
    } catch (error) {
      console.error(`Error checking if table ${tableName} exists:`, error);
      return false;
    }
  }

  /**
   * Get credential by email address
   * @param email - The email address to look up
   * @returns Credential object with service details or null if not found
   */
  public async getCredentialByEmail(email: string): Promise<Credential | null> {
    const query = `
        SELECT DISTINCT
            c.Id,
            c.Username,
            c.Notes,
            c.ServiceId,
            s.Name as ServiceName,
            s.Url as ServiceUrl,
            s.Logo as Logo,
            a.FirstName,
            a.LastName,
            a.NickName,
            a.BirthDate,
            a.Gender,
            a.Email,
            p.Value as Password
        FROM Credentials c
        LEFT JOIN Services s ON c.ServiceId = s.Id
        LEFT JOIN Aliases a ON c.AliasId = a.Id
        LEFT JOIN Passwords p ON p.CredentialId = c.Id
        WHERE c.IsDeleted = 0
        AND LOWER(a.Email) = LOWER(?)
        LIMIT 1`;

    const results = await this.executeQuery(query, [email]);

    if (results.length === 0) {
      return null;
    }

    // Convert the first row to a Credential object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = results[0] as any;
    return {
      Id: row.Id,
      Username: row.Username,
      Password: row.Password,
      ServiceName: row.ServiceName,
      ServiceUrl: row.ServiceUrl,
      Logo: row.Logo,
      Notes: row.Notes,
      Alias: {
        FirstName: row.FirstName,
        LastName: row.LastName,
        NickName: row.NickName,
        BirthDate: row.BirthDate,
        Gender: row.Gender,
        Email: row.Email
      }
    };
  }

  /**
   * Update an existing credential with associated entities
   * @param credential The credential object to update
   * @param originalAttachmentIds The IDs of the original attachments
   * @param attachments The attachments to update
   * @returns The number of rows modified
   */
  public async updateCredentialById(credential: Credential, originalAttachmentIds: string[], attachments: Attachment[]): Promise<number> {
    try {
      await NativeVaultManager.beginTransaction();
      const currentDateTime = new Date().toISOString()
        .replace('T', ' ')
        .replace('Z', '')
        .substring(0, 23);

      // Get existing credential to compare changes
      const existingCredential = await this.getCredentialById(credential.Id);
      if (!existingCredential) {
        throw new Error('Credential not found');
      }

      // 1. Update Service
      const serviceQuery = `
        UPDATE Services
        SET Name = ?,
            Url = ?,
            Logo = COALESCE(?, Logo),
            UpdatedAt = ?
        WHERE Id = (
          SELECT ServiceId
          FROM Credentials
          WHERE Id = ?
        )`;

      let logoData = null;
      try {
        if (credential.Logo) {
          // Handle object-like array conversion
          if (typeof credential.Logo === 'object' && !ArrayBuffer.isView(credential.Logo)) {
            const values = Object.values(credential.Logo);
            logoData = new Uint8Array(values);
          // Handle existing array types
          } else if (Array.isArray(credential.Logo) || credential.Logo instanceof ArrayBuffer || credential.Logo instanceof Uint8Array) {
            logoData = new Uint8Array(credential.Logo);
          }
        }
      } catch (error) {
        console.warn('Failed to convert logo to Uint8Array:', error);
        logoData = null;
      }

      await this.executeUpdate(serviceQuery, [
        credential.ServiceName,
        credential.ServiceUrl ?? null,
        logoData,
        currentDateTime,
        credential.Id
      ]);

      // 2. Update Alias
      const aliasQuery = `
        UPDATE Aliases
        SET FirstName = ?,
            LastName = ?,
            NickName = ?,
            BirthDate = ?,
            Gender = ?,
            Email = ?,
            UpdatedAt = ?
        WHERE Id = (
          SELECT AliasId
          FROM Credentials
          WHERE Id = ?
        )`;

      // Only update BirthDate if it's actually different (accounting for format differences)
      let birthDate = credential.Alias.BirthDate;
      if (birthDate && existingCredential.Alias.BirthDate) {
        const newDate = new Date(birthDate);
        const existingDate = new Date(existingCredential.Alias.BirthDate);
        if (newDate.getTime() === existingDate.getTime()) {
          birthDate = existingCredential.Alias.BirthDate;
        }
      }

      await this.executeUpdate(aliasQuery, [
        credential.Alias.FirstName ?? null,
        credential.Alias.LastName ?? null,
        credential.Alias.NickName ?? null,
        birthDate ?? null,
        credential.Alias.Gender ?? null,
        credential.Alias.Email ?? null,
        currentDateTime,
        credential.Id
      ]);

      // 3. Update Credential
      const credentialQuery = `
        UPDATE Credentials
        SET Username = ?,
            Notes = ?,
            UpdatedAt = ?
        WHERE Id = ?`;

      await this.executeUpdate(credentialQuery, [
        credential.Username ?? null,
        credential.Notes ?? null,
        currentDateTime,
        credential.Id
      ]);

      // 4. Update Password if changed
      if (credential.Password !== existingCredential.Password) {
        // Check if a password record already exists for this credential, if not, then create one.
        const passwordRecordExistsQuery = `
          SELECT Id
          FROM Passwords
          WHERE CredentialId = ?`;
        const passwordResults = await this.executeQuery(passwordRecordExistsQuery, [credential.Id]);

        if (passwordResults.length === 0) {
          // Create a new password record
          const passwordQuery = `
            INSERT INTO Passwords (Id, Value, CredentialId, CreatedAt, UpdatedAt, IsDeleted)
            VALUES (?, ?, ?, ?, ?, ?)`;

          await this.executeUpdate(passwordQuery, [
            crypto.randomUUID().toUpperCase(),
            credential.Password,
            credential.Id,
            currentDateTime,
            currentDateTime,
            0
          ]);
        } else {
          // Update the existing password record
          const passwordQuery = `
            UPDATE Passwords
            SET Value = ?, UpdatedAt = ?
            WHERE CredentialId = ?`;

          await this.executeUpdate(passwordQuery, [
            credential.Password,
            currentDateTime,
            credential.Id
          ]);
        }
      }

      // 5. Handle Attachments
      if (attachments) {
        // Get current attachment IDs to track what needs to be deleted
        const currentAttachmentIds = attachments.map(a => a.Id);

        // Delete attachments that were removed (in originalAttachmentIds but not in current attachments)
        const attachmentsToDelete = originalAttachmentIds.filter(id => !currentAttachmentIds.includes(id));
        for (const attachmentId of attachmentsToDelete) {
          const deleteQuery = `
            UPDATE Attachments
            SET IsDeleted = 1,
                UpdatedAt = ?
            WHERE Id = ?`;
          await this.executeUpdate(deleteQuery, [currentDateTime, attachmentId]);
        }

        // Process each attachment
        for (const attachment of attachments) {
          const isExistingAttachment = originalAttachmentIds.includes(attachment.Id);

          if (!isExistingAttachment) {
            // Insert new attachment
            const insertQuery = `
              INSERT INTO Attachments (Id, Filename, Blob, CredentialId, CreatedAt, UpdatedAt, IsDeleted)
              VALUES (?, ?, ?, ?, ?, ?, ?)`;
            await this.executeUpdate(insertQuery, [
              attachment.Id,
              attachment.Filename,
              attachment.Blob as Uint8Array,
              credential.Id,
              currentDateTime,
              currentDateTime,
              0
            ]);
          }
        }
      }

      await NativeVaultManager.commitTransaction();
      return 1;

    } catch (error) {
      await NativeVaultManager.rollbackTransaction();
      console.error('Error updating credential:', error);
      throw error;
    }
  }
}

export default SqliteClient;