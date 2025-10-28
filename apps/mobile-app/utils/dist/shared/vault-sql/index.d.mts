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
declare const COMPLETE_SCHEMA_SQL = "\n\uFEFFCREATE TABLE IF NOT EXISTS \"__EFMigrationsHistory\" (\n    \"MigrationId\" TEXT NOT NULL CONSTRAINT \"PK___EFMigrationsHistory\" PRIMARY KEY,\n    \"ProductVersion\" TEXT NOT NULL\n);\n\nBEGIN TRANSACTION;\nCREATE TABLE \"Aliases\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Aliases\" PRIMARY KEY,\n    \"Gender\" VARCHAR NULL,\n    \"FirstName\" VARCHAR NULL,\n    \"LastName\" VARCHAR NULL,\n    \"NickName\" VARCHAR NULL,\n    \"BirthDate\" TEXT NOT NULL,\n    \"AddressStreet\" VARCHAR NULL,\n    \"AddressCity\" VARCHAR NULL,\n    \"AddressState\" VARCHAR NULL,\n    \"AddressZipCode\" VARCHAR NULL,\n    \"AddressCountry\" VARCHAR NULL,\n    \"Hobbies\" TEXT NULL,\n    \"EmailPrefix\" TEXT NULL,\n    \"PhoneMobile\" TEXT NULL,\n    \"BankAccountIBAN\" TEXT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL\n);\n\nCREATE TABLE \"Services\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Services\" PRIMARY KEY,\n    \"Name\" TEXT NULL,\n    \"Url\" TEXT NULL,\n    \"Logo\" BLOB NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL\n);\n\nCREATE TABLE \"Credentials\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Credentials\" PRIMARY KEY,\n    \"AliasId\" TEXT NOT NULL,\n    \"Notes\" TEXT NULL,\n    \"Username\" TEXT NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"ServiceId\" TEXT NOT NULL,\n    CONSTRAINT \"FK_Credentials_Aliases_AliasId\" FOREIGN KEY (\"AliasId\") REFERENCES \"Aliases\" (\"Id\") ON DELETE CASCADE,\n    CONSTRAINT \"FK_Credentials_Services_ServiceId\" FOREIGN KEY (\"ServiceId\") REFERENCES \"Services\" (\"Id\") ON DELETE CASCADE\n);\n\nCREATE TABLE \"Attachment\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Attachment\" PRIMARY KEY,\n    \"Filename\" TEXT NOT NULL,\n    \"Blob\" BLOB NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"CredentialId\" TEXT NOT NULL,\n    CONSTRAINT \"FK_Attachment_Credentials_CredentialId\" FOREIGN KEY (\"CredentialId\") REFERENCES \"Credentials\" (\"Id\") ON DELETE CASCADE\n);\n\nCREATE TABLE \"Passwords\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Passwords\" PRIMARY KEY,\n    \"Value\" TEXT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"CredentialId\" TEXT NOT NULL,\n    CONSTRAINT \"FK_Passwords_Credentials_CredentialId\" FOREIGN KEY (\"CredentialId\") REFERENCES \"Credentials\" (\"Id\") ON DELETE CASCADE\n);\n\nCREATE INDEX \"IX_Attachment_CredentialId\" ON \"Attachment\" (\"CredentialId\");\n\nCREATE INDEX \"IX_Credentials_AliasId\" ON \"Credentials\" (\"AliasId\");\n\nCREATE INDEX \"IX_Credentials_ServiceId\" ON \"Credentials\" (\"ServiceId\");\n\nCREATE INDEX \"IX_Passwords_CredentialId\" ON \"Passwords\" (\"CredentialId\");\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240708094944_1.0.0-InitialMigration', '9.0.4');\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240708224522_1.0.1-EmptyTestMigration', '9.0.4');\n\nALTER TABLE \"Aliases\" RENAME COLUMN \"EmailPrefix\" TO \"Email\";\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240711204207_1.0.2-ChangeEmailColumn', '9.0.4');\n\nCREATE TABLE \"EncryptionKeys\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_EncryptionKeys\" PRIMARY KEY,\n    \"PublicKey\" TEXT NOT NULL,\n    \"PrivateKey\" TEXT NOT NULL,\n    \"IsPrimary\" INTEGER NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL\n);\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240729105618_1.1.0-AddPkiTables', '9.0.4');\n\nCREATE TABLE \"Settings\" (\n    \"Key\" TEXT NOT NULL CONSTRAINT \"PK_Settings\" PRIMARY KEY,\n    \"Value\" TEXT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL\n);\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240805073413_1.2.0-AddSettingsTable', '9.0.4');\n\nCREATE TABLE \"ef_temp_Aliases\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Aliases\" PRIMARY KEY,\n    \"BirthDate\" TEXT NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"Email\" TEXT NULL,\n    \"FirstName\" VARCHAR NULL,\n    \"Gender\" VARCHAR NULL,\n    \"LastName\" VARCHAR NULL,\n    \"NickName\" VARCHAR NULL,\n    \"UpdatedAt\" TEXT NOT NULL\n);\n\nINSERT INTO \"ef_temp_Aliases\" (\"Id\", \"BirthDate\", \"CreatedAt\", \"Email\", \"FirstName\", \"Gender\", \"LastName\", \"NickName\", \"UpdatedAt\")\nSELECT \"Id\", \"BirthDate\", \"CreatedAt\", \"Email\", \"FirstName\", \"Gender\", \"LastName\", \"NickName\", \"UpdatedAt\"\nFROM \"Aliases\";\n\nCOMMIT;\n\nPRAGMA foreign_keys = 0;\n\nBEGIN TRANSACTION;\nDROP TABLE \"Aliases\";\n\nALTER TABLE \"ef_temp_Aliases\" RENAME TO \"Aliases\";\n\nCOMMIT;\n\nPRAGMA foreign_keys = 1;\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240805122422_1.3.0-UpdateIdentityStructure', '9.0.4');\n\nBEGIN TRANSACTION;\nCREATE TABLE \"ef_temp_Credentials\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Credentials\" PRIMARY KEY,\n    \"AliasId\" TEXT NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"Notes\" TEXT NULL,\n    \"ServiceId\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"Username\" TEXT NULL,\n    CONSTRAINT \"FK_Credentials_Aliases_AliasId\" FOREIGN KEY (\"AliasId\") REFERENCES \"Aliases\" (\"Id\") ON DELETE CASCADE,\n    CONSTRAINT \"FK_Credentials_Services_ServiceId\" FOREIGN KEY (\"ServiceId\") REFERENCES \"Services\" (\"Id\") ON DELETE CASCADE\n);\n\nINSERT INTO \"ef_temp_Credentials\" (\"Id\", \"AliasId\", \"CreatedAt\", \"Notes\", \"ServiceId\", \"UpdatedAt\", \"Username\")\nSELECT \"Id\", \"AliasId\", \"CreatedAt\", \"Notes\", \"ServiceId\", \"UpdatedAt\", \"Username\"\nFROM \"Credentials\";\n\nCOMMIT;\n\nPRAGMA foreign_keys = 0;\n\nBEGIN TRANSACTION;\nDROP TABLE \"Credentials\";\n\nALTER TABLE \"ef_temp_Credentials\" RENAME TO \"Credentials\";\n\nCOMMIT;\n\nPRAGMA foreign_keys = 1;\n\nBEGIN TRANSACTION;\nCREATE INDEX \"IX_Credentials_AliasId\" ON \"Credentials\" (\"AliasId\");\n\nCREATE INDEX \"IX_Credentials_ServiceId\" ON \"Credentials\" (\"ServiceId\");\n\nCOMMIT;\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240812141727_1.3.1-MakeUsernameOptional', '9.0.4');\n\nBEGIN TRANSACTION;\nALTER TABLE \"Settings\" ADD \"IsDeleted\" INTEGER NOT NULL DEFAULT 0;\n\nALTER TABLE \"Services\" ADD \"IsDeleted\" INTEGER NOT NULL DEFAULT 0;\n\nALTER TABLE \"Passwords\" ADD \"IsDeleted\" INTEGER NOT NULL DEFAULT 0;\n\nALTER TABLE \"EncryptionKeys\" ADD \"IsDeleted\" INTEGER NOT NULL DEFAULT 0;\n\nALTER TABLE \"Credentials\" ADD \"IsDeleted\" INTEGER NOT NULL DEFAULT 0;\n\nALTER TABLE \"Attachment\" ADD \"IsDeleted\" INTEGER NOT NULL DEFAULT 0;\n\nALTER TABLE \"Aliases\" ADD \"IsDeleted\" INTEGER NOT NULL DEFAULT 0;\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240916105320_1.4.0-AddSyncSupport', '9.0.4');\n\nALTER TABLE \"Attachment\" RENAME TO \"Attachments\";\n\nCREATE TABLE \"ef_temp_Attachments\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Attachments\" PRIMARY KEY,\n    \"Blob\" BLOB NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"CredentialId\" TEXT NOT NULL,\n    \"Filename\" TEXT NOT NULL,\n    \"IsDeleted\" INTEGER NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    CONSTRAINT \"FK_Attachments_Credentials_CredentialId\" FOREIGN KEY (\"CredentialId\") REFERENCES \"Credentials\" (\"Id\") ON DELETE CASCADE\n);\n\nINSERT INTO \"ef_temp_Attachments\" (\"Id\", \"Blob\", \"CreatedAt\", \"CredentialId\", \"Filename\", \"IsDeleted\", \"UpdatedAt\")\nSELECT \"Id\", \"Blob\", \"CreatedAt\", \"CredentialId\", \"Filename\", \"IsDeleted\", \"UpdatedAt\"\nFROM \"Attachments\";\n\nCOMMIT;\n\nPRAGMA foreign_keys = 0;\n\nBEGIN TRANSACTION;\nDROP TABLE \"Attachments\";\n\nALTER TABLE \"ef_temp_Attachments\" RENAME TO \"Attachments\";\n\nCOMMIT;\n\nPRAGMA foreign_keys = 1;\n\nBEGIN TRANSACTION;\nCREATE INDEX \"IX_Attachments_CredentialId\" ON \"Attachments\" (\"CredentialId\");\n\nCOMMIT;\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20240917191243_1.4.1-RenameAttachmentsPlural', '9.0.4');\n\nBEGIN TRANSACTION;\nCREATE TABLE \"TotpCodes\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_TotpCodes\" PRIMARY KEY,\n    \"Name\" TEXT NOT NULL,\n    \"SecretKey\" TEXT NOT NULL,\n    \"CredentialId\" TEXT NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"IsDeleted\" INTEGER NOT NULL,\n    CONSTRAINT \"FK_TotpCodes_Credentials_CredentialId\" FOREIGN KEY (\"CredentialId\") REFERENCES \"Credentials\" (\"Id\") ON DELETE CASCADE\n);\n\nCREATE INDEX \"IX_TotpCodes_CredentialId\" ON \"TotpCodes\" (\"CredentialId\");\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20250310131554_1.5.0-AddTotpCodes', '9.0.4');\n\n\nPRAGMA foreign_keys = OFF;\n\n-- Clean up any existing temp tables first\nDROP TABLE IF EXISTS \"__EFMigrationsHistory_temp\";\nDROP TABLE IF EXISTS \"Aliases_temp\";\nDROP TABLE IF EXISTS \"Services_temp\";\nDROP TABLE IF EXISTS \"EncryptionKeys_temp\";\nDROP TABLE IF EXISTS \"Settings_temp\";\nDROP TABLE IF EXISTS \"Credentials_temp\";\nDROP TABLE IF EXISTS \"Attachments_temp\";\nDROP TABLE IF EXISTS \"Passwords_temp\";\nDROP TABLE IF EXISTS \"TotpCodes_temp\";\n\n-- Create backup tables for all data\nCREATE TABLE \"__EFMigrationsHistory_temp\" AS SELECT * FROM \"__EFMigrationsHistory\";\nCREATE TABLE \"Aliases_temp\" AS SELECT * FROM \"Aliases\";\nCREATE TABLE \"Services_temp\" AS SELECT * FROM \"Services\";\nCREATE TABLE \"EncryptionKeys_temp\" AS SELECT * FROM \"EncryptionKeys\";\nCREATE TABLE \"Settings_temp\" AS SELECT * FROM \"Settings\";\nCREATE TABLE \"Credentials_temp\" AS SELECT * FROM \"Credentials\";\nCREATE TABLE \"Attachments_temp\" AS SELECT * FROM \"Attachments\";\nCREATE TABLE \"Passwords_temp\" AS SELECT * FROM \"Passwords\";\nCREATE TABLE \"TotpCodes_temp\" AS SELECT * FROM \"TotpCodes\";\n\n-- Delete orphaned records that do not have a valid FK to the credential object\nDELETE FROM \"Attachments_temp\" WHERE \"CredentialId\" NOT IN (SELECT \"Id\" FROM \"Credentials_temp\");\nDELETE FROM \"Passwords_temp\" WHERE \"CredentialId\" NOT IN (SELECT \"Id\" FROM \"Credentials_temp\");\nDELETE FROM \"TotpCodes_temp\" WHERE \"CredentialId\" NOT IN (SELECT \"Id\" FROM \"Credentials_temp\");\n\n-- Delete orphaned credentials that do not have valid FKs to alias or service objects\nDELETE FROM \"Credentials_temp\" WHERE \"AliasId\" NOT IN (SELECT \"Id\" FROM \"Aliases_temp\");\nDELETE FROM \"Credentials_temp\" WHERE \"ServiceId\" NOT IN (SELECT \"Id\" FROM \"Services_temp\");\n\n-- After cleaning credentials, clean dependent tables again in case we removed credentials\nDELETE FROM \"Attachments_temp\" WHERE \"CredentialId\" NOT IN (SELECT \"Id\" FROM \"Credentials_temp\");\nDELETE FROM \"Passwords_temp\" WHERE \"CredentialId\" NOT IN (SELECT \"Id\" FROM \"Credentials_temp\");\nDELETE FROM \"TotpCodes_temp\" WHERE \"CredentialId\" NOT IN (SELECT \"Id\" FROM \"Credentials_temp\");\n\n-- Drop all existing tables\nDROP TABLE \"TotpCodes\";\nDROP TABLE \"Passwords\";\nDROP TABLE \"Attachments\";\nDROP TABLE \"Credentials\";\nDROP TABLE \"Settings\";\nDROP TABLE \"EncryptionKeys\";\nDROP TABLE \"Services\";\nDROP TABLE \"Aliases\";\nDROP TABLE \"__EFMigrationsHistory\";\n\n-- Recreate tables with proper constraints (no dependencies first)\nCREATE TABLE \"__EFMigrationsHistory\" (\n    \"MigrationId\" TEXT NOT NULL CONSTRAINT \"PK___EFMigrationsHistory\" PRIMARY KEY,\n    \"ProductVersion\" TEXT NOT NULL\n);\n\nCREATE TABLE \"Aliases\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Aliases\" PRIMARY KEY,\n    \"BirthDate\" TEXT NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"Email\" TEXT NULL,\n    \"FirstName\" VARCHAR NULL,\n    \"Gender\" VARCHAR NULL,\n    \"LastName\" VARCHAR NULL,\n    \"NickName\" VARCHAR NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"IsDeleted\" INTEGER NOT NULL DEFAULT 0\n);\n\nCREATE TABLE \"Services\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Services\" PRIMARY KEY,\n    \"Name\" TEXT NULL,\n    \"Url\" TEXT NULL,\n    \"Logo\" BLOB NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"IsDeleted\" INTEGER NOT NULL DEFAULT 0\n);\n\nCREATE TABLE \"EncryptionKeys\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_EncryptionKeys\" PRIMARY KEY,\n    \"PublicKey\" TEXT NOT NULL,\n    \"PrivateKey\" TEXT NOT NULL,\n    \"IsPrimary\" INTEGER NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"IsDeleted\" INTEGER NOT NULL DEFAULT 0\n);\n\nCREATE TABLE \"Settings\" (\n    \"Key\" TEXT NOT NULL CONSTRAINT \"PK_Settings\" PRIMARY KEY,\n    \"Value\" TEXT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"IsDeleted\" INTEGER NOT NULL DEFAULT 0\n);\n\n-- Tables with foreign keys\nCREATE TABLE \"Credentials\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Credentials\" PRIMARY KEY,\n    \"AliasId\" TEXT NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"Notes\" TEXT NULL,\n    \"ServiceId\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"Username\" TEXT NULL,\n    \"IsDeleted\" INTEGER NOT NULL DEFAULT 0,\n    CONSTRAINT \"FK_Credentials_Aliases_AliasId\" FOREIGN KEY (\"AliasId\") REFERENCES \"Aliases\" (\"Id\") ON DELETE CASCADE,\n    CONSTRAINT \"FK_Credentials_Services_ServiceId\" FOREIGN KEY (\"ServiceId\") REFERENCES \"Services\" (\"Id\") ON DELETE CASCADE\n);\n\nCREATE TABLE \"Attachments\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Attachments\" PRIMARY KEY,\n    \"Blob\" BLOB NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"CredentialId\" TEXT NOT NULL,\n    \"Filename\" TEXT NOT NULL,\n    \"IsDeleted\" INTEGER NOT NULL DEFAULT 0,\n    \"UpdatedAt\" TEXT NOT NULL,\n    CONSTRAINT \"FK_Attachments_Credentials_CredentialId\" FOREIGN KEY (\"CredentialId\") REFERENCES \"Credentials\" (\"Id\") ON DELETE CASCADE\n);\n\nCREATE TABLE \"Passwords\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Passwords\" PRIMARY KEY,\n    \"Value\" TEXT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"CredentialId\" TEXT NOT NULL,\n    \"IsDeleted\" INTEGER NOT NULL DEFAULT 0,\n    CONSTRAINT \"FK_Passwords_Credentials_CredentialId\" FOREIGN KEY (\"CredentialId\") REFERENCES \"Credentials\" (\"Id\") ON DELETE CASCADE\n);\n\nCREATE TABLE \"TotpCodes\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_TotpCodes\" PRIMARY KEY,\n    \"Name\" TEXT NOT NULL,\n    \"SecretKey\" TEXT NOT NULL,\n    \"CredentialId\" TEXT NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"IsDeleted\" INTEGER NOT NULL DEFAULT 0,\n    CONSTRAINT \"FK_TotpCodes_Credentials_CredentialId\" FOREIGN KEY (\"CredentialId\") REFERENCES \"Credentials\" (\"Id\") ON DELETE CASCADE\n);\n\n\n-- Restore data from temp tables\nINSERT INTO \"__EFMigrationsHistory\" SELECT * FROM \"__EFMigrationsHistory_temp\";\nINSERT INTO \"Aliases\" SELECT * FROM \"Aliases_temp\";\nINSERT INTO \"Services\" SELECT * FROM \"Services_temp\";\nINSERT INTO \"EncryptionKeys\" SELECT * FROM \"EncryptionKeys_temp\";\nINSERT INTO \"Settings\" SELECT * FROM \"Settings_temp\";\nINSERT INTO \"Credentials\" SELECT * FROM \"Credentials_temp\";\nINSERT INTO \"Attachments\" SELECT * FROM \"Attachments_temp\";\nINSERT INTO \"Passwords\" SELECT * FROM \"Passwords_temp\";\nINSERT INTO \"TotpCodes\" SELECT * FROM \"TotpCodes_temp\";\n\n-- =====================================================================================\n-- Date Format Normalization Migration\n-- =====================================================================================\n-- This migration normalizes ALL date fields to the standard format: 'yyyy-MM-dd HH:mm:ss.fff'\n-- Previously the different clients used different date formats which complicate date parsing.\n-- From version 0.24.0 onwards, all new dates are stored in this standard format.\n\n-- Update Aliases table (CreatedAt, UpdatedAt, BirthDate)\nUPDATE \"Aliases\" SET \"CreatedAt\" =\n    CASE\n        -- Already in correct format (yyyy-MM-dd HH:mm:ss.fff) - no change\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"CreatedAt\"\n\n        -- ISO 8601 with milliseconds (yyyy-MM-ddTHH:mm:ss.fffZ) -> Replace T with space, remove Z and everything after .fff\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(\"CreatedAt\", 12, 12)\n\n        -- Without milliseconds (yyyy-MM-dd HH:mm:ss or yyyy-MM-ddTHH:mm:ssZ) -> Add .000\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(replace(\"CreatedAt\", 'T', ' '), 12, 8) || '.000'\n\n        -- Fallback: if none match, keep as-is (edge case)\n        ELSE \"CreatedAt\"\n    END;\n\nUPDATE \"Aliases\" SET \"UpdatedAt\" =\n    CASE\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"UpdatedAt\"\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(\"UpdatedAt\", 12, 12)\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(replace(\"UpdatedAt\", 'T', ' '), 12, 8) || '.000'\n        ELSE \"UpdatedAt\"\n    END;\n\n-- BirthDate: Always set time to 00:00:00 (no milliseconds for birth dates)\nUPDATE \"Aliases\" SET \"BirthDate\" =\n    CASE\n        -- If empty or already '0001-01-01 00:00:00', keep as-is\n        WHEN \"BirthDate\" = '' OR \"BirthDate\" = '0001-01-01 00:00:00'\n            THEN \"BirthDate\"\n\n        -- If already in correct format (yyyy-MM-dd 00:00:00), keep as-is\n        WHEN \"BirthDate\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] 00:00:00'\n            THEN \"BirthDate\"\n\n        -- Extract date part and set time to 00:00:00\n        WHEN \"BirthDate\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'\n            THEN substr(\"BirthDate\", 1, 10) || ' 00:00:00'\n\n        -- Fallback\n        ELSE \"BirthDate\"\n    END;\n\n-- Update Services table (CreatedAt, UpdatedAt)\nUPDATE \"Services\" SET \"CreatedAt\" =\n    CASE\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"CreatedAt\"\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(\"CreatedAt\", 12, 12)\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(replace(\"CreatedAt\", 'T', ' '), 12, 8) || '.000'\n        ELSE \"CreatedAt\"\n    END;\n\nUPDATE \"Services\" SET \"UpdatedAt\" =\n    CASE\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"UpdatedAt\"\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(\"UpdatedAt\", 12, 12)\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(replace(\"UpdatedAt\", 'T', ' '), 12, 8) || '.000'\n        ELSE \"UpdatedAt\"\n    END;\n\n-- Update EncryptionKeys table (CreatedAt, UpdatedAt)\nUPDATE \"EncryptionKeys\" SET \"CreatedAt\" =\n    CASE\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"CreatedAt\"\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(\"CreatedAt\", 12, 12)\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(replace(\"CreatedAt\", 'T', ' '), 12, 8) || '.000'\n        ELSE \"CreatedAt\"\n    END;\n\nUPDATE \"EncryptionKeys\" SET \"UpdatedAt\" =\n    CASE\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"UpdatedAt\"\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(\"UpdatedAt\", 12, 12)\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(replace(\"UpdatedAt\", 'T', ' '), 12, 8) || '.000'\n        ELSE \"UpdatedAt\"\n    END;\n\n-- Update Settings table (CreatedAt, UpdatedAt)\nUPDATE \"Settings\" SET \"CreatedAt\" =\n    CASE\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"CreatedAt\"\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(\"CreatedAt\", 12, 12)\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(replace(\"CreatedAt\", 'T', ' '), 12, 8) || '.000'\n        ELSE \"CreatedAt\"\n    END;\n\nUPDATE \"Settings\" SET \"UpdatedAt\" =\n    CASE\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"UpdatedAt\"\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(\"UpdatedAt\", 12, 12)\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(replace(\"UpdatedAt\", 'T', ' '), 12, 8) || '.000'\n        ELSE \"UpdatedAt\"\n    END;\n\n-- Update Credentials table (CreatedAt, UpdatedAt)\nUPDATE \"Credentials\" SET \"CreatedAt\" =\n    CASE\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"CreatedAt\"\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(\"CreatedAt\", 12, 12)\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(replace(\"CreatedAt\", 'T', ' '), 12, 8) || '.000'\n        ELSE \"CreatedAt\"\n    END;\n\nUPDATE \"Credentials\" SET \"UpdatedAt\" =\n    CASE\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"UpdatedAt\"\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(\"UpdatedAt\", 12, 12)\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(replace(\"UpdatedAt\", 'T', ' '), 12, 8) || '.000'\n        ELSE \"UpdatedAt\"\n    END;\n\n-- Update Attachments table (CreatedAt, UpdatedAt)\nUPDATE \"Attachments\" SET \"CreatedAt\" =\n    CASE\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"CreatedAt\"\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(\"CreatedAt\", 12, 12)\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(replace(\"CreatedAt\", 'T', ' '), 12, 8) || '.000'\n        ELSE \"CreatedAt\"\n    END;\n\nUPDATE \"Attachments\" SET \"UpdatedAt\" =\n    CASE\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"UpdatedAt\"\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(\"UpdatedAt\", 12, 12)\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(replace(\"UpdatedAt\", 'T', ' '), 12, 8) || '.000'\n        ELSE \"UpdatedAt\"\n    END;\n\n-- Update Passwords table (CreatedAt, UpdatedAt)\nUPDATE \"Passwords\" SET \"CreatedAt\" =\n    CASE\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"CreatedAt\"\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(\"CreatedAt\", 12, 12)\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(replace(\"CreatedAt\", 'T', ' '), 12, 8) || '.000'\n        ELSE \"CreatedAt\"\n    END;\n\nUPDATE \"Passwords\" SET \"UpdatedAt\" =\n    CASE\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"UpdatedAt\"\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(\"UpdatedAt\", 12, 12)\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(replace(\"UpdatedAt\", 'T', ' '), 12, 8) || '.000'\n        ELSE \"UpdatedAt\"\n    END;\n\n-- Update TotpCodes table (CreatedAt, UpdatedAt)\nUPDATE \"TotpCodes\" SET \"CreatedAt\" =\n    CASE\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"CreatedAt\"\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(\"CreatedAt\", 12, 12)\n        WHEN \"CreatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"CreatedAt\", 1, 10) || ' ' || substr(replace(\"CreatedAt\", 'T', ' '), 12, 8) || '.000'\n        ELSE \"CreatedAt\"\n    END;\n\nUPDATE \"TotpCodes\" SET \"UpdatedAt\" =\n    CASE\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]'\n            THEN \"UpdatedAt\"\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(\"UpdatedAt\", 12, 12)\n        WHEN \"UpdatedAt\" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9][T ][0-9][0-9]:[0-9][0-9]:[0-9][0-9]*'\n            THEN substr(\"UpdatedAt\", 1, 10) || ' ' || substr(replace(\"UpdatedAt\", 'T', ' '), 12, 8) || '.000'\n        ELSE \"UpdatedAt\"\n    END;\n\n-- =====================================================================================\n-- End of Date Format Normalization Migration\n-- =====================================================================================\n\n-- Recreate indexes\nCREATE INDEX \"IX_Credentials_AliasId\" ON \"Credentials\" (\"AliasId\");\nCREATE INDEX \"IX_Credentials_ServiceId\" ON \"Credentials\" (\"ServiceId\");\nCREATE INDEX \"IX_Attachments_CredentialId\" ON \"Attachments\" (\"CredentialId\");\nCREATE INDEX \"IX_Passwords_CredentialId\" ON \"Passwords\" (\"CredentialId\");\nCREATE INDEX \"IX_TotpCodes_CredentialId\" ON \"TotpCodes\" (\"CredentialId\");\n\n-- Clean up temp tables\nDROP TABLE \"__EFMigrationsHistory_temp\";\nDROP TABLE \"Aliases_temp\";\nDROP TABLE \"Services_temp\";\nDROP TABLE \"EncryptionKeys_temp\";\nDROP TABLE \"Settings_temp\";\nDROP TABLE \"Credentials_temp\";\nDROP TABLE \"Attachments_temp\";\nDROP TABLE \"Passwords_temp\";\nDROP TABLE \"TotpCodes_temp\";\n\nPRAGMA foreign_keys = ON;\n\n\nCREATE TABLE \"Passkeys\" (\n    \"Id\" TEXT NOT NULL CONSTRAINT \"PK_Passkeys\" PRIMARY KEY,\n    \"RpId\" TEXT COLLATE NOCASE NOT NULL,\n    \"UserHandle\" BLOB NOT NULL,\n    \"PublicKey\" TEXT NOT NULL,\n    \"PrivateKey\" TEXT NOT NULL,\n    \"PrfKey\" BLOB NULL,\n    \"DisplayName\" TEXT NOT NULL,\n    \"AdditionalData\" BLOB NULL,\n    \"CredentialId\" TEXT NOT NULL,\n    \"CreatedAt\" TEXT NOT NULL,\n    \"UpdatedAt\" TEXT NOT NULL,\n    \"IsDeleted\" INTEGER NOT NULL,\n    CONSTRAINT \"FK_Passkeys_Credentials_CredentialId\" FOREIGN KEY (\"CredentialId\") REFERENCES \"Credentials\" (\"Id\") ON DELETE CASCADE\n);\n\nCREATE INDEX \"IX_Passkeys_CredentialId\" ON \"Passkeys\" (\"CredentialId\");\n\nCREATE INDEX \"IX_Passkeys_RpId\" ON \"Passkeys\" (\"RpId\");\n\nINSERT INTO \"__EFMigrationsHistory\" (\"MigrationId\", \"ProductVersion\")\nVALUES ('20251014122838_1.6.0-AddPasskeys', '9.0.4');\n\nCOMMIT;\n";
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

/**
 * Utility for checking vault version compatibility using semantic versioning
 */

/**
 * Result of version compatibility check
 */
type VersionCompatibilityResult = {
    /**
     * Whether the database version is compatible with the current client
     */
    isCompatible: boolean;
    /**
     * The database version string (e.g., "1.6.1")
     */
    databaseVersion: string;
    /**
     * The current client's version info (if found)
     */
    clientVersion?: VaultVersion;
    /**
     * Whether the database version is known to the client
     */
    isKnownVersion: boolean;
    /**
     * Whether this is a major version difference
     */
    isMajorVersionDifference: boolean;
    /**
     * Whether this is a minor/patch version difference
     */
    isMinorVersionDifference: boolean;
};
/**
 * Check if a database version is compatible with the current client using semantic versioning rules.
 *
 * Compatibility rules:
 * 1. If the database version is known to the client (exists in VAULT_VERSIONS), it's compatible
 * 2. If the database version is unknown:
 *    - Same major version (e.g., 1.6.1 vs 1.6.2 or 1.7.0): Compatible (backwards compatible minor/patch changes)
 *    - Different major version (e.g., 1.6.1 vs 2.0.0): Incompatible (breaking changes)
 *
 * This allows newer database versions with backwards-compatible changes to work with older clients,
 * while still preventing incompatibilities from major version changes.
 *
 * @param databaseVersion - The version string from the database migration (e.g., "1.6.1")
 * @param clientVersionToCompare - Optional client version to compare against (for testing). If not provided, uses the latest version from VAULT_VERSIONS.
 * @returns VersionCompatibilityResult with compatibility information
 */
declare function checkVersionCompatibility(databaseVersion: string, clientVersionToCompare?: string): VersionCompatibilityResult;
/**
 * Get the latest client version from VAULT_VERSIONS.
 *
 * @returns The latest VaultVersion
 */
declare function getLatestClientVersion(): VaultVersion;
/**
 * Extract version from a migration ID.
 *
 * Migration IDs follow the pattern: "YYYYMMDDHHMMSS_X.Y.Z-Description"
 * For example: "20240917191243_1.4.1-RenameAttachmentsPlural"
 *
 * @param migrationId - The migration ID from __EFMigrationsHistory
 * @returns The version string (e.g., "1.4.1") or null if not found
 */
declare function extractVersionFromMigrationId(migrationId: string): string | null;

export { COMPLETE_SCHEMA_SQL, CreateVaultSqlGenerator, MIGRATION_SCRIPTS, type SqlGenerationResult, VAULT_VERSIONS, VaultSqlGenerator, type VaultVersion, type VaultVersionInfo, type VersionCompatibilityResult, checkVersionCompatibility, extractVersionFromMigrationId, getLatestClientVersion };
