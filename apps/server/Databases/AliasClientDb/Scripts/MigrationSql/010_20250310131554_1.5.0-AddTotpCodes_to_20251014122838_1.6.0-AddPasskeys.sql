BEGIN TRANSACTION;

PRAGMA foreign_keys = OFF;

-- Clean up any existing temp tables first
DROP TABLE IF EXISTS "__EFMigrationsHistory_temp";
DROP TABLE IF EXISTS "Aliases_temp";
DROP TABLE IF EXISTS "Services_temp";
DROP TABLE IF EXISTS "EncryptionKeys_temp";
DROP TABLE IF EXISTS "Settings_temp";
DROP TABLE IF EXISTS "Credentials_temp";
DROP TABLE IF EXISTS "Attachments_temp";
DROP TABLE IF EXISTS "Passwords_temp";
DROP TABLE IF EXISTS "TotpCodes_temp";

-- Create backup tables for all data
CREATE TABLE "__EFMigrationsHistory_temp" AS SELECT * FROM "__EFMigrationsHistory";
CREATE TABLE "Aliases_temp" AS SELECT * FROM "Aliases";
CREATE TABLE "Services_temp" AS SELECT * FROM "Services";
CREATE TABLE "EncryptionKeys_temp" AS SELECT * FROM "EncryptionKeys";
CREATE TABLE "Settings_temp" AS SELECT * FROM "Settings";
CREATE TABLE "Credentials_temp" AS SELECT * FROM "Credentials";
CREATE TABLE "Attachments_temp" AS SELECT * FROM "Attachments";
CREATE TABLE "Passwords_temp" AS SELECT * FROM "Passwords";
CREATE TABLE "TotpCodes_temp" AS SELECT * FROM "TotpCodes";

-- Delete orphaned records that do not have a valid FK to the credential object
DELETE FROM "Attachments_temp" WHERE "CredentialId" NOT IN (SELECT "Id" FROM "Credentials_temp");
DELETE FROM "Passwords_temp" WHERE "CredentialId" NOT IN (SELECT "Id" FROM "Credentials_temp");
DELETE FROM "TotpCodes_temp" WHERE "CredentialId" NOT IN (SELECT "Id" FROM "Credentials_temp");

-- Delete orphaned credentials that do not have valid FKs to alias or service objects
DELETE FROM "Credentials_temp" WHERE "AliasId" NOT IN (SELECT "Id" FROM "Aliases_temp");
DELETE FROM "Credentials_temp" WHERE "ServiceId" NOT IN (SELECT "Id" FROM "Services_temp");

-- After cleaning credentials, clean dependent tables again in case we removed credentials
DELETE FROM "Attachments_temp" WHERE "CredentialId" NOT IN (SELECT "Id" FROM "Credentials_temp");
DELETE FROM "Passwords_temp" WHERE "CredentialId" NOT IN (SELECT "Id" FROM "Credentials_temp");
DELETE FROM "TotpCodes_temp" WHERE "CredentialId" NOT IN (SELECT "Id" FROM "Credentials_temp");

-- Drop all existing tables
DROP TABLE "TotpCodes";
DROP TABLE "Passwords";
DROP TABLE "Attachments";
DROP TABLE "Credentials";
DROP TABLE "Settings";
DROP TABLE "EncryptionKeys";
DROP TABLE "Services";
DROP TABLE "Aliases";
DROP TABLE "__EFMigrationsHistory";

-- Recreate tables with proper constraints (no dependencies first)
CREATE TABLE "__EFMigrationsHistory" (
    "MigrationId" TEXT NOT NULL CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY,
    "ProductVersion" TEXT NOT NULL
);

CREATE TABLE "Aliases" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Aliases" PRIMARY KEY,
    "BirthDate" TEXT NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "Email" TEXT NULL,
    "FirstName" VARCHAR NULL,
    "Gender" VARCHAR NULL,
    "LastName" VARCHAR NULL,
    "NickName" VARCHAR NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "Services" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Services" PRIMARY KEY,
    "Name" TEXT NULL,
    "Url" TEXT NULL,
    "Logo" BLOB NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "EncryptionKeys" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_EncryptionKeys" PRIMARY KEY,
    "PublicKey" TEXT NOT NULL,
    "PrivateKey" TEXT NOT NULL,
    "IsPrimary" INTEGER NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "Settings" (
    "Key" TEXT NOT NULL CONSTRAINT "PK_Settings" PRIMARY KEY,
    "Value" TEXT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL DEFAULT 0
);

-- Tables with foreign keys
CREATE TABLE "Credentials" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Credentials" PRIMARY KEY,
    "AliasId" TEXT NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "Notes" TEXT NULL,
    "ServiceId" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "Username" TEXT NULL,
    "IsDeleted" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "FK_Credentials_Aliases_AliasId" FOREIGN KEY ("AliasId") REFERENCES "Aliases" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_Credentials_Services_ServiceId" FOREIGN KEY ("ServiceId") REFERENCES "Services" ("Id") ON DELETE CASCADE
);

CREATE TABLE "Attachments" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Attachments" PRIMARY KEY,
    "Blob" BLOB NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "CredentialId" TEXT NOT NULL,
    "Filename" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL DEFAULT 0,
    "UpdatedAt" TEXT NOT NULL,
    CONSTRAINT "FK_Attachments_Credentials_CredentialId" FOREIGN KEY ("CredentialId") REFERENCES "Credentials" ("Id") ON DELETE CASCADE
);

CREATE TABLE "Passwords" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Passwords" PRIMARY KEY,
    "Value" TEXT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "CredentialId" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "FK_Passwords_Credentials_CredentialId" FOREIGN KEY ("CredentialId") REFERENCES "Credentials" ("Id") ON DELETE CASCADE
);

CREATE TABLE "TotpCodes" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_TotpCodes" PRIMARY KEY,
    "Name" TEXT NOT NULL,
    "SecretKey" TEXT NOT NULL,
    "CredentialId" TEXT NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "FK_TotpCodes_Credentials_CredentialId" FOREIGN KEY ("CredentialId") REFERENCES "Credentials" ("Id") ON DELETE CASCADE
);


-- Restore data from temp tables
INSERT INTO "__EFMigrationsHistory" SELECT * FROM "__EFMigrationsHistory_temp";
INSERT INTO "Aliases" SELECT * FROM "Aliases_temp";
INSERT INTO "Services" SELECT * FROM "Services_temp";
INSERT INTO "EncryptionKeys" SELECT * FROM "EncryptionKeys_temp";
INSERT INTO "Settings" SELECT * FROM "Settings_temp";
INSERT INTO "Credentials" SELECT * FROM "Credentials_temp";
INSERT INTO "Attachments" SELECT * FROM "Attachments_temp";
INSERT INTO "Passwords" SELECT * FROM "Passwords_temp";
INSERT INTO "TotpCodes" SELECT * FROM "TotpCodes_temp";

-- Recreate indexes
CREATE INDEX "IX_Credentials_AliasId" ON "Credentials" ("AliasId");
CREATE INDEX "IX_Credentials_ServiceId" ON "Credentials" ("ServiceId");
CREATE INDEX "IX_Attachments_CredentialId" ON "Attachments" ("CredentialId");
CREATE INDEX "IX_Passwords_CredentialId" ON "Passwords" ("CredentialId");
CREATE INDEX "IX_TotpCodes_CredentialId" ON "TotpCodes" ("CredentialId");

-- Clean up temp tables
DROP TABLE "__EFMigrationsHistory_temp";
DROP TABLE "Aliases_temp";
DROP TABLE "Services_temp";
DROP TABLE "EncryptionKeys_temp";
DROP TABLE "Settings_temp";
DROP TABLE "Credentials_temp";
DROP TABLE "Attachments_temp";
DROP TABLE "Passwords_temp";
DROP TABLE "TotpCodes_temp";

PRAGMA foreign_keys = ON;


CREATE TABLE "Passkeys" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Passkeys" PRIMARY KEY,
    "RpId" TEXT COLLATE NOCASE NOT NULL,
    "UserHandle" BLOB NOT NULL,
    "PublicKey" TEXT NOT NULL,
    "PrivateKey" TEXT NOT NULL,
    "PrfKey" BLOB NULL,
    "DisplayName" TEXT NOT NULL,
    "AdditionalData" BLOB NULL,
    "CredentialId" TEXT NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    CONSTRAINT "FK_Passkeys_Credentials_CredentialId" FOREIGN KEY ("CredentialId") REFERENCES "Credentials" ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_Passkeys_CredentialId" ON "Passkeys" ("CredentialId");

CREATE INDEX "IX_Passkeys_RpId" ON "Passkeys" ("RpId");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20251014122838_1.6.0-AddPasskeys', '9.0.4');

COMMIT;

