/**
 * Vault database version information
 */
type VaultVersion = {
    /**
     * The migration revision number
     */
    revision: number;
    /**
     * The internal migration version number that equals the AliasClientDb database version (e.g., "1.5.0").
     * This is not the same as the AliasVault server release version.
     */
    version: string;
    /**
     * Description of changes in this version
     */
    description: string;
    /**
     * The AliasVault release that this vault version was introduced in (e.g., "0.14.0").
     * This value is shown to the user in the UI instead of the actual vault version in order to
     * avoid potential confusion. The "version" field is the actual AliasClientDb database version. While
     * this field is just for display purposes.
     */
    releaseVersion: string;
    /**
     * The last AliasVault release version that the vault was compatible with before requiring
     * this migration. This indicates to users what version their vault was compatible up to
     * before needing to upgrade to the new migration.
     */
    compatibleUpToVersion: string;
};

/**
 * Result of SQL generation operations
 */
type SqlGenerationResult = {
    success: boolean;
    sqlCommands: string[];
    version: string;
    migrationNumber: number;
    error?: string;
};
/**
 * Information about vault version requirements
 */
type VaultVersionInfo = {
    currentVersion: string;
    currentMigrationNumber: number;
    targetVersion: string;
    targetMigrationNumber: number;
    needsUpgrade: boolean;
    availableUpgrades: VaultVersion[];
};
/**
 * Vault SQL generator utility class
 * Provides SQL statements for vault creation and migration without database execution
 */
declare class VaultSqlGenerator {
    /**
     * Get SQL commands to create a new vault with the latest schema
     */
    getCreateVaultSql(): SqlGenerationResult;
    /**
     * Get SQL commands to upgrade vault from current version to target version
     */
    getUpgradeVaultSql(currentMigrationNumber: number, targetMigrationNumber?: number): SqlGenerationResult;
    /**
     * Get SQL commands to upgrade vault to latest version
     */
    getUpgradeToLatestSql(currentMigrationNumber: number): SqlGenerationResult;
    /**
     * Get SQL commands to upgrade vault to a specific version
     */
    getUpgradeToVersionSql(currentMigrationNumber: number, targetVersion: string): SqlGenerationResult;
    /**
     * Get SQL commands to check current vault version
     */
    getVersionCheckSql(): string[];
    /**
     * Get SQL command to validate vault structure
     */
    getVaultValidationSql(): string;
    /**
     * Parse vault version information from query results
     */
    parseVaultVersionInfo(settingsTableExists: boolean, versionResult?: string, migrationResult?: string): VaultVersionInfo;
    /**
     * Validate vault structure from table names
     */
    validateVaultStructure(tableNames: string[]): boolean;
    /**
     * Get all available vault versions
     */
    getAllVersions(): VaultVersion[];
    /**
     * Get current/latest vault version info
     */
    getLatestVersion(): VaultVersion;
    /**
     * Get specific migration SQL by migration number
     */
    getMigrationSql(migrationNumber: number): string | undefined;
    /**
     * Get complete schema SQL for creating new vault
     */
    getCompleteSchemaSql(): string;
}

/**
 * Vault version information
 * Auto-generated from EF Core migration filenames
 */

/**
 * All vault migrations/versions in chronological order. When adding a new migration, make sure to
 * update the "releaseVersion" field to the correct AliasVault release version that introduced this
 * migration.
 */
declare const VAULT_VERSIONS: VaultVersion[];

/**
 * Complete database schema SQL (latest version)
 * Auto-generated from EF Core migrations
 */
declare const COMPLETE_SCHEMA_SQL = "\n\uFEFFCREATE TABLE IF NOT EXISTS \"__EFMigrationsHistory\" (\n    \"MigrationId\" TEXT NOT NULL CONSTRAINT \"PK___EFMigrationsHistory\" PRIMARY KEY,\n    \"ProductVersion\" TEXT NOT NULL\n);\n\nBEGIN TRANSACTION;\nCREATE TABLE \"Aliases\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Aliases\" PRIMARY KEY,\n    \"Gender\" VARCHAR NULL,\n    \"FirstName\" VARCHAR NULL,\n    \"LastName\" VARCHAR NULL,\n    \"NickName\" VARCHAR NULL,\n    \"BirthDate\" TEXT NOT NULL,\n    \"AddressStreet\" VARCHAR NULL,\n    \"AddressCity\" VARCHAR NULL,\n    \"AddressState\" VARCHAR NULL,\n    \"AddressZipCode\" VARCHAR NULL,\n    \"AddressCountry\" VARCHAR NULL,\n    \"Hobbies\" TEXT NULL,\n    \"EmailPrefix\" TEXT NULL,\n    \"PhoneMobile\" TEXT NULL,\n    \"BankAccountIBAN\" TEXT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL\n);\n\nCREATE TABLE \"Services\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Services\" PRIMARY KEY,\n    \"Name\" TEXT NULL,\n    \"Url\" TEXT NULL,\n    \"Logo\" BLOB NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL\n);\n\nCREATE TABLE \"Credentials\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Credentials\" PRIMARY KEY,\n    \"AliasId\" TEXT NOT NULL,\n    \"Notes\" TEXT NULL,\n    \"Username\" TEXT NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"ServiceId\" TEXT NOT NULL,\n    CONSTRAINT \"FK_Credentials_Aliases_AliasId\" FOREIGN KEY (\"AliasId\") REFERENCES \"Aliases\" (\"Id\") ON DELETE CASCADE,\n    CONSTRAINT \"FK_Credentials_Services_ServiceId\" FOREIGN KEY (\"ServiceId\") REFERENCES \"Services\" (\"Id\") ON DELETE CASCADE\n);\n\nCREATE TABLE \"Attachment\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Attachment\" PRIMARY KEY,\n    \"Filename\" TEXT NOT NULL,\n    \"Blob\" BLOB NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"CredentialId\" TEXT NOT NULL,\n    CONSTRAINT \"FK_Attachment_Credentials_CredentialId\" FOREIGN KEY (\"CredentialId\") REFERENCES \"Credentials\" (\"Id\") ON DELETE CASCADE\n);\n\nCREATE TABLE \"Passwords\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Passwords\" PRIMARY KEY,\n    \"Value\" TEXT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"CredentialId\" TEXT NOT NULL,\n    CONSTRAINT \"FK_Passwords_Credentials_CredentialId\" FOREIGN KEY (\"CredentialId\") REFERENCES \"Credentials\" (\"Id\") ON DELETE CASCADE\n);\n\nCREATE INDEX \"IX_Attachment_CredentialId\" ON \"Attachment\" (\"CredentialId\");\n\nCREATE INDEX \"IX_Credentials_AliasId\" ON \"Credentials\" (\"AliasId\");\n\nCREATE INDEX \"IX_Credentials_ServiceId\" ON \"Credentials\" (\"ServiceId\");\n\nCREATE INDEX \"IX_Passwords_CredentialId\" ON \"Passwords\" (\"CredentialId\");\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240708094944_1.0.0-InitialMigration', '9.0.4');\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240708224522_1.0.1-EmptyTestMigration', '9.0.4');\n\nALTER TABLE \"Aliases\" RENAME COLUMN \"EmailPrefix\" TO \"Email\";\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240711204207_1.0.2-ChangeEmailColumn', '9.0.4');\n\nCREATE TABLE \"EncryptionKeys\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_EncryptionKeys\" PRIMARY KEY,\n    \"PublicKey\" TEXT NOT NULL,\n    \"PrivateKey\" TEXT NOT NULL,\n    \"IsPrimary\" INTEGER NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL\n);\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240729105618_1.1.0-AddPkiTables', '9.0.4');\n\nCREATE TABLE \"Settings\" (\n    \"Key\" TEXT NOT NULL CONSTRAINT \"PK_Settings\" PRIMARY KEY,\n    \"Value\" TEXT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL\n);\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240805073413_1.2.0-AddSettingsTable', '9.0.4');\n\nCREATE TABLE \"ef_temp_Aliases\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Aliases\" PRIMARY KEY,\n    \"BirthDate\" TEXT NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"Email\" TEXT NULL,\n    \"FirstName\" VARCHAR NULL,\n    \"Gender\" VARCHAR NULL,\n    \"LastName\" VARCHAR NULL,\n    \"NickName\" VARCHAR NULL,\n    \"UpdatedAt\" TEXT NOT NULL\n);\n\nINSERT INTO \"ef_temp_Aliases\" (\"Id\", \"BirthDate\", \"CreatedAt\", \"Email\", \"FirstName\", \"Gender\", \"LastName\", \"NickName\", \"UpdatedAt\")\nSELECT \"Id\", \"BirthDate\", \"CreatedAt\", \"Email\", \"FirstName\", \"Gender\", \"LastName\", \"NickName\", \"UpdatedAt\"\nFROM \"Aliases\";\n\nCOMMIT;\n\nPRAGMA foreign_keys = 0;\n\nBEGIN TRANSACTION;\nDROP TABLE \"Aliases\";\n\nALTER TABLE \"ef_temp_Aliases\" RENAME TO \"Aliases\";\n\nCOMMIT;\n\nPRAGMA foreign_keys = 1;\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240805122422_1.3.0-UpdateIdentityStructure', '9.0.4');\n\nBEGIN TRANSACTION;\nCREATE TABLE \"ef_temp_Credentials\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Credentials\" PRIMARY KEY,\n    \"AliasId\" TEXT NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"Notes\" TEXT NULL,\n    \"ServiceId\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"Username\" TEXT NULL,\n    CONSTRAINT \"FK_Credentials_Aliases_AliasId\" FOREIGN KEY (\"AliasId\") REFERENCES \"Aliases\" (\"Id\") ON DELETE CASCADE,\n    CONSTRAINT \"FK_Credentials_Services_ServiceId\" FOREIGN KEY (\"ServiceId\") REFERENCES \"Services\" (\"Id\") ON DELETE CASCADE\n);\n\nINSERT INTO \"ef_temp_Credentials\" (\"Id\", \"AliasId\", \"CreatedAt\", \"Notes\", \"ServiceId\", \"UpdatedAt\", \"Username\")\nSELECT \"Id\", \"AliasId\", \"CreatedAt\", \"Notes\", \"ServiceId\", \"UpdatedAt\", \"Username\"\nFROM \"Credentials\";\n\nCOMMIT;\n\nPRAGMA foreign_keys = 0;\n\nBEGIN TRANSACTION;\nDROP TABLE \"Credentials\";\n\nALTER TABLE \"ef_temp_Credentials\" RENAME TO \"Credentials\";\n\nCOMMIT;\n\nPRAGMA foreign_keys = 1;\n\nBEGIN TRANSACTION;\nCREATE INDEX \"IX_Credentials_AliasId\" ON \"Credentials\" (\"AliasId\");\n\nCREATE INDEX \"IX_Credentials_ServiceId\" ON \"Credentials\" (\"ServiceId\");\n\nCOMMIT;\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240812141727_1.3.1-MakeUsernameOptional', '9.0.4');\n\nBEGIN TRANSACTION;\nALTER TABLE \"Settings\" ADD \"IsDeleted\" INTEGER NOT NULL DEFAULT 0;\n\nALTER TABLE \"Services\" ADD \"IsDeleted\" INTEGER NOT NULL DEFAULT 0;\n\nALTER TABLE \"Passwords\" ADD \"IsDeleted\" INTEGER NOT NULL DEFAULT 0;\n\nALTER TABLE \"EncryptionKeys\" ADD \"IsDeleted\" INTEGER NOT NULL DEFAULT 0;\n\nALTER TABLE \"Credentials\" ADD \"IsDeleted\" INTEGER NOT NULL DEFAULT 0;\n\nALTER TABLE \"Attachment\" ADD \"IsDeleted\" INTEGER NOT NULL DEFAULT 0;\n\nALTER TABLE \"Aliases\" ADD \"IsDeleted\" INTEGER NOT NULL DEFAULT 0;\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240916105320_1.4.0-AddSyncSupport', '9.0.4');\n\nALTER TABLE \"Attachment\" RENAME TO \"Attachments\";\n\nCREATE TABLE \"ef_temp_Attachments\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Attachments\" PRIMARY KEY,\n    \"Blob\" BLOB NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"CredentialId\" TEXT NOT NULL,\n    \"Filename\" TEXT NOT NULL,\n    \"IsDeleted\" INTEGER NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    CONSTRAINT \"FK_Attachments_Credentials_CredentialId\" FOREIGN KEY (\"CredentialId\") REFERENCES \"Credentials\" (\"Id\") ON DELETE CASCADE\n);\n\nINSERT INTO \"ef_temp_Attachments\" (\"Id\", \"Blob\", \"CreatedAt\", \"CredentialId\", \"Filename\", \"IsDeleted\", \"UpdatedAt\")\nSELECT \"Id\", \"Blob\", \"CreatedAt\", \"CredentialId\", \"Filename\", \"IsDeleted\", \"UpdatedAt\"\nFROM \"Attachments\";\n\nCOMMIT;\n\nPRAGMA foreign_keys = 0;\n\nBEGIN TRANSACTION;\nDROP TABLE \"Attachments\";\n\nALTER TABLE \"ef_temp_Attachments\" RENAME TO \"Attachments\";\n\nCOMMIT;\n\nPRAGMA foreign_keys = 1;\n\nBEGIN TRANSACTION;\nCREATE INDEX \"IX_Attachments_CredentialId\" ON \"Attachments\" (\"CredentialId\");\n\nCOMMIT;\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240917191243_1.4.1-RenameAttachmentsPlural', '9.0.4');\n\nBEGIN TRANSACTION;\nCREATE TABLE \"TotpCodes\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_TotpCodes\" PRIMARY KEY,\n    \"Name\" TEXT NOT NULL,\n    \"SecretKey\" TEXT NOT NULL,\n    \"CredentialId\" TEXT NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"IsDeleted\" INTEGER NOT NULL,\n    CONSTRAINT \"FK_TotpCodes_Credentials_CredentialId\" FOREIGN KEY (\"CredentialId\") REFERENCES \"Credentials\" (\"Id\") ON DELETE CASCADE\n);\n\nCREATE INDEX \"IX_TotpCodes_CredentialId\" ON \"TotpCodes\" (\"CredentialId\");\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20250310131554_1.5.0-AddTotpCodes', '9.0.4');\n\nCREATE TABLE \"Passkeys\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Passkeys\" PRIMARY KEY,\n    \"CredentialId\" TEXT NOT NULL,\n    \"RpId\" TEXT COLLATE NOCASE NOT NULL,\n    \"UserId\" TEXT NULL,\n    \"PublicKey\" TEXT NOT NULL,\n    \"PrivateKey\" TEXT NOT NULL,\n    \"DisplayName\" TEXT NOT NULL,\n    \"AdditionalData\" BLOB NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"IsDeleted\" INTEGER NOT NULL,\n    CONSTRAINT \"FK_Passkeys_Credentials_CredentialId\" FOREIGN KEY (\"CredentialId\") REFERENCES \"Credentials\" (\"Id\") ON DELETE CASCADE\n);\n\nCREATE INDEX \"IX_Passkeys_CredentialId\" ON \"Passkeys\" (\"CredentialId\");\n\nCREATE INDEX \"IX_Passkeys_RpId\" ON \"Passkeys\" (\"RpId\");\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20251003045732_1.6.0-AddPasskeys', '9.0.4');\n\nCOMMIT;\n";
/**
 * Individual migration SQL scripts
 * Auto-generated from EF Core migrations
 */
declare const MIGRATION_SCRIPTS: Record<number, string>;

/**
 * Creates a new VaultSqlGenerator instance.
 * @returns A new VaultSqlGenerator instance.
 */
declare const CreateVaultSqlGenerator: () => VaultSqlGenerator;

export { COMPLETE_SCHEMA_SQL, CreateVaultSqlGenerator, MIGRATION_SCRIPTS, type SqlGenerationResult, VAULT_VERSIONS, VaultSqlGenerator, type VaultVersion, type VaultVersionInfo };
