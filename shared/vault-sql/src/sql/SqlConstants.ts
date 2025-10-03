/* eslint-disable no-irregular-whitespace */

/**
 * Complete database schema SQL (latest version)
 * Auto-generated from EF Core migrations
 */
export const COMPLETE_SCHEMA_SQL = `
﻿CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
    "MigrationId" TEXT NOT NULL CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY,
    "ProductVersion" TEXT NOT NULL
);

BEGIN TRANSACTION;
CREATE TABLE "Aliases" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Aliases" PRIMARY KEY,
    "Gender" VARCHAR NULL,
    "FirstName" VARCHAR NULL,
    "LastName" VARCHAR NULL,
    "NickName" VARCHAR NULL,
    "BirthDate" TEXT NOT NULL,
    "AddressStreet" VARCHAR NULL,
    "AddressCity" VARCHAR NULL,
    "AddressState" VARCHAR NULL,
    "AddressZipCode" VARCHAR NULL,
    "AddressCountry" VARCHAR NULL,
    "Hobbies" TEXT NULL,
    "EmailPrefix" TEXT NULL,
    "PhoneMobile" TEXT NULL,
    "BankAccountIBAN" TEXT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL
);

CREATE TABLE "Services" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Services" PRIMARY KEY,
    "Name" TEXT NULL,
    "Url" TEXT NULL,
    "Logo" BLOB NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL
);

CREATE TABLE "Credentials" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Credentials" PRIMARY KEY,
    "AliasId" TEXT NOT NULL,
    "Notes" TEXT NULL,
    "Username" TEXT NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "ServiceId" TEXT NOT NULL,
    CONSTRAINT "FK_Credentials_Aliases_AliasId" FOREIGN KEY ("AliasId") REFERENCES "Aliases" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_Credentials_Services_ServiceId" FOREIGN KEY ("ServiceId") REFERENCES "Services" ("Id") ON DELETE CASCADE
);

CREATE TABLE "Attachment" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Attachment" PRIMARY KEY,
    "Filename" TEXT NOT NULL,
    "Blob" BLOB NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "CredentialId" TEXT NOT NULL,
    CONSTRAINT "FK_Attachment_Credentials_CredentialId" FOREIGN KEY ("CredentialId") REFERENCES "Credentials" ("Id") ON DELETE CASCADE
);

CREATE TABLE "Passwords" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Passwords" PRIMARY KEY,
    "Value" TEXT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "CredentialId" TEXT NOT NULL,
    CONSTRAINT "FK_Passwords_Credentials_CredentialId" FOREIGN KEY ("CredentialId") REFERENCES "Credentials" ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_Attachment_CredentialId" ON "Attachment" ("CredentialId");

CREATE INDEX "IX_Credentials_AliasId" ON "Credentials" ("AliasId");

CREATE INDEX "IX_Credentials_ServiceId" ON "Credentials" ("ServiceId");

CREATE INDEX "IX_Passwords_CredentialId" ON "Passwords" ("CredentialId");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240708094944_1.0.0-InitialMigration', '9.0.4');

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240708224522_1.0.1-EmptyTestMigration', '9.0.4');

ALTER TABLE "Aliases" RENAME COLUMN "EmailPrefix" TO "Email";

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240711204207_1.0.2-ChangeEmailColumn', '9.0.4');

CREATE TABLE "EncryptionKeys" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_EncryptionKeys" PRIMARY KEY,
    "PublicKey" TEXT NOT NULL,
    "PrivateKey" TEXT NOT NULL,
    "IsPrimary" INTEGER NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL
);

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240729105618_1.1.0-AddPkiTables', '9.0.4');

CREATE TABLE "Settings" (
    "Key" TEXT NOT NULL CONSTRAINT "PK_Settings" PRIMARY KEY,
    "Value" TEXT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL
);

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240805073413_1.2.0-AddSettingsTable', '9.0.4');

CREATE TABLE "ef_temp_Aliases" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Aliases" PRIMARY KEY,
    "BirthDate" TEXT NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "Email" TEXT NULL,
    "FirstName" VARCHAR NULL,
    "Gender" VARCHAR NULL,
    "LastName" VARCHAR NULL,
    "NickName" VARCHAR NULL,
    "UpdatedAt" TEXT NOT NULL
);

INSERT INTO "ef_temp_Aliases" ("Id", "BirthDate", "CreatedAt", "Email", "FirstName", "Gender", "LastName", "NickName", "UpdatedAt")
SELECT "Id", "BirthDate", "CreatedAt", "Email", "FirstName", "Gender", "LastName", "NickName", "UpdatedAt"
FROM "Aliases";

COMMIT;

PRAGMA foreign_keys = 0;

BEGIN TRANSACTION;
DROP TABLE "Aliases";

ALTER TABLE "ef_temp_Aliases" RENAME TO "Aliases";

COMMIT;

PRAGMA foreign_keys = 1;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240805122422_1.3.0-UpdateIdentityStructure', '9.0.4');

BEGIN TRANSACTION;
CREATE TABLE "ef_temp_Credentials" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Credentials" PRIMARY KEY,
    "AliasId" TEXT NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "Notes" TEXT NULL,
    "ServiceId" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "Username" TEXT NULL,
    CONSTRAINT "FK_Credentials_Aliases_AliasId" FOREIGN KEY ("AliasId") REFERENCES "Aliases" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_Credentials_Services_ServiceId" FOREIGN KEY ("ServiceId") REFERENCES "Services" ("Id") ON DELETE CASCADE
);

INSERT INTO "ef_temp_Credentials" ("Id", "AliasId", "CreatedAt", "Notes", "ServiceId", "UpdatedAt", "Username")
SELECT "Id", "AliasId", "CreatedAt", "Notes", "ServiceId", "UpdatedAt", "Username"
FROM "Credentials";

COMMIT;

PRAGMA foreign_keys = 0;

BEGIN TRANSACTION;
DROP TABLE "Credentials";

ALTER TABLE "ef_temp_Credentials" RENAME TO "Credentials";

COMMIT;

PRAGMA foreign_keys = 1;

BEGIN TRANSACTION;
CREATE INDEX "IX_Credentials_AliasId" ON "Credentials" ("AliasId");

CREATE INDEX "IX_Credentials_ServiceId" ON "Credentials" ("ServiceId");

COMMIT;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240812141727_1.3.1-MakeUsernameOptional', '9.0.4');

BEGIN TRANSACTION;
ALTER TABLE "Settings" ADD "IsDeleted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Services" ADD "IsDeleted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Passwords" ADD "IsDeleted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "EncryptionKeys" ADD "IsDeleted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Credentials" ADD "IsDeleted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Attachment" ADD "IsDeleted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Aliases" ADD "IsDeleted" INTEGER NOT NULL DEFAULT 0;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240916105320_1.4.0-AddSyncSupport', '9.0.4');

ALTER TABLE "Attachment" RENAME TO "Attachments";

CREATE TABLE "ef_temp_Attachments" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Attachments" PRIMARY KEY,
    "Blob" BLOB NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "CredentialId" TEXT NOT NULL,
    "Filename" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    CONSTRAINT "FK_Attachments_Credentials_CredentialId" FOREIGN KEY ("CredentialId") REFERENCES "Credentials" ("Id") ON DELETE CASCADE
);

INSERT INTO "ef_temp_Attachments" ("Id", "Blob", "CreatedAt", "CredentialId", "Filename", "IsDeleted", "UpdatedAt")
SELECT "Id", "Blob", "CreatedAt", "CredentialId", "Filename", "IsDeleted", "UpdatedAt"
FROM "Attachments";

COMMIT;

PRAGMA foreign_keys = 0;

BEGIN TRANSACTION;
DROP TABLE "Attachments";

ALTER TABLE "ef_temp_Attachments" RENAME TO "Attachments";

COMMIT;

PRAGMA foreign_keys = 1;

BEGIN TRANSACTION;
CREATE INDEX "IX_Attachments_CredentialId" ON "Attachments" ("CredentialId");

COMMIT;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240917191243_1.4.1-RenameAttachmentsPlural', '9.0.4');

BEGIN TRANSACTION;
CREATE TABLE "TotpCodes" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_TotpCodes" PRIMARY KEY,
    "Name" TEXT NOT NULL,
    "SecretKey" TEXT NOT NULL,
    "CredentialId" TEXT NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    CONSTRAINT "FK_TotpCodes_Credentials_CredentialId" FOREIGN KEY ("CredentialId") REFERENCES "Credentials" ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_TotpCodes_CredentialId" ON "TotpCodes" ("CredentialId");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20250310131554_1.5.0-AddTotpCodes', '9.0.4');

CREATE TABLE "Passkeys" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Passkeys" PRIMARY KEY,
    "CredentialId" TEXT NOT NULL,
    "RpId" TEXT COLLATE NOCASE NOT NULL,
    "UserId" TEXT NULL,
    "PublicKey" TEXT NOT NULL,
    "PrivateKey" TEXT NOT NULL,
    "DisplayName" TEXT NOT NULL,
    "AdditionalData" BLOB NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    CONSTRAINT "FK_Passkeys_Credentials_CredentialId" FOREIGN KEY ("CredentialId") REFERENCES "Credentials" ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_Passkeys_CredentialId" ON "Passkeys" ("CredentialId");

CREATE INDEX "IX_Passkeys_RpId" ON "Passkeys" ("RpId");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20251003045732_1.6.0-AddPasskeys', '9.0.4');

COMMIT;
`;
/**
 * Individual migration SQL scripts
 * Auto-generated from EF Core migrations
 */
export const MIGRATION_SCRIPTS: Record<number, string> = {
  1: `﻿BEGIN TRANSACTION;
INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240708224522_1.0.1-EmptyTestMigration', '9.0.4');

COMMIT;`,
  2: `﻿BEGIN TRANSACTION;
ALTER TABLE "Aliases" RENAME COLUMN "EmailPrefix" TO "Email";

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240711204207_1.0.2-ChangeEmailColumn', '9.0.4');

COMMIT;`,
  3: `﻿BEGIN TRANSACTION;
CREATE TABLE "EncryptionKeys" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_EncryptionKeys" PRIMARY KEY,
    "PublicKey" TEXT NOT NULL,
    "PrivateKey" TEXT NOT NULL,
    "IsPrimary" INTEGER NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL
);

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240729105618_1.1.0-AddPkiTables', '9.0.4');

COMMIT;`,
  4: `﻿BEGIN TRANSACTION;
CREATE TABLE "Settings" (
    "Key" TEXT NOT NULL CONSTRAINT "PK_Settings" PRIMARY KEY,
    "Value" TEXT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL
);

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240805073413_1.2.0-AddSettingsTable', '9.0.4');

COMMIT;`,
  5: `﻿BEGIN TRANSACTION;
CREATE TABLE "ef_temp_Aliases" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Aliases" PRIMARY KEY,
    "BirthDate" TEXT NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "Email" TEXT NULL,
    "FirstName" VARCHAR NULL,
    "Gender" VARCHAR NULL,
    "LastName" VARCHAR NULL,
    "NickName" VARCHAR NULL,
    "UpdatedAt" TEXT NOT NULL
);

INSERT INTO "ef_temp_Aliases" ("Id", "BirthDate", "CreatedAt", "Email", "FirstName", "Gender", "LastName", "NickName", "UpdatedAt")
SELECT "Id", "BirthDate", "CreatedAt", "Email", "FirstName", "Gender", "LastName", "NickName", "UpdatedAt"
FROM "Aliases";

COMMIT;

PRAGMA foreign_keys = 0;

BEGIN TRANSACTION;
DROP TABLE "Aliases";

ALTER TABLE "ef_temp_Aliases" RENAME TO "Aliases";

COMMIT;

PRAGMA foreign_keys = 1;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240805122422_1.3.0-UpdateIdentityStructure', '9.0.4');`,
  6: `﻿BEGIN TRANSACTION;
CREATE TABLE "ef_temp_Credentials" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Credentials" PRIMARY KEY,
    "AliasId" TEXT NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "Notes" TEXT NULL,
    "ServiceId" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "Username" TEXT NULL,
    CONSTRAINT "FK_Credentials_Aliases_AliasId" FOREIGN KEY ("AliasId") REFERENCES "Aliases" ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_Credentials_Services_ServiceId" FOREIGN KEY ("ServiceId") REFERENCES "Services" ("Id") ON DELETE CASCADE
);

INSERT INTO "ef_temp_Credentials" ("Id", "AliasId", "CreatedAt", "Notes", "ServiceId", "UpdatedAt", "Username")
SELECT "Id", "AliasId", "CreatedAt", "Notes", "ServiceId", "UpdatedAt", "Username"
FROM "Credentials";

COMMIT;

PRAGMA foreign_keys = 0;

BEGIN TRANSACTION;
DROP TABLE "Credentials";

ALTER TABLE "ef_temp_Credentials" RENAME TO "Credentials";

COMMIT;

PRAGMA foreign_keys = 1;

BEGIN TRANSACTION;
CREATE INDEX "IX_Credentials_AliasId" ON "Credentials" ("AliasId");

CREATE INDEX "IX_Credentials_ServiceId" ON "Credentials" ("ServiceId");

COMMIT;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240812141727_1.3.1-MakeUsernameOptional', '9.0.4');`,
  7: `﻿BEGIN TRANSACTION;
ALTER TABLE "Settings" ADD "IsDeleted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Services" ADD "IsDeleted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Passwords" ADD "IsDeleted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "EncryptionKeys" ADD "IsDeleted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Credentials" ADD "IsDeleted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Attachment" ADD "IsDeleted" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Aliases" ADD "IsDeleted" INTEGER NOT NULL DEFAULT 0;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240916105320_1.4.0-AddSyncSupport', '9.0.4');

COMMIT;`,
  8: `﻿BEGIN TRANSACTION;
ALTER TABLE "Attachment" RENAME TO "Attachments";

CREATE TABLE "ef_temp_Attachments" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Attachments" PRIMARY KEY,
    "Blob" BLOB NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "CredentialId" TEXT NOT NULL,
    "Filename" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    CONSTRAINT "FK_Attachments_Credentials_CredentialId" FOREIGN KEY ("CredentialId") REFERENCES "Credentials" ("Id") ON DELETE CASCADE
);

INSERT INTO "ef_temp_Attachments" ("Id", "Blob", "CreatedAt", "CredentialId", "Filename", "IsDeleted", "UpdatedAt")
SELECT "Id", "Blob", "CreatedAt", "CredentialId", "Filename", "IsDeleted", "UpdatedAt"
FROM "Attachments";

COMMIT;

PRAGMA foreign_keys = 0;

BEGIN TRANSACTION;
DROP TABLE "Attachments";

ALTER TABLE "ef_temp_Attachments" RENAME TO "Attachments";

COMMIT;

PRAGMA foreign_keys = 1;

BEGIN TRANSACTION;
CREATE INDEX "IX_Attachments_CredentialId" ON "Attachments" ("CredentialId");

COMMIT;

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20240917191243_1.4.1-RenameAttachmentsPlural', '9.0.4');`,
  9: `﻿BEGIN TRANSACTION;
CREATE TABLE "TotpCodes" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_TotpCodes" PRIMARY KEY,
    "Name" TEXT NOT NULL,
    "SecretKey" TEXT NOT NULL,
    "CredentialId" TEXT NOT NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    CONSTRAINT "FK_TotpCodes_Credentials_CredentialId" FOREIGN KEY ("CredentialId") REFERENCES "Credentials" ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_TotpCodes_CredentialId" ON "TotpCodes" ("CredentialId");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20250310131554_1.5.0-AddTotpCodes', '9.0.4');

COMMIT;`,
  10: `﻿BEGIN TRANSACTION;
CREATE TABLE "Passkeys" (
    "Id" TEXT NOT NULL CONSTRAINT "PK_Passkeys" PRIMARY KEY,
    "CredentialId" TEXT NOT NULL,
    "RpId" TEXT COLLATE NOCASE NOT NULL,
    "UserId" TEXT NULL,
    "PublicKey" TEXT NOT NULL,
    "PrivateKey" TEXT NOT NULL,
    "DisplayName" TEXT NOT NULL,
    "AdditionalData" BLOB NULL,
    "CreatedAt" TEXT NOT NULL,
    "UpdatedAt" TEXT NOT NULL,
    "IsDeleted" INTEGER NOT NULL,
    CONSTRAINT "FK_Passkeys_Credentials_CredentialId" FOREIGN KEY ("CredentialId") REFERENCES "Credentials" ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_Passkeys_CredentialId" ON "Passkeys" ("CredentialId");

CREATE INDEX "IX_Passkeys_RpId" ON "Passkeys" ("RpId");

INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20251003045732_1.6.0-AddPasskeys', '9.0.4');

COMMIT;`,
};
